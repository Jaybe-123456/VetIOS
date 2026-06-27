import { createHash } from 'crypto';
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

export type AskVetiosAiSecurityTestCaseType =
    | 'prompt_injection'
    | 'rag_boundary'
    | 'tool_abuse'
    | 'data_exfiltration'
    | 'sensitive_identifier'
    | 'misinformation'
    | 'rate_limit'
    | 'incident_response'
    | 'external_attestation';

export interface AskVetiosAiSecurityTestPacket {
    schema_version: 'ask-vetios-ai-security-test-v1';
    test_suite: 'ask_vetios_runtime_security';
    test_case_type: AskVetiosAiSecurityTestCaseType;
    security_status: AskVetiosAiSecurityStatus;
    risk_level: 'low' | 'medium' | 'high';
    attack_detected: boolean;
    blocked_by_policy: boolean;
    incident_required: boolean;
    external_attestation_required: boolean;
    finding_count: number;
    mitigation_count: number;
    control_count: number;
    security_score: number;
    snapshot_hash: string;
    test_packet_hash: string;
    signals: AskVetiosAiSecuritySnapshot['signals'];
    controls: {
        admin_tools_blocked: boolean;
        write_actions_blocked: boolean;
        autonomous_actions_blocked: boolean;
        external_network_tools_blocked: boolean;
        rate_limit_enforced: boolean;
        token_budget_enforced: boolean;
        raw_case_note_persistence_blocked: boolean;
    };
    blockers: string[];
    warnings: string[];
    next_actions: string[];
    evidence: {
        raw_prompt_stored: false;
        raw_case_note_stored: false;
        raw_retrieval_text_stored: false;
        secrets_stored: false;
        snapshot_hash: string;
    };
}

