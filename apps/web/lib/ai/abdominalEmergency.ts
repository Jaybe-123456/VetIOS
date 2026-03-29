import type { ClinicalSignals } from '@/lib/ai/clinicalSignals';
import type { EmergencyRuleResult } from '@/lib/ai/emergencyRules';

export interface RankedDiagnosis {
    name: string;
    probability: number;
    key_drivers?: Array<{ feature: string; weight: number }>;
}

export interface MechanismClassOutput {
    label: 'Acute Mechanical Emergency' | 'Inflammatory Abdomen' | 'Toxicologic Syndrome' | 'Undifferentiated';
    confidence: number;
    drivers: Array<{ feature: string; weight: number }>;
}

export interface CatastrophicRiskOutput {
    definition: string;
    catastrophic_deterioration_risk_6h: number;
    operative_urgency_risk: number;
    shock_risk: number;
    legacy_ml_operational_risk: number | null;
}

export const GENERIC_MECHANISM_DIAGNOSES = new Set([
    'Acute Mechanical Emergency',
    'Acute Mechanical Gastrointestinal Emergency',
    'Acute Abdominal Emergency',
]);

const MECHANICAL_DIAGNOSIS_HINTS = [
    'gdv',
    'dilatation',
    'volvulus',
    'torsion',
    'obstruction',
];

export function isGenericMechanismDiagnosis(value: string | null | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return false;
    return [...GENERIC_MECHANISM_DIAGNOSES].some((entry) => entry.toLowerCase() === normalized);
}

export function hasPerfusionCompromise(signals: ClinicalSignals): boolean {
    return signals.evidence.collapse.present
        || signals.evidence.pale_mucous_membranes.present
        || signals.shock_pattern_strength >= 2;
}

export function hasClassicGdvPattern(signals: ClinicalSignals): boolean {
    return signals.has_deep_chested_breed_risk
        && signals.evidence.unproductive_retching.present
        && signals.evidence.abdominal_distension.present
        && signals.has_acute_onset;
}

export function hasAcuteAbdominalEmergencyPattern(signals: ClinicalSignals): boolean {
    if (hasClassicGdvPattern(signals) || signals.gdv_cluster_count >= 3) {
        return true;
    }

    const abdominalAnchorCount = [
        signals.evidence.unproductive_retching.present,
        signals.evidence.abdominal_distension.present,
        signals.evidence.abdominal_pain.present,
        signals.evidence.productive_vomiting.present,
    ].filter(Boolean).length;

    return abdominalAnchorCount >= 2
        && (
            signals.has_acute_onset
            || hasPerfusionCompromise(signals)
            || signals.evidence.tachycardia.present
            || signals.evidence.dyspnea.present
        );
}

export function hasEndocrineAnchorSignals(signals: ClinicalSignals): boolean {
    return signals.evidence.significant_hyperglycemia.present
        || signals.evidence.glucosuria.present
        || signals.evidence.ketonuria.present
        || signals.evidence.diabetic_metabolic_profile.present
        || signals.evidence.marked_alp_elevation.present
        || signals.evidence.supportive_acth_stimulation_test.present
        || (
            signals.has_chronic_duration
            && (
                signals.evidence.pot_bellied_appearance.present
                || signals.evidence.alopecia.present
                || signals.evidence.hypercholesterolemia.present
            )
        );
}

export function getSuppressedAcuteAbdominalFeatures(signals: ClinicalSignals): string[] {
    if (!hasAcuteAbdominalEmergencyPattern(signals) || hasEndocrineAnchorSignals(signals)) {
        return [];
    }

    return [
        'weight loss',
        'polyuria',
        'polydipsia',
        'polyphagia',
        'panting',
        'alopecia',
        'pot-bellied appearance',
    ];
}

export function shouldSuppressAcuteAbdominalFeature(signals: ClinicalSignals, feature: string): boolean {
    const normalized = feature.trim().toLowerCase().replace(/_/g, ' ');
    return getSuppressedAcuteAbdominalFeatures(signals)
        .some((entry) => entry.toLowerCase() === normalized);
}

export function severityFloorFromAbdominalSignals(
    signals: ClinicalSignals,
    emergencyEval: Pick<
        EmergencyRuleResult,
        'emergency_level' | 'catastrophic_risk_floor' | 'shock_risk_floor'
    >,
): number {
    if (hasClassicGdvPattern(signals) && hasPerfusionCompromise(signals)) {
        return 0.97;
    }
    if (hasClassicGdvPattern(signals) || signals.gdv_cluster_count >= 3) {
        return 0.93;
    }
    if (hasAcuteAbdominalEmergencyPattern(signals) && (hasPerfusionCompromise(signals) || emergencyEval.emergency_level === 'CRITICAL')) {
        return 0.88;
    }
    if (hasAcuteAbdominalEmergencyPattern(signals) || (emergencyEval.catastrophic_risk_floor ?? 0) >= 0.75) {
        return 0.76;
    }
    if ((emergencyEval.shock_risk_floor ?? 0) >= 0.65) {
        return 0.72;
    }
    return 0;
}

