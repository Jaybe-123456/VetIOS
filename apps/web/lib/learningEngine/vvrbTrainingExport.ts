import { createHash } from 'crypto';
import { auditVvrbCases, type VvrbAuditIssue, type VvrbAuditReport, type VvrbCaseRecord } from '@/lib/learningEngine/vvrbBenchmark';

export type VvrbTrainingSplit = 'train' | 'validation' | 'test';

export interface VvrbChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface VvrbSftRow {
    id: string;
    split: VvrbTrainingSplit;
    synthetic: true;
    benchmark_only: true;
    messages: VvrbChatMessage[];
    metadata: VvrbTrainingRowMetadata;
}

export interface VvrbDpoRow {
    id: string;
    split: VvrbTrainingSplit;
    synthetic: true;
    benchmark_only: true;
    prompt: VvrbChatMessage[];
    chosen: string;
    rejected: string;
    metadata: VvrbTrainingRowMetadata & {
        preference_source: 'explicit_vvrb_preference';
    };
}

export interface VvrbEvalRow {
    id: string;
    split: VvrbTrainingSplit;
    synthetic: true;
    benchmark_only: true;
    prompt: string;
    expected: {
        confirmed_diagnosis: string | null;
        top3_contains_confirmed: boolean | null;
        antimicrobial_decision: VvrbCaseRecord['antimicrobial_decision'] | null;
        red_flags: string[];
    };
    rubric: string[];
    metadata: VvrbTrainingRowMetadata;
}

export interface VvrbTrainingRowMetadata {
    benchmark_id: string;
    benchmark_version: string | null;
    case_domain: string | null;
    species: string | null;
    severity: string | null;
    regulatory_region: string | null;
    confirmed_diagnosis: string | null;
    clinician_feedback: string | null;
    source_hash: string;
}

export interface VvrbUnslothRecipe {
    base_model_id: string;
    attempted_or_previous_model_id: string | null;
    recommended_adapter_model_id: string;
    recommended_gguf_export_model_id: string;
    method: 'qlora_sft_then_optional_dpo';
    max_seq_length: number;
    lora_rank: number;
    lora_alpha: number;
    lora_dropout: number;
    learning_rate: number;
    warmup_ratio: number;
    epochs: number;
    response_only_loss: true;
    merge_before_gguf_export: true;
    notes: string[];
}

export interface VvrbExperimentalTrainingExportOptions {
    baseModelId?: string;
    attemptedOrPreviousModelId?: string | null;
    recommendedAdapterModelId?: string;
    recommendedGgufExportModelId?: string;
    allowCriticalSyntheticAuditIssues?: boolean;
    maxRows?: number;
    validationRatio?: number;
    testRatio?: number;
}

export interface VvrbExperimentalTrainingExport {
    manifest: {
        export_kind: 'vvrb_experimental_unsloth_training';
        export_status: 'ready_for_experimental_training' | 'blocked_by_audit';
        production_training_allowed: false;
        governed_training_allowed: false;
        moat_counts_allowed: false;
        dataset_hash: string;
        total_source_rows: number;
        exported_sft_rows: number;
        exported_dpo_rows: number;
        exported_eval_rows: number;
        blockers: string[];
        warnings: string[];
        audit_summary: Pick<VvrbAuditReport,
            'diagnosis_leakage_rate'
            | 'repeated_reasoning_top_rate'
            | 'unique_lab_pattern_count'
            | 'unique_amr_decision_count'
            | 'confidence_cire_correlation'
            | 'generic_evidence_source_rate'
        >;
        unsloth_recipe: VvrbUnslothRecipe;
        research_basis: string[];
    };
    sft_rows: VvrbSftRow[];
    dpo_rows: VvrbDpoRow[];
    eval_rows: VvrbEvalRow[];
}

const DEFAULT_BASE_MODEL_ID = 'Qwen/Qwen2.5-0.5B-Instruct';
const DEFAULT_PREVIOUS_MODEL_ID = 'VetIOS/vetios-qwen2.5-0.5b-clinical-restart-v1-gguf';
const DEFAULT_ADAPTER_MODEL_ID = 'VetIOS/vetios-qwen2.5-0.5b-clinical-restart-v2-lora';
const DEFAULT_GGUF_MODEL_ID = 'VetIOS/vetios-qwen2.5-0.5b-clinical-restart-v2-gguf';

