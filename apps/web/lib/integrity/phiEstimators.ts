import type {
    CapabilityPhi,
    ClinicalIntegrityInput,
    PerturbationScore,
} from '@/lib/integrity/types';

const EMERGENCY_KEYWORDS = [
    'collapse',
    'collapsed',
    'dyspnea',
    'respiratory distress',
    'unproductive retching',
    'retching',
    'abdominal distension',
    'seizure',
    'myoclonus',
    'cyanosis',
    'pale mucous membranes',
    'unresponsive',
    'shock',
];

export function estimateCapabilityPhis(
    input: ClinicalIntegrityInput,
    perturbation: PerturbationScore,
): CapabilityPhi[] {
    return [
        estimateDiagnosticStabilityPhi(input, perturbation),
        estimateTriageSafetyPhi(input, perturbation),
        estimateContradictionHandlingPhi(input, perturbation),
        estimateCalibrationIntegrityPhi(input, perturbation),
    ];
}

export function estimateDiagnosticStabilityPhi(
    input: ClinicalIntegrityInput,
    perturbation: PerturbationScore,
): CapabilityPhi {
    const diagnosis = asRecord(input.outputPayload.diagnosis);
    const topDifferentials = readDifferentials(diagnosis.top_differentials);
    const confidence = resolveConfidence(input, diagnosis);
    const topGap = computeTopGap(topDifferentials);
    const uncertaintyNotes = readStringArray(input.outputPayload.uncertainty_notes);

    let penalty = 0.04;
    if (topDifferentials.length === 0) {
        penalty += 0.34;
    } else if (topDifferentials.length < 3) {
        penalty += 0.14;
    }
    if (confidence == null) {
        penalty += 0.18;
    } else if (confidence < 0.45) {
        penalty += 0.24;
    } else if (confidence < 0.6) {
        penalty += 0.12;
    }
    if (topDifferentials.length >= 2 && topGap < 0.08) {
        penalty += 0.22;
    } else if (topDifferentials.length >= 2 && topGap < 0.15) {
        penalty += 0.11;
    }
    if (uncertaintyNotes.length >= 4) penalty += 0.08;
    if (perturbation.m >= 0.55) penalty += 0.1;

    const phi = roundMetric(1 - penalty);
    const reason = topDifferentials.length === 0
        ? 'No structured differential set was returned, which weakens diagnostic stability.'
        : topGap < 0.08
            ? 'Leading differentials are tightly clustered, suggesting unstable ranking under perturbation.'
            : confidence != null && confidence < 0.6
                ? 'Diagnosis confidence is compressed, indicating limited stability.'
                : 'Top diagnoses remain reasonably separated and internally consistent.';

    return { name: 'diagnostic_stability', phi, reason };
}

export function estimateTriageSafetyPhi(
    input: ClinicalIntegrityInput,
    perturbation: PerturbationScore,
): CapabilityPhi {
    const riskAssessment = asRecord(input.outputPayload.risk_assessment);
    const emergencyLevel = normalizeEmergencyLevel(riskAssessment.emergency_level);
    const severityScore = numberOrNull(riskAssessment.severity_score) ?? 0.5;
    const confidence = resolveConfidence(input, asRecord(input.outputPayload.diagnosis));
    const emergencySignals = countEmergencySignals(input.inputSignature);
    const contradictionScore = numberOrNull(input.contradictionAnalysis?.contradiction_score) ?? 0;

    let penalty = 0.03;
    if (emergencySignals >= 2 && severityScore < 0.6 && emergencyLevel !== 'HIGH' && emergencyLevel !== 'CRITICAL') {
        penalty += 0.34;
    } else if (emergencySignals >= 1 && emergencyLevel === 'LOW') {
        penalty += 0.22;
    }
    if (perturbation.components.missingness >= 0.35) penalty += 0.16;
    if (contradictionScore >= 0.45) penalty += 0.12;
    if ((emergencyLevel === 'HIGH' || emergencyLevel === 'CRITICAL') && (confidence ?? 0) < 0.5) {
        penalty += 0.15;
    }
    if (perturbation.components.ambiguity >= 0.3 && emergencySignals >= 1) {
        penalty += 0.1;
    }

    const phi = roundMetric(1 - penalty);
    const reason = emergencySignals >= 2 && emergencyLevel !== 'HIGH' && emergencyLevel !== 'CRITICAL'
        ? 'Emergency signal density is higher than the current triage posture suggests.'
        : perturbation.components.missingness >= 0.35
            ? 'Critical triage context is partially missing, reducing safety margin.'
            : 'Triage posture remains broadly aligned with the case severity signals.';

    return { name: 'triage_safety', phi, reason };
}

