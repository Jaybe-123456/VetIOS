import type {
    IntegrityResult,
    SafetyPolicyDecision,
} from '@/lib/integrity/types';

interface SafetyPolicyContext {
    inputSignature?: Record<string, unknown>;
    outputPayload?: Record<string, unknown>;
}

export function generateSafetyPolicy(
    integrity: IntegrityResult,
    context: SafetyPolicyContext = {},
): SafetyPolicyDecision {
    const elevatedEmergency = hasElevatedEmergencySignals(context.inputSignature, context.outputPayload);
    const divergenceWarning = integrity.instability.divergence > 0.2
        ? ' Model confidence currently exceeds structural integrity, so false reassurance risk is elevated.'
        : '';
    const varianceWarning = integrity.instability.variance_proxy > 0.55
        ? ' Differential ranking is unstable across nearby inputs, so uncertainty may widen with small data changes.'
        : '';

    if (integrity.state === 'collapsed') {
        return {
            action: 'abstain',
            message: `Clinical integrity is too degraded for a reliable automated recommendation. Escalate to manual clinical review and gather more data before relying on this result.${divergenceWarning}${varianceWarning}`,
        };
    }

    if (integrity.precliff_detected) {
        return {
            action: 'request_more_data',
            message: elevatedEmergency
                ? `System entering unstable inference regime during an urgent case. Additional clinical data and manual review are required before acting on this output.${divergenceWarning}${varianceWarning}`
                : `System entering unstable inference regime. Additional clinical data required before relying on this output.${divergenceWarning}${varianceWarning}`,
        };
    }

    if (integrity.state === 'metastable') {
        return {
            action: 'request_more_data',
            message: elevatedEmergency
                ? `Clinical structure is unstable while urgent case signals are present. Please gather more data and escalate to clinician review before relying on the output.${divergenceWarning}${varianceWarning}`
                : `Clinical structure is unstable for this case. Please add missing history, clarify contradictions, or provide stronger exam findings before relying on the output.${divergenceWarning}${varianceWarning}`,
        };
    }

    if (integrity.state === 'fragile') {
        return {
            action: 'allow_with_warning',
            message: `Clinical structure is partially degraded due to incomplete, contradictory, or ambiguous input. Use the result with caution and consider collecting more data.${divergenceWarning}${varianceWarning}`,
        };
    }

    return {
        action: 'allow',
        message: `Clinical integrity is stable enough for routine use, with no major degradation signals detected.${divergenceWarning}${varianceWarning}`,
    };
}

function hasElevatedEmergencySignals(
    inputSignature?: Record<string, unknown>,
    outputPayload?: Record<string, unknown>,
) {
    const riskAssessment = outputPayload != null ? asRecord(outputPayload.risk_assessment) : {};
    const emergencyLevel = readString(riskAssessment.emergency_level)?.toUpperCase() ?? 'MODERATE';
    if (emergencyLevel === 'HIGH' || emergencyLevel === 'CRITICAL') return true;

    const text = inputSignature == null
        ? ''
        : [
            readStringArray(inputSignature.symptoms).join(' '),
            readString(asRecord(inputSignature.metadata).raw_note),
            readString(asRecord(inputSignature.metadata).history),
            readString(asRecord(inputSignature.metadata).presenting_complaint),
        ]
            .filter((value): value is string => Boolean(value && value.trim()))
            .join(' ')
            .toLowerCase();

    return text.includes('collapse')
        || text.includes('dyspnea')
        || text.includes('respiratory distress')
        || text.includes('unproductive retching')
        || text.includes('abdominal distension')
        || text.includes('seizure')
        || text.includes('cyanosis');
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
