import type { RagAuthorityTier, RagCitation, RagSourceType } from '@/lib/agenticRag/types';
import type { AskVetiosIntakeSummary } from '@/lib/askVetios/intake';

export type AskVetiosVeterinaryRetrievalStatus =
    | 'non_clinical'
    | 'ungrounded'
    | 'needs_curated_sources'
    | 'partially_grounded'
    | 'veterinary_grounded';

export interface AskVetiosVeterinaryRetrievalSnapshot {
    schema_version: 'ask-vetios-veterinary-retrieval-v1';
    status: AskVetiosVeterinaryRetrievalStatus;
    policy: {
        boundary: 'veterinary_specific_retrieval';
        generic_web_memory_allowed: false;
        clinical_answers_require_grounding: true;
        accepted_authority_tiers: RagAuthorityTier[];
        accepted_source_types: RagSourceType[];
    };
    query_context: {
        species: string | null;
        clinical_sign_count: number;
        labs_present: boolean;
        imaging_present: boolean;
        treatment_present: boolean;
        toxicology_signal_present: boolean;
    };
    grounding: {
        rag_grounded: boolean;
        citation_count: number;
        veterinary_citation_count: number;
        high_authority_citation_count: number;
        species_matched_citation_count: number;
        source_names: string[];
        source_types: string[];
        authority_tiers: string[];
        retrieval_strategy: string | null;
        catalog_fallback_used: boolean;
    };
    coverage: {
        open_or_licensed_reference: boolean;
        toxicology: boolean;
        lab_reference: boolean;
        drug_or_treatment: boolean;
        specialty_guideline: boolean;
        reviewed_case: boolean;
        species_specific: boolean;
    };
    source_gaps: string[];
    warnings: string[];
}

interface BuildAskVetiosVeterinaryRetrievalSnapshotInput {
    mode: string;
    metadata: Record<string, unknown>;
    intake: AskVetiosIntakeSummary;
}

const ACCEPTED_AUTHORITY_TIERS: RagAuthorityTier[] = [
    'specialist_guideline',
    'peer_reviewed',
    'regulatory',
    'institutional',
    'clinic_local',
];

const ACCEPTED_SOURCE_TYPES: RagSourceType[] = [
    'guideline',
    'journal',
    'textbook',
    'drug_label',
    'lab_reference',
    'clinical_protocol',
    'dataset',
    'file',
];

export function buildAskVetiosVeterinaryRetrievalSnapshot(
    input: BuildAskVetiosVeterinaryRetrievalSnapshotInput,
): AskVetiosVeterinaryRetrievalSnapshot {
    const clinical = input.mode === 'clinical' || input.intake.is_clinical_intake;
    const species = input.intake.case_draft.species === 'unknown' ? null : input.intake.case_draft.species;
    const citations = readCitations(input.metadata.rag_citations);
    const stats = asRecord(input.metadata.rag_retrieval_stats);
    const retrievalStrategy = readString(stats.strategy);
    const catalogFallbackUsed = readNumber(stats.catalog_fallback_hits) > 0;
    const citationAssessments = citations.map((citation) => assessCitation(citation, species));
    const veterinaryCitationCount = citationAssessments.filter((item) => item.veterinary).length;
    const highAuthorityCitationCount = citationAssessments.filter((item) => item.highAuthority).length;
    const speciesMatchedCitationCount = citationAssessments.filter((item) => item.speciesMatched).length;
    const coverage = buildCoverage({
        citations,
        assessments: citationAssessments,
        intake: input.intake,
    });
    const sourceGaps = clinical ? buildSourceGaps({ input, citations, coverage }) : [];
    const status = determineStatus({
        clinical,
        citationCount: citations.length,
        veterinaryCitationCount,
        highAuthorityCitationCount,
        speciesMatchedCitationCount,
        sourceGaps,
        ragGrounded: input.metadata.rag_grounded === true,
    });
    const warnings = buildWarnings({
        status,
        clinical,
        citationCount: citations.length,
        sourceGaps,
        catalogFallbackUsed,
        ragWarnings: readStringArray(input.metadata.rag_evaluation_warnings),
    });

    return {
        schema_version: 'ask-vetios-veterinary-retrieval-v1',
        status,
        policy: {
            boundary: 'veterinary_specific_retrieval',
            generic_web_memory_allowed: false,
            clinical_answers_require_grounding: true,
            accepted_authority_tiers: ACCEPTED_AUTHORITY_TIERS,
            accepted_source_types: ACCEPTED_SOURCE_TYPES,
        },
        query_context: {
            species,
            clinical_sign_count: input.intake.case_draft.clinical_signs.length,
            labs_present: input.intake.case_draft.labs_or_tests.length > 0,
            imaging_present: input.intake.case_draft.imaging.length > 0,
            treatment_present: input.intake.case_draft.treatments.length > 0,
            toxicology_signal_present: hasToxicologySignal(input.intake.case_draft.raw_note, input.intake.case_draft.red_flags),
        },
        grounding: {
            rag_grounded: input.metadata.rag_grounded === true,
            citation_count: citations.length,
            veterinary_citation_count: veterinaryCitationCount,
            high_authority_citation_count: highAuthorityCitationCount,
            species_matched_citation_count: speciesMatchedCitationCount,
            source_names: unique(citations.map((citation) => citation.source_name)),
            source_types: unique(citations.map((citation) => citation.source_type)),
            authority_tiers: unique(citations.map((citation) => citation.authority_tier)),
            retrieval_strategy: retrievalStrategy,
            catalog_fallback_used: catalogFallbackUsed,
        },
        coverage,
        source_gaps: sourceGaps,
        warnings,
    };
}

