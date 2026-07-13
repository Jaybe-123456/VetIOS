export const STRATEGIC_RAIL_STATUSES = [
    'operational',
    'operating_foundation',
    'partial',
    'foundation',
    'blocked',
    'missing',
] as const;

export type StrategicRailStatus = typeof STRATEGIC_RAIL_STATUSES[number];

export interface StrategicRail {
    key: string;
    title: string;
    status: StrategicRailStatus;
    wedge: string;
    connected_modules: string[];
    built: string[];
    still_missing: string[];
    next_builds: string[];
    lock_in_mechanism: string;
    compute_policy: string;
    proof_required: string[];
}

export interface StrategicBuildPhase {
    phase: string;
    objective: string;
    builds: string[];
    exit_criteria: string[];
}

export interface StrategicRailsPacket {
    schema_version: 'vetios_strategic_rails_v1';
    generated_at: string;
    thesis: {
        what_vetios_should_become: string;
        scarce_resource: string;
        control_surface: string;
        non_goal: string;
    };
    posture: {
        rail_count: number;
        operational: number;
        operating_foundation: number;
        partial: number;
        foundation: number;
        blocked: number;
        missing: number;
        highest_priority_missing: string[];
    };
    rails: StrategicRail[];
    module_graph_edges: Array<{
        from: string;
        to: string;
        purpose: string;
    }>;
    build_sequence: StrategicBuildPhase[];
    source_alignment: Array<{
        source: string;
        infrastructure_implication: string;
    }>;
}

export function buildStrategicRailsPacket(input: { generatedAt?: string | null } = {}): StrategicRailsPacket {
    const generatedAt = normalizeOptionalText(input.generatedAt) ?? new Date().toISOString();
    const rails = buildStrategicRails();
    const summary = summarizeRails(rails);

    return {
        schema_version: 'vetios_strategic_rails_v1',
        generated_at: generatedAt,
        thesis: {
            what_vetios_should_become:
                'VetIOS should become the veterinary and One Health intelligence substrate: the clinical operating rail where cases, outcomes, ontology coverage, partner nodes, model reliability, governance, and compute routing are governed before any AI answer becomes action.',
            scarce_resource:
                'The scarce resource is not only model weights or GPU access. It is trusted clinical workflow plus outcome-confirmed, provenance-verified, species-aware evidence that can decide when compute is worth spending.',
            control_surface:
                'Own the daily operating pipelines: intake, inference, CIRE, outcome closure, ontology ingestion, partner-node learning, AMR surveillance, regulatory evidence, and model/compute routing.',
            non_goal:
                'VetIOS should not compete as another veterinary chatbot or generic medical model wrapper.',
        },
        posture: {
            ...summary,
            highest_priority_missing: [
                'production_pims_lab_pacs_connectors',
                'outcome_closure_at_daily_workflow_depth',
                'verified_global_ontology_population',
                'production_secure_aggregation_materialization',
                'compute_routing_metering_and_policy',
                'external_validation_and_claim_approval_loop',
            ],
        },
        rails,
        module_graph_edges: buildModuleGraphEdges(),
        build_sequence: buildStrategicBuildSequence(),
        source_alignment: buildSourceAlignment(),
    };
}

