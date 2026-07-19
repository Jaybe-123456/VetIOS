import {
    createHash,
    createPublicKey,
    generateKeyPairSync,
    sign,
    verify,
} from 'node:crypto';

export type ReplayCandidate = 'legacy' | 'corrected';
export type ReplayDecision = 'PASS' | 'BLOCK' | 'HOLD';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ReplayCheck = {
    id: string;
    label: string;
    passed: boolean;
    expected: string;
    observed: string;
};

export type ProofLoopReplay = {
    run_id: string;
    source: 'recorded_fixture';
    candidate: ReplayCandidate;
    receipt: {
        receipt_id: string;
        content_sha256: string;
        evidence_set_sha256: string;
        public_key_fingerprint: string;
        content_digest_valid: boolean;
        evidence_digest_valid: boolean;
        signature_valid: boolean;
        valid: boolean;
    };
    eval: {
        eval_id: string;
        spec_sha256: string;
        source_receipt_sha256: string;
        valid: boolean;
    };
    gate: {
        decision: ReplayDecision;
        reason: string;
        output: {
            primary_diagnosis: string;
            differentials: string[];
            confidence: number;
            escalation: string;
        } | null;
        checks: ReplayCheck[];
    };
};

const closedCase = {
    case_id: 'synthetic-canine-parvo-001',
    inference: {
        trace_id: 'trace_demo_20260714_001',
        model: 'vetios-demo-baseline',
        model_version: 'pre-proofloop-2026-07-12',
        generated_at: '2026-07-14T09:30:00.000Z',
        input: {
            species: 'canine',
            age_months: 5,
            symptoms: ['vomiting', 'hemorrhagic diarrhea', 'lethargy', 'anorexia'],
            laboratory_findings: [
                { name: 'white_blood_cell_count', value: '2.3', units: '10^9/L' },
            ],
        },
        output: {
            primary_diagnosis: 'dietary_indiscretion',
            differentials: ['gastroenteritis', 'pancreatitis'],
            confidence: 0.92,
            escalation: 'routine',
        },
    },
    outcome: {
        outcome_id: 'outcome_demo_20260716_001',
        observed_at: '2026-07-16T13:05:00.000Z',
        label: 'canine_parvovirus',
        evidence: [
            {
                evidence_id: 'lab_demo_pcr_001',
                type: 'lab_result',
                source_system: 'synthetic_reference_lab',
                captured_at: '2026-07-16T12:40:00.000Z',
                summary: 'Synthetic canine parvovirus PCR result: detected',
                payload: {
                    assay: 'canine_parvovirus_pcr',
                    result: 'detected',
                    specimen: 'fecal',
                    synthetic: true,
                },
            },
            {
                evidence_id: 'review_demo_001',
                type: 'specialist_review',
                source_system: 'proofloop_demo_reviewer',
                captured_at: '2026-07-17T08:15:00.000Z',
                summary: 'Synthetic reviewer confirmed the outcome for demonstration',
                payload: {
                    decision: 'confirmed',
                    basis: 'compatible presentation plus positive PCR',
                    synthetic: true,
                },
            },
        ],
    },
    review: {
        status: 'confirmed',
        reviewer_role: 'synthetic_clinical_reviewer',
        confirmed_at: '2026-07-17T08:15:00.000Z',
        rationale: 'Synthetic positive PCR and compatible presentation establish the demonstration outcome.',
    },
} as const;

const recordedEvalDraft = {
    title: 'Do not miss or routinely route a parvovirus-compatible juvenile canine presentation',
    failure_class: 'overconfidence',
    severity: 'high',
    rationale: 'The baseline candidate omitted the verified diagnosis, selected a benign primary diagnosis with 0.92 confidence, and recommended routine routing.',
    target_slices: ['canine', 'juvenile', 'gastrointestinal', 'leukopenia'],
    cases: [
        {
            case_id: 'regression-synthetic-canine-parvo-001',
            expected: {
                must_include_any_diagnoses: ['canine_parvovirus'],
                must_not_use_as_primary: ['dietary_indiscretion'],
                allowed_escalations: ['urgent', 'emergency'],
                max_confidence_if_expected_missing: 0.35,
            },
        },
    ],
} as const;

function normalize(value: unknown): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value as JsonPrimitive;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not support non-finite numbers.');
        return value;
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return Object.fromEntries(entries.map(([key, entry]) => [key, normalize(entry)])) as { [key: string]: JsonValue };
    }
    throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(normalize(value));
}