export function buildMechanismClassOutput(params: {
    signals: ClinicalSignals;
    differentials: RankedDiagnosis[];
    emergencyEval: EmergencyRuleResult;
}): MechanismClassOutput {
    const { signals, differentials, emergencyEval } = params;
    const topDiagnosis = differentials[0]?.name?.toLowerCase() ?? '';
    const topDiagnosisLooksMechanical = MECHANICAL_DIAGNOSIS_HINTS.some((hint) => topDiagnosis.includes(hint));
    const drivers: Array<{ feature: string; weight: number }> = [];

    if (signals.evidence.abdominal_distension.present) {
        drivers.push({ feature: 'abdominal distension', weight: 0.34 });
    }
    if (signals.evidence.unproductive_retching.present) {
        drivers.push({ feature: 'non-productive retching', weight: 0.36 });
    }
    if (signals.has_acute_onset) {
        drivers.push({ feature: 'acute onset', weight: 0.16 });
    }
    if (hasPerfusionCompromise(signals)) {
        drivers.push({ feature: 'perfusion compromise', weight: 0.18 });
    }

    if (hasAcuteAbdominalEmergencyPattern(signals) || topDiagnosisLooksMechanical || emergencyEval.mechanism_label === 'Acute Mechanical Emergency') {
        let confidence = 0.72;
        if (hasClassicGdvPattern(signals)) confidence += 0.12;
        if (hasPerfusionCompromise(signals)) confidence += 0.08;
        if (topDiagnosisLooksMechanical) confidence += 0.05;
        return {
            label: 'Acute Mechanical Emergency',
            confidence: clamp(confidence, 0.55, 0.98),
            drivers: drivers.sort((left, right) => right.weight - left.weight).slice(0, 4),
        };
    }

    if (
        signals.evidence.abdominal_pain.present
        && signals.evidence.fever.present
        && (signals.evidence.productive_vomiting.present || signals.evidence.weakness.present || hasPerfusionCompromise(signals))
    ) {
        return {
            label: 'Inflammatory Abdomen',
            confidence: 0.74,
            drivers: [
                { feature: 'abdominal pain', weight: 0.32 },
                { feature: 'fever', weight: 0.18 },
                { feature: signals.evidence.productive_vomiting.present ? 'vomiting' : 'weakness', weight: 0.14 },
            ],
        };
    }

    if (
        signals.evidence.hypersalivation.present
        && (signals.evidence.seizures.present || signals.evidence.collapse.present)
    ) {
        return {
            label: 'Toxicologic Syndrome',
            confidence: 0.7,
            drivers: [
                { feature: 'hypersalivation', weight: 0.22 },
                { feature: signals.evidence.seizures.present ? 'seizures' : 'collapse', weight: 0.18 },
            ],
        };
    }

    return {
        label: 'Undifferentiated',
        confidence: 0.32,
        drivers: [],
    };
}

export function buildCatastrophicRiskOutput(params: {
    signals: ClinicalSignals;
    emergencyEval: EmergencyRuleResult;
    severityScore: number;
    legacyOperationalRisk?: number | null;
}): CatastrophicRiskOutput {
    const { signals, emergencyEval, severityScore, legacyOperationalRisk = null } = params;
    let catastrophic = 0.18;
    let operative = 0.12;
    let shock = 0.08;

    if (signals.evidence.abdominal_distension.present) catastrophic += 0.22;
    if (signals.evidence.unproductive_retching.present) {
        catastrophic += 0.26;
        operative += 0.22;
    }
    if (signals.evidence.abdominal_pain.present) operative += 0.08;
    if (signals.has_deep_chested_breed_risk) catastrophic += 0.1;
    if (signals.has_acute_onset) catastrophic += 0.08;
    if (signals.evidence.recent_meal.present) operative += 0.04;
    if (signals.evidence.collapse.present) {
        catastrophic += 0.18;
        shock += 0.34;
    }
    if (signals.evidence.pale_mucous_membranes.present) shock += 0.24;
    if (signals.evidence.tachycardia.present) shock += 0.12;
    if (signals.evidence.dyspnea.present) shock += 0.1;
    if (signals.evidence.weakness.present) shock += 0.06;

    if (hasClassicGdvPattern(signals)) {
        catastrophic += 0.12;
        operative += 0.18;
    }

    catastrophic = Math.max(catastrophic, emergencyEval.catastrophic_risk_floor ?? 0);
    operative = Math.max(operative, emergencyEval.operative_urgency_floor ?? 0);
    shock = Math.max(shock, emergencyEval.shock_risk_floor ?? 0);

    if (severityScore >= 0.95) catastrophic = Math.max(catastrophic, 0.9);
    if (severityScore >= 0.88) operative = Math.max(operative, 0.84);
    if (severityScore >= 0.88 && hasPerfusionCompromise(signals)) shock = Math.max(shock, 0.82);

    return {
        definition: 'Risk predicts the short-horizon probability of catastrophic abdominal deterioration, urgent operative need, and shock progression if the syndrome is untreated.',
        catastrophic_deterioration_risk_6h: clamp(catastrophic, 0, 0.99),
        operative_urgency_risk: clamp(operative + (shock * 0.2), 0, 0.99),
        shock_risk: clamp(shock, 0, 0.99),
        legacy_ml_operational_risk: legacyOperationalRisk != null && Number.isFinite(legacyOperationalRisk)
            ? clamp(legacyOperationalRisk, 0, 1)
            : null,
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Number(value.toFixed(3))));
}
