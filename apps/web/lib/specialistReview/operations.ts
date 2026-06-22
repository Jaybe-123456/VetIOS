import { createHash } from 'crypto';
import {
    normalizeOptionalSpecialistReviewLabel,
    normalizeSpecialistReviewText,
    resolveSpecialistLearningEligibility,
    type SpecialistAIDisposition,
    type SpecialistClinicianAction,
    type SpecialistPacsStatus,
    type SpecialistReportStatus,
    type SpecialistReviewRoute,
    type SpecialistReviewStage,
    type SpecialistReviewStatus,
    type SpecialistReviewUrgencyLevel,
} from '@/lib/specialistReview/events';

export type SpecialistReviewQueueStatus =
    | 'blocked'
    | 'awaiting_pacs'
    | 'ready_for_assignment'
    | 'assigned'
    | 'in_review'
    | 'report_ready'
    | 'closure_ready'
    | 'learning_ready'
    | 'overdue';

export type SpecialistReviewerAvailability =
    | 'available'
    | 'busy'
    | 'offline'
    | 'unavailable';

export interface SpecialistReviewerProfile {
    reviewer_ref: string;
    reviewer_route: SpecialistReviewRoute;
    specialty?: string | null;
    availability: SpecialistReviewerAvailability;
    active_case_count?: number | null;
    max_active_case_count?: number | null;
    accepts_emergency?: boolean | null;
}

export interface SpecialistReviewOperationsInput {
    request_id?: string | null;
    reviewer_route: SpecialistReviewRoute;
    specialty?: string | null;
    urgency_level: SpecialistReviewUrgencyLevel;
    review_stage: SpecialistReviewStage;
    review_status: SpecialistReviewStatus;
    ai_disposition: SpecialistAIDisposition;
    clinician_action: SpecialistClinicianAction;
    report_status: SpecialistReportStatus;
    pacs_status: SpecialistPacsStatus;
    outcome_required: boolean;
    outcome_captured: boolean;
    learning_eligible?: boolean | null;
    evidence_pack?: Record<string, unknown> | null;
    corrections?: Record<string, unknown> | null;
    annotations?: Record<string, unknown> | null;
    deidentified_report?: Record<string, unknown> | null;
    review_summary?: string | null;
    observed_at?: string | null;
    created_at?: string | null;
    now?: string;
    reviewer_pool?: SpecialistReviewerProfile[];
}

export interface SpecialistReviewOperationsPacket {
    schema_version: 'specialist-review-operations-v1';
    queue_status: SpecialistReviewQueueStatus;
    operations_score: number;
    assignment: {
        reviewer_route: SpecialistReviewRoute;
        specialty: string | null;
        assigned_reviewer_ref: string | null;
        assignment_status: 'not_required' | 'needs_assignment' | 'assigned' | 'blocked';
        candidate_reviewer_count: number;
    };
    turnaround: {
        urgency_level: SpecialistReviewUrgencyLevel;
        sla_minutes: number;
        requested_at: string;
        due_at: string;
        minutes_until_due: number;
        overdue: boolean;
    };
    pacs_workflow: {
        required: boolean;
        pacs_status: SpecialistPacsStatus;
        upload_required: boolean;
        link_required: boolean;
        pacs_reference_hash: string | null;
    };
    report_workflow: {
        report_status: SpecialistReportStatus;
        final_report_ready: boolean;
        report_reference_hash: string | null;
        review_summary_hash: string | null;
    };
    closure: {
        review_stage: SpecialistReviewStage;
        review_status: SpecialistReviewStatus;
        ai_disposition: SpecialistAIDisposition;
        clinician_action: SpecialistClinicianAction;
        outcome_required: boolean;
        outcome_captured: boolean;
        learning_eligible: boolean;
        closure_ready: boolean;
    };
    deidentification: {
        raw_report_stored: false;
        report_text_hashed: boolean;
        direct_identifier_risk: boolean;
        detected_identifier_paths: string[];
    };
    provenance: {
        operation_digest: string;
        evidence_pack_hash: string;
        corrections_hash: string;
        annotations_hash: string;
        deidentified_report_hash: string;
    };
    blockers: string[];
    warnings: string[];
    next_actions: string[];
}

const SLA_MINUTES: Record<SpecialistReviewUrgencyLevel, number> = {
    routine: 72 * 60,
    priority: 24 * 60,
    urgent: 6 * 60,
    emergency: 60,
};

const SPECIALIST_ROUTES = new Set<SpecialistReviewRoute>([
    'emergency_veterinarian',
    'internal_medicine',
    'diagnostic_imaging',
    'toxicology',
    'cardiology',
    'neurology',
    'oncology',
    'surgery',
    'dermatology',
    'ophthalmology',
    'anesthesia',
    'pathology',
]);

