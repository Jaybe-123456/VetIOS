import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import {
    MODEL_EVIDENCE_INGESTION_EVENTS,
    MODEL_ATTESTATIONS,
    MODEL_CARD_PUBLICATIONS,
    MODEL_CERTIFICATIONS,
    MODEL_REGISTRY,
} from '@/lib/db/schemaContracts';

export type ModelCardPublicationStatus = 'draft' | 'published' | 'retired';
export type ModelCertificationStatus = 'pending' | 'active' | 'expired' | 'revoked';
export type ModelAttestationStatus = 'pending' | 'accepted' | 'rejected';
export type ModelAttestationVerificationStatus = 'unsigned' | 'pending' | 'verified' | 'failed';

export interface ModelRegistryReference {
    registry_id: string;
    tenant_id: string;
    model_name: string;
    model_version: string;
    model_family: string;
    lifecycle_status: string;
    updated_at: string;
}

export interface ModelCardPublicationRecord {
    id: string;
    tenant_id: string;
    registry_id: string;
    publication_status: ModelCardPublicationStatus;
    public_slug: string;
    summary_override: string | null;
    intended_use: string | null;
    limitations: string | null;
    review_notes: string | null;
    published_by: string | null;
    published_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ModelCertificationRecord {
    id: string;
    tenant_id: string;
    registry_id: string;
    publication_id: string | null;
    certification_name: string;
    issuer_name: string;
    status: ModelCertificationStatus;
    certificate_ref: string | null;
    valid_from: string | null;
    valid_until: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface ModelAttestationRecord {
    id: string;
    tenant_id: string;
    registry_id: string;
    publication_id: string | null;
    attestation_type: string;
    attestor_name: string;
    status: ModelAttestationStatus;
    evidence_uri: string | null;
    summary: string;
    attested_at: string | null;
    signed_payload_hash: string | null;
    signature_algorithm: string | null;
    signature_hash: string | null;
    signing_key_fingerprint: string | null;
    verification_status: ModelAttestationVerificationStatus;
    verified_at: string | null;
    verified_by: string | null;
    verification_notes: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface ModelEvidenceIngestionRecord {
    id: string;
    tenant_id: string;
    registry_id: string;
    publication_id: string | null;
    source_system: string;
    source_ref: string;
    attestation_type: string;
    attestor_name: string;
    evidence_uri: string | null;
    summary: string;
    signed_payload_hash: string | null;
    signature_algorithm: string | null;
    signature_hash: string | null;
    signing_key_fingerprint: string | null;
    verification_status: ModelAttestationVerificationStatus;
    payload_hash: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown>;
    received_at: string;
    created_at: string;
}

export interface ModelEvidenceIngestionResult {
    ingestion: ModelEvidenceIngestionRecord;
    attestation: ModelAttestationRecord | null;
    duplicate: boolean;
    materialization_error: string | null;
}

export interface ModelTrustSnapshot {
    tenant_id: string;
    registry_entries: ModelRegistryReference[];
    publications: ModelCardPublicationRecord[];
    certifications: ModelCertificationRecord[];
    attestations: ModelAttestationRecord[];
    evidence_ingestions: ModelEvidenceIngestionRecord[];
    summary: {
        published_cards: number;
        active_certifications: number;
        accepted_attestations: number;
        signed_attestations: number;
        verified_attestations: number;
        ingested_evidence: number;
        automated_attestations: number;
        pending_reviews: number;
    };
    refreshed_at: string;
}

export interface PublicModelTrustProfile {
    publication: ModelCardPublicationRecord | null;
    certifications: ModelCertificationRecord[];
    attestations: ModelAttestationRecord[];
}

export async function getModelTrustSnapshot(
    client: SupabaseClient,
    tenantId: string,
    options: { limit?: number } = {},
): Promise<ModelTrustSnapshot> {
    const limit = options.limit ?? 24;
    const [registryEntries, publications, certifications, attestations, evidenceIngestions] = await Promise.all([
        listRegistryEntries(client, tenantId, limit),
        listModelCardPublications(client, tenantId, limit),
        listModelCertifications(client, tenantId, limit),
        listModelAttestations(client, tenantId, limit),
        listModelEvidenceIngestions(client, tenantId, limit),
    ]);

    return {
        tenant_id: tenantId,
        registry_entries: registryEntries,
        publications,
        certifications,
        attestations,
        evidence_ingestions: evidenceIngestions,
        summary: {
            published_cards: publications.filter((publication) => publication.publication_status === 'published').length,
            active_certifications: certifications.filter((certification) => certification.status === 'active').length,
            accepted_attestations: attestations.filter((attestation) => attestation.status === 'accepted').length,
            signed_attestations: attestations.filter((attestation) => hasSignatureEvidence(attestation)).length,
            verified_attestations: attestations.filter((attestation) => attestation.verification_status === 'verified').length,
            ingested_evidence: evidenceIngestions.length,
            automated_attestations: attestations.filter((attestation) => readString(attestation.metadata.ingestion_event_id)).length,
            pending_reviews: publications.filter((publication) => publication.publication_status === 'draft').length
                + certifications.filter((certification) => certification.status === 'pending').length
                + attestations.filter((attestation) => attestation.status === 'pending').length,
        },
        refreshed_at: new Date().toISOString(),
    };
}

export async function getPublicModelTrustMap(
    client: SupabaseClient,
    tenantId: string,
): Promise<Record<string, PublicModelTrustProfile>> {
    try {
        const [publications, certifications, attestations] = await Promise.all([
            listModelCardPublications(client, tenantId, 200),
            listModelCertifications(client, tenantId, 400),
            listModelAttestations(client, tenantId, 400),
        ]);

        const registryIds = new Set<string>([
            ...publications.map((publication) => publication.registry_id),
            ...certifications.map((certification) => certification.registry_id),
            ...attestations.map((attestation) => attestation.registry_id),
        ]);

        const map: Record<string, PublicModelTrustProfile> = {};
        for (const registryId of registryIds) {
            map[registryId] = {
                publication: publications.find((publication) => publication.registry_id === registryId) ?? null,
                certifications: certifications.filter((certification) => certification.registry_id === registryId),
                attestations: attestations.filter((attestation) => attestation.registry_id === registryId),
            };
        }

        return map;
    } catch {
        return {};
    }
}

export async function publishModelCard(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        registryId: string;
        publicSlug: string;
        publicationStatus?: ModelCardPublicationStatus;
        summaryOverride?: string | null;
        intendedUse?: string | null;
        limitations?: string | null;
        reviewNotes?: string | null;
    },
): Promise<ModelCardPublicationRecord> {
    const C = MODEL_CARD_PUBLICATIONS.COLUMNS;
    const status = input.publicationStatus ?? 'published';
    const payload = {
        [C.tenant_id]: input.tenantId,
        [C.registry_id]: requireText(input.registryId, 'registry_id'),
        [C.public_slug]: requireText(input.publicSlug, 'public_slug'),
        [C.publication_status]: status,
        [C.summary_override]: normalizeOptionalText(input.summaryOverride),
        [C.intended_use]: normalizeOptionalText(input.intendedUse),
        [C.limitations]: normalizeOptionalText(input.limitations),
        [C.review_notes]: normalizeOptionalText(input.reviewNotes),
        [C.published_by]: status === 'published' ? input.actor : null,
        [C.published_at]: status === 'published' ? new Date().toISOString() : null,
    };

    const { data, error } = await client
        .from(MODEL_CARD_PUBLICATIONS.TABLE)
        .upsert(payload, {
            onConflict: `${C.tenant_id},${C.registry_id}`,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to publish model card: ${error?.message ?? 'Unknown error'}`);
    }

    return mapModelCardPublication(asRecord(data));
}

export async function createModelCertification(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        registryId: string;
        publicationId?: string | null;
        certificationName: string;
        issuerName: string;
        status?: ModelCertificationStatus;
        certificateRef?: string | null;
        validFrom?: string | null;
        validUntil?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<ModelCertificationRecord> {
    const C = MODEL_CERTIFICATIONS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_CERTIFICATIONS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.registry_id]: requireText(input.registryId, 'registry_id'),
            [C.publication_id]: normalizeOptionalText(input.publicationId),
            [C.certification_name]: requireText(input.certificationName, 'certification_name'),
            [C.issuer_name]: requireText(input.issuerName, 'issuer_name'),
            [C.status]: input.status ?? 'pending',
            [C.certificate_ref]: normalizeOptionalText(input.certificateRef),
            [C.valid_from]: normalizeOptionalText(input.validFrom),
            [C.valid_until]: normalizeOptionalText(input.validUntil),
            [C.metadata]: input.metadata ?? {},
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create model certification: ${error?.message ?? 'Unknown error'}`);
    }

    return mapModelCertification(asRecord(data));
}

export async function createModelAttestation(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        registryId: string;
        publicationId?: string | null;
        attestationType: string;
        attestorName: string;
        summary: string;
        status?: ModelAttestationStatus;
        evidenceUri?: string | null;
        attestedAt?: string | null;
        signedPayloadHash?: string | null;
        signatureAlgorithm?: string | null;
        signatureHash?: string | null;
        signatureMaterial?: string | null;
        signingKeyFingerprint?: string | null;
        verificationStatus?: ModelAttestationVerificationStatus;
        verifiedBy?: string | null;
        verificationNotes?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<ModelAttestationRecord> {
    const C = MODEL_ATTESTATIONS.COLUMNS;
    const signatureHash = normalizeOptionalText(input.signatureHash)
        ?? hashOptionalSecret(input.signatureMaterial);
    const verificationStatus = input.verificationStatus
        ?? (signatureHash && input.signingKeyFingerprint ? 'verified' : signatureHash ? 'pending' : 'unsigned');
    const verifiedAt = verificationStatus === 'verified' ? new Date().toISOString() : null;
    let payload: Record<string, unknown> = {
        [C.tenant_id]: input.tenantId,
        [C.registry_id]: requireText(input.registryId, 'registry_id'),
        [C.publication_id]: normalizeOptionalText(input.publicationId),
        [C.attestation_type]: requireText(input.attestationType, 'attestation_type'),
        [C.attestor_name]: requireText(input.attestorName, 'attestor_name'),
        [C.summary]: requireText(input.summary, 'summary'),
        [C.status]: input.status ?? 'pending',
        [C.evidence_uri]: normalizeOptionalText(input.evidenceUri),
        [C.attested_at]: normalizeOptionalText(input.attestedAt),
        [C.signed_payload_hash]: normalizeOptionalText(input.signedPayloadHash),
        [C.signature_algorithm]: normalizeOptionalText(input.signatureAlgorithm),
        [C.signature_hash]: signatureHash,
        [C.signing_key_fingerprint]: normalizeOptionalText(input.signingKeyFingerprint),
        [C.verification_status]: verificationStatus,
        [C.verified_at]: verifiedAt,
        [C.verified_by]: verificationStatus === 'verified' ? normalizeOptionalText(input.verifiedBy) ?? input.actor : null,
        [C.verification_notes]: normalizeOptionalText(input.verificationNotes),
        [C.metadata]: input.metadata ?? {},
        [C.created_by]: input.actor,
    };
    let inserted = await client
        .from(MODEL_ATTESTATIONS.TABLE)
        .insert(payload)
        .select('*')
        .single();

    if (inserted.error && isMissingColumnError(inserted.error.message ?? '')) {
        payload = { ...payload };
        delete payload[C.signed_payload_hash];
        delete payload[C.signature_algorithm];
        delete payload[C.signature_hash];
        delete payload[C.signing_key_fingerprint];
        delete payload[C.verification_status];
        delete payload[C.verified_at];
        delete payload[C.verified_by];
        delete payload[C.verification_notes];

        inserted = await client
            .from(MODEL_ATTESTATIONS.TABLE)
            .insert(payload)
            .select('*')
            .single();
    }

    if (inserted.error || !inserted.data) {
        throw new Error(`Failed to create model attestation: ${inserted.error?.message ?? 'Unknown error'}`);
    }

    return mapModelAttestation(asRecord(inserted.data));
}

export async function ingestModelAttestationEvidence(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        registryId?: string | null;
        publicSlug?: string | null;
        publicationId?: string | null;
        sourceSystem: string;
        sourceRef?: string | null;
        attestationType: string;
        attestorName: string;
        summary: string;
        evidenceUri?: string | null;
        signedPayloadHash?: string | null;
        signatureAlgorithm?: string | null;
        signatureHash?: string | null;
        signatureMaterial?: string | null;
        signingKeyFingerprint?: string | null;
        verificationStatus?: ModelAttestationVerificationStatus;
        payload?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    },
): Promise<ModelEvidenceIngestionResult> {
    const resolved = await resolveEvidenceTarget(client, {
        tenantId: input.tenantId,
        registryId: input.registryId,
        publicSlug: input.publicSlug,
        publicationId: input.publicationId,
    });
    const C = MODEL_EVIDENCE_INGESTION_EVENTS.COLUMNS;
    const sourceSystem = requireText(input.sourceSystem, 'source_system');
    const payload = input.payload ?? {};
    const payloadHash = createHash('sha256').update(stableStringify(payload)).digest('hex');
    const sourceRef = normalizeOptionalText(input.sourceRef)
        ?? createHash('sha256')
            .update(`${sourceSystem}:${resolved.registryId}:${payloadHash}`)
            .digest('hex');
    const signatureHash = normalizeOptionalText(input.signatureHash)
        ?? hashOptionalSecret(input.signatureMaterial);
    const verificationStatus = input.verificationStatus
        ?? (signatureHash && input.signingKeyFingerprint ? 'verified' : signatureHash ? 'pending' : 'unsigned');

    const existing = await findModelEvidenceIngestion(client, input.tenantId, sourceSystem, sourceRef);
    if (existing) {
        return {
            ingestion: existing,
            attestation: null,
            duplicate: true,
            materialization_error: null,
        };
    }

    const { data, error } = await client
        .from(MODEL_EVIDENCE_INGESTION_EVENTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.registry_id]: resolved.registryId,
            [C.publication_id]: resolved.publicationId,
            [C.source_system]: sourceSystem,
            [C.source_ref]: sourceRef,
            [C.attestation_type]: requireText(input.attestationType, 'attestation_type'),
            [C.attestor_name]: requireText(input.attestorName, 'attestor_name'),
            [C.evidence_uri]: normalizeOptionalText(input.evidenceUri),
            [C.summary]: requireText(input.summary, 'summary'),
            [C.signed_payload_hash]: normalizeOptionalText(input.signedPayloadHash),
            [C.signature_algorithm]: normalizeOptionalText(input.signatureAlgorithm),
            [C.signature_hash]: signatureHash,
            [C.signing_key_fingerprint]: normalizeOptionalText(input.signingKeyFingerprint),
            [C.verification_status]: verificationStatus,
            [C.payload_hash]: payloadHash,
            [C.payload]: payload,
            [C.metadata]: input.metadata ?? {},
        })
        .select('*')
        .single();

