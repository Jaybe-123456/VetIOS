import { CURATED_VETERINARY_RAG_SOURCES } from '../agenticRag/sourceCatalog';
import { getConditionsForSpecies, normalizeSpecies } from './condition-registry';
import { selectGlobalOneHealthConditionCandidates } from './globalOneHealthSeeds';
import type {
    GlobalConditionCandidateHint,
    GlobalConditionCoverageReport,
    GlobalConditionCoverageStatus,
    GlobalConditionExpansionReport,
    GlobalConditionSourceExpansionHint,
    InferenceRequest,
    Species,
} from './types';

const SPECIES_ALIASES: Record<Species, string[]> = {
    canine: ['canine', 'dog', 'dogs', 'puppy', 'canis'],
    feline: ['feline', 'cat', 'cats', 'kitten', 'felis'],
    bovine: ['bovine', 'cow', 'cattle', 'calf', 'bos'],
    ovine: ['ovine', 'sheep', 'lamb'],
    caprine: ['caprine', 'goat', 'kid'],
    equine: ['equine', 'horse', 'horses', 'foal'],
    avian: ['avian', 'bird', 'birds', 'poultry', 'chicken'],
    reptile: ['reptile', 'snake', 'lizard', 'chelonian', 'turtle', 'tortoise'],
    exotic: ['exotic', 'rabbit', 'ferret', 'guinea pig', 'guinea_pig', 'small mammal'],
};

const ONE_HEALTH_TERMS = [
    'human',
    'zoonotic',
    'zoonosis',
    'outbreak',
    'public health',
    'wildlife',
    'reservoir',
    'vector',
    'environment',
    'foodborne',
    'waterborne',
    'antimicrobial resistance',
    'amr',
    'one health',
];

export function assessGlobalConditionCoverage(request: InferenceRequest): GlobalConditionCoverageReport {
    const inputSpecies = String(request.species ?? '').trim();
    const canonicalSpecies = normalizeSpecies(inputSpecies);
    const speciesRecognized = isRecognizedSpeciesLabel(inputSpecies);
    const candidates = speciesRecognized ? getConditionsForSpecies(canonicalSpecies) : [];
    const sourceBackedCount = countSourcesForSpecies(canonicalSpecies);
    const oneHealthSourceCount = countOneHealthSourcesForSpecies(canonicalSpecies);
    const text = collectCaseText(request);
    const humanCorrelationRequested = ONE_HEALTH_TERMS.some((term) => text.includes(term));
    const candidateExpansionHints = buildSourceExpansionHints(canonicalSpecies, text, humanCorrelationRequested);
    const conditionCandidateHints = selectGlobalOneHealthConditionCandidates(canonicalSpecies, text);
    const blockers: string[] = ['open_world_candidate_generation_missing'];
    const warnings: string[] = [
        'Current inference candidates come from the local closed-world condition registry.',
        'Source catalog entries exist but are not yet materialized into a global condition ontology.',
    ];

    if (!speciesRecognized) {
        blockers.push('species_not_supported_by_registry');
        warnings.push('Unknown species labels must not silently fall back to canine for global condition reasoning.');
    }

    if (candidates.length < 15) {
        warnings.push('Registered candidate count is too small for global differential breadth.');
    }

    if (humanCorrelationRequested) {
        blockers.push('one_health_condition_edges_not_materialized');
        warnings.push('Human-animal-environment correlations require source-mapped One Health edges before inference can claim global coverage.');
    }

    if (conditionCandidateHints.length > 0) {
        warnings.push('Source-seeded One Health condition candidates were detected but are not yet active inference differentials.');
    }

    const status = classifyCoverage({
        speciesRecognized,
        registeredCandidateCount: candidates.length,
        humanCorrelationRequested,
    });

    return {
        status,
        score: coverageScore({
            status,
            registeredCandidateCount: candidates.length,
            sourceBackedCount,
            oneHealthSourceCount,
        }),
        registry_scope: 'closed_world',
        canonical_species: canonicalSpecies,
        input_species: inputSpecies || 'unknown',
        registered_candidate_count: candidates.length,
        source_backed_count: sourceBackedCount,
        one_health_source_count: oneHealthSourceCount,
        human_correlation_requested: humanCorrelationRequested,
        one_health_review_required: humanCorrelationRequested || status !== 'covered',
        open_world_candidate_generation: 'missing',
        candidate_expansion_status: 'source_hints_only',
        candidate_expansion_hints: candidateExpansionHints,
        condition_candidate_status: conditionCandidateHints.length > 0 ? 'seeded_source_candidates' : 'none',
        condition_candidate_hints: conditionCandidateHints,
        blockers,
        warnings,
        recommended_next_action: status === 'unsupported'
            ? 'Route to clinician review and ontology expansion before differential scoring.'
            : 'Use current inference only as closed-world decision support; expand candidates through the global ontology spine before claiming global coverage.',
    };
}