function buildStrategicRails(): StrategicRail[] {
    return [
        {
            key: 'daily_clinical_workflow_embed',
            title: 'Daily Clinical Workflow Embed',
            status: 'partial',
            wedge: 'Make VetIOS the default workspace where clinicians start cases, ingest labs, review images, ask follow-up questions, and close outcomes.',
            connected_modules: [
                'clinical cases',
                'inference console',
                'Ask VetIOS',
                'outcome learning',
                'workflow integration events',
                'mobile command input',
            ],
            built: [
                'Clinical workspace surfaces exist.',
                'Inference console supports structured, free-text, JSON, and multisystemic modes.',
                'Mobile command input has been stabilized for safer small-screen use.',
                'Workflow integration ledgers and evidence tracking exist.',
            ],
            still_missing: [
                'Production PIMS, lab, PACS, appointment, billing, and follow-up connectors with real credentials.',
                'Daily case closure UX that forces outcome capture into the natural workflow.',
                'Operational retry, reconciliation, and connector health dashboards per clinic.',
            ],
            next_builds: [
                'PIMS/lab/PACS connector adapter v1 with replay-safe import logs.',
                'Outcome closure queue embedded into every inference and case page.',
                'Clinic command center that starts from the highest-value next action after login.',
            ],
            lock_in_mechanism:
                'The switching cost becomes operational memory: open cases, connected records, outcome history, review queues, and clinic-specific calibration.',
            compute_policy:
                'Spend high-reasoning compute only after local deterministic extraction, cache replay, and source completeness checks.',
            proof_required: [
                'At least one real connector producing live events.',
                'Outcome closure rate by clinic.',
                'Connector import freshness and replay idempotency.',
            ],
        },
        {
            key: 'clinical_inference_and_cire',
            title: 'Clinical Inference And CIRE Reliability Rail',
            status: 'operating_foundation',
            wedge: 'Separate answer generation from answer reliability so every inference has lineage, CIRE scoring, actionability gating, replay checks, and clinician review hooks.',
            connected_modules: [
                'inference engine',
                'CIRE engine',
                'reliability packets',
                'gate decision events',
                'review queue',
                'counterfactual challenge',
            ],
            built: [
                'Deterministic inference engine and CIRE scoring exist.',
                'Replay drift checks, calibration snapshots, actionability gates, and review queues are represented.',
                'CIRE public standard, conformance route, certification registry, and methodology docs exist.',
            ],
            still_missing: [
                'Broad global condition coverage from verified ontology expansion rather than static condition patches.',
                'Large label-specific outcome calibration counts across species and geographies.',
                'External CIRE conformance adopters and third-party reliability attestations.',
            ],
            next_builds: [
                'Inference-time ontology candidate expansion from verified provider nodes.',
                'Outcome-volume calibration dashboard per species, label, and model route.',
                'External CIRE adopter sandbox with automated conformance certificates.',
            ],
            lock_in_mechanism:
                'CIRE becomes the reliability language for veterinary AI while VetIOS owns the managed runtime and outcome graph that makes it useful.',
            compute_policy:
                'CIRE and actionability decide whether to cache, run deterministic inference, escalate to higher reasoning, or require human review.',
            proof_required: [
                'Every displayed confidence has CIRE context.',
                'Every high-confidence uncalibrated label is visibly marked.',
                'Gate decisions are persisted and replayable.',
            ],
        },
        {
            key: 'outcome_confirmed_learning',
            title: 'Outcome-Confirmed Learning Rail',
            status: 'partial',
            wedge: 'Convert real clinical closure into the compounding data asset that generic models cannot buy overnight.',
            connected_modules: [
                'clinical outcome events',
                'learning audit events',
                'calibration recompute',
                'federated outcome eligibility',
                'moat completion',
            ],
            built: [
                'Outcome event schema, APIs, calibration recompute paths, and learning audit events exist.',
                'Synthetic rows are blocked from federation eligibility and moat-completion counts.',
                'Federated outcome eligibility snapshots exist.',
            ],
            still_missing: [
                'High-volume live outcome closure.',
                'Reviewer-verified outcome adjudication for ambiguous cases.',
                'Clinic-level outcome incentives and reminders.',
            ],
            next_builds: [
                'Outcome closure automation from follow-up, lab result return, and specialist report completion.',
                'Reviewer adjudication queue for disputed labels.',
                'Outcome freshness and calibration debt dashboard.',
            ],
            lock_in_mechanism:
                'Each clinic builds a longitudinal case memory and calibration history that becomes painful to abandon.',
            compute_policy:
                'Outcome-confirmed labels unlock model promotion and high-confidence automation; unconfirmed labels stay review-first.',
            proof_required: [
                'Confirmed outcome counts by label.',
                'Calibration error before and after outcome learning.',
                'Reviewer agreement and override rates.',
            ],
        },
        {
            key: 'global_one_health_ontology',
            title: 'Global One Health Ontology Spine',
            status: 'partial',
            wedge: 'Make VetIOS reason across animal, human, pathogen, environment, drug, geography, and surveillance concepts instead of forcing every case into a small hardcoded list.',
            connected_modules: [
                'global ontology ingestion',
                'ingestion operations console',
                'WOAH disease reference provider',
                'CDC Open Data provider',
                'NCBI/PubMed provider',
                'mapping review',
            ],
            built: [
                'Provider registry, official ingestion jobs, operations console, source hashes, coverage snapshots, and WOAH disease reference separation exist.',
                'CDC and NCBI provider paths have operational tests.',
                'Licensed/provider key list and direct setup guidance are documented.',
            ],
            still_missing: [
                'Real licensed SNOMED CT, UMLS, ICD-11, and VeNom releases configured and ingested.',
                'Reviewer-verified source mappings and externally verified code alignments.',
                'Open-world candidate expansion active in every inference path.',
            ],
            next_builds: [
                'SNOMED CT and VeNom release adapters with license-safe storage rules.',
                'Mapping reviewer workflow that promotes source-attested mappings to reviewer-verified.',
                'Inference coverage panel and blocked-scoring state when ontology coverage is insufficient.',
            ],
            lock_in_mechanism:
                'VetIOS becomes the crosswalk between veterinary practice data and human/public-health vocabularies.',
            compute_policy:
                'Do not spend high-reasoning inference on concepts with missing provider coverage without surfacing the gap.',
            proof_required: [
                'Provider counts and hashes from real releases.',
                'Verified mapping coverage by species and syndrome.',
                'Inference-time coverage snapshot for every run.',
            ],
        },
        {
            key: 'retrieval_and_citation_quality',
            title: 'Veterinary Retrieval Corpus Rail',
            status: 'foundation',
            wedge: 'Ground clinical explanations in licensed/open veterinary references, versioned source manifests, and citation-quality tests.',
            connected_modules: [
                'Agentic RAG',
                'retrieval corpus audit events',
                'citation quality evaluations',
                'red-team retrieval tests',
            ],
            built: [
                'Ask VetIOS retrieval status logic and corpus audit events exist.',
                'Citation quality and red-team evidence fields are represented.',
            ],
            still_missing: [
                'Real licensed/open veterinary corpus ingestion at production scale.',
                'Toxicology, lab range, drug monograph, imaging, and species-specific reference indexes.',
                'Continuous retrieval red-team and source drift tests.',
            ],
            next_builds: [
                'Licensed source ingestion pipeline with source versioning.',
                'Lab/toxicology index builder.',
                'RAG red-team cron with citation-grounding gates.',
            ],
            lock_in_mechanism:
                'Trusted source provenance and clinic-specific retrieval history become a defensible knowledge layer.',
            compute_policy:
                'Use retrieval grounding before model expansion for source-sensitive answers.',
            proof_required: [
                'Authorized source counts.',
                'Citation grounding rate.',
                'Red-team pass rate by corpus section.',
            ],
        },
        {
            key: 'partner_node_federation',
            title: 'Partner Node Federation Rail',
            status: 'partial',
            wedge: 'Let clinics and labs improve shared models without sending raw records or raw deltas to VetIOS.',
            connected_modules: [
                '@vetios/federation-node',
                'federation runtime events',
                'round node tasks',
                'update submissions',
                'promotion evaluation gates',
            ],
            built: [
                'Clinic/lab node package exists with local record loading, service mode, heartbeats, masked-update proof bundles, key rotation, and audit logging.',
                'Coordinator APIs and append-only runtime/submission ledgers exist.',
                'Aggregate artifact and promotion gate foundations exist.',
            ],
            still_missing: [
                'Live multi-node rounds with real partner data.',
                'Production installer and long-running clinic/lab agent operations.',
                'Coordinator aggregate materialization from real masked vectors and dropout-tolerant unmask shares.',
            ],
            next_builds: [
                'Production service-mode installer with persistent logs and enrollment UX.',
                'Real secure aggregation coordinator materialization.',
                'Live partner-node smoke round with at least three independent nodes.',
            ],
            lock_in_mechanism:
                'Network participants contribute learning signal while preserving local data control, making the federation more valuable with each node.',
            compute_policy:
                'Local training first; central compute only validates commitments, materializes aggregates, and runs promotion gates.',
            proof_required: [
                'Multi-node live round transcript.',
                'Dropout recovery proof.',
                'No raw record or raw delta persistence audit.',
            ],
        },
        {
            key: 'secure_aggregation_protocol',
            title: 'Cryptographic Secure Aggregation Rail',
            status: 'partial',
            wedge: 'Turn privacy-preserving learning from architecture claim into verifiable masked-vector materialization.',
            connected_modules: [
                'secure aggregation configs',
                'federated update submissions',
                'unmask-share records',
                'aggregate builder',
                'partner-node runner',
            ],
            built: [
                'X25519/HKDF pairwise masking, commitments, encrypted share evidence, Ed25519 signatures, and local round-proof mode exist.',
                'Coordinator-side aggregate artifact tests exist.',
            ],
            still_missing: [
                'Production-grade dropout-tolerant reconstruction over live vectors.',
                'Formal external cryptographic review.',
                'Key lifecycle and emergency revocation operations under real partner load.',
            ],
            next_builds: [
                'Coordinator aggregate materialization endpoint for masked vectors plus unmask shares.',
                'Dropout simulation suite with adversarial node behavior.',
                'External cryptography audit packet generator.',
            ],
            lock_in_mechanism:
                'A verified privacy rail lets regulated clinics and labs participate without surrendering raw data.',
            compute_policy:
                'Central compute cannot access raw deltas; it only verifies commitments and materializes authorized aggregates.',
            proof_required: [
                'Reconstructed aggregate equals sum of private local deltas without exposing any delta.',
                'Dropout tolerance report.',
                'External audit findings resolved.',
            ],
        },
        {
            key: 'amr_and_one_health_surveillance',
            title: 'AMR And One Health Surveillance Rail',
            status: 'foundation',
            wedge: 'Connect clinical cases, AST/culture feeds, pathogens, drugs, geography, species, and public-health exports.',
            connected_modules: [
                'AMR stewardship',
                'AMR lab feed surveillance events',
                'global ontology',
                'WOAH/WAHIS',
                'CDC Open Data',
                'One Health export',
            ],
            built: [
                'AMR stewardship/genomic foundations and lab feed surveillance event tables exist.',
                'CDC Open Data and WOAH disease reference provider infrastructure exists.',
            ],
            still_missing: [
                'Real AST/culture feeds from labs.',
                'Pathogen/drug taxonomy normalization with reviewer verification.',
                'One Health export packages and resistance trend dashboards.',
            ],
            next_builds: [
                'AST/culture import adapter.',
                'Drug-pathogen normalization reviewer.',
                'One Health surveillance dashboard with export packets.',
            ],
            lock_in_mechanism:
                'Regional resistance intelligence compounds through partner labs and clinical outcomes.',
            compute_policy:
                'Route AMR cases through source-backed taxonomy and surveillance context before generative explanation.',
            proof_required: [
                'Normalized lab feed counts.',
                'Resistance trend snapshots.',
                'Export packets accepted by partner/public-health workflows.',
            ],
        },
        {
            key: 'regulatory_security_and_claims',
            title: 'Regulatory, Security, And Claims Discipline Rail',
            status: 'foundation',
            wedge: 'Make safety, external validation, model cards, IFU-like documentation, and claim review part of the operating system.',
            connected_modules: [
                'AI security test events',
                'regulatory claim review events',
                'external validation',
                'model registry',
                'CIRE certification',
            ],
            built: [
                'AI security and regulatory claim ledgers exist.',
                'CIRE conformance certificates and model promotion gates exist.',
                'External validation event foundations exist.',
            ],
            still_missing: [
                'Continuous prompt-injection, RAG/vector, tool-abuse, and incident-response tests in production.',
                'Governed legal/clinical approval queues.',
                'Externally verified model cards, IFU-style documents, and claim substantiation packets.',
            ],
            next_builds: [
                'Security red-team cron tied to incident workflow.',
                'Claim approval queue with legal and clinical signoff.',
                'Model-card and IFU generator from live evidence packets.',
            ],
            lock_in_mechanism:
                'Hospitals, clinics, and partners stay because governance evidence is expensive to recreate and risky to lose.',
            compute_policy:
                'Claims, model promotion, and automated actions require current safety evidence and approval state.',
            proof_required: [
                'Security test pass/fail history.',
                'Approved claim packets.',
                'External validation events linked to model versions.',
            ],
        },
        {
            key: 'compute_routing_market_rail',
            title: 'Compute Routing And Market Rail',
            status: 'foundation',
            wedge: 'Treat compute as a governed clinical resource: meter it, route it, hedge it, and prove when high-cost reasoning is justified.',
            connected_modules: [
                'Decision Rails',
                'model routing',
                'control plane',
                'telemetry',
                'CIRE',
                'billing',
            ],
            built: [
                'Decision Rails already returns a compute strategy for cache replay, deterministic routing, high-reasoning escalation, or human review.',
                'Model routing, telemetry, billing navigation, and control-plane concepts exist.',
            ],
            still_missing: [
                'Cost, latency, model-family, and reliability-aware compute router.',
                'Per-clinic compute budgets and audit reports.',
                'External compute marketplace/provider abstraction.',
            ],
            next_builds: [
                'Compute policy engine v1 tied to Decision Rails.',
                'Inference cost meter and budget dashboard.',
                'Provider-agnostic model/compute route registry.',
            ],
            lock_in_mechanism:
                'VetIOS becomes the clinic-side rail that decides when expensive model calls are clinically and economically justified.',
            compute_policy:
                'Every inference route should explain cost, latency, evidence quality, reliability, and review state before spending scarce compute.',
            proof_required: [
                'Per-route cost and latency logs.',
                'Escalation avoided by cache/deterministic path.',
                'Safety outcomes by route family.',
            ],
        },
        {
            key: 'moat_evidence_control_plane',
            title: 'Moat Evidence Control Plane',
            status: 'partial',
            wedge: 'Make defensibility measurable through live counts, freshness, outcome linkage, provenance, trust scoring, and external validation.',
            connected_modules: [
                'moat completion service',
                'system dashboard',
                'decision rails',
                'ingestion operations console',
                'control-plane logs',
            ],
            built: [
                'Moat completion service tracks completion levels and missing evidence.',
                'System dashboard shows telemetry, CIRE, routing, governance, and alert surfaces.',
                'Ingestion operations console exposes provider configuration, dry-run, commit, and coverage state.',
            ],
            still_missing: [
                'Enough live event volume to move most moats from foundation to operating or defensible.',
                'Unified login landing that routes users to the highest-value next action.',
                'Board/investor evidence exports from real operating counts.',
            ],
            next_builds: [
                'Infrastructure home router after login with next-best-feature selection.',
                'Moat evidence export packet.',
                'Operating-count thresholds per moat and partner segment.',
            ],
            lock_in_mechanism:
                'The control plane becomes the record of operational truth for clinics, partners, and investors.',
            compute_policy:
                'Dashboards should show when missing evidence makes a high-cost compute action unjustified.',
            proof_required: [
                'Fresh live signals for each moat.',
                'Decision Rails and moat completion agree on blockers.',
                'Exports show source counts without leaking protected data.',
            ],
        },
    ];
}