    if (error || !data) {
        if (isMissingTableError(error?.message ?? '')) {
            throw new Error('Model evidence ingestion table is missing. Apply migration 20260606010000_model_evidence_ingestion.sql.');
        }
        throw new Error(`Failed to ingest model evidence: ${error?.message ?? 'Unknown error'}`);
    }

    const ingestion = mapModelEvidenceIngestion(asRecord(data));
    try {
        const attestation = await createModelAttestation(client, {
            tenantId: input.tenantId,
            actor: input.actor,
            registryId: ingestion.registry_id,
            publicationId: ingestion.publication_id,
            attestationType: ingestion.attestation_type,
            attestorName: ingestion.attestor_name,
            status: 'pending',
            evidenceUri: ingestion.evidence_uri,
            summary: ingestion.summary,
            attestedAt: ingestion.received_at,
            signedPayloadHash: ingestion.signed_payload_hash,
            signatureAlgorithm: ingestion.signature_algorithm,
            signatureHash: ingestion.signature_hash,
            signingKeyFingerprint: ingestion.signing_key_fingerprint,
            verificationStatus: ingestion.verification_status,
            verifiedBy: ingestion.verification_status === 'verified' ? input.actor ?? 'automated_evidence_ingestion' : null,
            verificationNotes: ingestion.verification_status === 'verified'
                ? 'Automated evidence ingestion supplied signature hash and signing-key fingerprint.'
                : 'Automated evidence ingestion queued this attestation for Trust Ops review.',
            metadata: {
                ...(input.metadata ?? {}),
                ingestion_event_id: ingestion.id,
                source_system: ingestion.source_system,
                source_ref: ingestion.source_ref,
                payload_hash: ingestion.payload_hash,
                automated_ingestion: true,
            },
        });

        return {
            ingestion,
            attestation,
            duplicate: false,
            materialization_error: null,
        };
    } catch (error) {
        return {
            ingestion,
            attestation: null,
            duplicate: false,
            materialization_error: error instanceof Error ? error.message : 'Failed to materialize ingested evidence.',
        };
    }
}

