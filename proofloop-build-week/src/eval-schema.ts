import { sha256 } from './integrity.js';
import type { EvalDraft, EvalSpec, EvalSpecContent, OutcomeReceipt } from './types.js';

const escalationValues = ['routine', 'soon', 'urgent', 'emergency'] as const;
const failureClasses = ['missed_diagnosis', 'overconfidence', 'unsafe_routing', 'unsupported_claim', 'other'] as const;
const severityValues = ['low', 'medium', 'high', 'critical'] as const;

export const evalDraftJsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: { type: 'string' },
        failure_class: { type: 'string', enum: [...failureClasses] },
        severity: { type: 'string', enum: [...severityValues] },
        rationale: { type: 'string' },
        target_slices: { type: 'array', items: { type: 'string' } },
        cases: {
            type: 'array',
            minItems: 1,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    case_id: { type: 'string' },
                    input: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            species: { type: 'string' },
                            age_months: { type: 'number' },
                            symptoms: { type: 'array', items: { type: 'string' } },
                            laboratory_findings: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        name: { type: 'string' },
                                        value: { type: 'string' },
                                        units: { type: 'string' },
                                    },
                                    required: ['name', 'value', 'units'],
                                },
                            },
                        },
                        required: ['species', 'age_months', 'symptoms', 'laboratory_findings'],
                    },
                    expected: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            must_include_any_diagnoses: { type: 'array', minItems: 1, items: { type: 'string' } },
                            must_not_use_as_primary: { type: 'array', items: { type: 'string' } },
                            allowed_escalations: { type: 'array', minItems: 1, items: { type: 'string', enum: [...escalationValues] } },
                            max_confidence_if_expected_missing: { type: 'number', minimum: 0, maximum: 1 },
                        },
                        required: [
                            'must_include_any_diagnoses',
                            'must_not_use_as_primary',
                            'allowed_escalations',
                            'max_confidence_if_expected_missing',
                        ],
                    },
                },
                required: ['case_id', 'input', 'expected'],
            },
        },
    },
    required: ['title', 'failure_class', 'severity', 'rationale', 'target_slices', 'cases'],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${path} must be a non-empty string.`);
    }
}

function requireStringArray(value: unknown, path: string, allowEmpty = true): asserts value is string[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
        throw new TypeError(`${path} must be ${allowEmpty ? 'an' : 'a non-empty'} array.`);
    }
    value.forEach((entry, index) => requireString(entry, `${path}[${index}]`));
}

export function parseEvalDraft(value: unknown): EvalDraft {
    if (!isRecord(value)) {
        throw new TypeError('Eval draft must be an object.');
    }
    requireString(value.title, 'title');
    requireString(value.failure_class, 'failure_class');
    requireString(value.severity, 'severity');
    requireString(value.rationale, 'rationale');
    requireStringArray(value.target_slices, 'target_slices');
    if (!failureClasses.includes(value.failure_class as (typeof failureClasses)[number])) {
        throw new TypeError('failure_class is not supported.');
    }
    if (!severityValues.includes(value.severity as (typeof severityValues)[number])) {
        throw new TypeError('severity is not supported.');
    }
    if (!Array.isArray(value.cases) || value.cases.length === 0) {
        throw new TypeError('cases must contain at least one case.');
    }

    for (const [index, entry] of value.cases.entries()) {
        if (!isRecord(entry) || !isRecord(entry.input) || !isRecord(entry.expected)) {
            throw new TypeError(`cases[${index}] is malformed.`);
        }
        requireString(entry.case_id, `cases[${index}].case_id`);
        requireString(entry.input.species, `cases[${index}].input.species`);
        if (typeof entry.input.age_months !== 'number' || entry.input.age_months < 0) {
            throw new TypeError(`cases[${index}].input.age_months must be non-negative.`);
        }
        requireStringArray(entry.input.symptoms, `cases[${index}].input.symptoms`);
        if (!Array.isArray(entry.input.laboratory_findings)) {
            throw new TypeError(`cases[${index}].input.laboratory_findings must be an array.`);
        }
        for (const [labIndex, lab] of entry.input.laboratory_findings.entries()) {
            if (!isRecord(lab)) {
                throw new TypeError(`cases[${index}].input.laboratory_findings[${labIndex}] is malformed.`);
            }
            requireString(lab.name, `cases[${index}].input.laboratory_findings[${labIndex}].name`);
            requireString(lab.value, `cases[${index}].input.laboratory_findings[${labIndex}].value`);
            if (typeof lab.units !== 'string') {
                throw new TypeError(`cases[${index}].input.laboratory_findings[${labIndex}].units must be a string.`);
            }
        }
        requireStringArray(entry.expected.must_include_any_diagnoses, `cases[${index}].expected.must_include_any_diagnoses`, false);
        requireStringArray(entry.expected.must_not_use_as_primary, `cases[${index}].expected.must_not_use_as_primary`);
        requireStringArray(entry.expected.allowed_escalations, `cases[${index}].expected.allowed_escalations`, false);
        if (!entry.expected.allowed_escalations.every((item) => escalationValues.includes(item as (typeof escalationValues)[number]))) {
            throw new TypeError(`cases[${index}].expected.allowed_escalations contains an unsupported value.`);
        }
        const cap = entry.expected.max_confidence_if_expected_missing;
        if (typeof cap !== 'number' || cap < 0 || cap > 1) {
            throw new TypeError(`cases[${index}].expected.max_confidence_if_expected_missing must be between 0 and 1.`);
        }
    }

    return value as unknown as EvalDraft;
}

export function finalizeEvalSpec(
    draft: EvalDraft,
    receipt: OutcomeReceipt,
    generatedBy: EvalSpecContent['generated_by'],
): EvalSpec {
    const contentWithoutId = {
        version: 'proofloop.eval.v1' as const,
        source_receipt_sha256: receipt.integrity.content_sha256,
        generated_by: generatedBy,
        ...draft,
    };
    const content: EvalSpecContent = {
        ...contentWithoutId,
        eval_id: `ple_${sha256(contentWithoutId).slice(0, 20)}`,
    };
    return { ...content, spec_sha256: sha256(content) };
}

export function verifyEvalSpec(spec: EvalSpec, receipt: OutcomeReceipt): boolean {
    const { spec_sha256, ...content } = spec;
    return spec.source_receipt_sha256 === receipt.integrity.content_sha256 && sha256(content) === spec_sha256;
}