function determineStatus(input: {
    clinical: boolean;
    citationCount: number;
    veterinaryCitationCount: number;
    highAuthorityCitationCount: number;
    speciesMatchedCitationCount: number;
    sourceGaps: string[];
    ragGrounded: boolean;
}): AskVetiosVeterinaryRetrievalStatus {
    if (!input.clinical) return 'non_clinical';
    if (input.citationCount === 0) return 'ungrounded';
    if (input.veterinaryCitationCount === 0 || input.highAuthorityCitationCount === 0) return 'needs_curated_sources';
    if (!input.ragGrounded || input.sourceGaps.length > 0 || input.speciesMatchedCitationCount === 0) return 'partially_grounded';
    return 'veterinary_grounded';
}

function buildCoverage(input: {
    citations: RagCitation[];
    assessments: Array<ReturnType<typeof assessCitation>>;
    intake: AskVetiosIntakeSummary;
}): AskVetiosVeterinaryRetrievalSnapshot['coverage'] {
    const haystack = input.citations.map(citationHaystack).join(' ');
    return {
        open_or_licensed_reference: input.assessments.some((item) => item.openOrLicensed),
        toxicology: /toxic|poison|rodenticide|chocolate|xylitol|anticoagulant|decontamination/.test(haystack),
        lab_reference: input.citations.some((citation) => citation.source_type === 'lab_reference')
            || /lab|cbc|chemistry|electrolyte|glucose|pcv|creatinine|lipase|assay|reference interval/.test(haystack),
        drug_or_treatment: input.citations.some((citation) => citation.source_type === 'drug_label')
            || /drug|dose|label|treat|therapy|medication|contraindication|antidote|fluid/.test(haystack),
        specialty_guideline: input.citations.some((citation) => citation.authority_tier === 'specialist_guideline')
            || /acvim|aaha|wsava|capc|iris|guideline|consensus|specialist/.test(haystack),
        reviewed_case: input.citations.some((citation) => citation.authority_tier === 'clinic_local')
            || /reviewed case|clinician confirmed|case graph|outcome confirmed|local case/.test(haystack),
        species_specific: input.assessments.some((item) => item.speciesMatched)
            || (input.intake.case_draft.species === 'unknown' && input.assessments.some((item) => item.veterinary)),
    };
}

function buildSourceGaps(input: {
    input: BuildAskVetiosVeterinaryRetrievalSnapshotInput;
    citations: RagCitation[];
    coverage: AskVetiosVeterinaryRetrievalSnapshot['coverage'];
}): string[] {
    const gaps: string[] = [];
    if (input.citations.length === 0) return ['accepted_veterinary_citations'];
    if (!input.coverage.open_or_licensed_reference) gaps.push('licensed_or_open_veterinary_reference');
    if (!input.coverage.species_specific) gaps.push('species_specific_evidence');
    if (input.input.intake.case_draft.labs_or_tests.length > 0 && !input.coverage.lab_reference) {
        gaps.push('lab_reference_or_diagnostic_range');
    }
    if (input.input.intake.case_draft.treatments.length > 0 && !input.coverage.drug_or_treatment) {
        gaps.push('drug_label_or_treatment_protocol');
    }
    if (hasToxicologySignal(input.input.intake.case_draft.raw_note, input.input.intake.case_draft.red_flags) && !input.coverage.toxicology) {
        gaps.push('toxicology_reference');
    }
    if (!input.coverage.specialty_guideline && input.citations.every((citation) => citation.authority_tier !== 'peer_reviewed')) {
        gaps.push('specialist_or_peer_reviewed_source');
    }
    return gaps;
}

