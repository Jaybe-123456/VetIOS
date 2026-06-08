import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type MultimodalArtifactType =
    | 'lab_panel'
    | 'vitals'
    | 'physical_exam'
    | 'imaging_reference'
    | 'voice_transcript'
    | 'document_reference';

export interface ClinicalMultimodalArtifact {
    id: string;
    tenant_id: string;
    case_id: string;
    inference_event_id: string | null;
    outcome_event_id: string | null;
    artifact_key: string;
    artifact_type: MultimodalArtifactType;
    source_ref: string;
    source_payload: Record<string, unknown>;
    extracted_facts: Record<string, unknown>;
    source_citations: unknown[];
    confirmed_diagnosis: string | null;
    label_status: 'unlabeled' | 'labeled' | 'suppressed';
    label_type: string | null;
    label_source: string;
    labeled_at: string | null;
    evidence_quality_score: number;
    deidentified: boolean;
    privacy_status: 'deidentified' | 'suppressed_phi_risk';
    created_at: string;
}

export interface MultimodalArtifactCaseInput {
    tenantId: string;
    caseId: string;
    inferenceEventId?: string | null;
    outcomeEventId?: string | null;
    confirmedDiagnosis?: string | null;
    labelType?: string | null;
    labeledAt?: string | null;
    patientMetadata?: Record<string, unknown> | null;
    latestInputSignature?: Record<string, unknown> | null;
    labs?: Record<string, unknown> | null;
    vitals?: Record<string, unknown> | null;
    physicalExam?: Record<string, unknown> | null;
    images?: unknown[] | null;
}

export interface MultimodalArtifactWriteSummary {
    attempted: number;
    inserted: number;
    warning: string | null;
}

interface PendingArtifact {
    artifact_type: MultimodalArtifactType;
    source_ref: string;
    source_payload: Record<string, unknown>;
    extracted_facts: Record<string, unknown>;
    source_citations: unknown[];
    evidence_quality_score: number;
}

export async function loadClinicalMultimodalArtifacts(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
): Promise<ClinicalMultimodalArtifact[]> {
    const { data, error } = await client
        .from('clinical_multimodal_artifacts')
        .select([
            'id',
            'tenant_id',
            'case_id',
            'inference_event_id',
            'outcome_event_id',
            'artifact_key',
            'artifact_type',
            'source_ref',
            'source_payload',
            'extracted_facts',
            'source_citations',
            'confirmed_diagnosis',
            'label_status',
            'label_type',
            'label_source',
            'labeled_at',
            'evidence_quality_score',
            'deidentified',
            'privacy_status',
            'created_at',
        ].join(', '))
        .eq('tenant_id', tenantId)
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        if (isMissingRelationOrColumn(error.message ?? '')) return [];
        throw new Error(`Failed to load multimodal artifacts: ${error.message}`);
    }

    return (data ?? []).map((row) => normalizeArtifactRow(row as unknown as Record<string, unknown>));
}

export async function persistClinicalMultimodalArtifacts(
    client: SupabaseClient,
    input: MultimodalArtifactCaseInput,
): Promise<MultimodalArtifactWriteSummary> {
    const artifacts = buildClinicalMultimodalArtifacts(input);
    if (artifacts.length === 0) {
        return { attempted: 0, inserted: 0, warning: null };
    }

    const { data, error } = await client
        .from('clinical_multimodal_artifacts')
        .upsert(artifacts, {
            onConflict: 'artifact_key',
            ignoreDuplicates: true,
        })
        .select('id');

    if (error) {
        if (isMissingRelationOrColumn(error.message ?? '')) {
            return {
                attempted: artifacts.length,
                inserted: 0,
                warning: 'clinical_multimodal_artifacts table is not available; apply multimodal artifact migration',
            };
        }

        return {
            attempted: artifacts.length,
            inserted: 0,
            warning: `clinical_multimodal_artifacts: ${error.message}`,
        };
    }

    return {
        attempted: artifacts.length,
        inserted: Array.isArray(data) ? data.length : 0,
        warning: null,
    };
}

