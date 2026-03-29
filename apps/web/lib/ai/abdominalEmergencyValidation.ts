export interface AbdominalValidationCase {
    id: string;
    label: string;
    input_signature: Record<string, unknown>;
    expected_top_diagnosis: string;
    expected_emergency_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
    expected_behavior: string;
    failure_indicator: string;
}

export interface AbdominalValidationResult {
    case_id: string;
    top_diagnosis_match: boolean;
    emergency_match: boolean;
    failure_detected: boolean;
    notes: string[];
}

export const ABDOMINAL_VALIDATION_CASES: AbdominalValidationCase[] = [
    {
        id: 'classic_gdv',
        label: 'Clean classic GDV',
        input_signature: {
            species: 'dog',
            breed: 'Great Dane',
            duration_days: 0.2,
            symptoms: [
                'non-productive retching',
                'abdominal distension',
                'hypersalivation',
                'weakness',
                'tachycardia',
                'pale mucous membranes',
            ],
            acute_onset: true,
            recent_meal: true,
        },
        expected_top_diagnosis: 'Gastric Dilatation-Volvulus (GDV)',
        expected_emergency_level: 'CRITICAL',
        expected_behavior: 'GDV should dominate with a wide margin; catastrophic and operative risks should both be very high.',
        failure_indicator: 'Generic mechanism label or benign gastric diagnosis outranks GDV, or catastrophic risk is low.',
    },
    {
        id: 'gdv_disguised_as_gastritis',
        label: 'GDV disguised as gastritis',
        input_signature: {
            species: 'dog',
            breed: 'Standard Poodle',
            duration_days: 0.3,
            symptoms: [
                'trying to vomit but nothing comes out',
                'drooling',
                'bloated',
                'restless',
                'tachycardia',
            ],
            notes: 'Started suddenly after dinner. Owner thought it was gastritis.',
            acute_onset: true,
            recent_meal: true,
        },
        expected_top_diagnosis: 'Gastric Dilatation-Volvulus (GDV)',
        expected_emergency_level: 'CRITICAL',
        expected_behavior: 'Retaining the mechanical emergency signal should prevent gastritis-style drift.',
        failure_indicator: 'Vomiting syndrome or gastroenteritis outranks GDV when retching plus distension is present.',
    },
    {
        id: 'simple_gastric_dilatation',
        label: 'Simple gastric dilatation',
        input_signature: {
            species: 'dog',
            breed: 'German Shepherd',
            duration_days: 0.4,
            symptoms: [
                'abdominal distension',
                'drooling',
                'mild weakness',
            ],
            notes: 'Started after a large meal, still ambulatory, pink gums, no collapse, no dry heaving.',
            recent_meal: true,
            acute_onset: true,
        },
        expected_top_diagnosis: 'Simple Gastric Dilatation',
        expected_emergency_level: 'HIGH',
        expected_behavior: 'Distension should stay mechanical, but the absence of perfusion collapse should prevent full GDV escalation.',
        failure_indicator: 'GDV dominates without retching/perfusion support or CRITICAL is assigned reflexively.',
    },
    {
        id: 'intestinal_obstruction_disguised_as_gastroenteritis',
        label: 'Intestinal obstruction disguised as gastroenteritis',
        input_signature: {
            species: 'dog',
            breed: 'Labrador Retriever',
            duration_days: 1,
            symptoms: [
                'vomiting',
                'abdominal pain',
                'anorexia',
                'weakness',
            ],
            notes: 'Swallowed part of a toy yesterday. Mild abdominal distension but no dry heaving.',
            acute_onset: true,
        },
        expected_top_diagnosis: 'Foreign Body Obstruction',
        expected_emergency_level: 'HIGH',
        expected_behavior: 'Productive vomiting plus foreign material context should beat simple gastroenteritis.',
        failure_indicator: 'Gastroenteritis remains top or GDV fires on vomiting alone.',
    },
    {
        id: 'peritonitis_with_misleading_vomiting_history',
        label: 'Peritonitis with misleading vomiting history',
        input_signature: {
            species: 'dog',
            breed: 'Mixed breed',
            duration_days: 1,
            symptoms: [
                'abdominal pain',
                'fever',
                'weakness',
                'tachycardia',
                'pale mucous membranes',
            ],
            notes: 'Vomited once overnight but now painful, weak, and febrile with guarded abdomen.',
            acute_onset: true,
        },
        expected_top_diagnosis: 'Peritonitis / Septic Abdomen',
        expected_emergency_level: 'CRITICAL',
        expected_behavior: 'Inflammatory abdomen with instability should outrank benign vomiting explanations.',
        failure_indicator: 'The system anchors on isolated vomiting and misses the septic abdomen pattern.',
    },
];

export function validateAbdominalOutput(
    validationCase: AbdominalValidationCase,
    outputPayload: Record<string, unknown>,
): AbdominalValidationResult {
    const diagnosis = readRecord(outputPayload.diagnosis);
    const riskAssessment = readRecord(outputPayload.risk_assessment);
    const topDifferentials = Array.isArray(diagnosis?.top_differentials)
        ? diagnosis.top_differentials as Array<Record<string, unknown>>
        : [];
    const topDiagnosis = typeof topDifferentials[0]?.name === 'string'
        ? topDifferentials[0].name
        : typeof diagnosis?.top_diagnosis === 'string'
            ? diagnosis.top_diagnosis
            : null;
    const emergencyLevel = typeof riskAssessment?.emergency_level === 'string'
        ? riskAssessment.emergency_level.toUpperCase()
        : null;
    const mechanismLabel = typeof readRecord(outputPayload.mechanism_class)?.label === 'string'
        ? String(readRecord(outputPayload.mechanism_class)?.label)
        : null;

    const notes: string[] = [];
    const topDiagnosisMatch = topDiagnosis === validationCase.expected_top_diagnosis;
    if (!topDiagnosisMatch) {
        notes.push(`Expected top diagnosis ${validationCase.expected_top_diagnosis} but received ${topDiagnosis ?? 'none'}.`);
    }

    const emergencyMatch = emergencyLevel === validationCase.expected_emergency_level;
    if (!emergencyMatch) {
        notes.push(`Expected emergency level ${validationCase.expected_emergency_level} but received ${emergencyLevel ?? 'none'}.`);
    }

    let failureDetected = false;
    if (mechanismLabel && topDiagnosis && topDiagnosis === mechanismLabel) {
        failureDetected = true;
        notes.push('Generic mechanism label leaked into the named diagnosis slot.');
    }

    const catastrophicRisk = typeof riskAssessment?.catastrophic_deterioration_risk_6h === 'number'
        ? riskAssessment.catastrophic_deterioration_risk_6h
        : null;
    if (validationCase.expected_emergency_level === 'CRITICAL' && catastrophicRisk != null && catastrophicRisk < 0.85) {
        failureDetected = true;
        notes.push(`Critical abdominal case returned catastrophically low risk (${catastrophicRisk}).`);
    }

    return {
        case_id: validationCase.id,
        top_diagnosis_match: topDiagnosisMatch,
        emergency_match: emergencyMatch,
        failure_detected: failureDetected,
        notes,
    };
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}
