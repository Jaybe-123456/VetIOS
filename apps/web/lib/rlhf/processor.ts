import type { SupabaseClient } from '@supabase/supabase-js';
import { RLHF_BATCH_RUNS, VET_OVERRIDE_SIGNALS } from '@/lib/db/schemaContracts';

export type RlhfOverrideType =
    | 'diagnosis_correction'
    | 'diagnosis_rerank'
    | 'confidence_flag'
    | 'treatment_correction'
    | 'severity_correction'
    | 'false_positive'
    | 'false_negative';

export type RlhfSignalStatus = 'pending' | 'queued' | 'applied' | 'rejected' | 'skipped';

export interface RlhfSignal {
    id: string;
    created_at: string;
    inference_event_id: string;
    tenant_id: string;
    vet_user_id: string;
    override_type: RlhfOverrideType;
    ai_output: Record<string, unknown>;
    vet_correction: Record<string, unknown>;
    correction_notes: string | null;
    species: string;
    breed: string | null;
    age_years: number | null;
    presenting_symptoms: string[];
    top_ai_diagnosis: string;
    ai_confidence: number;
    vet_diagnosis: string;
    vet_confidence: number | null;
    is_confirmed_by_outcome: boolean | null;
    outcome_event_id: string | null;
    status: RlhfSignalStatus;
}

export interface RlhfBatchResult {
    batch_id: string;
    signals_queued: number;
    signals_applied: number;
    signals_rejected: number;
    signals_skipped: number;
    duration_ms: number;
    errors: string[];
}

const WEIGHT_THRESHOLD = 0.35;
const BATCH_SIZE = 500;
const RECENCY_HALF_LIFE_DAYS = 90;

const TYPE_MULTIPLIERS: Record<RlhfOverrideType, number> = {
    diagnosis_correction: 1.0,
    false_positive: 1.0,
    false_negative: 1.0,
    diagnosis_rerank: 0.8,
    treatment_correction: 0.75,
    severity_correction: 0.6,
    confidence_flag: 0.4,
};

export function computeSignalWeight(signal: RlhfSignal): number {
    const base = signal.vet_confidence ?? 0.5;
    const outcomeBonus = signal.is_confirmed_by_outcome === true ? 1.5 : 1.0;
    const ageDays = (Date.now() - new Date(signal.created_at).getTime()) / 86_400_000;
    const recencyDecay = Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS);
    const typeMultiplier = TYPE_MULTIPLIERS[signal.override_type] ?? 0.5;
    return parseFloat(Math.min(1.0, base * outcomeBonus * recencyDecay * typeMultiplier).toFixed(4));
}

export function validateSignal(signal: RlhfSignal): string | null {
    if (!signal.species?.trim()) return 'missing species';
    if (!signal.vet_diagnosis?.trim()) return 'missing vet_diagnosis';
    if (signal.presenting_symptoms.length === 0) return 'no presenting symptoms';
    if (
        signal.override_type === 'diagnosis_correction' &&
        signal.vet_diagnosis.toLowerCase().trim() === signal.top_ai_diagnosis.toLowerCase().trim()
    ) return 'vet_diagnosis identical to ai_diagnosis — skipped';
    return null;
}

export async function runRlhfBatch(supabase: SupabaseClient): Promise<RlhfBatchResult> {
    const startMs = Date.now();
    const errors: string[] = [];

    const { data: batchData, error: batchErr } = await supabase
        .from(RLHF_BATCH_RUNS.TABLE)
        .insert({ status: 'running' })
        .select('id')
        .single();

    if (batchErr || !batchData) throw new Error(`Failed to create batch: ${batchErr?.message}`);
    const batchId = batchData.id as string;

    const { data: signals, error: fetchErr } = await supabase
        .from(VET_OVERRIDE_SIGNALS.TABLE)
        .select('id, created_at, inference_event_id, tenant_id, vet_user_id, override_type, ai_output, vet_correction, correction_notes, species, breed, age_years, presenting_symptoms, top_ai_diagnosis, ai_confidence, vet_diagnosis, vet_confidence, is_confirmed_by_outcome, outcome_event_id, status')
        .eq(VET_OVERRIDE_SIGNALS.COLUMNS.status, 'pending')
        .order(VET_OVERRIDE_SIGNALS.COLUMNS.created_at, { ascending: true })
        .limit(BATCH_SIZE);

    if (fetchErr) {
        await finaliseBatch(supabase, batchId, 'failed', 0, 0, 0, fetchErr.message);
        throw new Error(`Failed to fetch signals: ${fetchErr.message}`);
    }

    const pending = (signals ?? []) as RlhfSignal[];

    if (pending.length > 0) {
        await supabase
            .from(VET_OVERRIDE_SIGNALS.TABLE)
            .update({ status: 'queued', batch_id: batchId })
            .in(VET_OVERRIDE_SIGNALS.COLUMNS.id, pending.map(s => s.id));
    }

    let applied = 0, rejected = 0, skipped = 0;

    for (const signal of pending) {
        try {
            const validationError = validateSignal(signal);
            if (validationError) {
                await updateSignal(supabase, signal.id, 'skipped', 0, validationError);
                skipped++;
                continue;
            }
            const weight = computeSignalWeight(signal);
            if (weight < WEIGHT_THRESHOLD) {
                await updateSignal(supabase, signal.id, 'rejected', weight, `weight ${weight} below threshold`);
                rejected++;
                continue;
            }
            await updateSignal(supabase, signal.id, 'applied', weight, null);
            applied++;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`signal ${signal.id}: ${msg}`);
            await updateSignal(supabase, signal.id, 'rejected', 0, `error: ${msg}`);
            rejected++;
        }
    }

    const { error: rpcErr } = await supabase.rpc('refresh_rlhf_accuracy_view');
if (rpcErr) errors.push(`mv refresh: ${rpcErr.message}`);

    await finaliseBatch(supabase, batchId, 'completed', applied, rejected, skipped);

    return {
        batch_id: batchId,
        signals_queued: pending.length,
        signals_applied: applied,
        signals_rejected: rejected,
        signals_skipped: skipped,
        duration_ms: Date.now() - startMs,
        errors,
    };
}

async function updateSignal(
    supabase: SupabaseClient,
    id: string,
    status: RlhfSignalStatus,
    weight: number,
    notes: string | null,
) {
    await supabase
        .from(VET_OVERRIDE_SIGNALS.TABLE)
        .update({ status, signal_weight: weight, processed_at: new Date().toISOString(), processing_notes: notes })
        .eq(VET_OVERRIDE_SIGNALS.COLUMNS.id, id);
}

async function finaliseBatch(
    supabase: SupabaseClient,
    batchId: string,
    status: 'completed' | 'failed',
    applied: number,
    rejected: number,
    skipped: number,
    errorMessage?: string,
) {
    await supabase
        .from(RLHF_BATCH_RUNS.TABLE)
        .update({ status, completed_at: new Date().toISOString(), signals_applied: applied, signals_rejected: rejected, signals_skipped: skipped, error_message: errorMessage ?? null })
        .eq(RLHF_BATCH_RUNS.COLUMNS.id, batchId);
}
