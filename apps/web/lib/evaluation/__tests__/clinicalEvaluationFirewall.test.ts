import { describe, expect, it } from 'vitest';
import {
    createOptimizerMetricPacket,
    evaluateClinicalEvaluationFirewall,
    hashEvaluationDatasetRecords,
    sealEvaluationDatasetManifest,
    type ClinicalEvaluationFirewallInput,
    type ClinicalSafetyMetrics,
    type EvaluationDatasetManifestCore,
    type EvaluationDatasetRole,
    type EvaluationSplit,
    type OptimizationSurface,
} from '../clinicalEvaluationFirewall';

const RELEASE_POLICY = {
    minimum_release_rows: 4,
    minimum_sites: 2,
    minimum_subgroup_rows: 2,
    max_near_duplicate_comparisons: 1_000,
};

function makeRecord(
    id: string,
    vocabulary: string,
): Record<string, unknown> {
    return {
        species: vocabulary.startsWith('tundra') ? 'feline' : 'canine',
        breed: `${vocabulary} breed ${id}`,
        age_years: Number(id.replace(/\D/g, '')) + 1,
        presenting_complaint: `${vocabulary} complaint ${id}`,
        history: `${vocabulary} history signal ${id} isolated cohort vocabulary`,
        symptoms: [`${vocabulary}_sign_${id}`, `${vocabulary}_finding_${id}`],
        labs: {
            [`${vocabulary}_analyte_${id}`]: `${Number(id.replace(/\D/g, '')) + 10}`,
        },
    };
}

function makeSplit(input: {
    role: EvaluationDatasetRole;
    records: Array<Record<string, unknown>>;
    datasetId?: string;
    synthetic?: boolean;
    optimizerVisible?: boolean;
    holdoutAccessCount?: number;
    sealedAt?: string | null;
    featurePaths?: string[];
    targetPaths?: string[];
}): EvaluationSplit {
    const manifest: EvaluationDatasetManifestCore = {
        dataset_id: input.datasetId ?? `fixture-${input.role}`,
        version: '1.0.0',
        role: input.role,
        content_sha256: hashEvaluationDatasetRecords(input.records),
        row_count: input.records.length,
        site_count: 2,
        subgroup_counts: {
            canine: 2,
            feline: 2,
        },
        feature_paths: input.featurePaths ?? [
            'species',
            'breed',
            'history',
            'symptoms',
            'labs',
        ],
        target_paths: input.targetPaths ?? ['confirmed_diagnosis'],
        synthetic: input.synthetic ?? false,
        deidentified: true,
        data_use_authorized: true,
        provenance_complete: true,
        clinician_reviewed: true,
        outcome_confirmed: true,
        optimizer_visible: input.optimizerVisible ?? false,
        sealed_at: input.sealedAt
            ?? (input.role === 'sealed_holdout'
                ? '2026-07-28T00:00:00.000Z'
                : null),
        holdout_access_count: input.holdoutAccessCount ?? 0,
    };
    return {
        manifest: sealEvaluationDatasetManifest(manifest),
        records: input.records,
    };
}

function makeMetrics(
    overrides: Partial<ClinicalSafetyMetrics> = {},
): ClinicalSafetyMetrics {
    return {
        sample_count: 4,
        outcome_confirmed_count: 4,
        critical_recall: 0.98,
        dangerous_false_reassurance_rate: 0.005,
        contradiction_detection_rate: 0.98,
        abstain_accuracy: 0.95,
        ece: 0.02,
        brier_score: 0.08,
        subgroup_critical_recall: {
            canine: 0.96,
            feline: 0.95,
        },
        ...overrides,
    };
}

function makeReleaseInput(
    overrides: Partial<ClinicalEvaluationFirewallInput> = {},
): ClinicalEvaluationFirewallInput {
    return {
        intent: 'release',
        optimizer: null,
        optimization_surface: 'model_accuracy',
        splits: [
            makeSplit({
                role: 'validation',
                datasetId: 'validation-v1',
                records: [0, 1, 2, 3].map((index) =>
                    makeRecord(`v${index}`, 'orchard amber cedar')
                ),
            }),
            makeSplit({
                role: 'sealed_holdout',
                datasetId: 'holdout-v1',
                records: [0, 1, 2, 3].map((index) =>
                    makeRecord(`h${index}`, 'tundra cobalt quartz')
                ),
                holdoutAccessCount: 1,
            }),
        ],
        candidate_metrics: makeMetrics(),
        baseline_metrics: makeMetrics({
            ece: 0.019,
            brier_score: 0.079,
        }),
        policy: RELEASE_POLICY,
        ...overrides,
    };
}

