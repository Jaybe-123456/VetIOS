import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { ingestModelAttestationEvidence } from '@/lib/modelTrust/service';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EvidenceIngestionRequest {
    tenant_id?: string;
    registry_id?: string;
    public_slug?: string;
    publication_id?: string | null;
    source_system?: string;
    source_ref?: string;
    attestation_type?: string;
    attestor_name?: string;
    summary?: string;
    evidence_uri?: string | null;
    signed_payload_hash?: string | null;
    signature_algorithm?: string | null;
    signature_hash?: string | null;
    signature_material?: string | null;
    signing_key_fingerprint?: string | null;
    verification_status?: 'unsigned' | 'pending' | 'verified' | 'failed';
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const auth = authorizeEvidenceIngestion(req);
    if (!auth.ok) {
        return withTimedJson(
            { error: auth.error, request_id: requestId },
            auth.status,
            requestId,
            startTime,
        );
    }

    const parsed = await safeJson<EvidenceIngestionRequest>(req);
    if (!parsed.ok) {
        return withTimedJson({ error: parsed.error, request_id: requestId }, 400, requestId, startTime);
    }

    const tenantId = normalizeText(parsed.data.tenant_id)
        ?? normalizeText(process.env.VETIOS_PUBLIC_TENANT_ID)
        ?? normalizeText(process.env.VETIOS_DEV_TENANT_ID);
    if (!tenantId) {
        return withTimedJson(
            { error: 'tenant_id is required when VETIOS_PUBLIC_TENANT_ID is not configured.', request_id: requestId },
            400,
            requestId,
            startTime,
        );
    }

    try {
        const result = await ingestModelAttestationEvidence(getSupabaseServer(), {
            tenantId,
            actor: `evidence_ingest:${auth.keyFingerprint}`,
            registryId: parsed.data.registry_id,
            publicSlug: parsed.data.public_slug,
            publicationId: parsed.data.publication_id,
            sourceSystem: parsed.data.source_system ?? '',
            sourceRef: parsed.data.source_ref,
            attestationType: parsed.data.attestation_type ?? '',
            attestorName: parsed.data.attestor_name ?? '',
            summary: parsed.data.summary ?? '',
            evidenceUri: parsed.data.evidence_uri,
            signedPayloadHash: parsed.data.signed_payload_hash,
            signatureAlgorithm: parsed.data.signature_algorithm,
            signatureHash: parsed.data.signature_hash,
            signatureMaterial: parsed.data.signature_material,
            signingKeyFingerprint: parsed.data.signing_key_fingerprint,
            verificationStatus: parsed.data.verification_status,
            payload: parsed.data.payload ?? {},
            metadata: {
                ...(parsed.data.metadata ?? {}),
                ingestion_route: '/api/public/model-cards/evidence',
                key_fingerprint: auth.keyFingerprint,
            },
        });

        return withTimedJson(
            {
                ingestion: result.ingestion,
                attestation: result.attestation,
                duplicate: result.duplicate,
                materialization_error: result.materialization_error,
                request_id: requestId,
            },
            result.materialization_error ? 202 : result.duplicate ? 200 : 201,
            requestId,
            startTime,
        );
    } catch (error) {
        return withTimedJson(
            {
                error: error instanceof Error ? error.message : 'Model evidence ingestion failed.',
                request_id: requestId,
            },
            400,
            requestId,
            startTime,
        );
    }
}

function authorizeEvidenceIngestion(req: Request): {
    ok: true;
    keyFingerprint: string;
} | {
    ok: false;
    status: number;
    error: string;
} {
    const configuredKey = normalizeText(process.env.VETIOS_MODEL_EVIDENCE_INGEST_KEY);
    if (!configuredKey) {
        return {
            ok: false,
            status: 503,
            error: 'model_evidence_ingestion_disabled',
        };
    }

    const providedKey = normalizeText(req.headers.get('x-vetios-evidence-key'))
        ?? normalizeBearer(req.headers.get('authorization'));
    if (!providedKey || !safeCompare(providedKey, configuredKey)) {
        return {
            ok: false,
            status: 401,
            error: 'invalid_evidence_ingestion_key',
        };
    }

    return {
        ok: true,
        keyFingerprint: createHash('sha256').update(configuredKey).digest('hex').slice(0, 16),
    };
}

function withTimedJson(body: Record<string, unknown>, status: number, requestId: string, startTime: number): NextResponse {
    const response = NextResponse.json(body, { status });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

function normalizeBearer(value: string | null): string | null {
    const normalized = normalizeText(value);
    if (!normalized?.toLowerCase().startsWith('bearer ')) {
        return null;
    }
    return normalizeText(normalized.slice('bearer '.length));
}

function safeCompare(left: string, right: string): boolean {
    const leftHash = createHash('sha256').update(left).digest();
    const rightHash = createHash('sha256').update(right).digest();
    return leftHash.length === rightHash.length && timingSafeEqual(leftHash, rightHash);
}

function normalizeText(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
