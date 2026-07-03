import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { CireConformanceReport } from '@vetios/cire-engine';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    CIRE_CERTIFICATION_VERIFICATION_STATUSES,
    buildCireCertificationAssessment,
    buildPublicCireCertificationRegistry,
    type CireCertificationEventRow,
} from '@/lib/cire/certification';
import { apiGuard } from '@/lib/http/apiGuard';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});
const ConformanceReportSchema = z.object({
    standard_version: z.string().min(1),
    implementation: z.object({
        name: z.string().optional(),
        version: z.string().optional(),
        url: z.string().optional(),
    }).optional(),
    differential_cases: z.array(JsonRecordSchema).optional(),
    input_cases: z.array(JsonRecordSchema).optional(),
    cps_cases: z.array(JsonRecordSchema).optional(),
    output_vector_cases: z.array(JsonRecordSchema).optional(),
}).passthrough();

const CireCertificationSchema = z.object({
    request_id: z.string().uuid().optional(),
    external_validation_event_id: z.string().uuid().optional(),
    standard_version: z.string().min(1).max(32).optional(),
    implementation_name: z.string().min(2).max(180),
    implementation_version: z.string().max(80).optional(),
    implementation_url: z.string().url().max(500).optional(),
    package_name: z.string().max(180).optional(),
    repository_url: z.string().url().max(500).optional(),
    artifact_url: z.string().url().max(500).optional(),
    report: ConformanceReportSchema,
    verification_status: z.enum(CIRE_CERTIFICATION_VERIFICATION_STATUSES).default('self_attested'),
    public_listing_eligible: z.boolean().default(false),
    public_listing_label: z.string().min(3).max(180).optional(),
    signed_payload_hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    signature_algorithm: z.string().max(80).optional(),
    signature_hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    signing_key_fingerprint: z.string().max(160).optional(),
    limitations: z.string().max(2000).optional(),
    observed_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['evaluation:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = CireCertificationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    let assessment;
    try {
        assessment = buildCireCertificationAssessment({
            standardVersion: parsed.data.standard_version,
            implementationName: parsed.data.implementation_name,
            implementationVersion: parsed.data.implementation_version,
            implementationUrl: parsed.data.implementation_url,
            packageName: parsed.data.package_name,
            repositoryUrl: parsed.data.repository_url,
            artifactUrl: parsed.data.artifact_url,
            report: parsed.data.report as CireConformanceReport,
            verificationStatus: parsed.data.verification_status,
            publicListingEligible: parsed.data.public_listing_eligible,
            publicListingLabel: parsed.data.public_listing_label,
            signedPayloadHash: parsed.data.signed_payload_hash,
            signatureAlgorithm: parsed.data.signature_algorithm,
            signatureHash: parsed.data.signature_hash,
            signingKeyFingerprint: parsed.data.signing_key_fingerprint,
            limitations: parsed.data.limitations,
        });
    } catch (error) {
        return NextResponse.json(
            { error: 'invalid_certification', detail: error instanceof Error ? error.message : 'Invalid CIRE certification.' },
            { status: 400 },
        );
    }

    const requestId = parsed.data.request_id ?? randomUUID();
    const { data, error } = await client
        .from('cire_conformance_certification_events')
        .insert({
            tenant_id: auth.actor.tenantId,
            request_id: requestId,
            external_validation_event_id: parsed.data.external_validation_event_id ?? null,
            standard_version: assessment.standard_version,
            implementation_name: assessment.implementation_name,
            implementation_version: assessment.implementation_version,
            implementation_url: assessment.implementation_url,
            package_name: assessment.package_name,
            repository_url: assessment.repository_url,
            artifact_url: assessment.artifact_url,
            certification_status: assessment.certification_status,
            verification_status: assessment.verification_status,
            conformance_result: assessment.conformance_result,
            total_checks: assessment.total_checks,
            passed_checks: assessment.passed_checks,
            failed_checks: assessment.failed_checks,
            conformance_score: assessment.conformance_score,
            public_listing_eligible: assessment.public_listing_eligible,
            public_listing_label: assessment.public_listing_label,
            signed_payload_hash: assessment.signed_payload_hash,
            signature_algorithm: assessment.signature_algorithm,
            signature_hash: assessment.signature_hash,
            signing_key_fingerprint: assessment.signing_key_fingerprint,
            report: assessment.report,
            validation: assessment.validation,
            limitations: assessment.limitations,
            observed_at: parsed.data.observed_at ?? new Date().toISOString(),
        })
        .select('id, certification_status, conformance_result, conformance_score, total_checks, passed_checks, failed_checks, public_listing_eligible')
        .single();

    if (error) {
        if (error.code === '23505') {
            const cached = await loadCachedCertification(client, auth.actor.tenantId, requestId);
            if (cached) return NextResponse.json({ ...cached, cached: true, error: null });
        }
        return NextResponse.json(
            { error: 'cire_certification_store_failed', detail: error.message },
            { status: 503 },
        );
    }

    return NextResponse.json({
        certification_id: String(data.id),
        certification_status: String(data.certification_status ?? assessment.certification_status),
        conformance_result: String(data.conformance_result ?? assessment.conformance_result),
        conformance_score: Number(data.conformance_score ?? assessment.conformance_score),
        total_checks: Number(data.total_checks ?? assessment.total_checks),
        passed_checks: Number(data.passed_checks ?? assessment.passed_checks),
        failed_checks: Number(data.failed_checks ?? assessment.failed_checks),
        public_listing_eligible: Boolean(data.public_listing_eligible ?? assessment.public_listing_eligible),
        blockers: assessment.blockers,
        cached: false,
        error: null,
    });
}

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['evaluation:read'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await client
        .from('cire_conformance_certification_events')
        .select('id, standard_version, implementation_name, implementation_version, implementation_url, package_name, repository_url, artifact_url, certification_status, verification_status, conformance_result, total_checks, passed_checks, failed_checks, conformance_score, public_listing_eligible, public_listing_label, signed_payload_hash, signature_algorithm, signature_hash, signing_key_fingerprint, observed_at, created_at')
        .eq('tenant_id', auth.actor.tenantId)
        .order('observed_at', { ascending: false })
        .limit(200);

    if (error) {
        return NextResponse.json({ error: 'cire_certifications_unavailable' }, { status: 503 });
    }

    const rows = (Array.isArray(data) ? data : []) as CireCertificationEventRow[];
    return NextResponse.json({
        total_certifications: rows.length,
        public_registry_preview: buildPublicCireCertificationRegistry(rows),
        certifications: rows.map((row) => ({
            certification_id: row.id ?? null,
            standard_version: row.standard_version ?? null,
            implementation_name: row.implementation_name ?? null,
            implementation_version: row.implementation_version ?? null,
            certification_status: row.certification_status ?? null,
            verification_status: row.verification_status ?? null,
            conformance_result: row.conformance_result ?? null,
            conformance_score: row.conformance_score ?? null,
            total_checks: row.total_checks ?? null,
            passed_checks: row.passed_checks ?? null,
            failed_checks: row.failed_checks ?? null,
            public_listing_eligible: row.public_listing_eligible ?? false,
            signed_payload_hash: row.signed_payload_hash ?? null,
            observed_at: row.observed_at ?? row.created_at ?? null,
        })),
        error: null,
    });
}

async function loadCachedCertification(
    client: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
) {
    const { data } = await client
        .from('cire_conformance_certification_events')
        .select('id, certification_status, conformance_result, conformance_score, total_checks, passed_checks, failed_checks, public_listing_eligible')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();

    if (!data?.id) return null;
    return {
        certification_id: String(data.id),
        certification_status: String(data.certification_status ?? 'submitted'),
        conformance_result: String(data.conformance_result ?? 'failed'),
        conformance_score: Number(data.conformance_score ?? 0),
        total_checks: Number(data.total_checks ?? 0),
        passed_checks: Number(data.passed_checks ?? 0),
        failed_checks: Number(data.failed_checks ?? 0),
        public_listing_eligible: Boolean(data.public_listing_eligible),
    };
}
