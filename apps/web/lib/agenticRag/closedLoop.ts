import type { RagReadinessSummary } from './types';

export type ClosedLoopStageStatus = 'ready' | 'degraded' | 'blocked' | 'gated';

export interface ClosedLoopStage {
    id: string;
    label: string;
    status: ClosedLoopStageStatus;
    inputs: string[];
    outputs: string[];
    safety_gate: string;
}

export interface RagClosedLoopLearningSystem {
    system_id: 'vetios_agentic_rag_closed_loop';
    closed_loop_ready: boolean;
    clinical_reasoning_infrastructure: 'ready' | 'needs_evidence';
    diagnostic_intelligence_pipelines: 'ready' | 'needs_evidence';
    learning_mode: 'evidence_grounded_human_gated';
    corpus: RagReadinessSummary;
    stages: ClosedLoopStage[];
    feedback_edges: Array<{
        from: string;
        to: string;
        signal: string;
        gate: string;
    }>;
    promotion_policy: {
        autonomous_model_promotion: false;
        requires_clinician_review: true;
        requires_citations: true;
        requires_counterfactual_review: true;
        requires_audit_trace: true;
    };
    guarantees: string[];
}

export function buildRagClosedLoopLearningSystem(readiness: RagReadinessSummary): RagClosedLoopLearningSystem {
    const hasSources = readiness.sources > 0;
    const hasDocuments = readiness.documents > 0;
    const hasChunks = readiness.chunks > 0;
    const hasHighAuthority = readiness.high_authority_sources > 0;
    const corpusReady = readiness.ready && hasChunks && hasHighAuthority;
    const freshCorpus = readiness.stale_documents === 0;
    const loopReady = corpusReady && freshCorpus;

    return {
        system_id: 'vetios_agentic_rag_closed_loop',
        closed_loop_ready: loopReady,
        clinical_reasoning_infrastructure: loopReady ? 'ready' : 'needs_evidence',
        diagnostic_intelligence_pipelines: loopReady ? 'ready' : 'needs_evidence',
        learning_mode: 'evidence_grounded_human_gated',
        corpus: readiness,
        stages: [
            {
                id: 'source_registration',
                label: 'Veterinary and medical source registration',
                status: hasSources ? 'ready' : 'blocked',
                inputs: ['curated veterinary catalog', 'medicine/public-health catalog', 'tenant sources'],
                outputs: ['rag_sources authority tiers', 'species scope', 'domain scope', 'refresh policies'],
                safety_gate: 'public HTTPS source policy and authority-tier classification',
            },
            {
                id: 'evidence_indexing',
                label: 'Document and chunk indexing',
                status: hasDocuments && hasChunks ? 'ready' : hasDocuments ? 'degraded' : 'blocked',
                inputs: ['guidelines', 'drug labels', 'literature snapshots', 'lab references', 'source cards'],
                outputs: ['rag_documents', 'rag_chunks', 'content fingerprints', 'chunk provenance'],
                safety_gate: 'content hash, provenance, and stale-document tracking',
            },
            {
                id: 'grounded_retrieval',
                label: 'Citation-first retrieval',
                status: corpusReady ? 'ready' : hasChunks ? 'degraded' : 'blocked',
                inputs: ['clinical question', 'species filter', 'domain filter', 'hybrid/vector/lexical search'],
                outputs: ['ranked citations', 'quoted evidence', 'retrieval stats', 'unsupported-answer refusal'],
                safety_gate: 'no generated clinical claim when evidence is missing',
            },
            {
                id: 'clinical_reasoning',
                label: 'Clinical reasoning infrastructure',
                status: corpusReady ? 'ready' : 'blocked',
                inputs: ['retrieved citations', 'case context', 'diagnostic differentials', 'lab/imaging signals'],
                outputs: ['evidence-grounded diagnostic context', 'causal memory links', 'case audit trail'],
                safety_gate: 'clinical decision-support boundary with licensed-professional review',
            },
            {
                id: 'diagnostic_intelligence',
                label: 'Diagnostic intelligence pipeline',
                status: corpusReady ? 'ready' : 'blocked',
                inputs: ['query ledger', 'citations', 'counterfactual context', 'One Health signals'],
                outputs: ['active-learning candidates', 'diagnostic quality signals', 'source coverage gaps'],
                safety_gate: 'counterfactual review before any learning signal can influence model behavior',
            },
            {
                id: 'human_gated_learning',
                label: 'Human-gated learning loop',
                status: corpusReady ? 'gated' : 'blocked',
                inputs: ['clinician feedback', 'outcome events', 'retrieval misses', 'adversarial evaluations'],
                outputs: ['review queue', 'dataset improvement tasks', 'candidate prompt/model updates'],
                safety_gate: 'no autonomous clinical promotion without clinician approval and audit trace',
            },
            {
                id: 'refresh_and_surveillance',
                label: 'Catalog refresh and surveillance',
                status: loopReady ? 'ready' : corpusReady ? 'degraded' : 'blocked',
                inputs: ['refresh schedule', 'connector diagnostics', 'stale-document checks', 'source errors'],
                outputs: ['refresh runs', 'stale-source warnings', 'catalog diagnostics', 'new source tasks'],
                safety_gate: 'failed/blocked remote fetches remain diagnostics, not silent evidence',
            },
        ],
        feedback_edges: [
            {
                from: 'grounded_retrieval',
                to: 'diagnostic_intelligence',
                signal: 'retrieval success, misses, citation coverage, and authority tier',
                gate: 'citation coverage must be recorded before feedback is actionable',
            },
            {
                from: 'diagnostic_intelligence',
                to: 'human_gated_learning',
                signal: 'counterfactual findings, One Health signals, and active-learning candidates',
                gate: 'clinician or steward review required',
            },
            {
                from: 'human_gated_learning',
                to: 'source_registration',
                signal: 'approved evidence gaps and new-source requests',
                gate: 'source policy and authority-tier review required',
            },
            {
                from: 'refresh_and_surveillance',
                to: 'evidence_indexing',
                signal: 'new, updated, stale, failed, or quarantined source documents',
                gate: 'provenance and content fingerprints required',
            },
        ],
        promotion_policy: {
            autonomous_model_promotion: false,
            requires_clinician_review: true,
            requires_citations: true,
            requires_counterfactual_review: true,
            requires_audit_trace: true,
        },
        guarantees: [
            'VetIOS can use the indexed veterinary and medical corpus as evidence infrastructure for reasoning and diagnostics.',
            'VetIOS does not treat unverified or commercial pages as high-authority clinical protocol evidence.',
            'VetIOS refuses unsupported answers when retrieval cannot ground a clinical or medical claim.',
            'Learning is closed-loop for evidence improvement but remains human-gated for clinical behavior changes.',
        ],
    };
}