export interface AskVetiosAiSecurityTestEventDraft {
    tenant_id: string | null;
    request_id: string;
    ask_vetios_query_id: string | null;
    test_suite: AskVetiosAiSecurityTestPacket['test_suite'];
    test_case_type: AskVetiosAiSecurityTestCaseType;
    security_status: AskVetiosAiSecurityStatus;
    risk_level: 'low' | 'medium' | 'high';
    attack_detected: boolean;
    blocked_by_policy: boolean;
    incident_required: boolean;
    external_attestation_required: boolean;
    prompt_injection_detected: boolean;
    admin_tool_request_detected: boolean;
    data_exfiltration_request_detected: boolean;
    vector_boundary_required: boolean;
    misinformation_review_required: boolean;
    sensitive_info_detected: boolean;
    excessive_agency_request_detected: boolean;
    finding_count: number;
    mitigation_count: number;
    control_count: number;
    security_score: number;
    snapshot_hash: string;
    test_packet_hash: string;
    security_packet: AskVetiosAiSecurityTestPacket;
    blockers: string[];
    warnings: string[];
    next_actions: string[];
    evidence: Record<string, unknown>;
    observed_at: string;
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

export function buildAskVetiosAiSecurityTestPacket(
    snapshot: AskVetiosAiSecuritySnapshot,
): AskVetiosAiSecurityTestPacket {
    const snapshotHash = hashJson(snapshot);
    const testCaseType = determineTestCaseType(snapshot);
    const controls = {
        admin_tools_blocked: snapshot.controls.tool_policy.admin_tools_allowed === false,
        write_actions_blocked: snapshot.controls.tool_policy.write_actions_allowed === false,
        autonomous_actions_blocked: snapshot.controls.tool_policy.autonomous_actions_allowed === false,
        external_network_tools_blocked: snapshot.controls.tool_policy.external_network_tools_allowed === false,
        rate_limit_enforced: snapshot.controls.rate_limit.requests_per_minute > 0,
        token_budget_enforced: snapshot.controls.rate_limit.token_budget_enforced === true,
        raw_case_note_persistence_blocked: snapshot.data_handling.raw_case_note_persistence_allowed === false,
    };
    const controlCount = Object.values(controls).filter(Boolean).length;
    const attackDetected = Object.entries(snapshot.signals)
        .filter(([key]) => key !== 'unbounded_consumption_guarded')
        .some(([, value]) => value === true);
    const blockedByPolicy = controls.admin_tools_blocked
        && controls.write_actions_blocked
        && controls.autonomous_actions_blocked
        && controls.external_network_tools_blocked
        && controls.raw_case_note_persistence_blocked;
    const incidentRequired = snapshot.status === 'security_review_required' || snapshot.risk.level === 'high';
    const externalAttestationRequired = incidentRequired || snapshot.status === 'restricted';
    const blockers = buildSecurityTestBlockers({
        snapshot,
        attackDetected,
        blockedByPolicy,
        incidentRequired,
    });
    const warnings = buildSecurityTestWarnings(snapshot);
    const nextActions = unique([
        ...snapshot.next_actions,
        'record_ai_security_test_event',
        ...(incidentRequired ? ['open_ai_security_incident'] : []),
        ...(externalAttestationRequired ? ['queue_external_security_attestation'] : []),
    ]);
    const partialPacket = {
        schema_version: 'ask-vetios-ai-security-test-v1' as const,
        test_suite: 'ask_vetios_runtime_security' as const,
        test_case_type: testCaseType,
        security_status: snapshot.status,
        risk_level: snapshot.risk.level,
        attack_detected: attackDetected,
        blocked_by_policy: blockedByPolicy,
        incident_required: incidentRequired,
        external_attestation_required: externalAttestationRequired,
        finding_count: snapshot.risk.finding_count,
        mitigation_count: snapshot.risk.mitigations.length,
        control_count: controlCount,
        security_score: scoreSecurityPacket({
            snapshot,
            controlCount,
            attackDetected,
            blockedByPolicy,
            incidentRequired,
        }),
        snapshot_hash: snapshotHash,
        signals: snapshot.signals,
        controls,
        blockers,
        warnings,
        next_actions: nextActions,
        evidence: {
            raw_prompt_stored: false as const,
            raw_case_note_stored: false as const,
            raw_retrieval_text_stored: false as const,
            secrets_stored: false as const,
            snapshot_hash: snapshotHash,
        },
    };

    return {
        ...partialPacket,
        test_packet_hash: hashJson(partialPacket),
    };
}

export function buildAskVetiosAiSecurityTestEventDraft(input: {
    tenantId?: string | null;
    requestId: string;
    askVetiosQueryId?: string | null;
    snapshot: AskVetiosAiSecuritySnapshot;
    packet?: AskVetiosAiSecurityTestPacket;
    evidence?: Record<string, unknown>;
    observedAt?: Date;
}): AskVetiosAiSecurityTestEventDraft {
    const packet = input.packet ?? buildAskVetiosAiSecurityTestPacket(input.snapshot);
    return {
        tenant_id: input.tenantId ?? null,
        request_id: input.requestId,
        ask_vetios_query_id: input.askVetiosQueryId ?? null,
        test_suite: packet.test_suite,
        test_case_type: packet.test_case_type,
        security_status: packet.security_status,
        risk_level: packet.risk_level,
        attack_detected: packet.attack_detected,
        blocked_by_policy: packet.blocked_by_policy,
        incident_required: packet.incident_required,
        external_attestation_required: packet.external_attestation_required,
        prompt_injection_detected: packet.signals.prompt_injection_detected,
        admin_tool_request_detected: packet.signals.admin_tool_request_detected,
        data_exfiltration_request_detected: packet.signals.data_exfiltration_request_detected,
        vector_boundary_required: packet.signals.vector_boundary_required,
        misinformation_review_required: packet.signals.misinformation_review_required,
        sensitive_info_detected: packet.signals.sensitive_info_detected,
        excessive_agency_request_detected: packet.signals.excessive_agency_request_detected,
        finding_count: packet.finding_count,
        mitigation_count: packet.mitigation_count,
        control_count: packet.control_count,
        security_score: packet.security_score,
        snapshot_hash: packet.snapshot_hash,
        test_packet_hash: packet.test_packet_hash,
        security_packet: packet,
        blockers: packet.blockers,
        warnings: packet.warnings,
        next_actions: packet.next_actions,
        evidence: {
            ...packet.evidence,
            ...(input.evidence ?? {}),
        },
        observed_at: (input.observedAt ?? new Date()).toISOString(),
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

function determineTestCaseType(snapshot: AskVetiosAiSecuritySnapshot): AskVetiosAiSecurityTestCaseType {
    if (snapshot.signals.prompt_injection_detected) return 'prompt_injection';
    if (snapshot.signals.admin_tool_request_detected || snapshot.signals.excessive_agency_request_detected) return 'tool_abuse';
    if (snapshot.signals.data_exfiltration_request_detected) return 'data_exfiltration';
    if (snapshot.signals.vector_boundary_required) return 'rag_boundary';
    if (snapshot.signals.sensitive_info_detected) return 'sensitive_identifier';
    if (snapshot.signals.misinformation_review_required) return 'misinformation';
    return 'rate_limit';
}

function buildSecurityTestBlockers(input: {
    snapshot: AskVetiosAiSecuritySnapshot;
    attackDetected: boolean;
    blockedByPolicy: boolean;
    incidentRequired: boolean;
}): string[] {
    const blockers: string[] = [];
    if (input.attackDetected && !input.blockedByPolicy) blockers.push('attack_detected_without_complete_policy_block');
    if (input.incidentRequired) blockers.push('security_incident_review_required');
    if (input.snapshot.signals.data_exfiltration_request_detected) blockers.push('data_exfiltration_attempt_detected');
    if (input.snapshot.signals.admin_tool_request_detected) blockers.push('admin_tool_request_detected');
    return unique(blockers);
}

function buildSecurityTestWarnings(snapshot: AskVetiosAiSecuritySnapshot): string[] {
    const warnings: string[] = [];
    if (snapshot.signals.prompt_injection_detected) warnings.push('prompt_injection_pattern_detected');
    if (snapshot.signals.vector_boundary_required) warnings.push('rag_boundary_requires_curated_veterinary_sources');
    if (snapshot.signals.misinformation_review_required) warnings.push('clinical_misinformation_review_required');
    if (snapshot.signals.sensitive_info_detected) warnings.push('sensitive_identifier_review_required');
    if (snapshot.risk.finding_count > snapshot.risk.mitigations.length) warnings.push('security_findings_exceed_mitigations');
    return unique(warnings);
}

function scoreSecurityPacket(input: {
    snapshot: AskVetiosAiSecuritySnapshot;
    controlCount: number;
    attackDetected: boolean;
    blockedByPolicy: boolean;
    incidentRequired: boolean;
}): number {
    const controlCoverage = input.controlCount / 7;
    const findingPenalty = Math.min(0.4, input.snapshot.risk.finding_count * 0.08);
    const riskPenalty = input.snapshot.risk.level === 'high' ? 0.25 : input.snapshot.risk.level === 'medium' ? 0.12 : 0;
    const attackPenalty = input.attackDetected ? 0.08 : 0;
    const mitigationCredit = Math.min(0.2, input.snapshot.risk.mitigations.length * 0.025);
    const policyCredit = input.blockedByPolicy ? 0.16 : 0;
    const incidentCredit = input.incidentRequired ? 0.05 : 0;
    return round4(clamp01(0.55 + controlCoverage * 0.22 + mitigationCredit + policyCredit + incidentCredit - findingPenalty - riskPenalty - attackPenalty));
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

function hashJson(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
        .join(',')}}`;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
    return Math.round(value * 10_000) / 10_000;
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