export function buildVvrbExperimentalTrainingExport(
    records: VvrbCaseRecord[],
    options: VvrbExperimentalTrainingExportOptions = {},
): VvrbExperimentalTrainingExport {
    const selectedRecords = options.maxRows == null ? records : records.slice(0, options.maxRows);
    const audit = auditVvrbCases(selectedRecords);
    const criticalOrHighIssues = audit.issues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high');
    const blockers = [
        'synthetic_vvrb_rows_not_allowed_for_governed_training',
        'synthetic_vvrb_rows_not_allowed_for_moat_counts',
        ...criticalOrHighIssues.map((issue) => `audit:${issue.key}`),
    ];
    const exportBlocked = criticalOrHighIssues.length > 0 && options.allowCriticalSyntheticAuditIssues !== true;
    const splits = buildDeterministicSplits(selectedRecords, {
        validationRatio: options.validationRatio ?? 0.05,
        testRatio: options.testRatio ?? 0.05,
    });
    const sftRows = exportBlocked ? [] : selectedRecords.map((record) => buildSftRow(record, splits.get(recordId(record)) ?? 'train'));
    const dpoRows = exportBlocked ? [] : selectedRecords.flatMap((record) => buildDpoRows(record, splits.get(recordId(record)) ?? 'train'));
    const evalRows = exportBlocked ? [] : selectedRecords.map((record) => buildEvalRow(record, splits.get(recordId(record)) ?? 'train'));

    return {
        manifest: {
            export_kind: 'vvrb_experimental_unsloth_training',
            export_status: exportBlocked ? 'blocked_by_audit' : 'ready_for_experimental_training',
            production_training_allowed: false,
            governed_training_allowed: false,
            moat_counts_allowed: false,
            dataset_hash: hashRecords(selectedRecords),
            total_source_rows: selectedRecords.length,
            exported_sft_rows: sftRows.length,
            exported_dpo_rows: dpoRows.length,
            exported_eval_rows: evalRows.length,
            blockers,
            warnings: [
                'Use exported SFT rows only for cold-start experimental LoRA/QLoRA.',
                'Do not merge or promote a model trained on VVRB without real outcome-confirmed validation.',
                'DPO rows require explicit preferred/rejected responses; generic clinician_feedback is not enough.',
                'GGUF should be produced after adapter merge and evaluation, not used as the primary training target.',
            ],
            audit_summary: {
                diagnosis_leakage_rate: audit.diagnosis_leakage_rate,
                repeated_reasoning_top_rate: audit.repeated_reasoning_top_rate,
                unique_lab_pattern_count: audit.unique_lab_pattern_count,
                unique_amr_decision_count: audit.unique_amr_decision_count,
                confidence_cire_correlation: audit.confidence_cire_correlation,
                generic_evidence_source_rate: audit.generic_evidence_source_rate,
            },
            unsloth_recipe: buildUnslothRecipe(options),
            research_basis: [
                'Qwen2.5 technical report: use Qwen as an efficient open-weight base, with small models serving edge and iteration loops.',
                'LoRA: parameter-efficient adaptation keeps base weights frozen and trains low-rank adapters.',
                'QLoRA: 4-bit quantized fine-tuning lowers memory enough for practical iteration.',
                'DPO: use preference optimization only when explicit chosen/rejected pairs exist.',
                'FDA GMLP and PCCP: separate experimental model changes from validated production promotion.',
                'WHO health AI guidance: clinical AI requires transparency, human oversight, and measured risk controls.',
            ],
        },
        sft_rows: sftRows,
        dpo_rows: dpoRows,
        eval_rows: evalRows,
    };
}

export function encodeJsonlRows(rows: Array<Record<string, unknown>>): string {
    return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
}

function buildSftRow(record: VvrbCaseRecord, split: VvrbTrainingSplit): VvrbSftRow {
    return {
        id: recordId(record),
        split,
        synthetic: true,
        benchmark_only: true,
        messages: [
            systemMessage(),
            {
                role: 'user',
                content: buildClinicalPrompt(record),
            },
            {
                role: 'assistant',
                content: buildClinicalAnswer(record),
            },
        ],
        metadata: buildMetadata(record),
    };
}

