import type { AskVetiosCaseGraphSnapshot } from '@/lib/askVetios/caseGraph';
import type { AskVetiosIntakeSummary } from '@/lib/askVetios/intake';

export type AskVetiosAiSecurityStatus =
    | 'monitored'
    | 'guarded'
    | 'restricted'
    | 'security_review_required';

export interface AskVetiosAiSecuritySnapshot {
    schema_version: 'ask-vetios-ai-security-v1';
    status: AskVetiosAiSecurityStatus;
    security_boundary: 'public_ask_vetios_runtime';
    controls: {
        rate_limit: {
            requests_per_minute: 30;
            max_body_bytes: 32768;
            max_message_chars: 2000;
            max_conversation_turns: 20;
            token_budget_enforced: true;
        };
        tool_policy: {
            admin_tools_allowed: false;
            autonomous_actions_allowed: false;
            write_actions_allowed: false;
            external_network_tools_allowed: false;
            allowed_handoffs: Array<'case_form_draft' | 'inference_draft'>;
            blocked_tool_classes: string[];
        };
        audit: {
            origin_guard_enforced: true;
            request_fingerprinting: true;
            query_history_logging: true;
            security_snapshot_persisted: true;
        };
    };
    signals: {
        prompt_injection_detected: boolean;
        sensitive_info_detected: boolean;
        admin_tool_request_detected: boolean;
        excessive_agency_request_detected: boolean;
        data_exfiltration_request_detected: boolean;
        vector_boundary_required: boolean;
        misinformation_review_required: boolean;
        unbounded_consumption_guarded: true;
    };
    risk: {
        level: 'low' | 'medium' | 'high';
        finding_count: number;
        findings: string[];
        mitigations: string[];
    };
    data_handling: {
        case_graph_snapshot_uses_hash: boolean;
        raw_case_note_persistence_allowed: false;
        sensitive_identifier_review_required: boolean;
        deidentification_required: boolean;
    };
    next_actions: string[];
}

interface BuildAskVetiosAiSecuritySnapshotInput {
    mode: string;
    metadata: Record<string, unknown>;
    intake: AskVetiosIntakeSummary;
    caseGraphSnapshot?: AskVetiosCaseGraphSnapshot | null;
}

