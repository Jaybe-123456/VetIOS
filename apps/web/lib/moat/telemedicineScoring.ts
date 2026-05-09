export type TelemedicineUrgencyLevel = 'routine' | 'priority' | 'urgent' | 'emergency';

export interface TelemedicineVitals {
    temp_c?: number;
    hr_bpm?: number;
    rr_bpm?: number;
    mm_color?: string;
    cap_refill_s?: number;
}

export interface TelemedicineScoreInput {
    species: string;
    symptoms: string[];
    description?: string | null;
    vitals?: TelemedicineVitals | null;
}

export interface TelemedicineScoreResult {
    triage_score: number;
    urgency_level: TelemedicineUrgencyLevel;
    disposition: string;
    red_flags: string[];
    scoring_signals: string[];
}

const RED_FLAG_PATTERNS: Array<{ code: string; pattern: RegExp; weight: number }> = [
    { code: 'collapse_or_unresponsive', pattern: /\b(collapse|collapsed|unresponsive|non[-\s]?responsive|faint(?:ed|ing)?)\b/i, weight: 0.35 },
    { code: 'respiratory_distress', pattern: /\b(dyspnea|trouble breathing|difficulty breathing|gasping|cyanosis|blue gums?|open mouth breathing)\b/i, weight: 0.38 },
    { code: 'seizure_activity', pattern: /\b(seizure|seizing|convulsion|status epilepticus)\b/i, weight: 0.3 },
    { code: 'severe_bleeding_or_trauma', pattern: /\b(major trauma|hit by car|bleeding heavily|uncontrolled bleeding|penetrating wound)\b/i, weight: 0.34 },
    { code: 'toxin_exposure', pattern: /\b(toxin|poison|rat bait|xylitol|antifreeze|chocolate ingestion|lily ingestion)\b/i, weight: 0.28 },
    { code: 'bloat_or_gdv_signal', pattern: /\b(bloat|gdv|unproductive retching|distended abdomen|abdominal distension)\b/i, weight: 0.36 },
    { code: 'urinary_obstruction_signal', pattern: /\b(straining to urinate|cannot urinate|blocked cat|urinary blockage|no urine)\b/i, weight: 0.32 },
    { code: 'pale_or_blue_mucous_membranes', pattern: /\b(pale gums?|white gums?|blue gums?|cyanotic)\b/i, weight: 0.32 },
];

const SYMPTOM_WEIGHTS: Record<string, number> = {
    collapse: 0.32,
    dyspnea: 0.32,
    cyanosis: 0.3,
    seizure: 0.28,
    abdominal_distension: 0.25,
    pale_mucous_membranes: 0.25,
    tachycardia: 0.14,
    bradycardia: 0.18,
    fever: 0.12,
    hypothermia: 0.18,
    vomiting: 0.1,
    diarrhea: 0.08,
    lethargy: 0.08,
    anorexia: 0.06,
    pain_abdominal: 0.12,
};

export function scoreTelemedicineSymptoms(input: TelemedicineScoreInput): TelemedicineScoreResult {
    const description = input.description ?? '';
    const symptomSet = new Set(input.symptoms.map((symptom) => symptom.trim()).filter(Boolean));
    const redFlags = new Set<string>();
    const scoringSignals: string[] = [];
    let score = 0.08;

    for (const rule of RED_FLAG_PATTERNS) {
        if (!rule.pattern.test(description)) continue;
        redFlags.add(rule.code);
        score += rule.weight;
        scoringSignals.push(rule.code);
    }

    for (const symptom of symptomSet) {
        const weight = SYMPTOM_WEIGHTS[symptom] ?? 0.04;
        score += weight;
        scoringSignals.push(`symptom:${symptom}`);
        if (weight >= 0.25) redFlags.add(symptom);
    }

    const vitalSignals = scoreVitals(input.species, input.vitals ?? {});
    for (const signal of vitalSignals) {
        score += signal.weight;
        scoringSignals.push(signal.code);
        if (signal.redFlag) redFlags.add(signal.code);
    }

    const triageScore = clamp(Number(score.toFixed(3)), 0, 1);
    const urgencyLevel = triageScore >= 0.82 || redFlags.has('respiratory_distress')
        ? 'emergency'
        : triageScore >= 0.58
            ? 'urgent'
            : triageScore >= 0.35
                ? 'priority'
                : 'routine';

    return {
        triage_score: triageScore,
        urgency_level: urgencyLevel,
        disposition: dispositionFor(urgencyLevel),
        red_flags: Array.from(redFlags),
        scoring_signals: scoringSignals,
    };
}

function scoreVitals(species: string, vitals: TelemedicineVitals): Array<{ code: string; weight: number; redFlag?: boolean }> {
    const signals: Array<{ code: string; weight: number; redFlag?: boolean }> = [];
    const heartRate = vitals.hr_bpm;
    const respiratoryRate = vitals.rr_bpm;
    const temperature = vitals.temp_c;
    const mucousMembrane = vitals.mm_color?.toLowerCase();
    const capillaryRefill = vitals.cap_refill_s;

    if (temperature != null) {
        if (temperature >= 40.2) signals.push({ code: 'critical_fever', weight: 0.22, redFlag: true });
        else if (temperature >= 39.5) signals.push({ code: 'fever', weight: 0.12 });
        if (temperature <= 36.7) signals.push({ code: 'hypothermia', weight: 0.2, redFlag: true });
    }

    if (heartRate != null) {
        const high = species === 'feline' ? 240 : species === 'equine' ? 64 : 180;
        const low = species === 'feline' ? 100 : species === 'equine' ? 24 : 50;
        if (heartRate > high) signals.push({ code: 'marked_tachycardia', weight: 0.16 });
        if (heartRate < low) signals.push({ code: 'bradycardia', weight: 0.18, redFlag: true });
    }

    if (respiratoryRate != null) {
        const high = species === 'equine' ? 36 : 48;
        if (respiratoryRate > high) signals.push({ code: 'tachypnea_or_dyspnea_proxy', weight: 0.2, redFlag: respiratoryRate > high * 1.35 });
    }

    if (mucousMembrane === 'cyanotic') signals.push({ code: 'cyanotic_mucous_membranes', weight: 0.38, redFlag: true });
    if (mucousMembrane === 'pale' || mucousMembrane === 'muddy') signals.push({ code: 'poor_perfusion_mucous_membranes', weight: 0.24, redFlag: true });
    if (capillaryRefill != null && capillaryRefill > 3) signals.push({ code: 'prolonged_capillary_refill', weight: 0.2, redFlag: true });

    return signals;
}

function dispositionFor(urgencyLevel: TelemedicineUrgencyLevel) {
    if (urgencyLevel === 'emergency') return 'Immediate emergency referral or in-clinic stabilization is recommended.';
    if (urgencyLevel === 'urgent') return 'Same-day clinician review is recommended.';
    if (urgencyLevel === 'priority') return 'Prioritized appointment or clinician callback is recommended.';
    return 'Routine teleconsult follow-up is acceptable if signs remain stable.';
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
