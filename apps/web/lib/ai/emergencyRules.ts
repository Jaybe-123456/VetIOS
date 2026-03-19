import { extractClinicalSignals, getFeatureLabel, type SignalKey } from '@/lib/ai/clinicalSignals';

export type EmergencyLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export interface EmergencyRuleResult {
    emergency_level: EmergencyLevel;
    severity_boost: number;
    emergency_rule_triggered: boolean;
    emergency_rule_reasons: string[];
    promoted_differentials: string[];
    persistence_boosts: Record<string, number>;
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

    const gdvPersistenceTriggered =
        signals.gdv_cluster_count >= 3 ||
        (
            signals.evidence.unproductive_retching.present &&
            signals.evidence.abdominal_distension.present &&
            (signals.evidence.collapse.present || signals.shock_pattern_strength >= 2)
        ) ||
        (
            signals.has_deep_chested_breed_risk &&
            signals.evidence.abdominal_distension.present &&
            signals.evidence.unproductive_retching.present
        );

    if (gdvPersistenceTriggered) {
        reasons.push('GDV persistence rule activated due to clustered high-risk abdominal emergency signals');
        for (const differential of [
            'Gastric Dilatation-Volvulus (GDV)',
            'Acute Mechanical Emergency',
            'Simple Gastric Dilatation',
            'Mesenteric Volvulus',
        ]) {
            promotedDifferentials.add(differential);
        }
        persistenceBoosts['Gastric Dilatation-Volvulus (GDV)'] = 0.32;
        persistenceBoosts['Acute Mechanical Emergency'] = 0.28;
        persistenceBoosts['Simple Gastric Dilatation'] = 0.18;
        persistenceBoosts['Mesenteric Volvulus'] = 0.14;
        maxLevel = 'CRITICAL';
        severityBoost = Math.max(severityBoost, 0.6);
    }

    for (const signal of ESCALATION_SIGNS) {
        if (!signals.evidence[signal].present) continue;
        reasons.push(`High-risk sign detected: ${getFeatureLabel(signal)}`);
        maxLevel = elevateLevel(maxLevel, signal === 'collapse' || signal === 'pale_mucous_membranes' ? 'CRITICAL' : 'HIGH');
        severityBoost = Math.max(severityBoost, signal === 'collapse' ? 0.35 : 0.25);
    }

    if (signals.evidence.hypersalivation.present && signals.evidence.seizures.present) {
        reasons.push('Potential toxin syndrome detected from hypersalivation plus neurologic collapse');
        promotedDifferentials.add('Toxic Ingestion');
        persistenceBoosts['Toxic Ingestion'] = 0.18;
        maxLevel = elevateLevel(maxLevel, 'HIGH');
        severityBoost = Math.max(severityBoost, 0.25);
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
    };
}

function elevateLevel(current: EmergencyLevel, target: EmergencyLevel): EmergencyLevel {
    const levels: EmergencyLevel[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
    return levels.indexOf(target) > levels.indexOf(current) ? target : current;
}