const REVIEWED_AI_DISPOSITIONS = new Set<SpecialistAIDisposition>([
    'supported',
    'partially_supported',
    'corrected',
    'contradicted',
]);

const DIRECT_IDENTIFIER_KEY_PATTERNS = [
    /owner/i,
    /client/i,
    /patient.*name/i,
    /pet.*name/i,
    /email/i,
    /phone/i,
    /address/i,
    /microchip/i,
    /accession.*raw/i,
] as const;

export function buildSpecialistReviewOperationsPacket(
    input: SpecialistReviewOperationsInput,
): SpecialistReviewOperationsPacket {
    const now = parseDate(input.now) ?? new Date();
    const requestedAt = parseDate(input.observed_at) ?? parseDate(input.created_at) ?? now;
    const slaMinutes = SLA_MINUTES[input.urgency_level];
    const dueAt = new Date(requestedAt.getTime() + slaMinutes * 60_000);
    const minutesUntilDue = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
    const overdue = minutesUntilDue < 0 && !isTerminalReview(input);
    const pacsRequired = isPacsRequired(input);
    const pacsReferenceHash = hashOptional(readText(input.evidence_pack, [
        'pacs.study_instance_uid',
        'pacs.study_ref',
        'pacs.accession_ref',
        'study_instance_uid',
        'accession_id',
    ]));
    const reportReferenceHash = hashOptional(readText(input.deidentified_report, [
        'report_ref',
        'report_id',
        'document_ref',
    ]));
    const reviewSummary = normalizeSpecialistReviewText(input.review_summary);
    const identifierPaths = findDirectIdentifierPaths({
        evidence_pack: input.evidence_pack ?? {},
        corrections: input.corrections ?? {},
        annotations: input.annotations ?? {},
        deidentified_report: input.deidentified_report ?? {},
    });
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const candidateReviewers = findCandidateReviewers(input);
    const assignedReviewer = candidateReviewers[0] ?? null;
    const finalReportReady = input.report_status === 'final' || input.report_status === 'amended';
    const learningEligible = input.learning_eligible ?? resolveSpecialistLearningEligibility({
        review_status: input.review_status,
        ai_disposition: input.ai_disposition,
        report_status: input.report_status,
        outcome_required: input.outcome_required,
        outcome_captured: input.outcome_captured,
    });
    const closureReady = input.review_status === 'completed'
        && finalReportReady
        && (!input.outcome_required || input.outcome_captured);

    if (identifierPaths.length > 0) blockers.add('direct_identifier_risk_in_review_packet');
    if (pacsRequired && input.pacs_status !== 'linked') blockers.add('pacs_link_required');
    if (input.review_status === 'pending' && input.review_stage === 'requested' && !assignedReviewer && isSpecialistRoute(input.reviewer_route)) {
        blockers.add('specialist_reviewer_assignment_missing');
    }
    if (overdue) blockers.add('specialist_review_sla_overdue');
    if (input.review_status === 'completed' && !finalReportReady) blockers.add('final_or_amended_report_required');
    if (input.outcome_required && !input.outcome_captured && finalReportReady) warnings.add('outcome_capture_required_for_learning');
    if (input.ai_disposition === 'not_reviewed' && finalReportReady) warnings.add('final_report_missing_ai_disposition');
    if (reviewSummary) warnings.add('review_summary_hashed_not_used_as_raw_report');

    const queueStatus = resolveQueueStatus({
        input,
        blockerCount: blockers.size,
        pacsRequired,
        assignedReviewer,
        overdue,
        finalReportReady,
        closureReady,
        learningEligible,
    });
    const assignmentStatus = resolveAssignmentStatus(input, assignedReviewer, blockers);
    const packetBase = {
        request_id: input.request_id ?? null,
        reviewer_route: input.reviewer_route,
        specialty: normalizeOptionalSpecialistReviewLabel(input.specialty),
        urgency_level: input.urgency_level,
        review_stage: input.review_stage,
        review_status: input.review_status,
        report_status: input.report_status,
        pacs_status: input.pacs_status,
        outcome_required: input.outcome_required,
        outcome_captured: input.outcome_captured,
        learning_eligible: learningEligible,
        due_at: dueAt.toISOString(),
        assigned_reviewer_ref: assignedReviewer?.reviewer_ref ?? null,
        blockers: Array.from(blockers).sort(),
    };
    const operationDigest = hashJson(packetBase);

    return {
        schema_version: 'specialist-review-operations-v1',
        queue_status: queueStatus,
        operations_score: scoreOperations({
            input,
            queueStatus,
            assignedReviewer,
            pacsRequired,
            finalReportReady,
            closureReady,
            learningEligible,
            blockerCount: blockers.size,
        }),
        assignment: {
            reviewer_route: input.reviewer_route,
            specialty: normalizeOptionalSpecialistReviewLabel(input.specialty),
            assigned_reviewer_ref: assignedReviewer?.reviewer_ref ?? null,
            assignment_status: assignmentStatus,
            candidate_reviewer_count: candidateReviewers.length,
        },
        turnaround: {
            urgency_level: input.urgency_level,
            sla_minutes: slaMinutes,
            requested_at: requestedAt.toISOString(),
            due_at: dueAt.toISOString(),
            minutes_until_due: minutesUntilDue,
            overdue,
        },
        pacs_workflow: {
            required: pacsRequired,
            pacs_status: input.pacs_status,
            upload_required: pacsRequired && input.pacs_status === 'unavailable',
            link_required: pacsRequired && input.pacs_status !== 'linked',
            pacs_reference_hash: pacsReferenceHash,
        },
        report_workflow: {
            report_status: input.report_status,
            final_report_ready: finalReportReady,
            report_reference_hash: reportReferenceHash,
            review_summary_hash: hashOptional(reviewSummary),
        },
        closure: {
            review_stage: input.review_stage,
            review_status: input.review_status,
            ai_disposition: input.ai_disposition,
            clinician_action: input.clinician_action,
            outcome_required: input.outcome_required,
            outcome_captured: input.outcome_captured,
            learning_eligible: learningEligible,
            closure_ready: closureReady,
        },
        deidentification: {
            raw_report_stored: false,
            report_text_hashed: Boolean(reviewSummary),
            direct_identifier_risk: identifierPaths.length > 0,
            detected_identifier_paths: identifierPaths,
        },
        provenance: {
            operation_digest: operationDigest,
            evidence_pack_hash: hashJson(input.evidence_pack ?? {}),
            corrections_hash: hashJson(input.corrections ?? {}),
            annotations_hash: hashJson(input.annotations ?? {}),
            deidentified_report_hash: hashJson(input.deidentified_report ?? {}),
        },
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
        next_actions: buildNextActions({
            input,
            queueStatus,
            assignmentStatus,
            pacsRequired,
            finalReportReady,
            closureReady,
            learningEligible,
        }),
    };
}

