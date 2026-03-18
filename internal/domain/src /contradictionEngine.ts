/**
 * @vetios/domain — Contradiction Engine (Fix 4)
 *
 * Detects mutually exclusive clinical signals and gates the abstention decision.
 *
 * Design:
 *   - Pure functions, no I/O
 *   - Each contradiction pair has a clinical reason logged to telemetry
 *   - Score is normalised via sigmoid compression so multiple weak conflicts
 *     do not trivially push past the threshold
 *   - Abstain threshold is configurable per deployment
 */

import type { ContradictionOutput, ContradictionPairResult } from './types';

// ─── Pair Definition ──────────────────────────────────────────────────────────

interface ContradictionPair {
    /** Unique ID — persisted in telemetry. */
    pair_id:         string;
    symptom_a:       string;
    symptom_b:       string;
    /**
     * 0–1: how irreconcilable this pair is when both are present.
     * 1.0 = physically impossible to have both (e.g. polyuria + anuria).
     * 0.7 = clinically very unlikely, warrants investigation.
     */
    conflict_weight: number;
    /** Clinician-readable explanation shown in UI. */
    reason:          string;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Above this → abstain = YES, route to escalation. */
const ABSTAIN_THRESHOLD = 0.55;

/** Above this → flag for review but still output suggestions. */
const FLAG_THRESHOLD = 0.30;

// ─── Known Contradictory Pairs ────────────────────────────────────────────────

const CONTRADICTION_PAIRS: ContradictionPair[] = [
    {
        pair_id:         'productive_vs_unproductive_retching',
        symptom_a:       'productive_vomiting',
        symptom_b:       'non_productive_retching',
        conflict_weight: 0.90,
        reason:          'Productive vomiting and non-productive retching are mutually exclusive. Non-productive retching (without expulsion) is the key discriminator for GDV. Clarify which is occurring.',
    },
    {
        pair_id:         'normal_appetite_severe_pain',
        symptom_a:       'normal_appetite',
        symptom_b:       'severe_abdominal_pain',
        conflict_weight: 0.80,
        reason:          'Normal appetite is inconsistent with severe acute abdominal pain. Appetite assessment may be inaccurate or pain assessment may be misclassified.',
    },
    {
        pair_id:         'polyuria_vs_anuric',
        symptom_a:       'polyuria',
        symptom_b:       'no_urine_output',
        conflict_weight: 1.00,
        reason:          'Polyuria and anuria are physically mutually exclusive urine output states. Data entry error or two separate conditions over different timeframes.',
    },
    {
        pair_id:         'bradycardia_vs_tachycardia',
        symptom_a:       'bradycardia',
        symptom_b:       'tachycardia',
        conflict_weight: 1.00,
        reason:          'Heart rate cannot simultaneously be high and low. Resolve before continuing — measurement or recording error likely.',
    },
    {
        pair_id:         'normal_hydration_vs_severe_dehydration',
        symptom_a:       'normal_hydration',
        symptom_b:       'severe_dehydration',
        conflict_weight: 0.95,
        reason:          'Hydration status is categorical. Cannot be simultaneously normal and severely dehydrated. Re-assess skin turgor and mucous membrane moisture.',
    },
    {
        pair_id:         'alert_vs_obtunded',
        symptom_a:       'alert_and_responsive',
        symptom_b:       'obtunded',
        conflict_weight: 0.85,
        reason:          'Mentation status conflict — alert/responsive and obtunded are incompatible. Clarify current neurological status.',
    },
    {
        pair_id:         'diarrhoea_vs_constipation',
        symptom_a:       'diarrhoea',
        symptom_b:       'constipation',
        conflict_weight: 0.70,
        reason:          'Concurrent diarrhoea and constipation requires disambiguation. Could indicate partial obstruction with overflow — obtain abdominal radiograph.',
    },
    {
        pair_id:         'normal_temp_vs_hyperthermia',
        symptom_a:       'normal_temperature',
        symptom_b:       'hyperthermia',
        conflict_weight: 0.95,
        reason:          'Temperature cannot be simultaneously normal and elevated. Retake temperature — equipment calibration or timing issue.',
    },
    {
        pair_id:         'normal_temp_vs_hypothermia',
        symptom_a:       'normal_temperature',
        symptom_b:       'hypothermia',
        conflict_weight: 0.95,
        reason:          'Temperature cannot be simultaneously normal and below-range. Retake temperature.',
    },
    {
        pair_id:         'hyperthermia_vs_hypothermia',
        symptom_a:       'hyperthermia',
        symptom_b:       'hypothermia',
        conflict_weight: 1.00,
        reason:          'Temperature cannot be simultaneously elevated and depressed. Measurement error — retake immediately.',
    },
    {
        pair_id:         'normal_mm_vs_cyanosis',
        symptom_a:       'normal_mucous_membranes',
        symptom_b:       'cyanosis',
        conflict_weight: 0.90,
        reason:          'Normal mucous membrane colour is incompatible with cyanosis. Reassess — cyanosis indicates severe hypoxaemia requiring immediate oxygen.',
    },
    {
        pair_id:         'polyphagia_vs_anorexia',
        symptom_a:       'polyphagia',
        symptom_b:       'anorexia',
        conflict_weight: 0.85,
        reason:          'Polyphagia (increased appetite) and anorexia (no appetite) are contradictory appetite states over the same timeframe.',
    },
    {
        pair_id:         'normal_resp_vs_dyspnoea',
        symptom_a:       'normal_breathing',
        symptom_b:       'dyspnoea',
        conflict_weight: 0.88,
        reason:          'Normal breathing pattern is incompatible with dyspnoea. Reassess respiratory effort, rate, and pattern.',
    },
];

// ─── Core Detection Function ──────────────────────────────────────────────────

/**
 * Detects contradictions in the reported symptom set.
 *
 * @param presentSymptoms - normalised symptom keys (snake_case, lowercase)
 * @param symptomWeights  - optional confidence weights per symptom (0–1). Defaults 1.0.
 */
export function detectContradictions(
    presentSymptoms: string[],
    symptomWeights?: Record<string, number>,
): ContradictionOutput {
    const symptomSet = normaliseSymptomSet(presentSymptoms);
    const weights = symptomWeights ?? {};

    const activeConflicts: ContradictionPairResult[] = [];
    let rawScore = 0;

    for (const pair of CONTRADICTION_PAIRS) {
        const aPresent = symptomSet.has(pair.symptom_a);
        const bPresent = symptomSet.has(pair.symptom_b);
        if (!aPresent || !bPresent) continue;

        // Scale by the lower of the two symptom confidence weights
        const wA = weights[pair.symptom_a] ?? 1.0;
        const wB = weights[pair.symptom_b] ?? 1.0;
        const contribution = pair.conflict_weight * Math.min(wA, wB);

        rawScore += contribution;
        activeConflicts.push({
            symptom_a:        pair.symptom_a,
            symptom_b:        pair.symptom_b,
            conflict_weight:  pair.conflict_weight,
            reason:           pair.reason,
            score_contribution: round4(contribution),
        });
    }

    // Sigmoid-like normalisation: prevents multiple weak conflicts from
    // trivially exceeding the threshold while preserving single-pair severity.
    const contradiction_score = round4(Math.min(rawScore / (rawScore + 1), 1));

    const should_abstain = contradiction_score >= ABSTAIN_THRESHOLD;
    const should_flag    = contradiction_score >= FLAG_THRESHOLD;

    const recommended_action =
        should_abstain ? 'abstain_and_escalate' :
        should_flag    ? 'flag_for_review' :
                         'proceed';

    const contradiction_summary = buildSummary(
        contradiction_score, activeConflicts, recommended_action,
    );

    return {
        contradiction_score,
        should_abstain,
        recommended_action,
        active_conflicts: activeConflicts,
        contradiction_summary,
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseSymptomSet(symptoms: string[]): Set<string> {
    return new Set(
        symptoms.map((s) => s.toLowerCase().replace(/[\s-]+/g, '_')),
    );
}

function round4(n: number): number {
    return Math.round(n * 10000) / 10000;
}

function buildSummary(
    score: number,
    conflicts: ContradictionPairResult[],
    action: ContradictionOutput['recommended_action'],
): string {
    if (conflicts.length === 0) {
        return 'No contradictory signals detected. Clinical data is internally consistent.';
    }

    const actionText = {
        proceed:               'Proceeding with inference — flag findings for clinician review.',
        flag_for_review:       'Output flagged for clinician review before acting on recommendations.',
        abstain_and_escalate:  'Abstaining from recommendation. Clinical data requires clarification before AI guidance should be followed. Escalate to senior clinician.',
    }[action];

    const conflictList = conflicts
        .map((c) => `• ${c.symptom_a} ↔ ${c.symptom_b} (${c.reason})`)
        .join('\n');

    return (
        `Contradiction score: ${(score * 100).toFixed(1)}% — ${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} detected.\n` +
        conflictList + '\n' +
        actionText
    );
}

/** Returns list of all known contradiction pair IDs — used in tests. */
export function listContradictionPairs(): Array<Pick<ContradictionPair, 'pair_id' | 'symptom_a' | 'symptom_b'>> {
    return CONTRADICTION_PAIRS.map(({ pair_id, symptom_a, symptom_b }) => ({
        pair_id, symptom_a, symptom_b,
    }));
}