async function listRegistryEntries(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<ModelRegistryReference[]> {
    const C = MODEL_REGISTRY.COLUMNS;
    const { data, error } = await client
        .from(MODEL_REGISTRY.TABLE)
        .select(`${C.registry_id},${C.tenant_id},${C.model_name},${C.model_version},${C.model_family},${C.lifecycle_status},${C.updated_at}`)
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list model registry references: ${error.message}`);
    }

    return (data ?? []).map((row) => mapRegistryReference(asRecord(row)));
}

async function listModelCardPublications(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<ModelCardPublicationRecord[]> {
    const C = MODEL_CARD_PUBLICATIONS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_CARD_PUBLICATIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list model card publications: ${error.message}`);
    }

    return (data ?? []).map((row) => mapModelCardPublication(asRecord(row)));
}

async function listModelCertifications(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<ModelCertificationRecord[]> {
    const C = MODEL_CERTIFICATIONS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_CERTIFICATIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list model certifications: ${error.message}`);
    }

    return (data ?? []).map((row) => mapModelCertification(asRecord(row)));
}

async function listModelAttestations(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<ModelAttestationRecord[]> {
    const C = MODEL_ATTESTATIONS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_ATTESTATIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list model attestations: ${error.message}`);
    }

    return (data ?? []).map((row) => mapModelAttestation(asRecord(row)));
}