function resolveQueueStatus(input: {
    input: SpecialistReviewOperationsInput;
    blockerCount: number;
    pacsRequired: boolean;
    assignedReviewer: SpecialistReviewerProfile | null;
    overdue: boolean;
    finalReportReady: boolean;
    closureReady: boolean;
    learningEligible: boolean;
}): SpecialistReviewQueueStatus {
    if (input.learningEligible) return 'learning_ready';
    if (input.closureReady) return 'closure_ready';
    if (input.input.review_stage === 'report_ready' || input.finalReportReady) return 'report_ready';
    if (input.overdue) return 'overdue';
    if (input.pacsRequired && input.input.pacs_status !== 'linked') return 'awaiting_pacs';
    if (input.input.review_stage === 'in_review') return 'in_review';
    if (input.input.review_stage === 'assigned' || input.assignedReviewer) return 'assigned';
    if (input.blockerCount > 0) return 'blocked';
    return input.input.reviewer_route === 'none' ? 'blocked' : 'ready_for_assignment';
}

function resolveAssignmentStatus(
    input: SpecialistReviewOperationsInput,
    assignedReviewer: SpecialistReviewerProfile | null,
    blockers: Set<string>,
): SpecialistReviewOperationsPacket['assignment']['assignment_status'] {
    if (input.reviewer_route === 'none') return 'not_required';
    if (assignedReviewer) return 'assigned';
    if (blockers.has('direct_identifier_risk_in_review_packet')) return 'blocked';
    return 'needs_assignment';
}

function buildNextActions(input: {
    input: SpecialistReviewOperationsInput;
    queueStatus: SpecialistReviewQueueStatus;
    assignmentStatus: SpecialistReviewOperationsPacket['assignment']['assignment_status'];
    pacsRequired: boolean;
    finalReportReady: boolean;
    closureReady: boolean;
    learningEligible: boolean;
}): string[] {
    const actions: string[] = [];
    if (input.queueStatus === 'overdue') actions.push('escalate_review_sla');
    if (input.assignmentStatus === 'needs_assignment') actions.push('assign_specialist_reviewer');
    if (input.pacsRequired && input.input.pacs_status !== 'linked') actions.push('link_pacs_or_report_reference');
    if (input.input.review_stage === 'requested') actions.push('acknowledge_review_request');
    if (input.input.review_stage === 'assigned') actions.push('start_specialist_review');
    if (!input.finalReportReady && input.input.review_stage === 'in_review') actions.push('finalize_deidentified_report');
    if (input.finalReportReady && input.input.review_status !== 'completed') actions.push('return_report_to_clinician');
    if (input.input.outcome_required && !input.input.outcome_captured) actions.push('capture_clinical_outcome');
    if (input.closureReady && !input.learningEligible) actions.push('record_ai_disposition_for_learning');
    if (input.learningEligible) actions.push('promote_specialist_review_learning_signal');
    return unique(actions);
}