export function buildAskVetiosAiSecuritySnapshot(
    input: BuildAskVetiosAiSecuritySnapshotInput,
): AskVetiosAiSecuritySnapshot {
    const text = [
        input.intake.case_draft.raw_note,
        readString(input.metadata.explanation),
    ].filter(Boolean).join(' ');
    const clinical = input.mode === 'clinical' || input.intake.is_clinical_intake;
    const promptInjectionDetected = matchesAny(text, PROMPT_INJECTION_PATTERNS);
    const sensitiveInfoDetected = matchesAny(text, SENSITIVE_INFO_PATTERNS);
    const adminToolRequestDetected = matchesAny(text, ADMIN_TOOL_PATTERNS);
    const excessiveAgencyRequestDetected = matchesAny(text, EXCESSIVE_AGENCY_PATTERNS);
    const dataExfiltrationRequestDetected = matchesAny(text, DATA_EXFILTRATION_PATTERNS);
    const evidenceStatus = readString(input.metadata.veterinary_retrieval_status);
    const modelTrustStatus = readString(input.metadata.model_trust_status);
    const humanReviewStatus = readString(input.metadata.human_review_status);
    const vectorBoundaryRequired = clinical && evidenceStatus !== 'veterinary_grounded' && evidenceStatus !== 'non_clinical';
    const misinformationReviewRequired = clinical && (
        modelTrustStatus === 'needs_evidence'
        || modelTrustStatus === 'needs_review'
        || humanReviewStatus === 'emergency_review_required'
        || humanReviewStatus === 'specialist_review_recommended'
    );
    const findings = buildFindings({
        promptInjectionDetected,
        sensitiveInfoDetected,
        adminToolRequestDetected,
        excessiveAgencyRequestDetected,
        dataExfiltrationRequestDetected,
        vectorBoundaryRequired,
        misinformationReviewRequired,
    });
    const riskLevel = determineRiskLevel({
        promptInjectionDetected,
        adminToolRequestDetected,
        dataExfiltrationRequestDetected,
        excessiveAgencyRequestDetected,
        sensitiveInfoDetected,
        vectorBoundaryRequired,
        misinformationReviewRequired,
    });
    const status = determineStatus({
        clinical,
        riskLevel,
        findingCount: findings.length,
    });

    return {
        schema_version: 'ask-vetios-ai-security-v1',
        status,
        security_boundary: 'public_ask_vetios_runtime',
        controls: {
            rate_limit: {
                requests_per_minute: 30,
                max_body_bytes: 32768,
                max_message_chars: 2000,
                max_conversation_turns: 20,
                token_budget_enforced: true,
            },
            tool_policy: {
                admin_tools_allowed: false,
                autonomous_actions_allowed: false,
                write_actions_allowed: false,
                external_network_tools_allowed: false,
                allowed_handoffs: ['case_form_draft', 'inference_draft'],
                blocked_tool_classes: [
                    'admin_console',
                    'billing',
                    'infrastructure_console',
                    'database_write',
                    'service_role_credentials',
                    'external_side_effects',
                ],
            },
            audit: {
                origin_guard_enforced: true,
                request_fingerprinting: true,
                query_history_logging: true,
                security_snapshot_persisted: true,
            },
        },
        signals: {
            prompt_injection_detected: promptInjectionDetected,
            sensitive_info_detected: sensitiveInfoDetected,
            admin_tool_request_detected: adminToolRequestDetected,
            excessive_agency_request_detected: excessiveAgencyRequestDetected,
            data_exfiltration_request_detected: dataExfiltrationRequestDetected,
            vector_boundary_required: vectorBoundaryRequired,
            misinformation_review_required: misinformationReviewRequired,
            unbounded_consumption_guarded: true,
        },
        risk: {
            level: riskLevel,
            finding_count: findings.length,
            findings,
            mitigations: buildMitigations(findings),
        },
        data_handling: {
            case_graph_snapshot_uses_hash: Boolean(input.caseGraphSnapshot?.encounter.raw_note_hash),
            raw_case_note_persistence_allowed: false,
            sensitive_identifier_review_required: sensitiveInfoDetected,
            deidentification_required: clinical,
        },
        next_actions: buildNextActions({
            status,
            promptInjectionDetected,
            sensitiveInfoDetected,
            adminToolRequestDetected,
            excessiveAgencyRequestDetected,
            dataExfiltrationRequestDetected,
            vectorBoundaryRequired,
            misinformationReviewRequired,
        }),
    };
}

function determineStatus(input: {
    clinical: boolean;
    riskLevel: 'low' | 'medium' | 'high';
    findingCount: number;
}): AskVetiosAiSecurityStatus {
    if (input.riskLevel === 'high') return 'security_review_required';
    if (input.riskLevel === 'medium') return 'restricted';
    if (input.clinical || input.findingCount > 0) return 'guarded';
    return 'monitored';
}

function determineRiskLevel(input: {
    promptInjectionDetected: boolean;
    adminToolRequestDetected: boolean;
    dataExfiltrationRequestDetected: boolean;
    excessiveAgencyRequestDetected: boolean;
    sensitiveInfoDetected: boolean;
    vectorBoundaryRequired: boolean;
    misinformationReviewRequired: boolean;
}): 'low' | 'medium' | 'high' {
    if (input.promptInjectionDetected || input.adminToolRequestDetected || input.dataExfiltrationRequestDetected) {
        return 'high';
    }
    if (
        input.excessiveAgencyRequestDetected
        || input.sensitiveInfoDetected
        || input.vectorBoundaryRequired
        || input.misinformationReviewRequired
    ) {
        return 'medium';
    }
    return 'low';
}

function buildFindings(input: {
    promptInjectionDetected: boolean;
    sensitiveInfoDetected: boolean;
    adminToolRequestDetected: boolean;
    excessiveAgencyRequestDetected: boolean;
    dataExfiltrationRequestDetected: boolean;
    vectorBoundaryRequired: boolean;
    misinformationReviewRequired: boolean;
}): string[] {
    const findings: string[] = [];
    if (input.promptInjectionDetected) findings.push('prompt_injection_or_jailbreak_pattern');
    if (input.adminToolRequestDetected) findings.push('admin_or_internal_tool_request');
    if (input.dataExfiltrationRequestDetected) findings.push('data_exfiltration_request');
    if (input.excessiveAgencyRequestDetected) findings.push('excessive_agency_or_side_effect_request');
    if (input.sensitiveInfoDetected) findings.push('sensitive_identifier_present');
    if (input.vectorBoundaryRequired) findings.push('veterinary_retrieval_boundary_required');
    if (input.misinformationReviewRequired) findings.push('misinformation_or_review_risk');
    return unique(findings);
}