export function estimateContradictionHandlingPhi(
    input: ClinicalIntegrityInput,
    perturbation: PerturbationScore,
): CapabilityPhi {
    const contradictionScore = numberOrNull(input.contradictionAnalysis?.contradiction_score) ?? 0;
    const contradictionReasons = readStringArray(input.contradictionAnalysis?.contradiction_reasons);
    const confidenceCap = numberOrNull(input.contradictionAnalysis?.confidence_cap) ?? 1;
    const confidence = resolveConfidence(input, asRecord(input.outputPayload.diagnosis));
    const uncertaintyNotes = readStringArray(input.outputPayload.uncertainty_notes);
    const topDifferentials = readDifferentials(asRecord(input.outputPayload.diagnosis).top_differentials);
    const abstainRecommendation = Boolean(input.outputPayload.abstain_recommendation);
    const notesJoined = uncertaintyNotes.join(' ').toLowerCase();
    const acknowledgesContradiction = notesJoined.includes('contradiction')
        || notesJoined.includes('conflict')
        || notesJoined.includes('inconsistent')
        || notesJoined.includes('uncertain');

    if (contradictionScore <= 0.05 && contradictionReasons.length === 0) {
        return {
            name: 'contradiction_handling',
            phi: 0.96,
            reason: 'No meaningful contradiction pressure was detected in this case.',
        };
    }

    let penalty = 0.08;
    if (!acknowledgesContradiction) penalty += 0.26;
    if (confidence != null && confidence > confidenceCap + 0.03) penalty += 0.26;
    if (topDifferentials.length < 3) penalty += 0.14;
    if (contradictionScore >= 0.7 && !abstainRecommendation && (confidence ?? 0) > 0.55) penalty += 0.18;
    if (perturbation.components.contradiction >= 0.4 && uncertaintyNotes.length === 0) penalty += 0.1;

    const phi = roundMetric(1 - penalty);
    const reason = !acknowledgesContradiction
        ? 'Contradiction pressure exists but is not clearly surfaced in the returned uncertainty framing.'
        : confidence != null && confidence > confidenceCap + 0.03
            ? 'Confidence remains above the contradiction cap, suggesting insufficient degradation handling.'
            : 'Contradictions are being acknowledged and partially absorbed into the safety posture.';

    return { name: 'contradiction_handling', phi, reason };
}

export function estimateCalibrationIntegrityPhi(
    input: ClinicalIntegrityInput,
    perturbation: PerturbationScore,
): CapabilityPhi {
    const diagnosis = asRecord(input.outputPayload.diagnosis);
    const confidence = resolveConfidence(input, diagnosis);
    const uncertaintyNotes = readStringArray(input.outputPayload.uncertainty_notes);
    const contradictionScore = numberOrNull(input.contradictionAnalysis?.contradiction_score) ?? 0;
    const confidenceCap = numberOrNull(input.outputPayload.confidence_cap)
        ?? numberOrNull(input.contradictionAnalysis?.confidence_cap)
        ?? 1;
    const wasCapped = Boolean(input.outputPayload.was_capped)
        || Boolean(input.contradictionAnalysis?.confidence_was_capped);

    let penalty = 0.05;
    if (confidence == null) {
        penalty += 0.22;
    } else {
        if (perturbation.m >= 0.55 && confidence >= 0.78) penalty += 0.28;
        if (perturbation.components.missingness >= 0.35 && confidence >= 0.72) penalty += 0.14;
        if (contradictionScore >= 0.4 && confidence >= 0.7) penalty += 0.2;
        if (confidence > confidenceCap + 0.03) penalty += 0.16;
    }
    if (uncertaintyNotes.length === 0 && perturbation.m >= 0.35) penalty += 0.1;
    if (wasCapped && contradictionScore >= 0.25) penalty -= 0.08;

    const phi = roundMetric(1 - penalty);
    const reason = confidence == null
        ? 'No explicit confidence was returned, limiting calibration integrity.'
        : perturbation.m >= 0.55 && confidence >= 0.78
            ? 'Confidence remains high despite degraded clinical structure, suggesting overconfidence risk.'
            : wasCapped && contradictionScore >= 0.25
                ? 'Confidence was moderated under contradiction pressure, supporting calibration integrity.'
                : 'Confidence posture is broadly aligned with the observed uncertainty level.';

    return { name: 'calibration_integrity', phi, reason };
}

function countEmergencySignals(inputSignature: Record<string, unknown>) {
    const text = [
        readStringArray(inputSignature.symptoms).join(' '),
        readString(asRecord(inputSignature.metadata).raw_note),
        readString(asRecord(inputSignature.metadata).history),
        readString(asRecord(inputSignature.metadata).presenting_complaint),
    ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(' ')
        .toLowerCase();

    if (!text) return 0;

    let hits = 0;
    for (const keyword of EMERGENCY_KEYWORDS) {
        if (text.includes(keyword)) hits += 1;
    }
    return hits;
}

function normalizeEmergencyLevel(value: unknown) {
    const normalized = readString(value)?.toUpperCase() ?? 'MODERATE';
    if (normalized === 'CRITICAL' || normalized === 'HIGH' || normalized === 'MODERATE' || normalized === 'LOW') {
        return normalized;
    }
    return 'MODERATE';
}

function resolveConfidence(
    input: ClinicalIntegrityInput,
    diagnosis: Record<string, unknown>,
) {
    return numberOrNull(input.confidenceScore)
        ?? numberOrNull(diagnosis.confidence_score)
        ?? numberOrNull(input.outputPayload.confidence_score);
}

function computeTopGap(differentials: Array<{ probability: number }>) {
    if (differentials.length < 2) return 1;
    return Math.max(0, differentials[0].probability - differentials[1].probability);
}

function readDifferentials(value: unknown) {
    if (!Array.isArray(value)) return [] as Array<{ name: string; probability: number }>;
    return value
        .map((entry) => {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
            const record = entry as Record<string, unknown>;
            const name = readString(record.name) ?? readString(record.diagnosis) ?? 'Unknown';
            const probability = clamp01(numberOrNull(record.probability) ?? 0);
            return { name, probability };
        })
        .filter((entry): entry is { name: string; probability: number } => entry !== null);
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry): entry is string => entry.length > 0);
}

function numberOrNull(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number) {
    return Math.round(clamp01(value) * 1000) / 1000;
}
