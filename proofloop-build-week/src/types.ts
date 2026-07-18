export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Escalation = 'routine' | 'soon' | 'urgent' | 'emergency';

export interface ClinicalInput {
    species: string;
    age_months: number;
    symptoms: string[];
    laboratory_findings: Array<{
        name: string;
        value: string;
        units: string;
    }>;
}

export interface CandidateOutput {
    primary_diagnosis: string;
    differentials: string[];
    confidence: number;
    escalation: Escalation;
}

export interface ClosedCase {
    case_id: string;
    inference: {
        trace_id: string;
        model: string;
        model_version: string;
        generated_at: string;
        input: ClinicalInput;
        output: CandidateOutput;
    };
    outcome: {
        outcome_id: string;
        observed_at: string;
        label: string;
        evidence: Array<{
            evidence_id: string;
            type: 'lab_result' | 'imaging' | 'specialist_review' | 'follow_up';
            source_system: string;
            captured_at: string;
            summary: string;
            payload: Record<string, JsonValue>;
        }>;
    };
    review: {
        status: 'confirmed';
        reviewer_role: string;
        confirmed_at: string;
        rationale: string;
    };
}

export interface ReceiptEvidenceManifest {
    evidence_id: string;
    type: ClosedCase['outcome']['evidence'][number]['type'];
    source_system: string;
    captured_at: string;
    summary: string;
    payload_sha256: string;
}

export interface OutcomeReceiptContent {
    version: 'proofloop.outcome-receipt.v1';
    receipt_id: string;
    created_at: string;
    case_id: string;
    inference: ClosedCase['inference'];
    outcome: {
        outcome_id: string;
        observed_at: string;
        label: string;
        evidence: ReceiptEvidenceManifest[];
        evidence_set_sha256: string;
    };
    review: ClosedCase['review'];
}

export interface OutcomeReceipt extends OutcomeReceiptContent {
    integrity: {
        algorithm: 'ed25519';
        content_sha256: string;
        public_key_pem: string;
        signature_base64: string;
    };
}

export type FailureClass =
    | 'missed_diagnosis'
    | 'overconfidence'
    | 'unsafe_routing'
    | 'unsupported_claim'
    | 'other';

export interface EvalDraft {
    title: string;
    failure_class: FailureClass;
    severity: 'low' | 'medium' | 'high' | 'critical';
    rationale: string;
    target_slices: string[];
    cases: Array<{
        case_id: string;
        input: ClinicalInput;
        expected: {
            must_include_any_diagnoses: string[];
            must_not_use_as_primary: string[];
            allowed_escalations: Escalation[];
            max_confidence_if_expected_missing: number;
        };
    }>;
}

export interface EvalSpecContent extends EvalDraft {
    version: 'proofloop.eval.v1';
    eval_id: string;
    source_receipt_sha256: string;
    generated_by: {
        mode: 'gpt-5.6' | 'recorded_fixture';
        model: 'gpt-5.6';
        response_id: string | null;
    };
}

export interface EvalSpec extends EvalSpecContent {
    spec_sha256: string;
}

export interface GateCheck {
    check: string;
    passed: boolean;
    expected: JsonValue;
    observed: JsonValue;
}

export interface GateResult {
    candidate: string;
    decision: 'PASS' | 'BLOCK';
    eval_id: string;
    source_receipt_sha256: string;
    case_results: Array<{
        case_id: string;
        output: CandidateOutput;
        checks: GateCheck[];
        passed: boolean;
    }>;
}

export type Candidate = (input: ClinicalInput) => CandidateOutput | Promise<CandidateOutput>;
