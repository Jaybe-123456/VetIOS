import type { GlobalConditionCandidateHint, Species } from './types';

export type GlobalOneHealthConditionDomain =
    | 'infectious'
    | 'parasitic'
    | 'toxicology'
    | 'metabolic'
    | 'neoplastic'
    | 'immune_mediated'
    | 'reproductive'
    | 'cardiorespiratory'
    | 'gastrointestinal'
    | 'neurologic'
    | 'renal_urinary'
    | 'musculoskeletal'
    | 'dermatologic'
    | 'public_health'
    | 'environmental'
    | 'unknown';

export type HumanRelevance =
    | 'not_assessed'
    | 'none_known'
    | 'correlated'
    | 'zoonotic'
    | 'shared_pathogen'
    | 'shared_exposure'
    | 'human_only';

export type ZoonoticRole =
    | 'not_assessed'
    | 'not_zoonotic'
    | 'reservoir'
    | 'spillover_host'
    | 'dead_end_host'
    | 'vector_borne_bridge'
    | 'environmental_bridge';

export type AmrRelevance = 'not_assessed' | 'none_known' | 'possible' | 'confirmed' | 'surveillance_priority';

export interface GlobalOneHealthConditionSeed {
    condition_key: string;
    canonical_name: string;
    condition_domain: GlobalOneHealthConditionDomain;
    species_scope: string[];
    host_scope: string[];
    human_relevance: HumanRelevance;
    zoonotic_role: ZoonoticRole;
    syndrome_tags: string[];
    pathogen_refs: string[];
    vector_refs: string[];
    reservoir_refs: string[];
    transmission_routes: string[];
    geography_tags: string[];
    climate_tags: string[];
    amr_relevance: AmrRelevance;
    source_keys: string[];
    match_terms: string[];
    contextual_terms: string[];
}

const CORE_SOURCE_KEYS = [
    'woah_terrestrial_manual',
    'woah_wahis',
    'cdc_one_health',
    'who_icd_11',
    'snomed_ct',
    'nlm_umls',
    'mondo_disease_ontology',
    'pubmed_literature_index',
];