describe('clinical evaluation firewall', () => {
    it('allows Weco only aggregate latency metrics over a hidden synthetic development split', () => {
        const decision = evaluateClinicalEvaluationFirewall({
            intent: 'optimize',
            optimizer: 'weco',
            optimization_surface: 'pure_function_latency',
            splits: [
                makeSplit({
                    role: 'development',
                    synthetic: true,
                    records: [makeRecord('1', 'synthetic emerald vector')],
                }),
            ],
        });

        expect(decision).toMatchObject({
            status: 'allowed',
            optimizer_access_allowed: true,
            clinical_claim_eligible: false,
            promotion_eligible: false,
            allowed_optimizer_metrics: ['latency_ms', 'throughput_rps'],
        });
        expect(decision.warnings).toContain('synthetic_evidence_is_benchmark_only');

        expect(createOptimizerMetricPacket({
            decision,
            metric_name: 'latency_ms',
            metric_value: 12.25,
            goal: 'minimize',
        })).toEqual({
            firewall_decision_id: decision.decision_id,
            metric_name: 'latency_ms',
            metric_value: 12.25,
            goal: 'minimize',
        });
        expect(() => createOptimizerMetricPacket({
            decision,
            metric_name: 'latency_ms',
            metric_value: 12.25,
            goal: 'maximize',
        })).toThrow('optimizer_metric_goal_mismatch');
    });

    it.each<OptimizationSurface>(['model_accuracy', 'prompt'])(
        'blocks Weco from the %s surface',
        (optimizationSurface) => {
            const decision = evaluateClinicalEvaluationFirewall({
                intent: 'optimize',
                optimizer: 'weco',
                optimization_surface: optimizationSurface,
                splits: [
                    makeSplit({
                        role: 'development',
                        synthetic: true,
                        records: [makeRecord('1', 'synthetic emerald vector')],
                    }),
                ],
            });

            expect(decision.status).toBe('blocked');
            expect(decision.optimizer_access_allowed).toBe(false);
            expect(decision.blockers).toContain('optimizer_surface_not_approved');
            expect(decision.blockers).toContain(
                optimizationSurface === 'prompt'
                    ? 'weco_prompt_optimization_forbidden'
                    : 'weco_model_accuracy_forbidden',
            );
        },
    );

    it('blocks optimizer runs without a nonempty declared dataset', () => {
        const missing = evaluateClinicalEvaluationFirewall({
            intent: 'optimize',
            optimizer: 'weco',
            optimization_surface: 'pure_function_latency',
            splits: [],
        });
        const empty = evaluateClinicalEvaluationFirewall({
            intent: 'optimize',
            optimizer: 'weco',
            optimization_surface: 'pure_function_latency',
            splits: [
                makeSplit({
                    role: 'development',
                    synthetic: true,
                    records: [],
                }),
            ],
        });

        expect(missing.blockers).toContain('optimization_dataset_missing');
        expect(empty.blockers).toContain('optimization_dataset_empty');
    });

    it('detects exact and near-duplicate leakage between iterative splits', () => {
        const exact = makeRecord('1', 'shared copper signal history sequence');
        const near = {
            ...exact,
            breed: 'shared copper signal history sequence altered',
        };
        const decision = evaluateClinicalEvaluationFirewall({
            intent: 'optimize',
            optimizer: 'internal-benchmark-runner',
            optimization_surface: 'pure_function_latency',
            splits: [
                makeSplit({
                    role: 'search',
                    synthetic: true,
                    datasetId: 'search-v1',
                    records: [exact],
                }),
                makeSplit({
                    role: 'development',
                    synthetic: true,
                    datasetId: 'development-v1',
                    records: [exact, near],
                }),
            ],
            policy: {
                near_duplicate_threshold: 0.6,
            },
        });

        expect(decision.status).toBe('blocked');
        expect(decision.blockers).toEqual(expect.arrayContaining([
            'exact_split_leakage',
            'near_duplicate_split_leakage',
        ]));
        expect(decision.audit.exact_overlap_count).toBeGreaterThan(0);
        expect(decision.audit.near_duplicate_count).toBeGreaterThan(0);
    });

    it('blocks sensitive and secret material without echoing raw values', () => {
        const sensitiveEmail = 'owner.private@example.com';
        const secret = 'sk_super_private_test_value_123456789';
        const decision = evaluateClinicalEvaluationFirewall({
            intent: 'optimize',
            optimizer: 'weco',
            optimization_surface: 'pure_function_latency',
            splits: [
                makeSplit({
                    role: 'development',
                    synthetic: true,
                    records: [{
                        ...makeRecord('1', 'synthetic safe vector'),
                        owner: {
                            name: 'Private Owner',
                            email: sensitiveEmail,
                        },
                        history: `contact ${sensitiveEmail}`,
                        api_key: secret,
                    }],
                }),
            ],
        });
        const serialized = JSON.stringify(decision);

        expect(decision.blockers).toEqual(expect.arrayContaining([
            'sensitive_fields_present',
            'secret_material_present',
        ]));
        expect(decision.audit.sensitive_finding_count).toBeGreaterThanOrEqual(3);
        expect(serialized).not.toContain(sensitiveEmail);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('Private Owner');
    });

    it('blocks feature-target overlap and target-shaped input features', () => {
        const decision = evaluateClinicalEvaluationFirewall({
            intent: 'optimize',
            optimizer: 'weco',
            optimization_surface: 'pure_function_latency',
            splits: [
                makeSplit({
                    role: 'development',
                    synthetic: true,
                    records: [makeRecord('1', 'synthetic leakage vector')],
                    featurePaths: ['symptoms', 'confirmed_diagnosis'],
                    targetPaths: ['confirmed_diagnosis'],
                }),
            ],
        });

        expect(decision.blockers).toEqual(expect.arrayContaining([
            'feature_target_overlap',
            'target_like_feature_path',
        ]));
    });

    it('never admits synthetic evidence to clinical claims or promotion', () => {
        const input = makeReleaseInput();
        input.splits = input.splits.map((split) => ({
            ...split,
            manifest: sealEvaluationDatasetManifest({
                ...split.manifest,
                synthetic: true,
                manifest_sha256: undefined,
            } as unknown as EvaluationDatasetManifestCore),
        }));
        const decision = evaluateClinicalEvaluationFirewall(input);

        expect(decision.status).toBe('blocked');
        expect(decision.clinical_claim_eligible).toBe(false);
        expect(decision.promotion_eligible).toBe(false);
        expect(decision.blockers).toContain(
            'synthetic_rows_not_clinical_claim_eligible',
        );
    });

    it('admits one sealed, optimizer-blind, outcome-confirmed release cohort', () => {
        const decision = evaluateClinicalEvaluationFirewall(makeReleaseInput());

        expect(decision).toMatchObject({
            status: 'allowed',
            optimizer_access_allowed: false,
            clinical_claim_eligible: true,
            promotion_eligible: true,
        });
        expect(decision.blockers).toEqual([]);
        expect(decision.audit).toMatchObject({
            split_count: 2,
            row_count: 8,
            exact_overlap_count: 0,
            near_duplicate_count: 0,
            manifest_failure_count: 0,
        });
    });

    it('blocks unsafe, miscalibrated, and regressed candidate evidence', () => {
        const decision = evaluateClinicalEvaluationFirewall(makeReleaseInput({
            candidate_metrics: makeMetrics({
                critical_recall: 0.8,
                dangerous_false_reassurance_rate: 0.04,
                contradiction_detection_rate: 0.7,
                abstain_accuracy: 0.6,
                ece: 0.08,
                brier_score: 0.2,
                subgroup_critical_recall: {
                    canine: 0.75,
                    feline: 0.7,
                },
            }),
        }));

        expect(decision.blockers).toEqual(expect.arrayContaining([
            'critical_recall_below_floor',
            'dangerous_false_reassurance_above_ceiling',
            'contradiction_detection_below_floor',
            'abstain_accuracy_below_floor',
            'subgroup_critical_recall_below_floor',
            'ece_above_ceiling',
            'brier_score_above_ceiling',
            'ece_regression',
            'brier_score_regression',
        ]));
    });

    it('detects manifest tampering after sealing', () => {
        const split = makeSplit({
            role: 'development',
            synthetic: true,
            records: [makeRecord('1', 'synthetic tamper vector')],
        });
        split.records[0].history = 'tampered after the content hash was sealed';

        const decision = evaluateClinicalEvaluationFirewall({
            intent: 'optimize',
            optimizer: 'weco',
            optimization_surface: 'pure_function_latency',
            splits: [split],
        });

        expect(decision.blockers).toEqual(expect.arrayContaining([
            'dataset_content_hash_mismatch',
        ]));
        expect(decision.audit.manifest_failure_count).toBe(1);
    });

    it('blocks optimizer-visible or reused sealed holdouts', () => {
        const input = makeReleaseInput();
        input.splits[1] = makeSplit({
            role: 'sealed_holdout',
            datasetId: 'compromised-holdout-v1',
            records: [0, 1, 2, 3].map((index) =>
                makeRecord(`h${index}`, 'tundra cobalt quartz')
            ),
            optimizerVisible: true,
            holdoutAccessCount: 2,
        });

        const decision = evaluateClinicalEvaluationFirewall(input);

        expect(decision.blockers).toEqual(expect.arrayContaining([
            'holdout_optimizer_visible',
            'holdout_reused',
        ]));
    });

    it('binds decisions to the exact sealed datasets and reported metrics', () => {
        const first = evaluateClinicalEvaluationFirewall(makeReleaseInput());
        const changed = makeReleaseInput({
            candidate_metrics: makeMetrics({
                critical_recall: 0.97,
            }),
        });
        const second = evaluateClinicalEvaluationFirewall(changed);

        expect(first.decision_id).not.toBe(second.decision_id);
    });

    it('blocks metric evidence that does not match the sealed holdout cohort', () => {
        const decision = evaluateClinicalEvaluationFirewall(makeReleaseInput({
            candidate_metrics: makeMetrics({
                sample_count: 5,
                outcome_confirmed_count: 4,
            }),
        }));

        expect(decision.blockers).toEqual(expect.arrayContaining([
            'metric_cohort_manifest_mismatch',
            'metric_cohort_not_fully_outcome_confirmed',
        ]));
    });
});