function classifyCoverage(input: {
    speciesRecognized: boolean;
    registeredCandidateCount: number;
    humanCorrelationRequested: boolean;
}): GlobalConditionCoverageStatus {
    if (!input.speciesRecognized) return 'unsupported';
    if (input.registeredCandidateCount === 0) return 'gap';
    if (input.humanCorrelationRequested) return 'partial';
    if (input.registeredCandidateCount >= 40) return 'partial';
    return 'partial';
}

function coverageScore(input: {
    status: GlobalConditionCoverageStatus;
    registeredCandidateCount: number;
    sourceBackedCount: number;
    oneHealthSourceCount: number;
}) {
    if (input.status === 'unsupported') return 0;
    if (input.status === 'gap') return 0.12;
    const registry = Math.min(input.registeredCandidateCount / 80, 0.45);
    const sources = Math.min(input.sourceBackedCount / 20, 0.2);
    const oneHealth = Math.min(input.oneHealthSourceCount / 8, 0.15);
    return Number(Math.min(0.74, registry + sources + oneHealth).toFixed(4));
}

function countSourcesForSpecies(species: Species) {
    return CURATED_VETERINARY_RAG_SOURCES.filter((source) =>
        source.species_scope.some((entry) => speciesMatches(entry, species)),
    ).length;
}

function countOneHealthSourcesForSpecies(species: Species) {
    return CURATED_VETERINARY_RAG_SOURCES.filter((source) =>
        source.species_scope.some((entry) => speciesMatches(entry, species))
        && source.medicine_domain.some((domain) => domain.includes('one_health') || domain.includes('surveillance') || domain.includes('zoonotic')),
    ).length;
}