function buildModuleGraphEdges(): StrategicRailsPacket['module_graph_edges'] {
    return [
        {
            from: 'clinical_intake',
            to: 'inference_and_cire',
            purpose: 'Convert structured species-aware signals into auditable differentials and reliability state.',
        },
        {
            from: 'inference_and_cire',
            to: 'outcome_confirmed_learning',
            purpose: 'Turn predictions into calibrated memory only after clinician-confirmed outcome closure.',
        },
        {
            from: 'global_one_health_ontology',
            to: 'inference_candidate_expansion',
            purpose: 'Expand beyond static conditions while exposing missing provider coverage and unverified mappings.',
        },
        {
            from: 'retrieval_corpus',
            to: 'clinical_explanation',
            purpose: 'Ground explanations, next tests, and source-sensitive claims in versioned references.',
        },
        {
            from: 'partner_node_federation',
            to: 'secure_aggregation_protocol',
            purpose: 'Let local nodes train and submit masked updates without central raw-record access.',
        },
        {
            from: 'secure_aggregation_protocol',
            to: 'model_promotion_governance',
            purpose: 'Permit candidate promotion only after privacy, benchmark, calibration, and safety evidence exists.',
        },
        {
            from: 'decision_rails',
            to: 'compute_routing_market_rail',
            purpose: 'Route compute based on cacheability, evidence quality, CIRE state, cost, latency, and review needs.',
        },
        {
            from: 'moat_evidence_control_plane',
            to: 'operator_next_action',
            purpose: 'Show the next highest-leverage build, blocker, or review action instead of disconnected modules.',
        },
    ];
}