export function buildClinicalMultimodalArtifacts(input: MultimodalArtifactCaseInput): Array<Record<string, unknown>> {
    const confirmedDiagnosis = normalizeText(input.confirmedDiagnosis);
    const labelStatus = confirmedDiagnosis && input.outcomeEventId ? 'labeled' : 'unlabeled';
    const labeledAt = labelStatus === 'labeled'
        ? normalizeText(input.labeledAt) ?? new Date().toISOString()
        : null;
    const pending = collectPendingArtifacts(input, labelStatus === 'labeled');

    return pending.map((artifact) => {
        const artifactKey = sha256(stableStringify({
            tenant_id: input.tenantId,
            case_id: input.caseId,
            inference_event_id: input.inferenceEventId ?? null,
            outcome_event_id: input.outcomeEventId ?? null,
            artifact_type: artifact.artifact_type,
            source_ref: artifact.source_ref,
            source_payload: artifact.source_payload,
            confirmed_diagnosis: confirmedDiagnosis,
        }));

        return {
            tenant_id: input.tenantId,
            case_id: input.caseId,
            inference_event_id: normalizeText(input.inferenceEventId),
            outcome_event_id: normalizeText(input.outcomeEventId),
            artifact_key: artifactKey,
            artifact_type: artifact.artifact_type,
            source_ref: artifact.source_ref,
            source_payload: artifact.source_payload,
            extracted_facts: artifact.extracted_facts,
            source_citations: artifact.source_citations,
            confirmed_diagnosis: confirmedDiagnosis,
            label_status: labelStatus,
            label_type: normalizeText(input.labelType) ?? (labelStatus === 'labeled' ? 'expert_reviewed' : null),
            label_source: labelStatus === 'labeled' ? 'case_outcome' : 'case_intake',
            labeled_at: labeledAt,
            evidence_quality_score: artifact.evidence_quality_score,
            deidentified: true,
            privacy_status: 'deidentified',
        };
    });
}

function collectPendingArtifacts(input: MultimodalArtifactCaseInput, labeled: boolean): PendingArtifact[] {
    const metadata = asRecord(input.patientMetadata);
    const signature = asRecord(input.latestInputSignature);
    const signatureMetadata = asRecord(signature.metadata);
    const artifacts: PendingArtifact[] = [];

    const labs = firstNonEmptyRecord(
        asRecord(input.labs),
        asRecord(signature.lab_results),
        asRecord(signatureMetadata.labs),
    );
    if (labs) {
        artifacts.push(buildStructuredArtifact('lab_panel', 'case.labs', labs, labeled));
    }

    const vitals = firstNonEmptyRecord(
        asRecord(input.vitals),
        asRecord(signature.vitals),
        asRecord(signatureMetadata.vitals),
    );
    if (vitals) {
        artifacts.push(buildStructuredArtifact('vitals', 'case.vitals', vitals, labeled));
    }

    const physicalExam = firstNonEmptyRecord(
        asRecord(input.physicalExam),
        asRecord(signature.physical_exam),
        asRecord(signatureMetadata.physical_exam),
    );
    if (physicalExam) {
        artifacts.push(buildStructuredArtifact('physical_exam', 'case.physical_exam', physicalExam, labeled));
    }

    const images = firstNonEmptyArray(
        input.images,
        Array.isArray(signature.diagnostic_images) ? signature.diagnostic_images : null,
        Array.isArray(signatureMetadata.images) ? signatureMetadata.images : null,
    );
    if (images) {
        artifacts.push(buildImagingArtifact(images, labeled));
    }

    const voice = firstNonEmptyRecord(
        asRecord(metadata.voice_context),
        asRecord(signatureMetadata.voice_context),
    );
    if (voice) {
        const voiceArtifact = buildVoiceArtifact(voice, labeled);
        if (voiceArtifact) artifacts.push(voiceArtifact);
    }

    const diagnostics = firstNonEmptyRecord(
        asRecord(signature.diagnostic_tests),
        asRecord(signatureMetadata.diagnostics),
    );
    if (diagnostics) {
        artifacts.push(buildStructuredArtifact('document_reference', 'case.diagnostic_tests', diagnostics, labeled));
    }

    return artifacts;
}