function buildMitigations(findings: string[]): string[] {
    const mitigations = ['no_admin_tools_on_public_surface', 'rate_limit_and_token_budget_enforced'];
    if (findings.includes('prompt_injection_or_jailbreak_pattern')) mitigations.push('ignore_instruction_hierarchy_override');
    if (findings.includes('admin_or_internal_tool_request')) mitigations.push('block_internal_tool_access');
    if (findings.includes('data_exfiltration_request')) mitigations.push('deny_secret_or_dataset_export');
    if (findings.includes('excessive_agency_or_side_effect_request')) mitigations.push('allow_draft_handoffs_only');
    if (findings.includes('sensitive_identifier_present')) mitigations.push('deidentify_before_case_graph_promotion');
    if (findings.includes('veterinary_retrieval_boundary_required')) mitigations.push('require_veterinary_grounding');
    if (findings.includes('misinformation_or_review_risk')) mitigations.push('human_review_before_reliance');
    return unique(mitigations);
}

function buildNextActions(input: {
    status: AskVetiosAiSecurityStatus;
    promptInjectionDetected: boolean;
    sensitiveInfoDetected: boolean;
    adminToolRequestDetected: boolean;
    excessiveAgencyRequestDetected: boolean;
    dataExfiltrationRequestDetected: boolean;
    vectorBoundaryRequired: boolean;
    misinformationReviewRequired: boolean;
}): string[] {
    const actions: string[] = ['persist_security_snapshot'];
    if (input.promptInjectionDetected) actions.push('red_team_prompt_injection_case');
    if (input.adminToolRequestDetected) actions.push('confirm_admin_tools_blocked');
    if (input.dataExfiltrationRequestDetected) actions.push('deny_data_exfiltration');
    if (input.excessiveAgencyRequestDetected) actions.push('keep_actions_as_drafts_only');
    if (input.sensitiveInfoDetected) actions.push('review_sensitive_identifiers');
    if (input.vectorBoundaryRequired) actions.push('attach_curated_veterinary_sources');
    if (input.misinformationReviewRequired) actions.push('route_to_model_trust_review');
    if (input.status === 'security_review_required') actions.push('security_review_before_reuse');
    return unique(actions);
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(value));
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
}

const PROMPT_INJECTION_PATTERNS = [
    /\bignore (?:all )?(?:previous|prior|system|developer) instructions\b/i,
    /\breveal (?:the )?(?:system|developer) prompt\b/i,
    /\bshow (?:me )?(?:the )?(?:system|developer) prompt\b/i,
    /\bjailbreak\b/i,
    /\bDAN mode\b/i,
    /\boverride (?:your )?(?:safety|policy|guardrails|instructions)\b/i,
    /\bpretend (?:you are|to be) unrestricted\b/i,
];

const ADMIN_TOOL_PATTERNS = [
    /\b(?:open|unlock|use|access) (?:the )?(?:admin|infra|infrastructure|billing) (?:console|panel|tools?)\b/i,
    /\bservice role\b/i,
    /\bsupabase (?:service|admin) key\b/i,
    /\bdelete (?:all )?(?:users|cases|records|tables|database)\b/i,
    /\brun (?:sql|database) (?:as admin|with admin|with service role)\b/i,
];

const DATA_EXFILTRATION_PATTERNS = [
    /\b(?:dump|export|download|exfiltrate|leak) (?:all )?(?:cases|patients|records|database|dataset|secrets|keys)\b/i,
    /\bshow (?:me )?(?:all )?(?:api keys|tokens|credentials|secrets)\b/i,
    /\bprivate key\b/i,
    /\baccess token\b/i,
];

const EXCESSIVE_AGENCY_PATTERNS = [
    /\b(?:send|submit|place|order|schedule|book|charge|refund|prescribe|dispense) (?:it|this|the|a|an)\b/i,
    /\b(?:email|text|call) (?:the )?(?:owner|client|clinic|pharmacy|lab)\b/i,
    /\bmake (?:the )?(?:payment|purchase|appointment|order)\b/i,
];

const SENSITIVE_INFO_PATTERNS = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
    /\b(?:ssn|social security|credit card|card number)\b/i,
    /\b(?:api[_-]?key|secret[_-]?key|password|passwd)\s*[:=]\s*\S+/i,
];
