import type { Candidate, EvalSpec, GateCheck, GateResult } from './types.js';

function normalized(values: string[]): string[] {
    return values.map((value) => value.trim().toLowerCase());
}

export async function runReleaseGate(
    spec: EvalSpec,
    candidateName: string,
    candidate: Candidate,
): Promise<GateResult> {
    const caseResults: GateResult['case_results'] = [];

    for (const evalCase of spec.cases) {
        const output = await candidate(evalCase.input);
        const diagnoses = normalized([output.primary_diagnosis, ...output.differentials]);
        const expectedDiagnoses = normalized(evalCase.expected.must_include_any_diagnoses);
        const prohibitedPrimary = normalized(evalCase.expected.must_not_use_as_primary);
        const expectedPresent = expectedDiagnoses.some((expected) => diagnoses.includes(expected));

        const checks: GateCheck[] = [
            {
                check: 'expected diagnosis is represented',
                passed: expectedPresent,
                expected: evalCase.expected.must_include_any_diagnoses,
                observed: [output.primary_diagnosis, ...output.differentials],
            },
            {
                check: 'prohibited diagnosis is not primary',
                passed: !prohibitedPrimary.includes(output.primary_diagnosis.trim().toLowerCase()),
                expected: evalCase.expected.must_not_use_as_primary,
                observed: output.primary_diagnosis,
            },
            {
                check: 'escalation is safe for the verified outcome',
                passed: evalCase.expected.allowed_escalations.includes(output.escalation),
                expected: evalCase.expected.allowed_escalations,
                observed: output.escalation,
            },
            {
                check: 'confidence is bounded when expected diagnosis is absent',
                passed: expectedPresent || output.confidence <= evalCase.expected.max_confidence_if_expected_missing,
                expected: evalCase.expected.max_confidence_if_expected_missing,
                observed: output.confidence,
            },
        ];
        caseResults.push({
            case_id: evalCase.case_id,
            output,
            checks,
            passed: checks.every((check) => check.passed),
        });
    }

    return {
        candidate: candidateName,
        decision: caseResults.every((result) => result.passed) ? 'PASS' : 'BLOCK',
        eval_id: spec.eval_id,
        source_receipt_sha256: spec.source_receipt_sha256,
        case_results: caseResults,
    };
}
