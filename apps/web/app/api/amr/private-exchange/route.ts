import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    AMR_EXCHANGE_EVENT_TYPES,
    AMR_EXCHANGE_PRODUCT_KEYS,
    buildAMRExchangeAgreementSummaries,
    buildAMRSettlementPreview,
    validateAMRExchangeAgreementTransition,
    type AMRExchangeAgreementEventRow,
    type AMRExchangeSettlementEventRow,
    type AMRExchangeUsageEventRow,
} from '@/lib/amr/networkOperations';
import { hashAMRNetworkJson, hashAMRNetworkValue } from '@/lib/amr/outcomeNetwork';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { enforceVetiosClinicalActorGate } from '@/lib/auth/authTrustRouteGate';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const OptionalUuid = UuidSchema.optional();
const OptionalText = z.string().trim().min(1).max(512).optional();
const AgreementEventSchema = z.enum(AMR_EXCHANGE_EVENT_TYPES);
const ProductKeySchema = z.enum(AMR_EXCHANGE_PRODUCT_KEYS);

const RecordAgreementSchema = z.object({
    action: z.literal('record_agreement_event'),
    request_id: UuidSchema,
    agreement_id: OptionalUuid,
    event_type: AgreementEventSchema,
    product_key: ProductKeySchema.optional(),
    provider_site_id: OptionalUuid,
    consumer_tenant_id: OptionalUuid,
    counterparty_ref: OptionalText,
    purpose: OptionalText,
    license_key: OptionalText,
    privacy_class: z.enum(['deidentified_record', 'aggregate_only', 'federated_only']).optional(),
    permitted_species: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    permitted_geographies: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    permitted_use_cases: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
    pricing_model: z.enum(['per_record', 'per_episode', 'subscription', 'no_charge']).optional(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
    unit_price_minor: z.number().int().min(0).max(2_147_483_647).optional(),
    platform_fee_bps: z.number().int().min(0).max(10_000).optional(),
    terms_hash: Sha256Schema.optional(),
    data_use_agreement_hash: Sha256Schema.optional(),
    effective_at: z.string().datetime().optional(),
    expires_at: z.string().datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const MaterializeSettlementSchema = z.object({
    action: z.literal('materialize_settlement'),
    request_id: UuidSchema,
    settlement_id: OptionalUuid,
    agreement_id: UuidSchema,
    period_start: z.string().datetime(),
    period_end: z.string().datetime(),
}).strict();

const RecordSettlementStateSchema = z.object({
    action: z.literal('record_settlement_state'),
    request_id: UuidSchema,
    settlement_id: UuidSchema,
    event_type: z.enum(['approved', 'invoiced', 'paid', 'voided']),
    confirmation_hash: Sha256Schema.optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const PostSchema = z.discriminatedUnion('action', [
    RecordAgreementSchema,
    MaterializeSettlementSchema,
    RecordSettlementStateSchema,
]);

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['exchange:manage'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }

    const loaded = await loadExchangeData(supabase, auth.actor.tenantId);
    if (loaded.error) {
        return withHeaders(storageError(loaded.error, requestId), requestId, startTime);
    }
    const agreements = buildAMRExchangeAgreementSummaries(loaded.agreements);
    const metered = loaded.usage.filter((event) => event.usage_status === 'metered');

    return withHeaders(
        NextResponse.json({
            agreements,
            usage: {
                metered_events: metered.length,
                metered_amount_minor: metered.reduce(
                    (sum, event) => sum + Math.max(0, event.amount_minor),
                    0,
                ),
                currencies: uniqueStrings(metered.map((event) => event.currency)),
                recent: loaded.usage.slice(0, 100),
            },
            settlements: loaded.settlements.slice(0, 100),
            execution_boundary: {
                payment_execution: false,
                identifiable_record_exchange: false,
                settlement_ledger_only: true,
            },
            request_id: requestId,
            error: null,
        }),
        requestId,
        startTime,
    );
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const parsed = PostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({
                error: 'invalid_input',
                detail: parsed.error.flatten(),
                request_id: requestId,
            }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['exchange:manage'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }
    const actionKey = parsed.data.action === 'record_agreement_event'
        ? 'amr.exchange.agreement.write'
        : 'amr.exchange.settlement.write';
    const resourceId = parsed.data.action === 'record_agreement_event'
        ? parsed.data.agreement_id ?? parsed.data.request_id
        : parsed.data.action === 'materialize_settlement'
            ? parsed.data.settlement_id ?? parsed.data.agreement_id
            : parsed.data.settlement_id;
    const trustGate = await enforceVetiosClinicalActorGate({
        client: supabase as unknown as Parameters<typeof enforceVetiosClinicalActorGate>[0]['client'],
        requestId,
        actor: auth.actor,
        actionKey,
        resource: {
            type: parsed.data.action === 'record_agreement_event'
                ? 'amr_exchange_agreement'
                : 'amr_exchange_settlement',
            id: resourceId,
            tenantId: auth.actor.tenantId,
        },
        evidence: {
            route: 'api/amr/private-exchange',
            operation: parsed.data.action,
        },
    });
    if (!trustGate.ok) return withHeaders(trustGate.response, requestId, startTime);

    const actorId = auth.actor.userId
        ?? auth.actor.principalLabel
        ?? auth.actor.oauthClientId
        ?? 'unknown_actor';
    let response: NextResponse;
    if (parsed.data.action === 'record_agreement_event') {
        response = await recordAgreementEvent({
            supabase,
            tenantId: auth.actor.tenantId,
            actorId,
            body: parsed.data,
        });
    } else if (parsed.data.action === 'materialize_settlement') {
        response = await materializeSettlement({
            supabase,
            tenantId: auth.actor.tenantId,
            actorId,
            body: parsed.data,
        });
    } else {
        response = await recordSettlementState({
            supabase,
            tenantId: auth.actor.tenantId,
            actorId,
            body: parsed.data,
        });
    }
    return withHeaders(response, requestId, startTime);
}

async function recordAgreementEvent(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    actorId: string;
    body: z.infer<typeof RecordAgreementSchema>;
}) {
    const agreementId = input.body.agreement_id ?? randomUUID();
    const current = await loadAgreementEvents(input.supabase, input.tenantId, agreementId);
    if (current.error) return storageError(current.error, input.body.request_id);
    const transitionError = validateAMRExchangeAgreementTransition(
        current.rows,
        input.body.event_type,
    );
    if (transitionError) {
        return NextResponse.json({ error: transitionError }, { status: 409 });
    }

    const previous = current.rows.length > 0
        ? buildAMRExchangeAgreementSummaries(current.rows)[0] ?? null
        : null;
    const contract = {
        product_key: input.body.product_key ?? previous?.product_key,
        provider_site_id: input.body.provider_site_id ?? previous?.provider_site_id ?? null,
        consumer_tenant_id: input.body.consumer_tenant_id ?? previous?.consumer_tenant_id ?? null,
        counterparty_ref_hash: input.body.counterparty_ref
            ? hashAMRNetworkValue(input.body.counterparty_ref)
            : previous?.counterparty_ref_hash ?? null,
        purpose: input.body.purpose ?? previous?.purpose,
        license_key: input.body.license_key ?? previous?.license_key,
        privacy_class: input.body.privacy_class ?? previous?.privacy_class,
        permitted_species: input.body.permitted_species ?? previous?.permitted_species ?? [],
        permitted_geographies: input.body.permitted_geographies ?? previous?.permitted_geographies ?? [],
        permitted_use_cases: input.body.permitted_use_cases ?? previous?.permitted_use_cases ?? [],
        pricing_model: input.body.pricing_model ?? previous?.pricing_model,
        currency: input.body.currency ?? previous?.currency ?? 'USD',
        unit_price_minor: input.body.unit_price_minor ?? previous?.unit_price_minor ?? 0,
        platform_fee_bps: input.body.platform_fee_bps ?? previous?.platform_fee_bps ?? 0,
        terms_hash: input.body.terms_hash ?? previous?.terms_hash,
        data_use_agreement_hash: input.body.data_use_agreement_hash
            ?? previous?.data_use_agreement_hash,
        effective_at: input.body.effective_at ?? previous?.effective_at ?? null,
        expires_at: input.body.expires_at ?? previous?.expires_at ?? null,
    };
    const missing = requiredAgreementFields(contract);
    if (missing.length > 0) {
        return NextResponse.json({
            error: 'agreement_contract_incomplete',
            missing_fields: missing,
        }, { status: 400 });
    }
    if (!contract.consumer_tenant_id && !contract.counterparty_ref_hash) {
        return NextResponse.json({ error: 'agreement_counterparty_required' }, { status: 400 });
    }
    if (contract.expires_at && Date.parse(contract.expires_at) <= Date.now()) {
        return NextResponse.json({ error: 'agreement_expiry_must_be_future' }, { status: 400 });
    }

    const event = {
        tenant_id: input.tenantId,
        request_id: input.body.request_id,
        agreement_id: agreementId,
        event_type: input.body.event_type,
        ...contract,
        metadata: input.body.metadata ?? {},
        actor_id: input.actorId,
    };
    const inserted = await insertIdempotent(
        input.supabase,
        'amr_exchange_agreement_events',
        input.tenantId,
        input.body.request_id,
        { ...event, event_hash: hashAMRNetworkJson(event) },
    );
    if (inserted.error) return storageError(inserted.error, input.body.request_id);

    return NextResponse.json({
        agreement_id: agreementId,
        agreement_event_id: inserted.id,
        event_type: input.body.event_type,
        cached: inserted.cached,
        error: null,
    }, { status: inserted.cached ? 200 : 201 });
}

async function materializeSettlement(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    actorId: string;
    body: z.infer<typeof MaterializeSettlementSchema>;
}) {
    const loaded = await loadExchangeData(input.supabase, input.tenantId);
    if (loaded.error) return storageError(loaded.error, input.body.request_id);
    const agreement = buildAMRExchangeAgreementSummaries(loaded.agreements)
        .find((row) => row.agreement_id === input.body.agreement_id);
    if (!agreement) {
        return NextResponse.json({ error: 'agreement_not_found' }, { status: 404 });
    }
    if (!agreement.active) {
        return NextResponse.json({
            error: 'active_agreement_required',
            blockers: agreement.blockers,
        }, { status: 409 });
    }

    let preview;
    try {
        preview = buildAMRSettlementPreview({
            agreement,
            usageEvents: loaded.usage,
            priorSettlementEvents: loaded.settlements,
            periodStart: input.body.period_start,
            periodEnd: input.body.period_end,
        });
    } catch (error) {
        return NextResponse.json({
            error: 'settlement_preview_failed',
            detail: error instanceof Error ? error.message : 'Settlement preview failed.',
        }, { status: 409 });
    }
    if (preview.usage_event_count === 0) {
        return NextResponse.json({ error: 'no_unsettled_usage_in_period' }, { status: 409 });
    }

    const settlementId = input.body.settlement_id ?? randomUUID();
    const event = {
        tenant_id: input.tenantId,
        request_id: input.body.request_id,
        settlement_id: settlementId,
        agreement_id: input.body.agreement_id,
        event_type: 'calculated',
        period_start: input.body.period_start,
        period_end: input.body.period_end,
        usage_event_count: preview.usage_event_count,
        total_quantity: preview.total_quantity,
        gross_amount_minor: preview.gross_amount_minor,
        platform_fee_minor: preview.platform_fee_minor,
        provider_net_amount_minor: preview.provider_net_amount_minor,
        currency: preview.currency,
        source_digest_bundle_hash: preview.source_digest_bundle_hash,
        evidence: {
            usage_event_ids: preview.usage_event_ids,
            payment_executed: false,
        },
        actor_id: input.actorId,
    };
    const inserted = await insertIdempotent(
        input.supabase,
        'amr_exchange_settlement_events',
        input.tenantId,
        input.body.request_id,
        { ...event, event_hash: hashAMRNetworkJson(event) },
    );
    if (inserted.error) return storageError(inserted.error, input.body.request_id);

    return NextResponse.json({
        settlement_id: settlementId,
        settlement_event_id: inserted.id,
        event_type: 'calculated',
        preview,
        payment_executed: false,
        cached: inserted.cached,
        error: null,
    }, { status: inserted.cached ? 200 : 201 });
}

async function recordSettlementState(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    actorId: string;
    body: z.infer<typeof RecordSettlementStateSchema>;
}) {
    const current = await loadSettlementEvents(
        input.supabase,
        input.tenantId,
        input.body.settlement_id,
    );
    if (current.error) return storageError(current.error, input.body.request_id);
    const previous = current.rows.at(-1);
    if (!previous) {
        return NextResponse.json({ error: 'calculated_settlement_required' }, { status: 409 });
    }
    const transitionError = validateSettlementTransition(
        previous.event_type,
        input.body.event_type,
    );
    if (transitionError) {
        return NextResponse.json({ error: transitionError }, { status: 409 });
    }
    if (input.body.event_type === 'paid' && !input.body.confirmation_hash) {
        return NextResponse.json({ error: 'payment_confirmation_hash_required' }, { status: 400 });
    }

    const event = {
        tenant_id: input.tenantId,
        request_id: input.body.request_id,
        settlement_id: previous.settlement_id,
        agreement_id: previous.agreement_id,
        event_type: input.body.event_type,
        period_start: previous.period_start,
        period_end: previous.period_end,
        usage_event_count: previous.usage_event_count,
        total_quantity: previous.total_quantity,
        gross_amount_minor: previous.gross_amount_minor,
        platform_fee_minor: previous.platform_fee_minor,
        provider_net_amount_minor: previous.provider_net_amount_minor,
        currency: previous.currency,
        source_digest_bundle_hash: previous.source_digest_bundle_hash,
        evidence: {
            ...(input.body.evidence ?? {}),
            confirmation_hash: input.body.confirmation_hash ?? null,
            payment_executed_by_vetios: false,
        },
        actor_id: input.actorId,
    };
    const inserted = await insertIdempotent(
        input.supabase,
        'amr_exchange_settlement_events',
        input.tenantId,
        input.body.request_id,
        { ...event, event_hash: hashAMRNetworkJson(event) },
    );
    if (inserted.error) return storageError(inserted.error, input.body.request_id);

    return NextResponse.json({
        settlement_id: previous.settlement_id,
        settlement_event_id: inserted.id,
        event_type: input.body.event_type,
        payment_executed_by_vetios: false,
        cached: inserted.cached,
        error: null,
    }, { status: inserted.cached ? 200 : 201 });
}

function validateSettlementTransition(previous: string, next: string): string | null {
    if (previous === 'paid' || previous === 'voided') return 'terminal_settlement_cannot_transition';
    if (next === 'voided') return null;
    if (next === 'approved') return previous === 'calculated' ? null : 'calculated_settlement_required';
    if (next === 'invoiced') return previous === 'approved' ? null : 'approved_settlement_required';
    if (next === 'paid') return previous === 'invoiced' ? null : 'invoiced_settlement_required';
    return 'invalid_settlement_transition';
}

function requiredAgreementFields(contract: Record<string, unknown>): string[] {
    return [
        'product_key',
        'purpose',
        'license_key',
        'privacy_class',
        'pricing_model',
        'terms_hash',
        'data_use_agreement_hash',
    ].filter((key) => contract[key] == null || contract[key] === '');
}

async function loadExchangeData(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
) {
    const [agreements, usage, settlements] = await Promise.all([
        supabase.from('amr_exchange_agreement_events').select('*')
            .eq('tenant_id', tenantId).order('occurred_at', { ascending: true }).limit(10_000),
        supabase.from('amr_exchange_usage_events').select('*')
            .eq('tenant_id', tenantId).order('metered_at', { ascending: false }).limit(50_000),
        supabase.from('amr_exchange_settlement_events').select('*')
            .eq('tenant_id', tenantId).order('occurred_at', { ascending: true }).limit(10_000),
    ]);
    return {
        agreements: (agreements.data ?? []) as AMRExchangeAgreementEventRow[],
        usage: (usage.data ?? []) as AMRExchangeUsageEventRow[],
        settlements: (settlements.data ?? []) as AMRExchangeSettlementEventRow[],
        error: agreements.error?.message
            ?? usage.error?.message
            ?? settlements.error?.message
            ?? null,
    };
}

async function loadAgreementEvents(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    agreementId: string,
) {
    const { data, error } = await supabase
        .from('amr_exchange_agreement_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('agreement_id', agreementId)
        .order('occurred_at', { ascending: true })
        .limit(1_000);
    return {
        rows: (data ?? []) as AMRExchangeAgreementEventRow[],
        error: error?.message ?? null,
    };
}

async function loadSettlementEvents(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    settlementId: string,
) {
    const { data, error } = await supabase
        .from('amr_exchange_settlement_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('settlement_id', settlementId)
        .order('occurred_at', { ascending: true })
        .limit(1_000);
    return {
        rows: (data ?? []) as AMRExchangeSettlementEventRow[],
        error: error?.message ?? null,
    };
}

async function insertIdempotent(
    supabase: ReturnType<typeof getSupabaseServer>,
    table: string,
    tenantId: string,
    requestId: string,
    payload: Record<string, unknown>,
) {
    const { data, error } = await supabase.from(table).insert(payload).select('id').single();
    if (!error && data?.id) {
        return { id: String(data.id), cached: false, error: null as string | null };
    }
    if (error?.code !== '23505') {
        return { id: null, cached: false, error: error?.message ?? 'Insert failed.' };
    }
    const { data: existing, error: existingError } = await supabase
        .from(table)
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    return {
        id: existing?.id ? String(existing.id) : null,
        cached: Boolean(existing?.id),
        error: existingError?.message ?? (existing?.id ? null : error.message),
    };
}

function storageError(message: string, requestId: string) {
    const missingSchema = /relation .* does not exist|schema cache|could not find the table/i.test(message);
    return NextResponse.json({
        error: missingSchema
            ? 'amr_network_operations_migration_required'
            : 'amr_private_exchange_storage_failed',
        detail: message,
        migration: missingSchema
            ? 'supabase/migrations/20260730000000_amr_network_operations_exchange.sql'
            : undefined,
        request_id: requestId,
    }, { status: 503 });
}

function withHeaders(response: NextResponse, requestId: string, startTime: number) {
    response.headers.set('Cache-Control', 'private, no-store');
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