function buildStrategicBuildSequence(): StrategicBuildPhase[] {
    return [
        {
            phase: 'P0 daily operating wedge',
            objective: 'Make VetIOS unavoidable in daily clinical work before trying to look like a giant platform.',
            builds: [
                'PIMS/lab/PACS connector v1',
                'Outcome closure queue',
                'Login destination router to the highest-value next action',
            ],
            exit_criteria: [
                'Real connector events exist for at least one clinic or lab.',
                'Every inference has an outcome hook and visible closure state.',
                'A returning user lands on the most urgent operating action, not a generic dashboard.',
            ],
        },
        {
            phase: 'P1 source-backed intelligence spine',
            objective: 'Replace patched condition lists with source-backed ontology and retrieval coverage.',
            builds: [
                'SNOMED CT and VeNom release adapters',
                'Mapping review workflow',
                'Inference ontology coverage panel',
                'Citation-quality red-team cron',
            ],
            exit_criteria: [
                'Provider releases have source hashes and imported row counts.',
                'Mappings can be approved, rejected, or quarantined.',
                'Inference persists coverage and gap snapshots.',
            ],
        },
        {
            phase: 'P2 privacy-preserving network learning',
            objective: 'Prove that VetIOS can operate live multi-node learning without centralizing raw clinical records.',
            builds: [
                'Production federation node installer',
                'Coordinator secure aggregation materialization',
                'Live three-node smoke round',
            ],
            exit_criteria: [
                'At least three nodes heartbeat, pull tasks, train locally, and submit masked updates.',
                'Aggregate materialization is verified without raw delta persistence.',
                'Dropout recovery evidence is recorded.',
            ],
        },
        {
            phase: 'P3 compute and governance rail',
            objective: 'Turn compute from an opaque cost into a clinical infrastructure decision.',
            builds: [
                'Compute policy engine',
                'Inference cost and latency meter',
                'Provider-agnostic model route registry',
                'Model-card and claim evidence generator',
            ],
            exit_criteria: [
                'Every high-cost route explains why it was used.',
                'Budget, latency, CIRE, and evidence quality are visible by route.',
                'Model promotion and claims require current evidence packets.',
            ],
        },
        {
            phase: 'P4 external trust and distribution',
            objective: 'Make VetIOS hard to remove by becoming the evidence and reliability rail others integrate with.',
            builds: [
                'External validation workflow',
                'CIRE adopter sandbox',
                'Partner/lab marketplace operations',
                'Moat evidence export packet',
            ],
            exit_criteria: [
                'External reviewers can verify mappings, model cards, CIRE conformance, and claims.',
                'Partners depend on VetIOS APIs or node workflows.',
                'Moat completion claims are backed by live counts and fresh evidence.',
            ],
        },
    ];
}

