import { extractClinicalSignals, getFeatureLabel, type SignalKey } from '@/lib/ai/clinicalSignals';

export type EmergencyLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export interface EmergencyRuleResult {
    emergency_level: EmergencyLevel;
    severity_boost: number;
    emergency_rule_triggered: boolean;
    emergency_rule_reasons: string[];
    promoted_differentials: string[];
    persistence_boosts: Record<string, number>;
    mechanism_label: 'Acute Mechanical Emergency' | 'Inflammatory Abdomen' | 'Toxicologic Syndrome' | null;
    mechanism_confidence: number;
    catastrophic_risk_floor: number;
    operative_urgency_floor: number;
    shock_risk_floor: number;
}

const ESCALATION_SIGNS: SignalKey[] = [
    'collapse',
    'pale_mucous_membranes',
    'tachycardia',
    'dyspnea',
    'weakness',
    'seizures',
];

export function evaluateEmergencyRules(inputSignature: Record<string, unknown>): EmergencyRuleResult {
    const signals = extractClinicalSignals(inputSignature);
    const reasons: string[] = [];
    const promotedDifferentials = new Set<string>();
    const persistenceBoosts: Record<string, number> = {};
    let maxLevel: EmergencyLevel = 'LOW';
    let severityBoost = 0;
    let mechanismLabel: EmergencyRuleResult['mechanism_label'] = null;
    let mechanismConfidence = 0;
    let catastrophicRiskFloor = 0;
    let operativeUrgencyFloor = 0;
    let shockRiskFloor = 0;

    const gdvPersistenceTriggered =
        signals.gdv_cluster_count >= 3 ||
        (
            signals.evidence.unproductive_retching.present &&
            signals.evidence.abdominal_distension.present &&
            (signals.evidence.collapse.present || signals.shock_pattern_strength >= 2 || signals.has_acute_onset)
        ) ||
        (
            signals.has_deep_chested_breed_risk &&
            signals.evidence.abdominal_distension.present &&
            signals.evidence.unproductive_retching.present &&
            signals.has_acute_onset
        );

    if (gdvPersistenceTriggered) {
        reasons.push('GDV persistence rule activated due to clustered high-risk abdominal emergency signals');
        for (const differential of [
            'Gastric Dilatation-Volvulus (GDV)',
            'Simple Gastric Dilatation',
            'Mesenteric Volvulus',
            'Foreign Body Obstruction',
        ]) {
            promotedDifferentials.add(differential);
        }
        persistenceBoosts['Gastric Dilatation-Volvulus (GDV)'] = signals.has_deep_chested_breed_risk && signals.has_acute_onset ? 0.54 : 0.4;
        persistenceBoosts['Simple Gastric Dilatation'] = 0.12;
        persistenceBoosts['Mesenteric Volvulus'] = 0.1;
        persistenceBoosts['Foreign Body Obstruction'] = 0.08;
        mechanismLabel = 'Acute Mechanical Emergency';
        mechanismConfidence = signals.has_deep_chested_breed_risk && signals.has_acute_onset ? 0.96 : 0.88;
        catastrophicRiskFloor = signals.has_deep_chested_breed_risk && signals.has_acute_onset ? 0.9 : 0.82;
        operativeUrgencyFloor = signals.has_deep_chested_breed_risk && signals.has_acute_onset ? 0.88 : 0.76;
        shockRiskFloor = signals.evidence.collapse.present || signals.evidence.pale_mucous_membranes.present ? 0.82 : 0.58;
        maxLevel = 'CRITICAL';
        severityBoost = Math.max(severityBoost, 0.6);
    }

    for (const signal of ESCALATION_SIGNS) {
        if (!signals.evidence[signal].present) continue;
        reasons.push(`High-risk sign detected: ${getFeatureLabel(signal)}`);
        maxLevel = elevateLevel(maxLevel, signal === 'collapse' || signal === 'pale_mucous_membranes' ? 'CRITICAL' : 'HIGH');
        severityBoost = Math.max(severityBoost, signal === 'collapse' ? 0.35 : 0.25);
        if (signal === 'collapse' || signal === 'pale_mucous_membranes') {
            shockRiskFloor = Math.max(shockRiskFloor, 0.8);
        } else if (signal === 'tachycardia' || signal === 'dyspnea') {
            shockRiskFloor = Math.max(shockRiskFloor, 0.62);
        }
    }

    if (signals.evidence.hypersalivation.present && signals.evidence.seizures.present) {
        reasons.push('Potential toxin syndrome detected from hypersalivation plus neurologic collapse');
        promotedDifferentials.add('Toxic Ingestion');
        persistenceBoosts['Toxic Ingestion'] = 0.18;
        mechanismLabel = mechanismLabel ?? 'Toxicologic Syndrome';
        mechanismConfidence = Math.max(mechanismConfidence, 0.72);
        maxLevel = elevateLevel(maxLevel, 'HIGH');
        severityBoost = Math.max(severityBoost, 0.25);
    }

    if (
        !gdvPersistenceTriggered
        && signals.evidence.abdominal_pain.present
        && signals.evidence.fever.present
        && (signals.evidence.productive_vomiting.present || signals.evidence.collapse.present || signals.evidence.weakness.present)
    ) {
        mechanismLabel = mechanismLabel ?? 'Inflammatory Abdomen';
        mechanismConfidence = Math.max(mechanismConfidence, 0.74);
        catastrophicRiskFloor = Math.max(catastrophicRiskFloor, 0.58);
        operativeUrgencyFloor = Math.max(operativeUrgencyFloor, 0.4);
    }

    if (signals.distemper_pattern_strength >= 2.5) {
        reasons.push('Neuro-respiratory infectious emergency pattern detected');
        promotedDifferentials.add('Canine Distemper');
        persistenceBoosts['Canine Distemper'] = 0.16;
        maxLevel = elevateLevel(maxLevel, 'HIGH');
        severityBoost = Math.max(severityBoost, 0.2);
    }

    return {
        emergency_level: maxLevel,
        severity_boost: severityBoost,
        emergency_rule_triggered: reasons.length > 0,
        emergency_rule_reasons: reasons,
        promoted_differentials: [...promotedDifferentials],
        persistence_boosts: persistenceBoosts,
        mechanism_label: mechanismLabel,
        mechanism_confidence: Number(mechanismConfidence.toFixed(3)),
        catastrophic_risk_floor: Number(catastrophicRiskFloor.toFixed(3)),
        operative_urgency_floor: Number(operativeUrgencyFloor.toFixed(3)),
        shock_risk_floor: Number(shockRiskFloor.toFixed(3)),
    };
}

function elevateLevel(current: EmergencyLevel, target: EmergencyLevel): EmergencyLevel {
    const levels: EmergencyLevel[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
    return levels.indexOf(target) > levels.indexOf(current) ? target : current;
}
