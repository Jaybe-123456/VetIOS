import type { SupabaseClient } from '@supabase/supabase-js';
import {
    MODEL_ATTESTATIONS,
    MODEL_CARD_PUBLICATIONS,
    MODEL_CERTIFICATIONS,
    MODEL_REGISTRY,
} from '@/lib/db/schemaContracts';

export type ModelCardPublicationStatus = 'draft' | 'published' | 'retired';
export type ModelCertificationStatus = 'pending' | 'active' | 'expired' | 'revoked';
export type ModelAttestationStatus = 'pending' | 'accepted' | 'rejected';

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
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface ModelTrustSnapshot {
    tenant_id: string;
    registry_entries: ModelRegistryReference[];
    publications: ModelCardPublicationRecord[];
    certifications: ModelCertificationRecord[];
    attestations: ModelAttestationRecord[];
    summary: {
        published_cards: number;
        active_certifications: number;
        accepted_attestations: number;
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
    const [registryEntries, publications, certifications, attestations] = await Promise.all([
        listRegistryEntries(client, tenantId, limit),
        listModelCardPublications(client, tenantId, limit),
        listModelCertifications(client, tenantId, limit),
        listModelAttestations(client, tenantId, limit),
    ]);

    return {
        tenant_id: tenantId,
        registry_entries: registryEntries,
        publications,
        certifications,
        attestations,
        summary: {
            published_cards: publications.filter((publication) => publication.publication_status === 'published').length,
            active_certifications: certifications.filter((certification) => certification.status === 'active').length,
            accepted_attestations: attestations.filter((attestation) => attestation.status === 'accepted').length,
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
        metadata?: Record<string, unknown>;
    },
): Promise<ModelAttestationRecord> {
    const C = MODEL_ATTESTATIONS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_ATTESTATIONS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.registry_id]: requireText(input.registryId, 'registry_id'),
            [C.publication_id]: normalizeOptionalText(input.publicationId),
            [C.attestation_type]: requireText(input.attestationType, 'attestation_type'),
            [C.attestor_name]: requireText(input.attestorName, 'attestor_name'),
            [C.summary]: requireText(input.summary, 'summary'),
            [C.status]: input.status ?? 'pending',
            [C.evidence_uri]: normalizeOptionalText(input.evidenceUri),
            [C.attested_at]: normalizeOptionalText(input.attestedAt),
            [C.metadata]: input.metadata ?? {},
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create model attestation: ${error?.message ?? 'Unknown error'}`);
    }

    return mapModelAttestation(asRecord(data));
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
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
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

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