async function listModelEvidenceIngestions(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<ModelEvidenceIngestionRecord[]> {
    const C = MODEL_EVIDENCE_INGESTION_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_EVIDENCE_INGESTION_EVENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        if (isMissingTableError(error.message)) {
            return [];
        }
        throw new Error(`Failed to list model evidence ingestions: ${error.message}`);
    }

    return (data ?? []).map((row) => mapModelEvidenceIngestion(asRecord(row)));
}

async function findModelEvidenceIngestion(
    client: SupabaseClient,
    tenantId: string,
    sourceSystem: string,
    sourceRef: string,
): Promise<ModelEvidenceIngestionRecord | null> {
    const C = MODEL_EVIDENCE_INGESTION_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_EVIDENCE_INGESTION_EVENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.source_system, sourceSystem)
        .eq(C.source_ref, sourceRef)
        .maybeSingle();

    if (error) {
        if (isMissingTableError(error.message)) {
            throw new Error('Model evidence ingestion table is missing. Apply migration 20260606010000_model_evidence_ingestion.sql.');
        }
        throw new Error(`Failed to check model evidence idempotency: ${error.message}`);
    }

    return data ? mapModelEvidenceIngestion(asRecord(data)) : null;
}

async function resolveEvidenceTarget(
    client: SupabaseClient,
    input: {
        tenantId: string;
        registryId?: string | null;
        publicSlug?: string | null;
        publicationId?: string | null;
    },
): Promise<{ registryId: string; publicationId: string | null }> {
    const publicSlug = normalizeOptionalText(input.publicSlug);
    if (publicSlug) {
        const C = MODEL_CARD_PUBLICATIONS.COLUMNS;
        const { data, error } = await client
            .from(MODEL_CARD_PUBLICATIONS.TABLE)
            .select(`${C.id},${C.registry_id}`)
            .eq(C.tenant_id, input.tenantId)
            .eq(C.public_slug, publicSlug)
            .maybeSingle();

        if (error) {
            throw new Error(`Failed to resolve model-card public slug: ${error.message}`);
        }
        if (!data) {
            throw new Error(`No model-card publication found for public_slug "${publicSlug}".`);
        }

        const row = asRecord(data);
        return {
            registryId: requireText(readString(row.registry_id), 'registry_id'),
            publicationId: readString(row.id),
        };
    }

    return {
        registryId: requireText(input.registryId ?? null, 'registry_id'),
        publicationId: normalizeOptionalText(input.publicationId),
    };
}