function scoreOperations(input: {
    input: SpecialistReviewOperationsInput;
    queueStatus: SpecialistReviewQueueStatus;
    assignedReviewer: SpecialistReviewerProfile | null;
    pacsRequired: boolean;
    finalReportReady: boolean;
    closureReady: boolean;
    learningEligible: boolean;
    blockerCount: number;
}): number {
    const score = [
        input.input.reviewer_route !== 'none' ? 0.12 : 0,
        input.assignedReviewer || input.input.review_stage !== 'requested' ? 0.14 : 0,
        !input.pacsRequired || input.input.pacs_status === 'linked' ? 0.14 : 0,
        input.input.review_stage === 'in_review' || input.input.review_stage === 'report_ready' || input.input.review_stage === 'closed' ? 0.12 : 0,
        input.finalReportReady ? 0.16 : 0,
        REVIEWED_AI_DISPOSITIONS.has(input.input.ai_disposition) ? 0.12 : 0,
        input.closureReady ? 0.1 : 0,
        input.learningEligible ? 0.1 : 0,
    ].reduce((sum, value) => sum + value, 0);

    return Math.max(0, Math.min(1, Number((score - input.blockerCount * 0.18).toFixed(4))));
}

function findCandidateReviewers(input: SpecialistReviewOperationsInput): SpecialistReviewerProfile[] {
    return (input.reviewer_pool ?? [])
        .filter((reviewer) => reviewer.reviewer_route === input.reviewer_route)
        .filter((reviewer) => reviewer.availability === 'available')
        .filter((reviewer) => input.urgency_level !== 'emergency' || reviewer.accepts_emergency === true)
        .filter((reviewer) => {
            const active = reviewer.active_case_count ?? 0;
            const max = reviewer.max_active_case_count ?? Number.POSITIVE_INFINITY;
            return active < max;
        })
        .sort((left, right) => {
            const leftLoad = left.active_case_count ?? 0;
            const rightLoad = right.active_case_count ?? 0;
            return leftLoad - rightLoad || left.reviewer_ref.localeCompare(right.reviewer_ref);
        });
}

function isPacsRequired(input: SpecialistReviewOperationsInput): boolean {
    if (input.reviewer_route === 'diagnostic_imaging') return true;
    if (input.pacs_status === 'pending' || input.pacs_status === 'linked' || input.pacs_status === 'unavailable') return true;
    const evidence = input.evidence_pack ?? {};
    return Boolean(
        readText(evidence, ['pacs.study_instance_uid', 'pacs.study_ref', 'imaging.study_ref'])
        || readBoolean(evidence, ['imaging_present', 'pacs_required']),
    );
}

function isSpecialistRoute(value: SpecialistReviewRoute): boolean {
    return SPECIALIST_ROUTES.has(value);
}

function isTerminalReview(input: SpecialistReviewOperationsInput): boolean {
    return input.review_status === 'completed'
        || input.review_status === 'cancelled'
        || input.review_status === 'unable_to_review';
}

function findDirectIdentifierPaths(source: Record<string, unknown>): string[] {
    const paths = new Set<string>();
    visitRecord(source, '', (path, value) => {
        const key = path.split('.').at(-1) ?? path;
        if (DIRECT_IDENTIFIER_KEY_PATTERNS.some((pattern) => pattern.test(key))) paths.add(path);
        if (typeof value === 'string' && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) paths.add(path);
    });
    return Array.from(paths).sort();
}

function visitRecord(
    value: unknown,
    path: string,
    visitor: (path: string, value: unknown) => void,
) {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => visitRecord(entry, `${path}[${index}]`, visitor));
        return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key;
        visitor(nextPath, nested);
        visitRecord(nested, nextPath, visitor);
    }
}

function readText(source: Record<string, unknown> | null | undefined, paths: string[]): string | null {
    if (!source) return null;
    for (const path of paths) {
        const value = readPath(source, path);
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return null;
}

function readBoolean(source: Record<string, unknown> | null | undefined, paths: string[]): boolean | null {
    if (!source) return null;
    for (const path of paths) {
        const value = readPath(source, path);
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
            if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
        }
    }
    return null;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[segment];
    }, source);
}

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hashOptional(value: string | null | undefined): string | null {
    return value ? hashValue(value) : null;
}

function hashJson(value: unknown): string {
    return hashValue(stableStringify(value));
}

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (typeof value === 'object' && value !== null) {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).slice(0, 12);
}