function buildStructuredArtifact(
    artifactType: MultimodalArtifactType,
    sourceRef: string,
    payload: Record<string, unknown>,
    labeled: boolean,
): PendingArtifact {
    const deidentified = deidentifyJson(payload);
    const facts = flattenClinicalFacts(deidentified);
    return {
        artifact_type: artifactType,
        source_ref: sourceRef,
        source_payload: deidentified,
        extracted_facts: {
            fact_count: facts.length,
            facts: facts.slice(0, 24),
        },
        source_citations: [{ source_ref: sourceRef, modality: artifactType }],
        evidence_quality_score: scoreEvidence(facts.length, labeled, artifactType),
    };
}

function buildImagingArtifact(images: unknown[], labeled: boolean): PendingArtifact {
    const imageRefs = images.slice(0, 12).map((entry, index) => ({
        index,
        reference_hash: sha256(stableStringify(deidentifyJson(entry))),
        descriptor: readImageDescriptor(entry),
    }));

    return {
        artifact_type: 'imaging_reference',
        source_ref: 'case.images',
        source_payload: {
            image_count: images.length,
            references: imageRefs,
        },
        extracted_facts: {
            fact_count: imageRefs.length,
            facts: imageRefs.map((entry) => `image_reference_${entry.index + 1}`),
        },
        source_citations: [{ source_ref: 'case.images', modality: 'imaging_reference' }],
        evidence_quality_score: scoreEvidence(imageRefs.length, labeled, 'imaging_reference'),
    };
}

function buildVoiceArtifact(voice: Record<string, unknown>, labeled: boolean): PendingArtifact | null {
    const transcript = normalizeText(voice.raw_transcript);
    const extractionNotes = readStringArray(voice.extraction_notes);
    const confidence = readNumber(voice.extraction_confidence);
    if (!transcript && extractionNotes.length === 0 && confidence == null) return null;

    const payload = {
        transcript_hash: transcript ? sha256(transcript) : null,
        transcript_length: transcript?.length ?? 0,
        extraction_confidence: confidence,
        captured_at: normalizeText(voice.captured_at),
        source: normalizeText(voice.source),
        fallback_used: typeof voice.fallback_used === 'boolean' ? voice.fallback_used : null,
    };
    const facts = [
        transcript ? 'voice_transcript_captured' : null,
        confidence != null ? `extraction_confidence:${Math.round(confidence * 100)}%` : null,
        ...extractionNotes.map((note) => redactClinicalText(note)),
    ].filter((entry): entry is string => Boolean(entry));

    return {
        artifact_type: 'voice_transcript',
        source_ref: 'case.voice_context',
        source_payload: stripNullish(payload),
        extracted_facts: {
            fact_count: facts.length,
            facts: facts.slice(0, 12),
        },
        source_citations: [{ source_ref: 'case.voice_context', modality: 'voice_transcript' }],
        evidence_quality_score: scoreEvidence(facts.length, labeled, 'voice_transcript'),
    };
}

function normalizeArtifactRow(row: Record<string, unknown>): ClinicalMultimodalArtifact {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        case_id: String(row.case_id),
        inference_event_id: normalizeText(row.inference_event_id),
        outcome_event_id: normalizeText(row.outcome_event_id),
        artifact_key: String(row.artifact_key),
        artifact_type: normalizeArtifactType(row.artifact_type),
        source_ref: String(row.source_ref),
        source_payload: asRecord(row.source_payload),
        extracted_facts: asRecord(row.extracted_facts),
        source_citations: Array.isArray(row.source_citations) ? row.source_citations : [],
        confirmed_diagnosis: normalizeText(row.confirmed_diagnosis),
        label_status: normalizeLabelStatus(row.label_status),
        label_type: normalizeText(row.label_type),
        label_source: normalizeText(row.label_source) ?? 'case_outcome',
        labeled_at: normalizeText(row.labeled_at),
        evidence_quality_score: Math.max(0, Math.min(1, readNumber(row.evidence_quality_score) ?? 0)),
        deidentified: row.deidentified === true,
        privacy_status: row.privacy_status === 'suppressed_phi_risk' ? 'suppressed_phi_risk' : 'deidentified',
        created_at: String(row.created_at),
    };
}