function buildSourceExpansionHints(
    species: Species,
    caseText: string,
    humanCorrelationRequested: boolean,
): GlobalConditionSourceExpansionHint[] {
    return CURATED_VETERINARY_RAG_SOURCES
        .map((source) => {
            const speciesScore = source.species_scope.some((entry) => speciesMatches(entry, species)) ? 3 : 0;
            const oneHealthScore = source.medicine_domain.some((domain) =>
                domain.includes('one_health')
                || domain.includes('zoonotic')
                || domain.includes('surveillance')
                || domain.includes('antimicrobial_resistance'),
            ) ? 2 : 0;
            const topicScore = source.source_card.seed_topics
                .filter((topic) => caseText.includes(topic.toLowerCase()))
                .length;
            const domainScore = source.medicine_domain
                .filter((domain) => caseText.includes(domain.replaceAll('_', ' ')))
                .length;
            const authorityScore = source.authority_tier === 'regulatory'
                || source.authority_tier === 'specialist_guideline'
                || source.authority_tier === 'peer_reviewed'
                ? 1
                : 0;
            const score = speciesScore + authorityScore + topicScore + domainScore + (humanCorrelationRequested ? oneHealthScore : Math.min(oneHealthScore, 1));
            return { source, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.source.external_key.localeCompare(b.source.external_key))
        .slice(0, 6)
        .map(({ source }) => ({
            source_key: source.external_key,
            source_name: source.name,
            source_type: source.source_type,
            authority_tier: source.authority_tier,
            species_scope: source.species_scope,
            medicine_domain: source.medicine_domain,
            reason: humanCorrelationRequested && source.medicine_domain.some((domain) => domain.includes('one_health') || domain.includes('zoonotic') || domain.includes('surveillance'))
                ? 'One Health or surveillance source matched species/context.'
                : 'Species/source authority matched current closed-world coverage gap.',
        }));
}

export function buildGlobalConditionCandidateHints(
    species: Species,
    caseText: string,
): GlobalConditionCandidateHint[] {
    return selectGlobalOneHealthConditionCandidates(species, caseText);
}

export function applyGlobalConditionExpansionState(
    coverage: GlobalConditionCoverageReport | null | undefined,
    expansion: GlobalConditionExpansionReport | null | undefined,
): GlobalConditionCoverageReport | null {
    if (!coverage) return null;
    if (!expansion) return coverage;

    const candidateExpansionStatus = resolveCandidateExpansionStatus(expansion);
    const openWorldCandidateGeneration = expansion.expansion_mode === 'active'
        ? 'active'
        : expansion.expansion_mode === 'shadow'
            ? 'shadow'
            : 'blocked';
    const blockers = openWorldCandidateGeneration === 'active'
        ? coverage.blockers.filter((blocker) => blocker !== 'open_world_candidate_generation_missing')
        : dedupe([
            ...coverage.blockers.filter((blocker) =>
                blocker !== 'open_world_candidate_generation_missing'
                || expansion.status === 'no_candidate_hints'
                || expansion.status === 'no_verified_mappings',
            ),
            ...expansion.blockers,
        ]);
    const warnings = dedupe([
        ...coverage.warnings,
        ...expansion.warnings,
    ]);

    return {
        ...coverage,
        score: scoreWithExpansion(coverage, expansion),
        one_health_review_required: expansion.expansion_mode !== 'active' || coverage.one_health_review_required,
        open_world_candidate_generation: openWorldCandidateGeneration,
        candidate_expansion_status: candidateExpansionStatus,
        blockers,
        warnings,
        recommended_next_action: expansion.recommended_next_action,
    };
}

function resolveCandidateExpansionStatus(
    expansion: GlobalConditionExpansionReport,
): GlobalConditionCoverageReport['candidate_expansion_status'] {
    if (expansion.expansion_mode === 'active') return 'outcome_validated_active';
    if (expansion.expansion_mode === 'blocked') return 'blocked';
    if (expansion.externally_verified_mapping_count > 0) return 'externally_verified_shadow';
    if (expansion.reviewer_verified_mapping_count > 0) return 'reviewer_verified_shadow';
    if (expansion.source_attested_mapping_count > 0) return 'source_attested_shadow';
    return 'source_hints_only';
}

function scoreWithExpansion(
    coverage: GlobalConditionCoverageReport,
    expansion: GlobalConditionExpansionReport,
) {
    if (expansion.expansion_mode === 'active') return Number(Math.max(coverage.score, 0.86).toFixed(4));
    if (expansion.externally_verified_mapping_count > 0) return Number(Math.max(coverage.score, 0.76).toFixed(4));
    if (expansion.reviewer_verified_mapping_count > 0) return Number(Math.max(coverage.score, 0.68).toFixed(4));
    if (expansion.source_attested_mapping_count > 0) return Number(Math.max(coverage.score, 0.58).toFixed(4));
    return coverage.score;
}

function dedupe(values: string[]) {
    return [...new Set(values.filter(Boolean))];
}

function speciesMatches(entry: string, species: Species) {
    const normalized = entry.trim().toLowerCase();
    if (normalized === species) return true;
    if (species === 'bovine' && normalized === 'ruminant') return true;
    if ((species === 'ovine' || species === 'caprine') && (normalized === 'ruminant' || normalized === 'small_ruminant')) return true;
    if ((species === 'reptile' || species === 'exotic') && normalized === 'exotic') return true;
    return false;
}

function isRecognizedSpeciesLabel(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return Object.values(SPECIES_ALIASES).some((aliases) =>
        aliases.some((alias) => normalized === alias || normalized.includes(alias)),
    );
}

function collectCaseText(request: InferenceRequest) {
    const chunks: string[] = [
        request.species,
        request.breed ?? '',
        ...(request.presenting_signs ?? []),
        ...(request.symptom_vector ?? []),
        ...(request.history?.owner_observations ?? []),
        ...(request.history?.travel_history ?? []),
        request.history?.geographic_region ?? '',
        JSON.stringify(request.diagnostic_tests ?? {}),
    ];
    return chunks.join(' ').toLowerCase();
}
