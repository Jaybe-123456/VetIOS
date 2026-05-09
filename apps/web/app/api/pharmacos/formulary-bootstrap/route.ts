import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import {
    FALLBACK_FORMULARY,
    FALLBACK_INTERACTIONS,
    normalizeDrugName,
    type DrugFormularyRecord,
    type DrugInteractionRecord,
} from '@vetios/pharmacos';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
    const auth = authorizeOperator(req);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const refreshExisting = asRecord(body).refresh_existing === true;
    const supabase = getSupabaseServer();

    let insertedDrugs = 0;
    let refreshedDrugs = 0;
    let skippedDrugs = 0;
    for (const record of FALLBACK_FORMULARY) {
        const existing = await findExistingDrug(supabase, record);
        if (existing?.id && !refreshExisting) {
            skippedDrugs += 1;
            continue;
        }

        const payload = {
            ...record,
            formulary_version: existing?.id
                ? Math.max(Number(existing.formulary_version ?? 1) + 1, record.formulary_version)
                : record.formulary_version,
            update_source: existing?.id ? 'local_bootstrap_refresh' : 'local_bootstrap_seed',
            last_updated_at: new Date().toISOString(),
            active: record.active ?? true,
        };

        const write = existing?.id
            ? await supabase.from('drug_formulary').update(payload).eq('id', existing.id).select('id').single()
            : await supabase.from('drug_formulary').insert(payload).select('id').single();
        if (write.error) {
            return NextResponse.json({ error: write.error.message, drug_name: record.drug_name }, { status: 500 });
        }
        if (existing?.id) refreshedDrugs += 1;
        else insertedDrugs += 1;
    }

    const existingInteractions = await listExistingInteractions(supabase);
    let insertedInteractions = 0;
    let skippedInteractions = 0;
    for (const interaction of FALLBACK_INTERACTIONS) {
        const key = interactionKey(interaction.drug_a_name, interaction.drug_b_name, interaction.interaction_type);
        if (existingInteractions.has(key)) {
            skippedInteractions += 1;
            continue;
        }
        const write = await supabase.from('drug_interactions').insert(interaction).select('id').single();
        if (write.error) {
            return NextResponse.json({ error: write.error.message, interaction: key }, { status: 500 });
        }
        existingInteractions.add(key);
        insertedInteractions += 1;
    }

    await supabase.from('outbox_events').insert({
        tenant_id: 'platform',
        topic: 'pharmacos.formulary_bootstrapped',
        handler_key: 'pharmacos_formulary_bootstrap',
        target_type: 'internal_task',
        payload: {
            inserted_drugs: insertedDrugs,
            refreshed_drugs: refreshedDrugs,
            skipped_drugs: skippedDrugs,
            inserted_interactions: insertedInteractions,
            skipped_interactions: skippedInteractions,
        },
        metadata: { source: 'pharmacos_formulary_bootstrap' },
    }).throwOnError();

    return NextResponse.json({
        status: 'ok',
        refresh_existing: refreshExisting,
        inserted_drugs: insertedDrugs,
        refreshed_drugs: refreshedDrugs,
        skipped_drugs: skippedDrugs,
        inserted_interactions: insertedInteractions,
        skipped_interactions: skippedInteractions,
    });
}

function authorizeOperator(req: Request): { ok: true } | { ok: false; status: number; error: string } {
    const configured = process.env.VETIOS_INTERNAL_API_TOKEN?.trim();
    if (!configured) return { ok: false, status: 503, error: 'Operator token is not configured' };
    const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearer || !safeCompare(bearer, configured)) return { ok: false, status: 401, error: 'Unauthorized' };
    return { ok: true };
}

function safeCompare(a: string, b: string): boolean {
    try {
        const left = Buffer.from(a);
        const right = Buffer.from(b);
        return left.length === right.length && timingSafeEqual(left, right);
    } catch {
        return false;
    }
}

async function findExistingDrug(
    supabase: ReturnType<typeof getSupabaseServer>,
    record: DrugFormularyRecord,
) {
    const drugName = normalizeDrugName(record.drug_name);
    const { data, error } = await supabase
        .from('drug_formulary')
        .select('*')
        .ilike('drug_name', record.drug_name)
        .limit(10);
    if (error) throw new Error(error.message);
    return (data ?? []).find((candidate) => {
        const candidateRecord = candidate as DrugFormularyRecord;
        const sameName = normalizeDrugName(candidateRecord.drug_name) === drugName;
        const sameInn = record.who_inn && candidateRecord.who_inn
            ? normalizeDrugName(candidateRecord.who_inn) === normalizeDrugName(record.who_inn)
            : true;
        return sameName && sameInn;
    }) as (DrugFormularyRecord & { id: string }) | undefined;
}

async function listExistingInteractions(supabase: ReturnType<typeof getSupabaseServer>) {
    const { data, error } = await supabase
        .from('drug_interactions')
        .select('drug_a_name, drug_b_name, interaction_type')
        .limit(1000);
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => {
        const interaction = row as DrugInteractionRecord;
        return interactionKey(interaction.drug_a_name, interaction.drug_b_name, interaction.interaction_type);
    }));
}

function interactionKey(drugA: string, drugB: string, type: string) {
    return [...[drugA, drugB].map(normalizeDrugName).sort(), normalizeDrugName(type)].join('|');
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
