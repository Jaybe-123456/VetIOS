import { NextResponse } from 'next/server';
import {
    formularyUpdateRequestSchema,
    normalizeDrugName,
    type DrugFormularyRecord,
} from '@vetios/pharmacos';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
    const auth = authorizeOperator(req);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => null);
    const parsed = formularyUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid formulary update', details: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { update_type, drug_record, regulatory_reference, effective_date, submitted_by } = parsed.data;
    const existing = await findExistingDrug(supabase, drug_record);
    const previousVersion = existing ?? null;
    const nextVersion = {
        ...drug_record,
        formulary_version: existing ? Number(existing.formulary_version ?? 1) + 1 : drug_record.formulary_version,
        last_updated_at: new Date().toISOString(),
        update_source: submitted_by === 'fda_sync' ? 'fda_label_sync' : 'manual_review',
        active: drug_record.active ?? true,
    };

    const write = existing?.id
        ? await supabase
            .from('drug_formulary')
            .update(nextVersion)
            .eq('id', existing.id)
            .select('*')
            .single()
        : await supabase
            .from('drug_formulary')
            .insert(nextVersion)
            .select('*')
            .single();

    if (write.error || !write.data) {
        return NextResponse.json({ error: write.error?.message ?? 'Failed to write formulary record' }, { status: 500 });
    }

    const changeSummary = summarizeChange(update_type, previousVersion, nextVersion);
    const updateLog = await supabase.from('drug_formulary_updates').insert({
        drug_id: write.data.id,
        update_type,
        change_summary: changeSummary,
        changed_by: submitted_by,
        previous_version: previousVersion,
        new_version: write.data,
        regulatory_reference,
        effective_date,
    });

    if (updateLog.error) {
        return NextResponse.json({ error: updateLog.error.message }, { status: 500 });
    }

    await supabase.from('outbox_events').insert({
        tenant_id: 'platform',
        topic: 'pharmacos.formulary_updated',
        handler_key: 'pharmacos_formulary_update',
        target_type: 'internal_task',
        payload: {
            drug_id: write.data.id,
            drug_name: write.data.drug_name,
            update_type,
            formulary_version: write.data.formulary_version,
        },
        metadata: { source: 'pharmacos_formulary_update' },
    }).throwOnError();

    return NextResponse.json({
        drug_id: write.data.id,
        formulary_version: write.data.formulary_version,
        change_summary: changeSummary,
    });
}

function authorizeOperator(req: Request): { ok: true } | { ok: false; status: number; error: string } {
    const configured = process.env.VETIOS_INTERNAL_API_TOKEN?.trim();
    if (!configured) return { ok: false, status: 503, error: 'Operator token is not configured' };
    const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer !== configured) return { ok: false, status: 401, error: 'Unauthorized' };
    return { ok: true };
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

function summarizeChange(
    updateType: string,
    previous: DrugFormularyRecord | null,
    next: DrugFormularyRecord,
) {
    if (!previous) return `${updateType}: created ${next.drug_name} formulary version ${next.formulary_version}.`;
    const changed = Object.keys(next).filter((key) =>
        JSON.stringify((previous as Record<string, unknown>)[key]) !== JSON.stringify((next as Record<string, unknown>)[key]),
    );
    return `${updateType}: updated ${next.drug_name} to formulary version ${next.formulary_version}; changed ${changed.join(', ') || 'metadata'}.`;
}
