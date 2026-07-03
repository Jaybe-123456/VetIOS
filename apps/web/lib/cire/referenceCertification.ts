import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CIRE_CONFORMANCE_REPORT } from './conformance';
import { CIRE_STANDARD_VERSION } from './standard';
import {
    buildCireCertificationAssessment,
    type CireCertificationAssessment,
} from './certification';

export interface ReferenceCireCertificationResult {
    certification_id: string | null;
    request_id: string;
    cached: boolean;
    certification_status: CireCertificationAssessment['certification_status'];
    conformance_result: CireCertificationAssessment['conformance_result'];
    conformance_score: number;
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
    public_listing_eligible: boolean;
    signed_payload_hash: string;
    blockers: string[];
}

export function buildReferenceCireCertificationRequestId(tenantId: string): string {
    return stableUuid(`cire-reference-certification:${tenantId}:${CIRE_STANDARD_VERSION}`);
}

export function buildReferenceCireCertificationAssessment(): CireCertificationAssessment {
    return buildCireCertificationAssessment({
        standardVersion: CIRE_STANDARD_VERSION,
        implementationName: '@vetios/cire-engine',
        implementationVersion: CIRE_STANDARD_VERSION,
        implementationUrl: 'https://github.com/Jaybe-123456/VetIOS/tree/main/packages/cire-engine',
        packageName: '@vetios/cire-engine',
        repositoryUrl: 'https://github.com/Jaybe-123456/VetIOS',
        artifactUrl: 'https://www.vetios.tech/api/public/cire-conformance',
        report: CIRE_CONFORMANCE_REPORT,
        verificationStatus: 'self_attested',
        publicListingEligible: true,
        publicListingLabel: 'VetIOS reference CIRE engine',
        limitations: 'Reference conformance certificate generated from the bundled CIRE fixture. This proves standard compatibility, not clinical safety, outcome calibration, or production deployment quality.',
    });
}

export async function submitReferenceCireCertification(
    client: SupabaseClient,
    tenantId: string,
    observedAt = new Date().toISOString(),
): Promise<ReferenceCireCertificationResult> {
    const requestId = buildReferenceCireCertificationRequestId(tenantId);
    const assessment = buildReferenceCireCertificationAssessment();

    const { data, error } = await client
        .from('cire_conformance_certification_events')
        .insert({
            tenant_id: tenantId,
            request_id: requestId,
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
            observed_at: observedAt,
        })
        .select('id, certification_status, conformance_result, conformance_score, total_checks, passed_checks, failed_checks, public_listing_eligible, signed_payload_hash')
        .single();

    if (error) {
        if (error.code === '23505') {
            const cached = await loadCachedReferenceCertification(client, tenantId, requestId, assessment);
            if (cached) return cached;
        }
        throw new Error(`Failed to submit reference CIRE certification: ${error.message}`);
    }

    return mapCertificationResult(data as Record<string, unknown>, requestId, assessment, false);
}

async function loadCachedReferenceCertification(
    client: SupabaseClient,
    tenantId: string,
    requestId: string,
    assessment: CireCertificationAssessment,
): Promise<ReferenceCireCertificationResult | null> {
    const { data } = await client
        .from('cire_conformance_certification_events')
        .select('id, certification_status, conformance_result, conformance_score, total_checks, passed_checks, failed_checks, public_listing_eligible, signed_payload_hash')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();

    return data ? mapCertificationResult(data as Record<string, unknown>, requestId, assessment, true) : null;
}

function mapCertificationResult(
    row: Record<string, unknown>,
    requestId: string,
    assessment: CireCertificationAssessment,
    cached: boolean,
): ReferenceCireCertificationResult {
    return {
        certification_id: normalizeOptionalText(row.id),
        request_id: requestId,
        cached,
        certification_status: normalizeCertificationStatus(row.certification_status, assessment.certification_status),
        conformance_result: row.conformance_result === 'passed' ? 'passed' : 'failed',
        conformance_score: readNumber(row.conformance_score, assessment.conformance_score),
        total_checks: readInteger(row.total_checks, assessment.total_checks),
        passed_checks: readInteger(row.passed_checks, assessment.passed_checks),
        failed_checks: readInteger(row.failed_checks, assessment.failed_checks),
        public_listing_eligible: Boolean(row.public_listing_eligible ?? assessment.public_listing_eligible),
        signed_payload_hash: normalizeHash(row.signed_payload_hash) ?? assessment.signed_payload_hash,
        blockers: assessment.blockers,
    };
}

function normalizeCertificationStatus(
    value: unknown,
    fallback: CireCertificationAssessment['certification_status'],
): CireCertificationAssessment['certification_status'] {
    return value === 'submitted' || value === 'passed' || value === 'failed' || value === 'revoked' || value === 'expired'
        ? value
        : fallback;
}

function stableUuid(seed: string): string {
    const hash = createHash('sha256').update(seed).digest('hex');
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `4${hash.slice(13, 16)}`,
        `8${hash.slice(17, 20)}`,
        hash.slice(20, 32),
    ].join('-');
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeHash(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function readNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
}

function readInteger(value: unknown, fallback: number): number {
    return Math.max(0, Math.round(readNumber(value, fallback)));
}