function buildDpoRows(record: VvrbCaseRecord, split: VvrbTrainingSplit): VvrbDpoRow[] {
    const chosen = readText(record.preferred_response) ?? readText(record.corrected_response);
    const rejected = readText(record.rejected_response);
    if (!chosen || !rejected) return [];

    return [{
        id: `${recordId(record)}:dpo`,
        split,
        synthetic: true,
        benchmark_only: true,
        prompt: [
            systemMessage(),
            {
                role: 'user',
                content: buildClinicalPrompt(record),
            },
        ],
        chosen,
        rejected,
        metadata: {
            ...buildMetadata(record),
            preference_source: 'explicit_vvrb_preference',
        },
    }];
}

function buildEvalRow(record: VvrbCaseRecord, split: VvrbTrainingSplit): VvrbEvalRow {
    return {
        id: `${recordId(record)}:eval`,
        split,
        synthetic: true,
        benchmark_only: true,
        prompt: buildClinicalPrompt(record),
        expected: {
            confirmed_diagnosis: readText(record.confirmed_diagnosis),
            top3_contains_confirmed: typeof record.evaluation_targets?.top3_contains_confirmed === 'boolean'
                ? record.evaluation_targets.top3_contains_confirmed
                : null,
            antimicrobial_decision: record.antimicrobial_decision ?? null,
            red_flags: normalizeStringArray(record.red_flags),
        },
        rubric: [
            'Produces prioritized differential diagnoses without claiming certainty from synthetic evidence.',
            'Mentions emergency/referral red flags when present.',
            'Explains antimicrobial stewardship decision and avoids unnecessary antimicrobial use.',
            'Separates recommended diagnostics from treatment plan.',
            'Uses concise clinical reasoning suitable for veterinarian review.',
        ],
        metadata: buildMetadata(record),
    };
}

function buildClinicalPrompt(record: VvrbCaseRecord): string {
    return [
        `Species: ${readText(record.species) ?? 'unknown'}`,
        `Breed: ${readText(record.breed) ?? 'unknown'}`,
        `Age: ${readText(record.age) ?? 'unknown'}`,
        `Sex: ${readText(record.sex) ?? 'unknown'}`,
        `Region: ${readText(record.regulatory_region) ?? 'unknown'}`,
        `Care setting: ${readText(record.care_environment) ?? 'unknown'}`,
        `Presenting complaint: ${readText(record.presenting_complaint) ?? 'not provided'}`,
        `History: ${readText(record.history) ?? 'not provided'}`,
        `Clinical signs: ${normalizeStringArray(record.clinical_signs).join(', ') || 'not provided'}`,
        `Labs: ${stableJson(record.labs ?? {})}`,
        `Imaging: ${stableJson(record.imaging ?? {})}`,
        '',
        'Task: Provide a veterinarian-facing assessment with prioritized differentials, red flags, recommended tests, treatment plan, and antimicrobial stewardship reasoning. Do not present this synthetic benchmark case as outcome-confirmed real-world evidence.',
    ].join('\n');
}

function buildClinicalAnswer(record: VvrbCaseRecord): string {
    const differentials = normalizeStringArray(record.differential_diagnoses);
    const tests = normalizeStringArray(record.recommended_tests);
    const treatment = normalizeStringArray(record.treatment_plan);
    const redFlags = normalizeStringArray(record.red_flags);
    const antimicrobial = record.antimicrobial_decision;

    return [
        `Assessment: ${readText(record.reasoning_chain_public) ?? 'The case requires veterinarian review and confirmatory testing before diagnosis.'}`,
        '',
        `Prioritized differentials: ${differentials.length > 0 ? differentials.join('; ') : 'not enough evidence to rank differentials'}.`,
        `Red flags: ${redFlags.length > 0 ? redFlags.join('; ') : 'none explicitly provided in the benchmark row'}.`,
        `Recommended tests: ${tests.length > 0 ? tests.join('; ') : 'confirmatory testing should be selected by the attending veterinarian'}.`,
        `Treatment plan: ${treatment.length > 0 ? treatment.join('; ') : 'supportive care and reassessment pending diagnostics'}.`,
        `Antimicrobial decision: ${readText(antimicrobial?.drug) ?? 'not specified'}; rationale: ${readText(antimicrobial?.reason) ?? 'not specified'}; stewardship risk: ${readText(antimicrobial?.stewardship_risk) ?? 'unknown'}.`,
        '',
        `Benchmark label: ${readText(record.confirmed_diagnosis) ?? 'not provided'}; outcome: ${readText(record.outcome) ?? 'not provided'}.`,
        'Safety note: this is synthetic benchmark supervision and must be validated against real clinician-reviewed, outcome-confirmed cases before production use.',
    ].join('\n');
}