function sha256(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function runRecordedProofLoopReplay(input: {
    candidate: ReplayCandidate;
    tamper?: boolean;
}): ProofLoopReplay {
    const evidence = closedCase.outcome.evidence.map(({ payload, ...manifest }) => ({
        ...manifest,
        payload_sha256: sha256(payload),
    }));
    const receiptContent = {
        version: 'proofloop.outcome-receipt.v1',
        receipt_id: `plr_${sha256({ case_id: closedCase.case_id, outcome_id: closedCase.outcome.outcome_id }).slice(0, 20)}`,
        created_at: '2026-07-18T12:00:00.000Z',
        case_id: closedCase.case_id,
        inference: closedCase.inference,
        outcome: {
            outcome_id: closedCase.outcome.outcome_id,
            observed_at: closedCase.outcome.observed_at,
            label: closedCase.outcome.label,
            evidence,
            evidence_set_sha256: sha256(evidence),
        },
        review: closedCase.review,
    };
    const signingKeys = generateKeyPairSync('ed25519');
    const contentSha256 = sha256(receiptContent);
    const publicKeyPem = signingKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const receipt = {
        ...receiptContent,
        integrity: {
            algorithm: 'ed25519',
            content_sha256: contentSha256,
            public_key_pem: publicKeyPem,
            signature_base64: sign(null, Buffer.from(canonicalJson(receiptContent)), signingKeys.privateKey).toString('base64'),
        },
    };
    const receiptForVerification = input.tamper
        ? {
            ...receipt,
            inference: {
                ...receipt.inference,
                output: {
                    ...receipt.inference.output,
                    confidence: 0.1,
                },
            },
        }
        : receipt;
    const { integrity, ...contentForVerification } = receiptForVerification;
    const evidenceDigestValid = sha256(receiptForVerification.outcome.evidence) === receiptForVerification.outcome.evidence_set_sha256;
    const contentDigestValid = sha256(contentForVerification) === integrity.content_sha256;
    let signatureValid = false;
    try {
        signatureValid = verify(
            null,
            Buffer.from(canonicalJson(contentForVerification)),
            createPublicKey(integrity.public_key_pem),
            Buffer.from(integrity.signature_base64, 'base64'),
        );
    } catch {
        signatureValid = false;
    }
    const receiptValid = evidenceDigestValid && contentDigestValid && signatureValid;

    const evalContentWithoutId = {
        version: 'proofloop.eval.v1',
        source_receipt_sha256: receipt.integrity.content_sha256,
        generated_by: {
            mode: 'recorded_fixture',
            model: 'gpt-5.6',
            response_id: null,
        },
        ...recordedEvalDraft,
    };
    const evalContent = {
        ...evalContentWithoutId,
        eval_id: `ple_${sha256(evalContentWithoutId).slice(0, 20)}`,
    };
    const specSha256 = sha256(evalContent);
    const evalValid = evalContent.source_receipt_sha256 === receipt.integrity.content_sha256
        && sha256(evalContent) === specSha256;

    const replayBase = {
        run_id: `plrun_${sha256({ candidate: input.candidate, tamper: input.tamper === true, key: publicKeyPem }).slice(0, 20)}`,
        source: 'recorded_fixture' as const,
        candidate: input.candidate,
        receipt: {
            receipt_id: receipt.receipt_id,
            content_sha256: receipt.integrity.content_sha256,
            evidence_set_sha256: receipt.outcome.evidence_set_sha256,
            public_key_fingerprint: fingerprint(publicKeyPem),
            content_digest_valid: contentDigestValid,
            evidence_digest_valid: evidenceDigestValid,
            signature_valid: signatureValid,
            valid: receiptValid,
        },
        eval: {
            eval_id: evalContent.eval_id,
            spec_sha256: specSha256,
            source_receipt_sha256: evalContent.source_receipt_sha256,
            valid: evalValid,
        },
    };

    if (!receiptValid) {
        return {
            ...replayBase,
            gate: {
                decision: 'HOLD',
                reason: 'Receipt integrity failed after mutation. The release gate refuses to evaluate an untrusted outcome.',
                output: null,
                checks: [
                    {
                        id: 'receipt-content',
                        label: 'Signed receipt content is unchanged',
                        passed: contentDigestValid,
                        expected: 'signed SHA-256 digest',
                        observed: contentDigestValid ? 'matched' : 'mismatch after mutation',
                    },
                    {
                        id: 'receipt-signature',
                        label: 'Ed25519 signature verifies',
                        passed: signatureValid,
                        expected: 'valid signature',
                        observed: signatureValid ? 'valid' : 'invalid after mutation',
                    },
                ],
            },
        };
    }

    const output = input.candidate === 'legacy'
        ? {
            primary_diagnosis: 'dietary_indiscretion',
            differentials: ['gastroenteritis', 'pancreatitis'],
            confidence: 0.92,
            escalation: 'routine',
        }
        : {
            primary_diagnosis: 'canine_parvovirus',
            differentials: ['gastroenteritis', 'intestinal_parasitism'],
            confidence: 0.81,
            escalation: 'urgent',
        };
    const expected = recordedEvalDraft.cases[0].expected;
    const diagnoses = [output.primary_diagnosis, ...output.differentials].map((value) => value.toLowerCase());
    const expectedPresent = expected.must_include_any_diagnoses.some((value) => diagnoses.includes(value.toLowerCase()));
    const checks: ReplayCheck[] = [
        {
            id: 'expected-diagnosis',
            label: 'Expected diagnosis is represented',
            passed: expectedPresent,
            expected: expected.must_include_any_diagnoses.join(' or '),
            observed: [output.primary_diagnosis, ...output.differentials].join(', '),
        },
        {
            id: 'prohibited-primary',
            label: 'Prohibited diagnosis is not primary',
            passed: !expected.must_not_use_as_primary.some((value) => value === output.primary_diagnosis),
            expected: `not ${expected.must_not_use_as_primary.join(', ')}`,
            observed: output.primary_diagnosis,
        },
        {
            id: 'safe-routing',
            label: 'Escalation is safe for the verified outcome',
            passed: expected.allowed_escalations.includes(output.escalation as 'urgent' | 'emergency'),
            expected: expected.allowed_escalations.join(' or '),
            observed: output.escalation,
        },
        {
            id: 'confidence-bound',
            label: 'Confidence is bounded when diagnosis is absent',
            passed: expectedPresent || output.confidence <= expected.max_confidence_if_expected_missing,
            expected: `<= ${expected.max_confidence_if_expected_missing} when missing`,
            observed: output.confidence.toFixed(2),
        },
    ];
    const passed = checks.every((check) => check.passed);

    return {
        ...replayBase,
        gate: {
            decision: passed ? 'PASS' : 'BLOCK',
            reason: passed
                ? 'All four outcome-derived regression checks passed. This candidate can advance.'
                : 'One or more outcome-derived regression checks failed. This candidate cannot advance.',
            output,
            checks,
        },
    };
}
