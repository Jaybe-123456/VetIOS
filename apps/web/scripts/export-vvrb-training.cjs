#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');

const DEFAULT_BASE_MODEL_ID = 'Qwen/Qwen2.5-0.5B-Instruct';
const DEFAULT_PREVIOUS_MODEL_ID = 'VetIOS/vetios-qwen2.5-0.5b-clinical-restart-v1-gguf';
const DEFAULT_ADAPTER_MODEL_ID = 'VetIOS/vetios-qwen2.5-0.5b-clinical-restart-v2-lora';
const DEFAULT_GGUF_MODEL_ID = 'VetIOS/vetios-qwen2.5-0.5b-clinical-restart-v2-gguf';
const GENERIC_EVIDENCE_SOURCE_PATTERNS = [
  /standard veterinary clinical reasoning patterns/i,
  /msd\/merck veterinary manual disease guidance/i,
  /woah antimicrobial stewardship/i,
];

main().catch((error) => {
  console.error(`VVRB export failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const inputPath = args.input ?? process.env.VVRB_JSONL_PATH;
  if (!inputPath) {
    throw new Error('Missing --input <path> or VVRB_JSONL_PATH.');
  }

  const outputDir = path.resolve(args.outDir ?? defaultOutputDir());
  const records = await loadJsonl(inputPath, {
    limit: args.limit,
    skipInvalidLines: args.skipInvalidLines,
  });
  const audit = auditRecords(records);
  const exportBundle = buildExport(records, audit, args);

  await fs.promises.mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(outputDir, 'manifest.json'), exportBundle.manifest),
    writeJson(path.join(outputDir, 'audit.json'), audit),
    writeJsonl(path.join(outputDir, 'sft.jsonl'), exportBundle.sftRows),
    writeJsonl(path.join(outputDir, 'eval.jsonl'), exportBundle.evalRows),
    writeJsonl(path.join(outputDir, 'dpo.jsonl'), exportBundle.dpoRows),
  ]);

  console.log(JSON.stringify({
    output_dir: outputDir,
    export_status: exportBundle.manifest.export_status,
    total_source_rows: exportBundle.manifest.total_source_rows,
    exported_sft_rows: exportBundle.manifest.exported_sft_rows,
    exported_eval_rows: exportBundle.manifest.exported_eval_rows,
    exported_dpo_rows: exportBundle.manifest.exported_dpo_rows,
    blockers: exportBundle.manifest.blockers,
  }, null, 2));
}

function parseArgs(argv) {
  const args = {
    input: null,
    outDir: null,
    limit: null,
    skipInvalidLines: false,
    allowExperimentalSyntheticTraining: false,
    baseModelId: DEFAULT_BASE_MODEL_ID,
    previousModelId: DEFAULT_PREVIOUS_MODEL_ID,
    adapterModelId: DEFAULT_ADAPTER_MODEL_ID,
    ggufModelId: DEFAULT_GGUF_MODEL_ID,
    validationRatio: 0.05,
    testRatio: 0.05,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--input':
        args.input = readRequired(argv, ++index, '--input');
        break;
      case '--out-dir':
        args.outDir = readRequired(argv, ++index, '--out-dir');
        break;
      case '--limit':
        args.limit = readPositiveInteger(readRequired(argv, ++index, '--limit'), '--limit');
        break;
      case '--skip-invalid-lines':
        args.skipInvalidLines = true;
        break;
      case '--allow-experimental-synthetic-training':
        args.allowExperimentalSyntheticTraining = true;
        break;
      case '--base-model':
        args.baseModelId = readRequired(argv, ++index, '--base-model');
        break;
      case '--previous-model':
        args.previousModelId = readRequired(argv, ++index, '--previous-model');
        break;
      case '--adapter-model':
        args.adapterModelId = readRequired(argv, ++index, '--adapter-model');
        break;
      case '--gguf-model':
        args.ggufModelId = readRequired(argv, ++index, '--gguf-model');
        break;
      case '--validation-ratio':
        args.validationRatio = readRatio(readRequired(argv, ++index, '--validation-ratio'), '--validation-ratio');
        break;
      case '--test-ratio':
        args.testRatio = readRatio(readRequired(argv, ++index, '--test-ratio'), '--test-ratio');
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (args.validationRatio + args.testRatio >= 0.5) {
    throw new Error('Validation + test ratio must stay below 0.5.');
  }

  return args;
}

function printHelp() {
  console.log(`VetIOS VVRB experimental training export

Usage:
  pnpm --filter @vetios/web run export:vvrb-training -- --input <cases.jsonl> --out-dir <dir>

Required:
  --input <path>                         Path to the 60k VVRB JSONL file. Can also use VVRB_JSONL_PATH.

Options:
  --out-dir <dir>                        Output directory. Defaults to apps/web/artifacts/vvrb-training/<timestamp>.
  --limit <n>                            Stream only the first n rows for smoke tests.
  --skip-invalid-lines                   Skip malformed JSONL lines.
  --allow-experimental-synthetic-training
                                         Write SFT/eval/DPO rows even when audit detects critical synthetic issues.
  --base-model <id>                      Defaults to ${DEFAULT_BASE_MODEL_ID}.
  --previous-model <id>                  Defaults to ${DEFAULT_PREVIOUS_MODEL_ID}.
  --adapter-model <id>                   Defaults to ${DEFAULT_ADAPTER_MODEL_ID}.
  --gguf-model <id>                      Defaults to ${DEFAULT_GGUF_MODEL_ID}.
  --validation-ratio <0..1>              Defaults to 0.05.
  --test-ratio <0..1>                    Defaults to 0.05.

Outputs:
  manifest.json, audit.json, sft.jsonl, eval.jsonl, dpo.jsonl

Safety:
  This command produces experimental synthetic training artifacts only. It never marks VVRB rows as
  outcome-confirmed, federation-eligible, governed-training eligible, or moat-completion evidence.
`);
}

async function loadJsonl(inputPath, options) {
  const absolutePath = path.resolve(inputPath);
  const records = [];
  const reader = readline.createInterface({
    input: fs.createReadStream(absolutePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of reader) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        records.push(parsed);
      } else if (!options.skipInvalidLines) {
        throw new Error(`Line ${lineNumber} is not a JSON object.`);
      }
    } catch (error) {
      if (!options.skipInvalidLines) {
        throw new Error(`Invalid JSONL at line ${lineNumber}: ${error.message}`);
      }
    }
    if (options.limit != null && records.length >= options.limit) break;
  }

  return records;
}

function buildExport(records, audit, args) {
  const highOrCriticalIssues = audit.issues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high');
  const exportBlocked = highOrCriticalIssues.length > 0 && args.allowExperimentalSyntheticTraining !== true;
  const blockers = [
    'synthetic_vvrb_rows_not_allowed_for_governed_training',
    'synthetic_vvrb_rows_not_allowed_for_moat_counts',
    ...highOrCriticalIssues.map((issue) => `audit:${issue.key}`),
  ];
  const splitById = buildSplits(records, {
    validationRatio: args.validationRatio,
    testRatio: args.testRatio,
  });
  const sftRows = exportBlocked ? [] : records.map((record) => buildSftRow(record, splitById.get(recordId(record)) ?? 'train'));
  const evalRows = exportBlocked ? [] : records.map((record) => buildEvalRow(record, splitById.get(recordId(record)) ?? 'train'));
  const dpoRows = exportBlocked ? [] : records.flatMap((record) => buildDpoRows(record, splitById.get(recordId(record)) ?? 'train'));

  return {
    manifest: {
      export_kind: 'vvrb_experimental_unsloth_training',
      export_status: exportBlocked ? 'blocked_by_audit' : 'ready_for_experimental_training',
      production_training_allowed: false,
      governed_training_allowed: false,
      moat_counts_allowed: false,
      dataset_hash: hashRecords(records),
      total_source_rows: records.length,
      exported_sft_rows: sftRows.length,
      exported_eval_rows: evalRows.length,
      exported_dpo_rows: dpoRows.length,
      blockers,
      warnings: [
        'Use exported SFT rows only for cold-start experimental LoRA/QLoRA.',
        'Do not merge or promote a model trained on VVRB without real outcome-confirmed validation.',
        'Use DPO only where explicit chosen/rejected preference pairs exist.',
        'Train against the HF base/instruct model; export GGUF after adapter merge and evaluation.',
      ],
      audit_summary: {
        diagnosis_leakage_rate: audit.diagnosis_leakage_rate,
        repeated_reasoning_top_rate: audit.repeated_reasoning_top_rate,
        unique_lab_pattern_count: audit.unique_lab_pattern_count,
        unique_amr_decision_count: audit.unique_amr_decision_count,
        confidence_cire_correlation: audit.confidence_cire_correlation,
        generic_evidence_source_rate: audit.generic_evidence_source_rate,
      },
      unsloth_recipe: {
        base_model_id: args.baseModelId,
        attempted_or_previous_model_id: args.previousModelId,
        recommended_adapter_model_id: args.adapterModelId,
        recommended_gguf_export_model_id: args.ggufModelId,
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
      },
      research_basis: [
        'Qwen2.5 technical report',
        'LoRA',
        'QLoRA',
        'DPO',
        'FDA GMLP',
        'FDA PCCP',
        'WHO health AI guidance',
      ],
    },
    sftRows,
    evalRows,
    dpoRows,
  };
}

function auditRecords(records) {
  const total = records.length;
  const syntheticCases = records.filter((record) => record.synthetic === true).length;
  const invalidCases = total - syntheticCases;
  const leakageRows = records.filter((record) => {
    const top1 = readText(record.evaluation_targets && record.evaluation_targets.top1_differential)
      || readText(Array.isArray(record.differential_diagnoses) ? record.differential_diagnoses[0] : null);
    const confirmed = readText(record.confirmed_diagnosis);
    return top1 && confirmed && normalizeText(top1) === normalizeText(confirmed);
  }).length;
  const labPatterns = records.map((record) => stableJson(record.labs || {}));
  const amrDecisions = records.map((record) => stableJson(record.antimicrobial_decision || {}));
  const domainDiversity = buildDomainDiversity(records);
  const confidenceCireCorrelation = pearson(
    records.map((record) => readScore(record.confidence_score)),
    records.map((record) => readScore(record.cire_phi_hat)),
  );
  const genericEvidenceSourceRate = ratio(records.filter(hasOnlyGenericEvidenceSources).length, total);
  const diagnosisLeakageRate = ratio(leakageRows, total);
  const repeatedReasoningTopRate = topRate(records.map((record) => reasoningOpener(record.reasoning_chain_public)));
  const repeatedHistoryTopRate = topRate(records.map((record) => normalizeText(readText(record.history))));
  const issues = [];

  if (invalidCases > 0) {
    issues.push(issue('records_not_marked_synthetic', 'critical', 'Every VVRB row must be explicitly synthetic.', invalidCases, 0));
  }
  if (diagnosisLeakageRate > 0.9) {
    issues.push(issue('diagnosis_target_leakage', 'critical', 'Top-1 differential matches confirmed diagnosis too often.', diagnosisLeakageRate, 0.9));
  }
  for (const domain of domainDiversity) {
    if (domain.total_cases >= 100 && domain.unique_confirmed_diagnoses < 8) {
      issues.push(issue(`domain_collapse:${domain.domain}`, 'high', `Domain ${domain.domain} has too few unique confirmed diagnoses.`, domain.unique_confirmed_diagnoses, 8));
    }
  }
  if (repeatedReasoningTopRate > 0.05) {
    issues.push(issue('repeated_reasoning_templates', 'high', 'Reasoning-chain openers repeat too often.', repeatedReasoningTopRate, 0.05));
  }
  if (topRate(labPatterns) > 0.05 || new Set(labPatterns).size < Math.max(20, Math.floor(total * 0.01))) {
    issues.push(issue('lab_template_repetition', 'high', 'Lab patterns are too repetitive for clinical fine-tuning.', new Set(labPatterns).size, Math.max(20, Math.floor(total * 0.01))));
  }
  if (topRate(amrDecisions) > 0.05 || new Set(amrDecisions).size < Math.max(20, Math.floor(total * 0.01))) {
    issues.push(issue('amr_decision_template_repetition', 'high', 'Antimicrobial decisions are too template-like.', new Set(amrDecisions).size, Math.max(20, Math.floor(total * 0.01))));
  }
  if (confidenceCireCorrelation != null && Math.abs(confidenceCireCorrelation) > 0.85) {
    issues.push(issue('confidence_cire_correlation_too_high', 'warning', 'Confidence and CIRE phi-hat are too tightly correlated.', confidenceCireCorrelation, 0.85));
  }
  if (genericEvidenceSourceRate > 0.5) {
    issues.push(issue('generic_evidence_sources', 'warning', 'Most evidence sources are generic.', genericEvidenceSourceRate, 0.5));
  }

  return {
    dataset_name: 'vvrb',
    benchmark_version: mostCommon(records.map((record) => readText(record.benchmark_version)).filter(Boolean)),
    total_cases: total,
    synthetic_cases: syntheticCases,
    invalid_cases: invalidCases,
    diagnosis_leakage_rate: round(diagnosisLeakageRate),
    domain_diagnosis_diversity: domainDiversity,
    repeated_reasoning_top_rate: round(repeatedReasoningTopRate),
    repeated_history_top_rate: round(repeatedHistoryTopRate),
    unique_lab_pattern_count: new Set(labPatterns).size,
    lab_pattern_top_rate: round(topRate(labPatterns)),
    unique_amr_decision_count: new Set(amrDecisions).size,
    amr_decision_top_rate: round(topRate(amrDecisions)),
    confidence_cire_correlation: confidenceCireCorrelation == null ? null : round(confidenceCireCorrelation),
    generic_evidence_source_rate: round(genericEvidenceSourceRate),
    issues,
    allowed_uses: ['benchmark_harness', 'prompt_regression_tests', 'experimental_sft_export_with_explicit_override'],
    blocked_uses: ['governed_training', 'federated_outcome_learning_eligibility', 'moat_completion_live_counts', 'clinical_claim_substantiation'],
  };
}

function buildSftRow(record, split) {
  return {
    id: recordId(record),
    split,
    synthetic: true,
    benchmark_only: true,
    messages: [
      systemMessage(),
      { role: 'user', content: buildClinicalPrompt(record) },
      { role: 'assistant', content: buildClinicalAnswer(record) },
    ],
    metadata: buildMetadata(record),
  };
}

function buildEvalRow(record, split) {
  return {
    id: `${recordId(record)}:eval`,
    split,
    synthetic: true,
    benchmark_only: true,
    prompt: buildClinicalPrompt(record),
    expected: {
      confirmed_diagnosis: readText(record.confirmed_diagnosis),
      top3_contains_confirmed: typeof (record.evaluation_targets && record.evaluation_targets.top3_contains_confirmed) === 'boolean'
        ? record.evaluation_targets.top3_contains_confirmed
        : null,
      antimicrobial_decision: record.antimicrobial_decision || null,
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

function buildDpoRows(record, split) {
  const chosen = readText(record.preferred_response) || readText(record.corrected_response);
  const rejected = readText(record.rejected_response);
  if (!chosen || !rejected) return [];
  return [{
    id: `${recordId(record)}:dpo`,
    split,
    synthetic: true,
    benchmark_only: true,
    prompt: [systemMessage(), { role: 'user', content: buildClinicalPrompt(record) }],
    chosen,
    rejected,
    metadata: {
      ...buildMetadata(record),
      preference_source: 'explicit_vvrb_preference',
    },
  }];
}

function buildClinicalPrompt(record) {
  return [
    `Species: ${readText(record.species) || 'unknown'}`,
    `Breed: ${readText(record.breed) || 'unknown'}`,
    `Age: ${readText(record.age) || 'unknown'}`,
    `Sex: ${readText(record.sex) || 'unknown'}`,
    `Region: ${readText(record.regulatory_region) || 'unknown'}`,
    `Care setting: ${readText(record.care_environment) || 'unknown'}`,
    `Presenting complaint: ${readText(record.presenting_complaint) || 'not provided'}`,
    `History: ${readText(record.history) || 'not provided'}`,
    `Clinical signs: ${normalizeStringArray(record.clinical_signs).join(', ') || 'not provided'}`,
    `Labs: ${stableJson(record.labs || {})}`,
    `Imaging: ${stableJson(record.imaging || {})}`,
    '',
    'Task: Provide a veterinarian-facing assessment with prioritized differentials, red flags, recommended tests, treatment plan, and antimicrobial stewardship reasoning. Do not present this synthetic benchmark case as outcome-confirmed real-world evidence.',
  ].join('\n');
}

function buildClinicalAnswer(record) {
  const antimicrobial = record.antimicrobial_decision || {};
  return [
    `Assessment: ${readText(record.reasoning_chain_public) || 'The case requires veterinarian review and confirmatory testing before diagnosis.'}`,
    '',
    `Prioritized differentials: ${normalizeStringArray(record.differential_diagnoses).join('; ') || 'not enough evidence to rank differentials'}.`,
    `Red flags: ${normalizeStringArray(record.red_flags).join('; ') || 'none explicitly provided in the benchmark row'}.`,
    `Recommended tests: ${normalizeStringArray(record.recommended_tests).join('; ') || 'confirmatory testing should be selected by the attending veterinarian'}.`,
    `Treatment plan: ${normalizeStringArray(record.treatment_plan).join('; ') || 'supportive care and reassessment pending diagnostics'}.`,
    `Antimicrobial decision: ${readText(antimicrobial.drug) || 'not specified'}; rationale: ${readText(antimicrobial.reason) || 'not specified'}; stewardship risk: ${readText(antimicrobial.stewardship_risk) || 'unknown'}.`,
    '',
    `Benchmark label: ${readText(record.confirmed_diagnosis) || 'not provided'}; outcome: ${readText(record.outcome) || 'not provided'}.`,
    'Safety note: this is synthetic benchmark supervision and must be validated against real clinician-reviewed, outcome-confirmed cases before production use.',
  ].join('\n');
}

function buildMetadata(record) {
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

function systemMessage() {
  return {
    role: 'system',
    content: 'You are VetIOS, a veterinary clinical reasoning assistant. Provide veterinarian-facing educational support, preserve uncertainty, surface red flags, and never treat synthetic benchmark cases as real outcome-confirmed evidence.',
  };
}

function buildSplits(records, options) {
  const splitById = new Map();
  for (const record of records) {
    const id = recordId(record);
    const bucket = deterministicBucket(id);
    splitById.set(id, bucket < options.testRatio ? 'test' : bucket < options.testRatio + options.validationRatio ? 'validation' : 'train');
  }
  return splitById;
}

function buildDomainDiversity(records) {
  const byDomain = new Map();
  for (const record of records) {
    const domain = readText(record.case_domain) || 'unknown';
    const diagnosis = readText(record.confirmed_diagnosis);
    if (!diagnosis) continue;
    const bucket = byDomain.get(domain) || [];
    bucket.push(diagnosis);
    byDomain.set(domain, bucket);
  }
  return Array.from(byDomain.entries()).map(([domain, diagnoses]) => {
    const counts = countValues(diagnoses.map(normalizeText));
    const [topDiagnosis, topCount] = topEntry(counts);
    return {
      domain,
      total_cases: diagnoses.length,
      unique_confirmed_diagnoses: counts.size,
      top_confirmed_diagnosis: topDiagnosis,
      top_confirmed_diagnosis_rate: round(ratio(topCount, diagnoses.length)),
    };
  }).sort((left, right) => right.total_cases - left.total_cases || left.domain.localeCompare(right.domain));
}

function hasOnlyGenericEvidenceSources(record) {
  const sources = normalizeStringArray(record.evidence_sources);
  if (sources.length === 0) return true;
  return sources.every((source) => GENERIC_EVIDENCE_SOURCE_PATTERNS.some((pattern) => pattern.test(source)));
}

function reasoningOpener(value) {
  const text = readText(value);
  if (!text) return null;
  return normalizeText((text.split(/\bbecause\b/i)[0] || text));
}

function pearson(leftValues, rightValues) {
  const pairs = leftValues.map((left, index) => [left, rightValues[index]]).filter(([left, right]) => left != null && right != null);
  if (pairs.length < 3) return null;
  const leftMean = average(pairs.map(([left]) => left));
  const rightMean = average(pairs.map(([, right]) => right));
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (const [left, right] of pairs) {
    const leftDelta = left - leftMean;
    const rightDelta = right - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }
  return leftSum === 0 || rightSum === 0 ? null : numerator / Math.sqrt(leftSum * rightSum);
}

function writeJson(filePath, value) {
  return fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, rows) {
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  return fs.promises.writeFile(filePath, content.length > 0 ? `${content}\n` : '', 'utf8');
}

function defaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), 'artifacts', 'vvrb-training', stamp);
}

function recordId(record) {
  return readText(record.benchmark_id) || `vvrb-${hashRecord(record).slice(0, 12)}`;
}

function hashRecords(records) {
  const digest = crypto.createHash('sha256');
  for (const record of records) {
    digest.update(recordId(record));
    digest.update(hashRecord(record));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function hashRecord(record) {
  return crypto.createHash('sha256').update(stableJson(record)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value == null ? null : value);
}

function deterministicBucket(value) {
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
  return (Number.parseInt(hash, 16) % 10000) / 10000;
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(readText).filter(Boolean) : [];
}

function readText(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readScore(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function normalizeText(value) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function ratio(value, denominator) {
  return denominator <= 0 ? 0 : value / denominator;
}

function topRate(values) {
  const filtered = values.filter(Boolean);
  if (filtered.length === 0) return 0;
  const [, count] = topEntry(countValues(filtered));
  return count / filtered.length;
}

function mostCommon(values) {
  if (values.length === 0) return null;
  return topEntry(countValues(values))[0];
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

function topEntry(counts) {
  let topKey = null;
  let topCount = 0;
  for (const [key, count] of counts.entries()) {
    if (count > topCount || (count === topCount && topKey != null && key < topKey)) {
      topKey = key;
      topCount = count;
    }
  }
  return [topKey, topCount];
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function issue(key, severity, message, metric, threshold) {
  return { key, severity, message, metric, threshold };
}

function readRequired(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
  return value;
}

function readPositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function readRatio(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) throw new Error(`${flag} must be >= 0 and < 1.`);
  return parsed;
}