function buildUnslothRecipe(options: VvrbExperimentalTrainingExportOptions): VvrbUnslothRecipe {
    return {
        base_model_id: options.baseModelId ?? DEFAULT_BASE_MODEL_ID,
        attempted_or_previous_model_id: options.attemptedOrPreviousModelId ?? DEFAULT_PREVIOUS_MODEL_ID,
        recommended_adapter_model_id: options.recommendedAdapterModelId ?? DEFAULT_ADAPTER_MODEL_ID,
        recommended_gguf_export_model_id: options.recommendedGgufExportModelId ?? DEFAULT_GGUF_MODEL_ID,
        method: 'qlora_sft_then_optional_dpo',
        max_seq_length: 4096,
        lora_rank: 16,
        lora_alpha: 32,
        lora_dropout: 0.05,
        learning_rate: 0.0002,
        warmup_ratio: 0.03,
        epochs: 1,
        response_only_loss: true,
        merge_before_gguf_export: true,
        notes: [
            'Start with one epoch because VVRB is synthetic and template-heavy.',
            'Use response-only loss masking so the model learns clinical answer style rather than copying prompts.',
            'Keep the LoRA adapter separate from governed production models until real outcome-confirmed validation passes.',
            'Use DPO only for explicit chosen/rejected rows, not generic approved feedback.',
        ],
    };
}

function buildDeterministicSplits(
    records: VvrbCaseRecord[],
    options: { validationRatio: number; testRatio: number },
): Map<string, VvrbTrainingSplit> {
    const splits = new Map<string, VvrbTrainingSplit>();
    for (const record of records) {
        const id = recordId(record);
        const bucket = deterministicBucket(id);
        const split = bucket < options.testRatio
            ? 'test'
            : bucket < options.testRatio + options.validationRatio
                ? 'validation'
                : 'train';
        splits.set(id, split);
    }
    return splits;
}

function buildMetadata(record: VvrbCaseRecord): VvrbTrainingRowMetadata {
    return {
        benchmark_id: recordId(record),
        benchmark_version: readText(record.benchmark_version),
        case_domain: readText(record.case_domain),
        species: readText(record.species),
        severity: readText(record.severity),
        regulatory_region: readText(record.regulatory_region),
        confirmed_diagnosis: readText(record.confirmed_diagnosis),
        clinician_feedback: readText(record.clinician_feedback),
        source_hash: hashRecord(record),
    };
}

function systemMessage(): VvrbChatMessage {
    return {
        role: 'system',
        content: 'You are VetIOS, a veterinary clinical reasoning assistant. Provide veterinarian-facing educational support, preserve uncertainty, surface red flags, and never treat synthetic benchmark cases as real outcome-confirmed evidence.',
    };
}

function recordId(record: VvrbCaseRecord): string {
    return readText(record.benchmark_id) ?? `vvrb-${hashRecord(record).slice(0, 12)}`;
}

function deterministicBucket(value: string): number {
    const hash = createHash('sha1').update(value).digest('hex').slice(0, 8);
    return (Number.parseInt(hash, 16) % 10_000) / 10_000;
}

function hashRecords(records: VvrbCaseRecord[]): string {
    const digest = createHash('sha256');
    for (const record of records) {
        digest.update(recordId(record));
        digest.update(hashRecord(record));
        digest.update('\0');
    }
    return digest.digest('hex');
}

function hashRecord(record: VvrbCaseRecord): string {
    return createHash('sha256').update(stableJson(record)).digest('hex');
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(readText).filter(isString)
        : [];
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: string | null): value is string {
    return value != null;
}