function scoreEvidence(factCount: number, labeled: boolean, artifactType: MultimodalArtifactType): number {
    const modalityWeight = artifactType === 'lab_panel' || artifactType === 'imaging_reference'
        ? 0.18
        : artifactType === 'voice_transcript'
            ? 0.12
            : 0.14;
    const score = 0.28
        + Math.min(0.3, factCount * 0.035)
        + modalityWeight
        + (labeled ? 0.22 : 0);
    return Number(Math.min(1, score).toFixed(2));
}

function flattenClinicalFacts(value: unknown, prefix = ''): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((entry, index) => flattenClinicalFacts(entry, `${prefix}[${index}]`));
    }
    if (isRecord(value)) {
        return Object.entries(value).flatMap(([key, entry]) => {
            const nextPrefix = prefix ? `${prefix}.${key}` : key;
            return flattenClinicalFacts(entry, nextPrefix);
        });
    }
    if (value === null || value === undefined || String(value).trim().length === 0) return [];
    return [`${prefix}:${String(value).slice(0, 120)}`];
}

function deidentifyJson(value: unknown): Record<string, unknown> {
    const sanitized = sanitizeJsonValue(value);
    return isRecord(sanitized) ? sanitized : { value: sanitized };
}

function sanitizeJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value
            .map((entry) => sanitizeJsonValue(entry))
            .filter((entry) => entry !== undefined);
    }

    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !isSensitiveKey(key))
                .map(([key, entry]) => [key, sanitizeJsonValue(entry)])
                .filter(([, entry]) => entry !== undefined),
        );
    }

    if (typeof value === 'string') return redactClinicalText(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (value === undefined) return undefined;
    return redactClinicalText(String(value));
}

function redactClinicalText(value: string): string {
    return value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted_email]')
        .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted_phone]')
        .replace(/\b(?:microchip|chip|owner|client|phone|email|address)\s*[:#-]?\s*\S+/gi, '$1 [redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

function isSensitiveKey(key: string): boolean {
    return /(owner|client|contact|phone|email|address|microchip|chip_id|patient_name|name|raw_transcript|transcript|url|uri|file_path)/i.test(key);
}

function readImageDescriptor(value: unknown): string {
    const record = asRecord(value);
    return normalizeText(record.modality)
        ?? normalizeText(record.type)
        ?? normalizeText(record.description)
        ?? 'clinical image reference';
}

function firstNonEmptyRecord(...records: Record<string, unknown>[]): Record<string, unknown> | null {
    for (const record of records) {
        if (Object.keys(record).length > 0) return record;
    }
    return null;
}

function firstNonEmptyArray(...arrays: Array<unknown[] | null | undefined>): unknown[] | null {
    for (const array of arrays) {
        if (Array.isArray(array) && array.length > 0) return array;
    }
    return null;
}

function stripNullish<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
    );
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => normalizeText(entry))
        .filter((entry): entry is string => Boolean(entry));
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeArtifactType(value: unknown): MultimodalArtifactType {
    return value === 'lab_panel'
        || value === 'vitals'
        || value === 'physical_exam'
        || value === 'imaging_reference'
        || value === 'voice_transcript'
        || value === 'document_reference'
        ? value
        : 'document_reference';
}

function normalizeLabelStatus(value: unknown): ClinicalMultimodalArtifact['label_status'] {
    return value === 'labeled' || value === 'suppressed' ? value : 'unlabeled';
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function isMissingRelationOrColumn(message: string): boolean {
    return message.includes('schema cache')
        || message.includes('Could not find the')
        || (message.includes('relation') && message.includes('does not exist'))
        || (message.includes('column') && message.includes('does not exist'));
}