function mapRegistryReference(row: Record<string, unknown>): ModelRegistryReference {
    return {
        registry_id: readString(row.registry_id) ?? 'unknown_registry',
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        model_name: readString(row.model_name) ?? 'Unknown model',
        model_version: readString(row.model_version) ?? 'unknown_version',
        model_family: readString(row.model_family) ?? 'diagnostics',
        lifecycle_status: readString(row.lifecycle_status) ?? 'candidate',
        updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    };
}

function mapModelCardPublication(row: Record<string, unknown>): ModelCardPublicationRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        registry_id: readString(row.registry_id) ?? 'unknown_registry',
        publication_status: (readString(row.publication_status) ?? 'draft') as ModelCardPublicationStatus,
        public_slug: readString(row.public_slug) ?? 'unpublished-card',
        summary_override: readString(row.summary_override),
        intended_use: readString(row.intended_use),
        limitations: readString(row.limitations),
        review_notes: readString(row.review_notes),
        published_by: readString(row.published_by),
        published_at: readString(row.published_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapModelCertification(row: Record<string, unknown>): ModelCertificationRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        registry_id: readString(row.registry_id) ?? 'unknown_registry',
        publication_id: readString(row.publication_id),
        certification_name: readString(row.certification_name) ?? 'Certification',
        issuer_name: readString(row.issuer_name) ?? 'Unknown issuer',
        status: (readString(row.status) ?? 'pending') as ModelCertificationStatus,
        certificate_ref: readString(row.certificate_ref),
        valid_from: readString(row.valid_from),
        valid_until: readString(row.valid_until),
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapModelAttestation(row: Record<string, unknown>): ModelAttestationRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        registry_id: readString(row.registry_id) ?? 'unknown_registry',
        publication_id: readString(row.publication_id),
        attestation_type: readString(row.attestation_type) ?? 'attestation',
        attestor_name: readString(row.attestor_name) ?? 'Unknown attestor',
        status: (readString(row.status) ?? 'pending') as ModelAttestationStatus,
        evidence_uri: readString(row.evidence_uri),
        summary: readString(row.summary) ?? '',
        attested_at: readString(row.attested_at),
        signed_payload_hash: readString(row.signed_payload_hash),
        signature_algorithm: readString(row.signature_algorithm),
        signature_hash: readString(row.signature_hash),
        signing_key_fingerprint: readString(row.signing_key_fingerprint),
        verification_status: (readString(row.verification_status) ?? 'unsigned') as ModelAttestationVerificationStatus,
        verified_at: readString(row.verified_at),
        verified_by: readString(row.verified_by),
        verification_notes: readString(row.verification_notes),
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapModelEvidenceIngestion(row: Record<string, unknown>): ModelEvidenceIngestionRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        registry_id: readString(row.registry_id) ?? 'unknown_registry',
        publication_id: readString(row.publication_id),
        source_system: readString(row.source_system) ?? 'unknown_source',
        source_ref: readString(row.source_ref) ?? 'unknown_ref',
        attestation_type: readString(row.attestation_type) ?? 'attestation',
        attestor_name: readString(row.attestor_name) ?? 'Unknown attestor',
        evidence_uri: readString(row.evidence_uri),
        summary: readString(row.summary) ?? '',
        signed_payload_hash: readString(row.signed_payload_hash),
        signature_algorithm: readString(row.signature_algorithm),
        signature_hash: readString(row.signature_hash),
        signing_key_fingerprint: readString(row.signing_key_fingerprint),
        verification_status: (readString(row.verification_status) ?? 'pending') as ModelAttestationVerificationStatus,
        payload_hash: readString(row.payload_hash) ?? '',
        payload: asRecord(row.payload),
        metadata: asRecord(row.metadata),
        received_at: String(row.received_at ?? row.created_at ?? new Date().toISOString()),
        created_at: String(row.created_at ?? row.received_at ?? new Date().toISOString()),
    };
}

function requireText(value: string | null | undefined, field: string): string {
    if (!value || value.trim().length === 0) {
        throw new Error(`${field} is required.`);
    }
    return value.trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function hashOptionalSecret(value: string | null | undefined): string | null {
    const normalized = normalizeOptionalText(value);
    return normalized ? createHash('sha256').update(normalized).digest('hex') : null;
}

function hasSignatureEvidence(attestation: ModelAttestationRecord): boolean {
    return Boolean(attestation.signature_hash || attestation.signed_payload_hash || attestation.signing_key_fingerprint);
}

function isMissingColumnError(message: string): boolean {
    return message.includes('schema cache')
        || message.includes('column')
        || message.includes('Could not find the');
}

function isMissingTableError(message: string): boolean {
    return message.includes('schema cache')
        || message.includes('relation')
        || message.includes('Could not find the table');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }

    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