function buildSourceAlignment(): StrategicRailsPacket['source_alignment'] {
    return [
        {
            source: 'FDA Good Machine Learning Practice and PCCP guidance',
            infrastructure_implication:
                'VetIOS should treat model changes as controlled, evidence-backed, monitored lifecycle events, not silent prompt or model swaps.',
        },
        {
            source: 'WHO AI for health and large multi-modal model guidance',
            infrastructure_implication:
                'VetIOS needs transparency, human oversight, safety monitoring, equity, privacy, and post-deployment surveillance built into the platform.',
        },
        {
            source: 'Clinical AI reporting standards such as DECIDE-AI, CONSORT-AI, SPIRIT-AI, and MI-CLAIM',
            infrastructure_implication:
                'Every clinical claim should be traceable to study design, data lineage, evaluation cohort, limitations, and reviewer approval.',
        },
        {
            source: 'WHO GLASS, WOAH AMR, WAHIS, CDC, PubMed, UMLS, ICD-11, SNOMED CT, VeNom, VetCompass',
            infrastructure_implication:
                'One Health intelligence must be source-backed and code-mapped before it can safely expand clinical candidate spaces.',
        },
        {
            source: 'Compute-market infrastructure trend',
            infrastructure_implication:
                'The durable product is not only access to GPUs. It is the policy rail that decides which clinical cases deserve expensive compute and why.',
        },
        {
            source: 'Healthcare enterprise adoption pattern',
            infrastructure_implication:
                'The strongest wedge is integration into daily clinical operations, with governance, privacy, and measurable outcomes as the buying language.',
        },
    ];
}

function summarizeRails(rails: StrategicRail[]) {
    const counts = {
        rail_count: rails.length,
        operational: 0,
        operating_foundation: 0,
        partial: 0,
        foundation: 0,
        blocked: 0,
        missing: 0,
    };

    for (const rail of rails) {
        counts[rail.status] += 1;
    }

    return counts;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
