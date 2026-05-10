import type { RagAuthorityTier, RagSourceType } from './types';

export interface CuratedRagSourceDefinition {
    external_key: string;
    name: string;
    source_type: RagSourceType;
    authority_tier: RagAuthorityTier;
    species_scope: string[];
    medicine_domain: string[];
    url: string;
    license: string;
    attribution: string;
    ingestion_policy: Record<string, unknown>;
    refresh_policy: {
        connector: 'public_https' | 'source_card' | 'ncbi_literature' | 'regulatory_index';
        refresh_interval_days: number;
        fetch_remote_text: boolean;
        requires_clinician_review?: boolean;
    };
    connector_queries?: Array<{
        label: string;
        database: 'pubmed' | 'pmc';
        query: string;
        max_records?: number;
    }>;
    source_card: {
        retrieval_use: string;
        safety_boundary: string;
        integration_hooks: string[];
        seed_topics: string[];
    };
}

export const CURATED_VETERINARY_RAG_SOURCES: CuratedRagSourceDefinition[] = [
    {
        external_key: 'avma_resources',
        name: 'AVMA veterinary resources and tools',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'avian', 'exotic'],
        medicine_domain: ['clinical_guideline', 'public_health', 'antimicrobial_stewardship'],
        url: 'https://www.avma.org/resources-tools',
        license: 'public web reference; verify source terms before redistributing extracted text',
        attribution: 'American Veterinary Medical Association',
        ingestion_policy: {
            preferred_for: ['professional guidance', 'policy', 'antimicrobial stewardship'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 14,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Professional veterinary guidance, policy context, stewardship, and practice standards.',
            safety_boundary: 'Use as decision-support context and route final clinical decisions through a licensed veterinarian.',
            integration_hooks: ['counterfactual_reviewer', 'clinical_safety_guardrail', 'outcome_learning'],
            seed_topics: ['antimicrobial stewardship', 'veterinary guidelines', 'practice resources'],
        },
    },
    {
        external_key: 'aaha_guidelines',
        name: 'AAHA canine and feline guidelines',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: ['canine', 'feline'],
        medicine_domain: ['clinical_guideline', 'preventive_care', 'diagnostics', 'treatment_pathway'],
        url: 'https://www.aaha.org/for-veterinary-professionals/aaha-guidelines/',
        license: 'public web reference; verify source terms before redistributing extracted text',
        attribution: 'American Animal Hospital Association',
        ingestion_policy: {
            preferred_for: ['small animal clinical guideline', 'preventive care', 'practice workflow'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 14,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Small animal clinical guideline grounding for canine and feline workflows.',
            safety_boundary: 'Guideline excerpts must be interpreted against patient context, comorbidities, and clinician judgment.',
            integration_hooks: ['causal_memory', 'counterfactual_reviewer', 'treatment_intelligence'],
            seed_topics: ['canine guidelines', 'feline guidelines', 'vaccination', 'pain management', 'preventive care'],
        },
    },
    {
        external_key: 'wsava_global_guidelines',
        name: 'WSAVA global veterinary guidelines',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: ['canine', 'feline'],
        medicine_domain: ['clinical_guideline', 'nutrition', 'vaccination', 'diagnostics'],
        url: 'https://wsava.org/global-guidelines/',
        license: 'public web reference; verify source terms before redistributing extracted text',
        attribution: 'World Small Animal Veterinary Association',
        ingestion_policy: {
            preferred_for: ['global small animal guideline', 'nutrition', 'vaccination'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Global small-animal guideline grounding for vaccination, nutrition, and common clinical standards.',
            safety_boundary: 'Use regional law, product availability, and local disease prevalence before operationalizing recommendations.',
            integration_hooks: ['causal_memory', 'counterfactual_reviewer', 'population_surveillance'],
            seed_topics: ['global guidelines', 'vaccination', 'nutrition', 'small animal diagnostics'],
        },
    },
    {
        external_key: 'acvim_endorsed_statements',
        name: 'ACVIM endorsed statements',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'small_animal', 'large_animal'],
        medicine_domain: ['internal_medicine', 'clinical_guideline', 'diagnostics', 'treatment_pathway'],
        url: 'https://www.acvim.org/journals-research/research/acvim-endorsed-statements',
        license: 'public professional reference; article-level licenses vary',
        attribution: 'American College of Veterinary Internal Medicine',
        ingestion_policy: {
            preferred_for: ['specialist consensus', 'internal medicine', 'evidence-based practice guideline'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Specialist-endorsed consensus, evidence-based practice guidance, and systematic review routing.',
            safety_boundary: 'Consensus statements supplement but do not replace patient-specific clinical judgment and local standards of care.',
            integration_hooks: ['counterfactual_reviewer', 'clinical_safety_guardrail', 'model_promotion_gate'],
            seed_topics: ['ACVIM consensus statement', 'internal medicine guideline', 'evidence-based veterinary practice'],
        },
    },
    {
        external_key: 'aafp_feline_guidelines',
        name: 'AAFP feline practice guidelines',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: ['feline'],
        medicine_domain: ['clinical_guideline', 'preventive_care', 'feline_medicine', 'zoonotic_disease'],
        url: 'https://www.aafponline.org/about/guidelines.html',
        license: 'public professional reference; guideline and article licenses vary',
        attribution: 'American Association of Feline Practitioners',
        ingestion_policy: {
            preferred_for: ['feline practice guideline', 'cat friendly handling', 'retrovirus', 'feline zoonosis'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Feline-focused clinical guidance, client-risk framing, retrovirus, vaccination, life stage, and cat-friendly care workflows.',
            safety_boundary: 'Use feline-specific guidance alongside current diagnostics, regional law, product labels, and clinician judgment.',
            integration_hooks: ['clinical_safety_guardrail', 'counterfactual_reviewer', 'one_health_surveillance'],
            seed_topics: ['feline guidelines', 'cat friendly practice', 'feline zoonosis', 'feline retrovirus', 'feline vaccination'],
        },
    },
    {
        external_key: 'merck_veterinary_manual',
        name: 'Merck Veterinary Manual',
        source_type: 'textbook',
        authority_tier: 'institutional',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'avian', 'exotic'],
        medicine_domain: ['disease_reference', 'diagnostics', 'treatment_pathway', 'infectious_disease'],
        url: 'https://www.merckvetmanual.com/en-us/veterinary-topics',
        license: 'public web reference; verify source terms before redistributing extracted text',
        attribution: 'Merck Veterinary Manual',
        ingestion_policy: {
            preferred_for: ['disease reference', 'diagnostic overview', 'differential context'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Broad veterinary disease reference and differential-diagnosis support across species.',
            safety_boundary: 'Reference material must not override patient-specific exam, diagnostics, drug labels, or specialist guidelines.',
            integration_hooks: ['multi_agent_consensus', 'counterfactual_reviewer', 'diagnostic_panel_selector'],
            seed_topics: ['canine distemper', 'vomiting diarrhea diagnostics', 'infectious disease', 'differential diagnosis'],
        },
    },
    {
        external_key: 'cornell_feline_health_center',
        name: 'Cornell Feline Health Center health topics',
        source_type: 'web',
        authority_tier: 'institutional',
        species_scope: ['feline'],
        medicine_domain: ['disease_reference', 'client_education', 'infectious_disease', 'nutrition', 'behavior', 'one_health'],
        url: 'https://www.vet.cornell.edu/departments-centers-and-institutes/cornell-feline-health-center/health-information/feline-health-topics',
        license: 'public university veterinary reference; verify reuse terms before redistributing extracted text',
        attribution: 'Cornell University College of Veterinary Medicine Feline Health Center',
        ingestion_policy: {
            preferred_for: ['feline disease reference', 'owner education', 'feline infectious disease'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'University-vetted feline health reference material for disease education, owner-facing explanations, and triage context.',
            safety_boundary: 'Client education material supports but does not replace examination, diagnostics, treatment planning, or emergency care.',
            integration_hooks: ['client_education_guardrail', 'counterfactual_reviewer', 'outcome_learning'],
            seed_topics: ['feline health topics', 'feline infectious disease', 'feline kidney disease', 'feline nutrition', 'cat owner education'],
        },
    },
    {
        external_key: 'veterinary_partner_vin',
        name: 'Veterinary Partner VIN client education',
        source_type: 'client_handout',
        authority_tier: 'institutional',
        species_scope: ['canine', 'feline', 'equine', 'avian', 'reptile', 'amphibian', 'small_mammal', 'swine', 'ruminant'],
        medicine_domain: ['client_education', 'disease_reference', 'medications', 'preventive_care'],
        url: 'https://veterinarypartner.vin.com/default.aspx?pid=19239',
        license: 'public veterinary client education reference; verify reuse terms before redistributing extracted text',
        attribution: 'Veterinary Information Network Veterinary Partner',
        ingestion_policy: {
            preferred_for: ['client education', 'owner-friendly explanation', 'medication counseling'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Veterinarian-authored owner education and medication context across companion, equine, exotic, and food-animal species.',
            safety_boundary: 'Owner-facing education must be translated back into clinician-supervised diagnostic and treatment decisions.',
            integration_hooks: ['client_education_guardrail', 'clinical_safety_guardrail', 'treatment_intelligence'],
            seed_topics: ['veterinary partner', 'client education', 'pet medications', 'species health information'],
        },
    },
    {
        external_key: 'iris_kidney_guidelines',
        name: 'IRIS kidney disease guidelines',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: ['canine', 'feline'],
        medicine_domain: ['nephrology', 'renal_disease', 'lab_reference', 'clinical_guideline', 'treatment_pathway'],
        url: 'https://www.iris-kidney.com/iris-guidelines-1',
        license: 'public specialist guideline reference; verify reuse terms before redistributing extracted text',
        attribution: 'International Renal Interest Society',
        ingestion_policy: {
            preferred_for: ['CKD staging', 'AKI grading', 'proteinuria', 'renal treatment recommendations'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Canine and feline kidney disease staging, lab interpretation, treatment-pathway, and monitoring context.',
            safety_boundary: 'Renal recommendations depend on patient hydration, comorbidities, trends, lab methods, and clinician-supervised follow-up.',
            integration_hooks: ['diagnostic_panel_selector', 'counterfactual_reviewer', 'treatment_intelligence'],
            seed_topics: ['IRIS CKD staging', 'IRIS AKI grading', 'proteinuria', 'creatinine', 'SDMA', 'renal treatment'],
        },
    },
    {
        external_key: 'usda_aphis_veterinary_services',
        name: 'USDA APHIS Veterinary Services',
        source_type: 'guideline',
        authority_tier: 'regulatory',
        species_scope: ['equine', 'bovine', 'ovine', 'caprine', 'swine', 'avian', 'wildlife'],
        medicine_domain: ['surveillance', 'biosecurity', 'notifiable_disease', 'livestock_health', 'one_health'],
        url: 'https://www.aphis.usda.gov/veterinary-services',
        license: 'public government reference',
        attribution: 'United States Department of Agriculture APHIS Veterinary Services',
        ingestion_policy: {
            preferred_for: ['livestock disease surveillance', 'biosecurity', 'regulated animal health programs'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'regulatory_index',
            refresh_interval_days: 14,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'U.S. livestock, poultry, and animal-health surveillance context for regulated disease workflows.',
            safety_boundary: 'Regulatory actions and reportability must be confirmed against current federal, state, and local requirements.',
            integration_hooks: ['one_health_surveillance', 'population_signal_engine', 'outbreak_signal_review'],
            seed_topics: ['APHIS veterinary services', 'livestock disease', 'biosecurity', 'animal health surveillance'],
        },
    },
    {
        external_key: 'woah_terrestrial_manual',
        name: 'WOAH Terrestrial Manual',
        source_type: 'guideline',
        authority_tier: 'regulatory',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'ovine', 'caprine', 'avian', 'swine'],
        medicine_domain: ['infectious_disease', 'diagnostics', 'surveillance', 'one_health'],
        url: 'https://www.woah.org/en/what-we-do/standards/codes-and-manuals/terrestrial-manual-online-access/',
        license: 'public web reference; verify source terms before redistributing extracted text',
        attribution: 'World Organisation for Animal Health',
        ingestion_policy: {
            preferred_for: ['notifiable disease', 'diagnostic standards', 'cross-border surveillance'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'regulatory_index',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Disease surveillance, diagnostic test standardization, and outbreak triage grounding.',
            safety_boundary: 'Regulatory reporting obligations vary by jurisdiction and must be confirmed against local authority rules.',
            integration_hooks: ['one_health_surveillance', 'population_signal_engine', 'counterfactual_reviewer'],
            seed_topics: ['notifiable disease', 'diagnostic test standards', 'surveillance', 'zoonotic disease'],
        },
    },
    {
        external_key: 'cdc_one_health',
        name: 'CDC One Health resources',
        source_type: 'web',
        authority_tier: 'regulatory',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'avian', 'wildlife', 'human'],
        medicine_domain: ['one_health', 'zoonotic_disease', 'public_health', 'surveillance'],
        url: 'https://www.cdc.gov/one-health/',
        license: 'public government reference',
        attribution: 'Centers for Disease Control and Prevention',
        ingestion_policy: {
            preferred_for: ['zoonotic bridge risk', 'One Health coordination', 'public health context'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'regulatory_index',
            refresh_interval_days: 14,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Human-animal-environment surveillance context and cross-species zoonotic risk triage.',
            safety_boundary: 'Use public health guidance with veterinary case evidence and local reporting requirements.',
            integration_hooks: ['one_health_surveillance', 'zoonotic_bridge_engine', 'outbreak_signal_review'],
            seed_topics: ['One Health', 'zoonotic disease', 'surveillance', 'human animal environment'],
        },
    },
    {
        external_key: 'cdc_healthy_pets_veterinary',
        name: 'CDC Healthy Pets veterinary resources',
        source_type: 'web',
        authority_tier: 'regulatory',
        species_scope: ['canine', 'feline', 'avian', 'reptile', 'amphibian', 'farm_animal', 'exotic', 'human'],
        medicine_domain: ['zoonotic_disease', 'client_education', 'public_health', 'one_health'],
        url: 'https://www.cdc.gov/healthy-pets/',
        license: 'public government reference',
        attribution: 'Centers for Disease Control and Prevention',
        ingestion_policy: {
            preferred_for: ['zoonotic client education', 'public health triage', 'veterinary public health'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'regulatory_index',
            refresh_interval_days: 14,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Zoonotic disease prevention and client-education grounding for veterinary and human health interfaces.',
            safety_boundary: 'Use alongside veterinary examination, diagnostic confirmation, and local health department guidance.',
            integration_hooks: ['one_health_surveillance', 'client_risk_guardrail', 'outbreak_signal_review'],
            seed_topics: ['healthy pets', 'zoonotic disease', 'veterinary resources', 'public health'],
        },
    },
    {
        external_key: 'capc_parasite_guidelines',
        name: 'CAPC companion animal parasite guidelines',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: ['canine', 'feline'],
        medicine_domain: ['parasitology', 'zoonotic_disease', 'preventive_care', 'diagnostics', 'surveillance'],
        url: 'https://capcvet.org/',
        license: 'public professional guideline reference; verify reuse terms before redistributing extracted text',
        attribution: 'Companion Animal Parasite Council',
        ingestion_policy: {
            preferred_for: ['parasite diagnosis', 'parasite prevention', 'parasite prevalence maps', 'zoonotic parasite risk'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 14,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Small-animal parasite prevention, diagnostic, prevalence, and zoonotic risk grounding for canine and feline cases.',
            safety_boundary: 'Parasite recommendations should account for local prevalence, travel, patient risk, drug labels, and clinician judgment.',
            integration_hooks: ['one_health_surveillance', 'population_signal_engine', 'diagnostic_panel_selector'],
            seed_topics: ['CAPC guidelines', 'heartworm', 'ticks', 'intestinal parasites', 'parasite prevalence', 'zoonotic parasites'],
        },
    },
    {
        external_key: 'esccap_parasite_guidelines',
        name: 'ESCCAP parasite control guidelines',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: ['canine', 'feline', 'equine', 'small_mammal'],
        medicine_domain: ['parasitology', 'zoonotic_disease', 'preventive_care', 'vector_borne_disease', 'travel_medicine'],
        url: 'https://www.esccap.org/guidelines/',
        license: 'public professional guideline reference; verify reuse terms before redistributing extracted text',
        attribution: 'European Scientific Counsel Companion Animal Parasites',
        ingestion_policy: {
            preferred_for: ['parasite control', 'travel/import parasite risk', 'vector-borne disease', 'European companion animal guidance'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'European companion-animal parasite guideline grounding, travel/import risk context, and zoonotic parasite prevention.',
            safety_boundary: 'Regional parasite ecology and product availability vary; local veterinary guidance and labels remain controlling.',
            integration_hooks: ['one_health_surveillance', 'population_signal_engine', 'counterfactual_reviewer'],
            seed_topics: ['ESCCAP guidelines', 'worm control', 'ectoparasites', 'vector borne disease', 'pet travel parasites'],
        },
    },
    {
        external_key: 'fda_animal_drugs',
        name: 'FDA Animal Drugs at FDA',
        source_type: 'drug_label',
        authority_tier: 'regulatory',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'ovine', 'caprine', 'swine', 'avian'],
        medicine_domain: ['drug_safety', 'formulary', 'drug_label', 'adverse_event'],
        url: 'https://animaldrugsatfda.fda.gov/',
        license: 'public government reference',
        attribution: 'U.S. Food and Drug Administration',
        ingestion_policy: {
            preferred_for: ['drug label', 'approved animal drug', 'withdrawal time', 'contraindication'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'regulatory_index',
            refresh_interval_days: 7,
            fetch_remote_text: true,
        },
        source_card: {
            retrieval_use: 'Drug-label grounding for formulary, safety, indication, and withdrawal-time checks.',
            safety_boundary: 'Dosing and extra-label use require clinician judgment and applicable regional legal review.',
            integration_hooks: ['treatment_intelligence', 'adr_pipeline', 'counterfactual_reviewer'],
            seed_topics: ['animal drug label', 'contraindication', 'adverse event', 'withdrawal time', 'formulary'],
        },
    },
    {
        external_key: 'dailymed_drug_labels',
        name: 'DailyMed human and animal drug labels',
        source_type: 'drug_label',
        authority_tier: 'regulatory',
        species_scope: ['human', 'canine', 'feline', 'equine', 'bovine', 'ovine', 'caprine', 'swine', 'avian'],
        medicine_domain: ['drug_safety', 'drug_label', 'contraindication', 'adverse_event', 'formulary'],
        url: 'https://dailymed.nlm.nih.gov/dailymed/',
        license: 'public NLM drug-label reference',
        attribution: 'National Library of Medicine DailyMed',
        ingestion_policy: {
            preferred_for: ['structured product labeling', 'warnings', 'contraindications', 'human medicine bridge'],
            high_authority: true,
            requires_clinician_review: true,
        },
        refresh_policy: {
            connector: 'regulatory_index',
            refresh_interval_days: 7,
            fetch_remote_text: true,
            requires_clinician_review: true,
        },
        source_card: {
            retrieval_use: 'Drug-label grounding for marketed human and animal medicines, especially warnings and contraindication review.',
            safety_boundary: 'Human-label evidence is not a veterinary dosing protocol; extra-label use requires legal and clinical review.',
            integration_hooks: ['treatment_intelligence', 'adr_pipeline', 'evidence_trust_filter'],
            seed_topics: ['DailyMed label', 'contraindication', 'warning', 'animal drug', 'human drug'],
        },
    },
    {
        external_key: 'pmc_open_access',
        name: 'PubMed Central Open Access literature',
        source_type: 'journal',
        authority_tier: 'peer_reviewed',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'avian', 'exotic', 'human'],
        medicine_domain: ['research', 'evidence', 'diagnostics', 'treatment_pathway', 'one_health'],
        url: 'https://pmc.ncbi.nlm.nih.gov/tools/openftlist/',
        license: 'open-access corpus; article-level licenses vary',
        attribution: 'PubMed Central Open Access Subset',
        ingestion_policy: {
            preferred_for: ['open literature', 'peer reviewed evidence', 'full text retrieval'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'ncbi_literature',
            refresh_interval_days: 7,
            fetch_remote_text: false,
        },
        connector_queries: [
            {
                label: 'open access veterinary clinical evidence',
                database: 'pmc',
                query: '(veterinary medicine OR dogs OR cats OR equine OR bovine) AND (diagnostic OR treatment OR guideline) AND open access[filter]',
                max_records: 5,
            },
            {
                label: 'one health zoonotic evidence',
                database: 'pmc',
                query: '(zoonotic OR "One Health") AND veterinary AND open access[filter]',
                max_records: 4,
            },
        ],
        source_card: {
            retrieval_use: 'Open-access journal evidence for diagnostics, treatment mechanisms, and cross-species research signals.',
            safety_boundary: 'Grade literature by study design, species match, recency, and direct patient applicability.',
            integration_hooks: ['counterfactual_reviewer', 'clinical_memory', 'model_promotion_gate'],
            seed_topics: ['open access veterinary medicine', 'clinical study', 'diagnostic accuracy', 'therapeutic evidence'],
        },
    },
    {
        external_key: 'pubmed_literature_index',
        name: 'PubMed veterinary and medical literature index',
        source_type: 'journal',
        authority_tier: 'peer_reviewed',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'avian', 'exotic', 'human'],
        medicine_domain: ['research', 'evidence', 'diagnostics', 'treatment_pathway', 'one_health'],
        url: 'https://pubmed.ncbi.nlm.nih.gov/',
        license: 'bibliographic index; article licenses vary',
        attribution: 'National Library of Medicine PubMed',
        ingestion_policy: {
            preferred_for: ['literature discovery', 'abstract grounding', 'evidence review'],
            high_authority: true,
        },
        refresh_policy: {
            connector: 'ncbi_literature',
            refresh_interval_days: 7,
            fetch_remote_text: false,
        },
        connector_queries: [
            {
                label: 'veterinary medicine evidence discovery',
                database: 'pubmed',
                query: '(veterinary medicine[MeSH Terms] OR dog OR cat OR equine OR bovine) AND (diagnosis OR therapeutics OR guideline)',
                max_records: 6,
            },
            {
                label: 'comparative medicine bridge',
                database: 'pubmed',
                query: '("comparative medicine" OR "One Health") AND (veterinary OR zoonosis)',
                max_records: 4,
            },
        ],
        source_card: {
            retrieval_use: 'Peer-reviewed literature discovery and abstract-level grounding across veterinary and medical topics.',
            safety_boundary: 'Use abstracts to locate evidence; do not treat abstracts alone as complete clinical protocols.',
            integration_hooks: ['counterfactual_reviewer', 'model_promotion_gate', 'outcome_learning'],
            seed_topics: ['veterinary medicine', 'zoonosis', 'diagnostic test', 'therapy', 'case-control study'],
        },
    },
    {
        external_key: 'ncbi_bookshelf_biomedical_reference',
        name: 'NCBI Bookshelf biomedical and life sciences reference',
        source_type: 'textbook',
        authority_tier: 'institutional',
        species_scope: ['human', 'canine', 'feline', 'equine', 'bovine', 'avian', 'exotic'],
        medicine_domain: ['biomedical_reference', 'pathophysiology', 'drug_safety', 'research', 'one_health'],
        url: 'https://www.ncbi.nlm.nih.gov/books/',
        license: 'public biomedical book and guideline index; title-level licenses vary',
        attribution: 'National Library of Medicine NCBI Bookshelf',
        ingestion_policy: {
            preferred_for: ['biomedical mechanisms', 'medical reference', 'guideline discovery'],
            high_authority: true,
            requires_clinician_review: true,
        },
        refresh_policy: {
            connector: 'source_card',
            refresh_interval_days: 30,
            fetch_remote_text: false,
            requires_clinician_review: true,
        },
        source_card: {
            retrieval_use: 'Biomedical reference discovery for cross-species mechanisms, toxicology, pharmacology, and human-medicine context.',
            safety_boundary: 'Human medical reference content must be translated through veterinary species, dose, and legal constraints.',
            integration_hooks: ['counterfactual_reviewer', 'evidence_trust_filter', 'treatment_intelligence'],
            seed_topics: ['NCBI Bookshelf', 'biomedical reference', 'pathophysiology', 'toxicology', 'guideline'],
        },
    },
    {
        external_key: 'biovenic_animal_health_platform',
        name: 'BioVenic animal health biotechnology platform',
        source_type: 'web',
        authority_tier: 'unverified',
        species_scope: ['canine', 'feline', 'equine', 'bovine', 'swine', 'avian', 'aquaculture', 'livestock'],
        medicine_domain: ['veterinary_biologicals', 'animal_research', 'therapeutic_antibody', 'vaccine_development', 'nutrition_research'],
        url: 'https://www.biovenic.com/',
        license: 'commercial web reference; verify source terms and claims before clinical use',
        attribution: 'BioVenic',
        ingestion_policy: {
            commercial_vendor_source: true,
            preferred_for: ['vendor capability discovery', 'biotechnology service discovery', 'hypothesis generation'],
            high_authority: false,
            requires_clinician_review: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
            requires_clinician_review: true,
        },
        source_card: {
            retrieval_use: 'Commercial animal-health biotechnology source discovery across veterinary biologicals, animal R&D, nutrition, and molecular breeding.',
            safety_boundary: 'Treat BioVenic platform material as commercial capability discovery only; require independent peer-reviewed, regulatory, or specialist evidence before clinical use.',
            integration_hooks: ['evidence_trust_filter', 'counterfactual_reviewer', 'treatment_intelligence'],
            seed_topics: ['BioVenic', 'veterinary biologicals', 'animal health biotechnology', 'animal R&D', 'veterinary products'],
        },
    },
    {
        external_key: 'biovenic_veterinary_therapeutic_antibody',
        name: 'BioVenic veterinary therapeutic antibody development',
        source_type: 'web',
        authority_tier: 'unverified',
        species_scope: ['canine', 'feline', 'equine', 'livestock'],
        medicine_domain: ['therapeutic_antibody', 'oncology', 'immunology', 'infectious_disease', 'veterinary_biologicals'],
        url: 'https://www.biovenic.com/veterinary-therapeutic-antibody-development.htm',
        license: 'commercial web reference; verify source terms and claims before clinical use',
        attribution: 'BioVenic',
        ingestion_policy: {
            commercial_vendor_source: true,
            preferred_for: ['therapeutic antibody R&D discovery', 'caninization', 'felinization', 'target discovery'],
            high_authority: false,
            requires_clinician_review: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
            requires_clinician_review: true,
        },
        source_card: {
            retrieval_use: 'Commercial discovery context for veterinary therapeutic antibodies, species-specific antibodies, safety assessment, and manufacturing capabilities.',
            safety_boundary: 'Do not use vendor antibody-development material as a treatment recommendation without independent efficacy, safety, regulatory, and clinician review.',
            integration_hooks: ['evidence_trust_filter', 'counterfactual_reviewer', 'treatment_intelligence'],
            seed_topics: ['veterinary therapeutic antibody', 'canine antibody', 'feline antibody', 'caninization', 'felinization', 'therapeutic target'],
        },
    },
    {
        external_key: 'biovenic_canine_distemper_antibody',
        name: 'BioVenic canine distemper virus therapeutic antibody page',
        source_type: 'web',
        authority_tier: 'unverified',
        species_scope: ['canine'],
        medicine_domain: ['infectious_disease', 'therapeutic_antibody', 'canine_distemper'],
        url: 'https://www.biovenic.com/canine-distemper-virus-therapeutic-antibody-development',
        license: 'commercial web reference; verify source terms and claims before clinical use',
        attribution: 'BioVenic',
        ingestion_policy: {
            commercial_vendor_source: true,
            preferred_for: ['hypothesis generation', 'vendor capability discovery'],
            high_authority: false,
            requires_clinician_review: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            fetch_remote_text: true,
            requires_clinician_review: true,
        },
        source_card: {
            retrieval_use: 'Commercial source discovery for canine distemper therapeutic antibody development concepts.',
            safety_boundary: 'Treat as unverified vendor material; do not use as a treatment recommendation without independent peer-reviewed or regulatory support.',
            integration_hooks: ['counterfactual_reviewer', 'evidence_trust_filter', 'treatment_intelligence'],
            seed_topics: ['canine distemper virus', 'therapeutic antibody', 'vendor source', 'evidence verification'],
        },
    },
];

export function getCuratedRagCatalog(): CuratedRagSourceDefinition[] {
    return CURATED_VETERINARY_RAG_SOURCES;
}

export function buildCuratedSourceCard(definition: CuratedRagSourceDefinition): string {
    const species = definition.species_scope.join(', ');
    const domains = definition.medicine_domain.join(', ');
    const hooks = definition.source_card.integration_hooks.join(', ');
    const topics = definition.source_card.seed_topics.join(', ');
    const connectorQueries = definition.connector_queries?.map((query) => `${query.database}:${query.label}`).join(', ');

    return [
        `${definition.name} is registered in VetIOS as ${definition.authority_tier} ${definition.source_type} evidence.`,
        `Canonical source URL: ${definition.url}`,
        `Species scope: ${species}. Medicine domains: ${domains}.`,
        `Retrieval use: ${definition.source_card.retrieval_use}`,
        `Safety boundary: ${definition.source_card.safety_boundary}`,
        `Agentic RAG integration hooks: ${hooks}.`,
        `Seed retrieval topics: ${topics}.`,
        connectorQueries ? `Connector seed queries: ${connectorQueries}.` : null,
        `Refresh policy: ${definition.refresh_policy.connector} every ${definition.refresh_policy.refresh_interval_days} days.`,
        definition.authority_tier === 'unverified'
            ? 'Trust note: this source is intentionally ranked below peer-reviewed, specialist guideline, regulatory, and institutional evidence.'
            : 'Trust note: this source is ranked as high-priority grounding evidence when retrieved with direct citations.',
        'VetIOS links this source into causal clinical memory, counterfactual diagnostic review, outcome learning, and One Health surveillance when the query context matches.',
    ].filter((line): line is string => typeof line === 'string').join('\n');
}
