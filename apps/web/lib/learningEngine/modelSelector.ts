import {
    type AdversarialEvaluationReport,
    type BenchmarkSummary,
    type ModelSelectionDecision,
} from '@/lib/learningEngine/types';

export interface ModelSelectionInput {
    candidateModelVersion: string;
    championModelVersion: string | null;
    candidateBenchmark: BenchmarkSummary | null;
    championBenchmark: BenchmarkSummary | null;
    candidateAdversarial: AdversarialEvaluationReport | null;
    championAdversarial: AdversarialEvaluationReport | null;
}

export function selectChampionChallengerDecision(
    input: ModelSelectionInput,
): ModelSelectionDecision {
    const reasons: string[] = [];

    if (!input.candidateBenchmark) {
        return {
            candidate_model: input.candidateModelVersion,
            champion_model: input.championModelVersion,
            decision: 'reject',
            reasons: ['No candidate benchmark summary was produced.'],
        };
    }

    if (!input.candidateBenchmark.pass) {
        reasons.push('Candidate benchmark suite did not meet promotion gates.');
    }
    if (input.candidateBenchmark.calibration_report?.recommendation.status === 'needs_recalibration') {
        reasons.push('Candidate requires recalibration before promotion.');
    }
    if (input.candidateAdversarial && !input.candidateAdversarial.pass) {
        reasons.push('Candidate regressed on adversarial safety checks.');
    }

    if (reasons.length > 0) {
        return {
            candidate_model: input.candidateModelVersion,
            champion_model: input.championModelVersion,
            decision: 'reject',
            reasons,
        };
    }

    if (!input.championBenchmark) {
        return {
            candidate_model: input.candidateModelVersion,
            champion_model: input.championModelVersion,
            decision: 'promote',
            reasons: ['No existing champion benchmark baseline was available, and the candidate passed all gates.'],
        };
    }

    const comparisonReasons = compareAgainstChampion(input);
    if (comparisonReasons.blockers.length > 0) {
        return {
            candidate_model: input.candidateModelVersion,
            champion_model: input.championModelVersion,
            decision: 'reject',
            reasons: comparisonReasons.blockers,
        };
    }

    if (comparisonReasons.improvements.length === 0) {
        return {
            candidate_model: input.candidateModelVersion,
            champion_model: input.championModelVersion,
            decision: 'hold',
            reasons: ['Candidate passed hard gates but did not materially improve on the current champion.'],
        };
    }

    return {
        candidate_model: input.candidateModelVersion,
        champion_model: input.championModelVersion,
        decision: 'promote',
        reasons: comparisonReasons.improvements,
    };
}

function compareAgainstChampion(input: ModelSelectionInput): {
    blockers: string[];
    improvements: string[];
} {
    const blockers: string[] = [];
    const improvements: string[] = [];
    const candidate = input.candidateBenchmark!;
    const champion = input.championBenchmark!;

    const candidateDiagnosis = candidate.diagnosis_metrics;
    const championDiagnosis = champion.diagnosis_metrics;
    const candidateSeverity = candidate.severity_metrics;
    const championSeverity = champion.severity_metrics;
    const candidateCalibration = candidate.calibration_report;
    const championCalibration = champion.calibration_report;

    if (candidateDiagnosis && championDiagnosis) {
        if (candidateDiagnosis.accuracy + 0.005 < championDiagnosis.accuracy) {
            blockers.push('Candidate diagnosis accuracy is below the current champion.');
        } else if (candidateDiagnosis.accuracy > championDiagnosis.accuracy + 0.01) {
            improvements.push('Diagnosis accuracy improved over the current champion.');
        }

        if (candidateDiagnosis.macro_f1 + 0.005 < championDiagnosis.macro_f1) {
            blockers.push('Candidate diagnosis macro F1 regressed relative to the current champion.');
        } else if (candidateDiagnosis.macro_f1 > championDiagnosis.macro_f1 + 0.01) {
            improvements.push('Diagnosis macro F1 improved over the current champion.');
        }

        const subgroupBlocker = subgroupRegression(
            candidateDiagnosis.subgroup_performance.species,
            championDiagnosis.subgroup_performance.species,
        ) ?? subgroupRegression(
            candidateDiagnosis.subgroup_performance.cluster,
            championDiagnosis.subgroup_performance.cluster,
        );
        if (subgroupBlocker) {
            blockers.push(subgroupBlocker);
        }
    }

    if (candidateSeverity && championSeverity) {
        if (candidateSeverity.critical_recall + 0.001 < championSeverity.critical_recall) {
            blockers.push('Candidate critical-case recall regressed relative to the current champion.');
        } else if (candidateSeverity.critical_recall > championSeverity.critical_recall + 0.01) {
            improvements.push('Critical-case recall improved over the current champion.');
        }

        if (candidateSeverity.emergency_false_negative_rate > championSeverity.emergency_false_negative_rate + 0.02) {
            blockers.push('Candidate emergency false-negative rate increased relative to the current champion.');
        } else if (candidateSeverity.emergency_false_negative_rate + 0.02 < championSeverity.emergency_false_negative_rate) {
            improvements.push('Emergency false-negative rate improved over the current champion.');
        }
    }

    if (candidateCalibration && championCalibration) {
        const candidateEce = candidateCalibration.expected_calibration_error;
        const championEce = championCalibration.expected_calibration_error;
        if (
            candidateEce != null &&
            championEce != null &&
            candidateEce > championEce + 0.02
        ) {
            blockers.push('Candidate calibration degraded relative to the current champion.');
        } else if (
            candidateEce != null &&
            championEce != null &&
            candidateEce + 0.01 < championEce
        ) {
            improvements.push('Calibration error improved over the current champion.');
        }
    }

    if (input.candidateAdversarial && input.championAdversarial) {
        if (
            input.candidateAdversarial.emergency_preservation_rate + 0.001 <
            input.championAdversarial.emergency_preservation_rate
        ) {
            blockers.push('Candidate adversarial emergency preservation regressed.');
        }
        if (
            input.candidateAdversarial.dangerous_false_reassurance_rate >
            input.championAdversarial.dangerous_false_reassurance_rate + 0.01
        ) {
            blockers.push('Candidate dangerous false reassurance increased on adversarial cases.');
        }
        if (
            input.candidateAdversarial.contradiction_detection_rate >
            input.championAdversarial.contradiction_detection_rate + 0.02
        ) {
            improvements.push('Contradiction detection improved on adversarial cases.');
        }
    }

    return { blockers, improvements };
}

function subgroupRegression(
    candidateGroups: Array<{ group: string; support: number; accuracy: number }>,
    championGroups: Array<{ group: string; support: number; accuracy: number }>,
): string | null {
    const championByGroup = new Map(championGroups.map((group) => [group.group, group]));
    for (const candidateGroup of candidateGroups) {
        const championGroup = championByGroup.get(candidateGroup.group);
        if (!championGroup) continue;
        if (candidateGroup.support < 3 || championGroup.support < 3) continue;
        if (candidateGroup.accuracy + 0.15 < championGroup.accuracy) {
            return `Candidate subgroup robustness regressed for ${candidateGroup.group}.`;
        }
    }
    return null;
}
