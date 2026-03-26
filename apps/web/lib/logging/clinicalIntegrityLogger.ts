import type { SupabaseClient } from '@supabase/supabase-js';
import { CLINICAL_INTEGRITY_EVENTS } from '@/lib/db/schemaContracts';
import type {
    ClinicalIntegrityHistoryEntry,
    IntegrityResult,
    SafetyPolicyDecision,
} from '@/lib/integrity/types';

export interface ClinicalIntegrityLogInput {
    inference_event_id: string;
    tenant_id: string;
    perturbation_score_m: number;
    global_phi: number;
    delta_phi: number;
    curvature: number;
    variance_proxy: number;
    divergence: number;
    critical_instability_index: number;
    state: IntegrityResult['state'];
    collapse_risk: number;
    precliff_detected: boolean;
    details?: {
        perturbation: IntegrityResult['perturbation'];
        capabilities: IntegrityResult['capabilities'];
        instability: IntegrityResult['instability'];
        precliff_detected: boolean;
        safety_policy: SafetyPolicyDecision;
    } | null;
}

export async function fetchRecentClinicalIntegrityHistory(
    client: SupabaseClient,
    tenantId: string,
    limit = 6,
): Promise<ClinicalIntegrityHistoryEntry[]> {
    const C = CLINICAL_INTEGRITY_EVENTS.COLUMNS;
    const selectColumns = [
        C.global_phi,
        C.perturbation_score_m,
        C.details,
        C.created_at,
    ].join(', ');

    const { data, error } = await client
        .from(CLINICAL_INTEGRITY_EVENTS.TABLE)
        .select(selectColumns)
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(limit);

    if (error || !Array.isArray(data)) {
        console.warn(`Failed to read recent clinical integrity history: ${error?.message ?? 'Unknown error'}`);
        return [];
    }

    return data
        .map((row) => {
            const record = typeof row === 'object' && row !== null ? row as Record<string, unknown> : {};
            const globalPhi = numberOrNull(record[C.global_phi]);
            const perturbationScoreM = numberOrNull(record[C.perturbation_score_m]);
            if (globalPhi == null || perturbationScoreM == null) return null;

            return {
                global_phi: globalPhi,
                perturbation_score_m: perturbationScoreM,
                details: asNullableRecord(record[C.details]),
                created_at: typeof record[C.created_at] === 'string' ? record[C.created_at] : null,
            };
        })
        .filter((entry): entry is ClinicalIntegrityHistoryEntry => entry !== null);
}

export async function logClinicalIntegrityEvent(
    client: SupabaseClient,
    input: ClinicalIntegrityLogInput,
) {
    const C = CLINICAL_INTEGRITY_EVENTS.COLUMNS;

    const { error } = await client
        .from(CLINICAL_INTEGRITY_EVENTS.TABLE)
        .insert({
            [C.inference_event_id]: input.inference_event_id,
            [C.tenant_id]: input.tenant_id,
            [C.perturbation_score_m]: input.perturbation_score_m,
            [C.global_phi]: input.global_phi,
            [C.delta_phi]: input.delta_phi,
            [C.curvature]: input.curvature,
            [C.variance_proxy]: input.variance_proxy,
            [C.divergence]: input.divergence,
            [C.critical_instability_index]: input.critical_instability_index,
            [C.state]: input.state,
            [C.collapse_risk]: input.collapse_risk,
            [C.precliff_detected]: input.precliff_detected,
            [C.details]: input.details ?? {},
        });

    if (error) {
        throw new Error(`Failed to log clinical integrity event: ${error.message}`);
    }
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function numberOrNull(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