export const GLOBAL_ONE_HEALTH_CONDITION_SEEDS: GlobalOneHealthConditionSeed[] = [
    {
        condition_key: 'rabies',
        canonical_name: 'Rabies',
        condition_domain: 'infectious',
        species_scope: ['canine', 'feline', 'bovine', 'equine', 'ovine', 'caprine', 'wildlife', 'human'],
        host_scope: ['mammal', 'human', 'livestock', 'companion_animal', 'wildlife'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'reservoir',
        syndrome_tags: ['neurologic', 'encephalitis', 'salivation', 'behavior_change', 'bite_exposure'],
        pathogen_refs: ['Rabies lyssavirus'],
        vector_refs: [],
        reservoir_refs: ['dog', 'bat', 'wildlife'],
        transmission_routes: ['bite', 'saliva_exposure'],
        geography_tags: ['global'],
        climate_tags: [],
        amr_relevance: 'none_known',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['rabies', 'lyssavirus', 'hydrophobia'],
        contextual_terms: ['bite', 'salivation', 'neurologic', 'encephalitis', 'wildlife', 'human exposure'],
    },
    {
        condition_key: 'anthrax',
        canonical_name: 'Anthrax',
        condition_domain: 'infectious',
        species_scope: ['bovine', 'ovine', 'caprine', 'equine', 'wildlife', 'human'],
        host_scope: ['livestock', 'wildlife', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'environmental_bridge',
        syndrome_tags: ['sudden_death', 'hemorrhage', 'fever', 'edema'],
        pathogen_refs: ['Bacillus anthracis'],
        vector_refs: [],
        reservoir_refs: ['soil_spores', 'livestock', 'wildlife'],
        transmission_routes: ['environmental_exposure', 'carcass_exposure', 'inhalation', 'ingestion'],
        geography_tags: ['global'],
        climate_tags: ['flooding', 'drought', 'soil_disturbance'],
        amr_relevance: 'possible',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['anthrax', 'bacillus anthracis'],
        contextual_terms: ['sudden death', 'bloody discharge', 'carcass', 'soil', 'outbreak', 'livestock'],
    },
    {
        condition_key: 'highly_pathogenic_avian_influenza',
        canonical_name: 'Highly pathogenic avian influenza',
        condition_domain: 'infectious',
        species_scope: ['avian', 'wildlife', 'feline', 'swine', 'human'],
        host_scope: ['poultry', 'wild_bird', 'mammal', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'spillover_host',
        syndrome_tags: ['respiratory', 'neurologic', 'cyanosis', 'sudden_death', 'egg_drop'],
        pathogen_refs: ['Influenza A virus'],
        vector_refs: [],
        reservoir_refs: ['wild_bird', 'poultry'],
        transmission_routes: ['respiratory', 'fecal_oral', 'environmental_exposure'],
        geography_tags: ['global'],
        climate_tags: ['migratory_bird_season'],
        amr_relevance: 'none_known',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['avian influenza', 'bird flu', 'h5n1', 'h5', 'influenza a'],
        contextual_terms: ['poultry', 'backyard flock', 'wildlife', 'wild bird', 'outbreak', 'respiratory', 'cyanosis', 'egg drop'],
    },
    {
        condition_key: 'brucellosis',
        canonical_name: 'Brucellosis',
        condition_domain: 'infectious',
        species_scope: ['bovine', 'ovine', 'caprine', 'canine', 'swine', 'wildlife', 'human'],
        host_scope: ['livestock', 'companion_animal', 'wildlife', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'reservoir',
        syndrome_tags: ['abortion', 'reproductive_loss', 'orchitis', 'fever', 'milk_drop'],
        pathogen_refs: ['Brucella spp.'],
        vector_refs: [],
        reservoir_refs: ['cattle', 'small_ruminant', 'dog', 'swine', 'wildlife'],
        transmission_routes: ['reproductive_fluids', 'milk', 'occupational_exposure'],
        geography_tags: ['global'],
        climate_tags: [],
        amr_relevance: 'possible',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['brucellosis', 'brucella'],
        contextual_terms: ['abortion storm', 'abortion', 'orchitis', 'reproductive loss', 'raw milk', 'occupational exposure'],
    },
    {
        condition_key: 'leptospirosis',
        canonical_name: 'Leptospirosis',
        condition_domain: 'infectious',
        species_scope: ['canine', 'bovine', 'equine', 'swine', 'wildlife', 'human'],
        host_scope: ['companion_animal', 'livestock', 'wildlife', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'environmental_bridge',
        syndrome_tags: ['renal', 'hepatic', 'fever', 'icterus', 'hemorrhage'],
        pathogen_refs: ['Leptospira spp.'],
        vector_refs: [],
        reservoir_refs: ['rodent', 'wildlife', 'livestock'],
        transmission_routes: ['urine_exposure', 'waterborne', 'environmental_exposure'],
        geography_tags: ['global'],
        climate_tags: ['flooding', 'heavy_rain'],
        amr_relevance: 'possible',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['leptospirosis', 'leptospira'],
        contextual_terms: ['floodwater', 'standing water', 'rodent', 'icterus', 'acute kidney', 'renal', 'hepatic'],
    },
    {
        condition_key: 'q_fever',
        canonical_name: 'Q fever',
        condition_domain: 'infectious',
        species_scope: ['bovine', 'ovine', 'caprine', 'human'],
        host_scope: ['ruminant', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'environmental_bridge',
        syndrome_tags: ['abortion', 'reproductive_loss', 'pneumonia', 'fever'],
        pathogen_refs: ['Coxiella burnetii'],
        vector_refs: [],
        reservoir_refs: ['ruminant'],
        transmission_routes: ['aerosol', 'birth_products', 'environmental_dust'],
        geography_tags: ['global'],
        climate_tags: ['dry_dust'],
        amr_relevance: 'possible',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['q fever', 'coxiella', 'coxiella burnetii'],
        contextual_terms: ['abortion', 'birth products', 'aerosol', 'pneumonia', 'ruminant herd'],
    },
    {
        condition_key: 'west_nile_virus',
        canonical_name: 'West Nile virus infection',
        condition_domain: 'infectious',
        species_scope: ['equine', 'avian', 'human', 'wildlife'],
        host_scope: ['horse', 'bird', 'human', 'wildlife'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'vector_borne_bridge',
        syndrome_tags: ['neurologic', 'encephalitis', 'ataxia', 'weakness'],
        pathogen_refs: ['West Nile virus'],
        vector_refs: ['mosquito'],
        reservoir_refs: ['bird'],
        transmission_routes: ['vector_borne'],
        geography_tags: ['global'],
        climate_tags: ['mosquito_season', 'standing_water'],
        amr_relevance: 'none_known',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['west nile', 'west nile virus', 'wnv'],
        contextual_terms: ['mosquito', 'neurologic', 'ataxia', 'encephalitis', 'bird die-off'],
    },
    {
        condition_key: 'rift_valley_fever',
        canonical_name: 'Rift Valley fever',
        condition_domain: 'infectious',
        species_scope: ['bovine', 'ovine', 'caprine', 'camelid', 'human'],
        host_scope: ['livestock', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'vector_borne_bridge',
        syndrome_tags: ['abortion', 'fever', 'neonatal_mortality', 'hemorrhage'],
        pathogen_refs: ['Rift Valley fever virus'],
        vector_refs: ['mosquito'],
        reservoir_refs: ['livestock'],
        transmission_routes: ['vector_borne', 'blood_exposure', 'birth_products'],
        geography_tags: ['africa', 'middle_east'],
        climate_tags: ['heavy_rain', 'flooding', 'mosquito_season'],
        amr_relevance: 'none_known',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['rift valley fever', 'rvf'],
        contextual_terms: ['mosquito', 'abortion storm', 'neonatal mortality', 'hemorrhage', 'flooding'],
    },
    {
        condition_key: 'bovine_tuberculosis',
        canonical_name: 'Bovine tuberculosis',
        condition_domain: 'infectious',
        species_scope: ['bovine', 'wildlife', 'human', 'canine', 'feline'],
        host_scope: ['cattle', 'wildlife', 'human', 'companion_animal'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'reservoir',
        syndrome_tags: ['chronic_wasting', 'respiratory', 'lymphadenopathy'],
        pathogen_refs: ['Mycobacterium bovis'],
        vector_refs: [],
        reservoir_refs: ['cattle', 'wildlife'],
        transmission_routes: ['respiratory', 'milk', 'wildlife_contact'],
        geography_tags: ['global'],
        climate_tags: [],
        amr_relevance: 'confirmed',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['bovine tuberculosis', 'mycobacterium bovis', 'm. bovis'],
        contextual_terms: ['chronic wasting', 'tb test', 'tuberculin', 'respiratory', 'wildlife contact'],
    },
    {
        condition_key: 'salmonellosis',
        canonical_name: 'Salmonellosis',
        condition_domain: 'infectious',
        species_scope: ['canine', 'feline', 'bovine', 'equine', 'avian', 'reptile', 'exotic', 'human'],
        host_scope: ['companion_animal', 'livestock', 'reptile', 'poultry', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'environmental_bridge',
        syndrome_tags: ['diarrhea', 'sepsis', 'fever', 'foodborne'],
        pathogen_refs: ['Salmonella spp.'],
        vector_refs: [],
        reservoir_refs: ['reptile', 'poultry', 'livestock'],
        transmission_routes: ['fecal_oral', 'foodborne', 'environmental_exposure'],
        geography_tags: ['global'],
        climate_tags: [],
        amr_relevance: 'surveillance_priority',
        source_keys: [...CORE_SOURCE_KEYS, 'who_antimicrobial_resistance', 'fao_antimicrobial_resistance'],
        match_terms: ['salmonella', 'salmonellosis'],
        contextual_terms: ['diarrhea', 'foodborne', 'reptile', 'poultry', 'fecal', 'amr'],
    },
    {
        condition_key: 'campylobacteriosis',
        canonical_name: 'Campylobacteriosis',
        condition_domain: 'infectious',
        species_scope: ['canine', 'feline', 'bovine', 'avian', 'human'],
        host_scope: ['companion_animal', 'livestock', 'poultry', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'environmental_bridge',
        syndrome_tags: ['diarrhea', 'enteritis', 'foodborne'],
        pathogen_refs: ['Campylobacter spp.'],
        vector_refs: [],
        reservoir_refs: ['poultry', 'livestock', 'companion_animal'],
        transmission_routes: ['fecal_oral', 'foodborne', 'waterborne'],
        geography_tags: ['global'],
        climate_tags: [],
        amr_relevance: 'surveillance_priority',
        source_keys: [...CORE_SOURCE_KEYS, 'who_antimicrobial_resistance', 'fao_antimicrobial_resistance'],
        match_terms: ['campylobacter', 'campylobacteriosis'],
        contextual_terms: ['diarrhea', 'foodborne', 'poultry', 'waterborne', 'amr'],
    },
    {
        condition_key: 'toxoplasmosis',
        canonical_name: 'Toxoplasmosis',
        condition_domain: 'parasitic',
        species_scope: ['feline', 'ovine', 'caprine', 'human', 'wildlife'],
        host_scope: ['cat', 'small_ruminant', 'human', 'wildlife'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'environmental_bridge',
        syndrome_tags: ['abortion', 'neurologic', 'ocular', 'reproductive_loss'],
        pathogen_refs: ['Toxoplasma gondii'],
        vector_refs: [],
        reservoir_refs: ['cat'],
        transmission_routes: ['oocyst_environment', 'foodborne', 'transplacental'],
        geography_tags: ['global'],
        climate_tags: [],
        amr_relevance: 'none_known',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['toxoplasmosis', 'toxoplasma', 'toxoplasma gondii'],
        contextual_terms: ['cat feces', 'abortion', 'ocular', 'neurologic', 'pregnancy', 'foodborne'],
    },
    {
        condition_key: 'echinococcosis',
        canonical_name: 'Echinococcosis',
        condition_domain: 'parasitic',
        species_scope: ['canine', 'ovine', 'caprine', 'bovine', 'wildlife', 'human'],
        host_scope: ['dog', 'livestock', 'wildlife', 'human'],
        human_relevance: 'zoonotic',
        zoonotic_role: 'reservoir',
        syndrome_tags: ['cystic_disease', 'hepatic', 'pulmonary', 'abattoir'],
        pathogen_refs: ['Echinococcus spp.'],
        vector_refs: [],
        reservoir_refs: ['dog', 'wild_canid'],
        transmission_routes: ['fecal_oral', 'foodborne', 'environmental_exposure'],
        geography_tags: ['global'],
        climate_tags: [],
        amr_relevance: 'none_known',
        source_keys: CORE_SOURCE_KEYS,
        match_terms: ['echinococcosis', 'echinococcus', 'hydatid'],
        contextual_terms: ['cyst', 'abattoir', 'sheep', 'dog', 'hepatic cyst', 'pulmonary cyst'],
    },
    {
        condition_key: 'amr_enterobacterales_surveillance',
        canonical_name: 'AMR Enterobacterales surveillance signal',
        condition_domain: 'public_health',
        species_scope: ['canine', 'feline', 'bovine', 'ovine', 'caprine', 'equine', 'avian', 'reptile', 'exotic', 'human'],
        host_scope: ['companion_animal', 'livestock', 'wildlife', 'human', 'environment'],
        human_relevance: 'shared_exposure',
        zoonotic_role: 'environmental_bridge',
        syndrome_tags: ['antimicrobial_resistance', 'culture', 'ast', 'enteric', 'urinary', 'sepsis'],
        pathogen_refs: ['Enterobacterales'],
        vector_refs: [],
        reservoir_refs: ['animal', 'human', 'environment'],
        transmission_routes: ['shared_environment', 'foodborne', 'waterborne', 'healthcare_associated'],
        geography_tags: ['global'],
        climate_tags: [],
        amr_relevance: 'surveillance_priority',
        source_keys: [
            'who_antimicrobial_resistance',
            'fao_antimicrobial_resistance',
            'woah_terrestrial_manual',
            'woah_wahis',
            'pubmed_literature_index',
            'pmc_open_access',
        ],
        match_terms: ['amr', 'antimicrobial resistance', 'mdr', 'esbl', 'carbapenemase', 'enterobacterales'],
        contextual_terms: ['culture', 'sensitivity', 'ast', 'resistant', 'antibiogram', 'one health'],
    },
];

export function selectGlobalOneHealthConditionCandidates(
    species: Species,
    caseText: string,
): GlobalConditionCandidateHint[] {
    const normalized = normalizeText(caseText);

    return GLOBAL_ONE_HEALTH_CONDITION_SEEDS
        .map((seed) => {
            const speciesScore = speciesMatchesSeed(seed, species) ? 2 : 0;
            const matchedTerms = collectMatchedTerms(seed.match_terms, normalized);
            const contextualMatches = collectMatchedTerms(seed.contextual_terms, normalized);
            const explicitScore = matchedTerms.length * 3;
            const contextScore = contextualMatches.length;
            const oneHealthScore = hasOneHealthContext(normalized) && seed.human_relevance !== 'none_known' ? 1 : 0;
            const score = speciesScore + explicitScore + contextScore + oneHealthScore;

            return {
                seed,
                score,
                matchedTerms: [...new Set([...matchedTerms, ...contextualMatches])],
                explicitCount: matchedTerms.length,
                contextualCount: contextualMatches.length,
            };
        })
        .filter((entry) =>
            speciesMatchesSeed(entry.seed, species)
            && (
                entry.explicitCount > 0
                || entry.contextualCount >= 2
                || (hasOneHealthContext(normalized) && entry.contextualCount >= 1)
            ),
        )
        .sort((a, b) => b.score - a.score || a.seed.condition_key.localeCompare(b.seed.condition_key))
        .slice(0, 8)
        .map(({ seed, matchedTerms }) => ({
            condition_key: seed.condition_key,
            canonical_name: seed.canonical_name,
            condition_domain: seed.condition_domain,
            species_scope: seed.species_scope,
            host_scope: seed.host_scope,
            human_relevance: seed.human_relevance,
            zoonotic_role: seed.zoonotic_role,
            amr_relevance: seed.amr_relevance,
            source_keys: seed.source_keys,
            matched_terms: matchedTerms,
            reason: buildCandidateReason(seed, matchedTerms),
        }));
}

function speciesMatchesSeed(seed: GlobalOneHealthConditionSeed, species: Species) {
    if (seed.species_scope.includes(species)) return true;
    if (species === 'bovine' && seed.species_scope.includes('livestock')) return true;
    if ((species === 'ovine' || species === 'caprine') && seed.species_scope.some((entry) => entry === 'small_ruminant' || entry === 'livestock')) {
        return true;
    }
    if (species === 'avian' && seed.species_scope.some((entry) => entry === 'poultry' || entry === 'wildlife')) return true;
    if ((species === 'reptile' || species === 'exotic') && seed.species_scope.some((entry) => entry === 'wildlife' || entry === 'exotic')) return true;
    return false;
}

function collectMatchedTerms(terms: string[], caseText: string) {
    return terms.filter((term) => caseText.includes(normalizeText(term)));
}

function hasOneHealthContext(caseText: string) {
    return [
        'human',
        'zoonotic',
        'zoonosis',
        'one health',
        'public health',
        'outbreak',
        'wildlife',
        'environment',
        'foodborne',
        'waterborne',
        'amr',
        'antimicrobial resistance',
    ].some((term) => caseText.includes(term));
}

function buildCandidateReason(seed: GlobalOneHealthConditionSeed, matchedTerms: string[]) {
    const matchText = matchedTerms.length > 0 ? `Matched ${matchedTerms.slice(0, 4).join(', ')}.` : 'Matched species and One Health context.';
    return `${matchText} Candidate is source-seeded only; confirm through source ingestion, clinician review, diagnostics, and outcome evidence before it can expand the live differential.`;
}

function normalizeText(value: string) {
    return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