function buildWarnings(input: {
    status: AskVetiosVeterinaryRetrievalStatus;
    clinical: boolean;
    citationCount: number;
    sourceGaps: string[];
    catalogFallbackUsed: boolean;
    ragWarnings: string[];
}): string[] {
    const warnings: string[] = [];
    if (input.clinical && input.citationCount === 0) {
        warnings.push('Ask VetIOS has no accepted veterinary retrieval citations for this clinical answer.');
    }
    if (input.status === 'needs_curated_sources') {
        warnings.push('Retrieved evidence is not yet strong veterinary grounding; add curated veterinary references before relying on this answer.');
    }
    if (input.sourceGaps.length > 0) {
        warnings.push(`Retrieval gaps: ${input.sourceGaps.map((gap) => gap.replace(/_/g, ' ')).join(', ')}.`);
    }
    if (input.catalogFallbackUsed) {
        warnings.push('Built-in curated catalog fallback was used; seed or refresh the tenant RAG corpus to make this evidence durable.');
    }
    warnings.push(...input.ragWarnings.slice(0, 3));
    return unique(warnings);
}

function assessCitation(citation: RagCitation, species: string | null) {
    const haystack = citationHaystack(citation);
    return {
        veterinary: isVeterinaryCitation(citation, haystack),
        highAuthority: ACCEPTED_AUTHORITY_TIERS.includes(citation.authority_tier),
        speciesMatched: species ? speciesTerms(species).some((term) => haystack.includes(term)) : isVeterinaryCitation(citation, haystack),
        openOrLicensed: /open|license|licensed|public|merck|aaha|wsava|acvim|capc|cornell|pubmed|pmc|fda|iris|avma|vin|vetios/.test(haystack),
    };
}

function isVeterinaryCitation(citation: RagCitation, haystack: string): boolean {
    if (citation.authority_tier === 'clinic_local') return true;
    if (['guideline', 'textbook', 'drug_label', 'lab_reference', 'clinical_protocol', 'dataset'].includes(citation.source_type)) return true;
    return /veterinary|vetios|canine|feline|equine|bovine|avian|porcine|ovine|caprine|dog|dogs|cat|cats|horse|cattle|animal/.test(haystack);
}

function hasToxicologySignal(rawNote: string, redFlags: string[]): boolean {
    const haystack = `${rawNote} ${redFlags.join(' ')}`.toLowerCase();
    return /toxin|poison|poisoning|ingested|ate chocolate|xylitol|rodenticide|anticoagulant|household chemical|plant/.test(haystack);
}

function speciesTerms(species: string): string[] {
    switch (species) {
        case 'canine': return ['canine', 'dog', 'dogs'];
        case 'feline': return ['feline', 'cat', 'cats'];
        case 'equine': return ['equine', 'horse', 'horses'];
        case 'bovine': return ['bovine', 'cattle', 'cow', 'calf'];
        case 'avian': return ['avian', 'bird', 'birds'];
        case 'porcine': return ['porcine', 'swine', 'pig'];
        case 'ovine': return ['ovine', 'sheep', 'lamb'];
        default: return [species.toLowerCase()];
    }
}

function citationHaystack(citation: RagCitation): string {
    return `${citation.title} ${citation.source_name} ${citation.source_type} ${citation.authority_tier} ${citation.quote} ${citation.url ?? ''} ${JSON.stringify(citation.provenance ?? {})}`.toLowerCase();
}

function readCitations(value: unknown): RagCitation[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => asRecord(entry))
        .filter((entry) => Object.keys(entry).length > 0)
        .map((entry, index) => ({
            index: readNumber(entry.index) || index + 1,
            chunk_id: readString(entry.chunk_id) ?? '',
            document_id: readString(entry.document_id) ?? '',
            source_id: readString(entry.source_id) ?? '',
            title: readString(entry.title) ?? 'Untitled veterinary source',
            source_name: readString(entry.source_name) ?? 'Unknown source',
            source_type: readRagSourceType(entry.source_type),
            authority_tier: readRagAuthorityTier(entry.authority_tier),
            url: readString(entry.url),
            year: readString(entry.year),
            quote: readString(entry.quote) ?? '',
            similarity: readNumber(entry.similarity),
            provenance: asRecord(entry.provenance),
        }));
}

function readRagSourceType(value: unknown): RagSourceType {
    const candidate = readString(value);
    return ACCEPTED_SOURCE_TYPES.includes(candidate as RagSourceType)
        || candidate === 'client_handout'
        || candidate === 'web'
        || candidate === 'other'
        ? candidate as RagSourceType
        : 'other';
}

function readRagAuthorityTier(value: unknown): RagAuthorityTier {
    const candidate = readString(value);
    return ACCEPTED_AUTHORITY_TIERS.includes(candidate as RagAuthorityTier)
        || candidate === 'unverified'
        ? candidate as RagAuthorityTier
        : 'unverified';
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}

function readNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
}
