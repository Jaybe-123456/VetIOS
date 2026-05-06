import { createHash, createHmac, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { authorizeCronRequest } from '@/lib/http/cronAuth';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { createOutboxEvent } from '@/lib/outbox/outbox-service';

const SPECIES = [
    'canine',
    'feline',
    'equine',
    'bovine',
    'ovine',
    'caprine',
    'porcine',
    'avian',
    'reptile',
    'rabbit',
    'ferret',
    'other',
] as const;

const SYMPTOM_CODES = [
    'vomiting',
    'diarrhea',
    'lethargy',
    'anorexia',
    'cough',
    'dyspnea',
    'tachycardia',
    'bradycardia',
    'fever',
    'hypothermia',
    'collapse',
    'seizure',
    'ataxia',
    'abdominal_distension',
    'pain_abdominal',
    'polyuria',
    'polydipsia',
    'lameness',
    'pruritus',
    'ocular_discharge',
    'nasal_discharge',
    'weight_loss',
    'pale_mucous_membranes',
    'cyanosis',
] as const;

const MM_COLORS = ['pink', 'pale', 'cyanotic', 'icteric', 'brick_red', 'muddy'] as const;
const LAB_PANEL_RULES = [
    { panel_code: 'cbc', trigger: ['fever', 'lethargy', 'pale_mucous_membranes'], lift: 0.18 },
    { panel_code: 'serum_chemistry', trigger: ['vomiting', 'diarrhea', 'anorexia', 'weight_loss'], lift: 0.16 },
    { panel_code: 'electrolytes', trigger: ['collapse', 'vomiting', 'diarrhea'], lift: 0.14 },
    { panel_code: 'thoracic_imaging_followup', trigger: ['cough', 'dyspnea', 'cyanosis'], lift: 0.2 },
    { panel_code: 'urinalysis', trigger: ['polyuria', 'polydipsia'], lift: 0.15 },
] as const;

const IntakeSchema = z.object({
    patient_id: z.string().uuid(),
    species: z.enum(SPECIES),
    weight_kg: z.number().positive().optional(),
    age_years: z.number().min(0).optional(),
    presenting_symptoms: z.array(z.enum(SYMPTOM_CODES)).min(1),
    vitals: z.object({
        temp_c: z.number().min(25).max(45).optional(),
        hr_bpm: z.number().int().min(10).max(360).optional(),
        rr_bpm: z.number().int().min(1).max(220).optional(),
        mm_color: z.enum(MM_COLORS).optional(),
        cap_refill_s: z.number().min(0).max(10).optional(),
    }).default({}),
    medications_current: z.array(z.object({
        drug_code: z.string().min(1).max(80),
        drug_class: z.string().min(1).max(80).optional(),
    })).default([]),
    imaging_study_ids: z.array(z.string().uuid()).default([]),
    modality: z.enum(['in_clinic', 'telemedicine', 'asynchronous']).default('in_clinic'),
    teleconsult_session_id: z.string().uuid().optional(),
    teleconsult_provider_id: z.string().min(1).max(120).optional(),
    region_code: z.string().min(2).max(24).optional(),
});

const PopulationContributeSchema = z.object({
    outcome_event_id: z.string().uuid().optional(),
    inference_event_id: z.string().uuid().optional(),
    region_code: z.string().min(2).max(24).optional(),
}).refine((value) => value.outcome_event_id || value.inference_event_id, {
    message: 'outcome_event_id or inference_event_id is required.',
});

const AdverseEventSchema = z.object({
    inference_event_id: z.string().uuid().optional(),
    species: z.string().min(1),
    drug_code: z.string().min(1).max(80),
    drug_class: z.string().min(1).max(80),
    symptom_codes: z.array(z.string().min(1)).min(1),
    outcome_severity: z.enum(['mild', 'moderate', 'severe', 'fatal']),
    time_to_onset_hours: z.number().min(0).optional(),
    outcome_label: z.string().min(1).max(160),
});

const LabResultSchema = z.object({
    lab_recommendation_id: z.string().uuid(),
    panel_code: z.string().min(1).max(80),
    result_value: z.number(),
    unit: z.string().min(1).max(40),
    reference_range_low: z.number().optional(),
    reference_range_high: z.number().optional(),
    result_interpretation: z.enum(['normal', 'low', 'high', 'critical_low', 'critical_high']),
    received_at: z.string().datetime().optional(),
});

const TelemetryIngestSchema = z.object({
    tenant_id: z.string().uuid(),
    patient_id: z.string().uuid(),
    device_id: z.string().min(1).max(120),
    device_type: z.enum(['collar', 'implant', 'patch', 'external_monitor']),
    species: z.enum(SPECIES).default('canine'),
    readings: z.array(z.object({
        metric_type: z.enum(['heart_rate_bpm', 'temperature_c', 'respiratory_rate_bpm', 'activity_score', 'spo2_pct', 'glucose_mmol']),
        value: z.number(),
        recorded_at: z.string().datetime(),
        quality_score: z.number().min(0).max(1).default(1),
    })).min(1).max(Number(process.env.VETIOS_TELEMETRY_BATCH_MAX_READINGS ?? 500)),
});

export async function handleIntakePost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['inference:write'] });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);

    const parsed = await parseBody(req, IntakeSchema, requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const tenantId = auth.actor.tenantId;
    const inferencePayload = buildInferencePayload(parsed, tenantId, 'intake');
    const inference = await callInternalInference(req, inferencePayload);
    const inferenceEventId = readString(inference.inference_event_id) ?? readString(inference.data?.inference_event_id);
    if (!inferenceEventId) return jsonError('inference_failed', 'Intake inference did not return an inference_event_id.', 502, requestId, startTime);

    const confidence = readNumber(inference.confidence_score) ?? readNumber(inference.data?.confidence_score);
    const differentials = readDifferentials(inference);
    const topDifferential = readTopDifferential(differentials);
    const gate = Number(process.env.VETIOS_CONFIDENCE_GATE_THRESHOLD ?? 0.65);
    const surfacedDifferentials = confidence == null || confidence >= gate ? differentials : [];

    const { data, error } = await supabase
        .from('intake_sessions')
        .insert({
            tenant_id: tenantId,
            patient_id: parsed.patient_id,
            species: parsed.species,
            weight_kg: parsed.weight_kg ?? null,
            age_years: parsed.age_years ?? null,
            presenting_symptoms: parsed.presenting_symptoms,
            vitals: parsed.vitals,
            medications_current: parsed.medications_current,
            imaging_study_ids: parsed.imaging_study_ids,
            modality: parsed.modality,
            teleconsult_session_id: parsed.teleconsult_session_id ?? null,
            teleconsult_provider_id: parsed.teleconsult_provider_id ?? null,
            inference_event_id: inferenceEventId,
            status: 'inferred',
        })
        .select('id,event_hash')
        .single();
    if (error || !data) return jsonError('intake_persist_failed', error?.message ?? 'Failed to persist intake.', 500, requestId, startTime);

    await emitMoatEvent(supabase, {
        tenantId,
        eventName: 'intake.inferred',
        aggregateType: 'intake_session',
        aggregateId: String(data.id),
        payload: {
            intake_session_id: data.id,
            inference_event_id: inferenceEventId,
            confidence_score: confidence,
            top_differential: topDifferential,
            symptom_codes: parsed.presenting_symptoms,
            region_code: parsed.region_code ?? null,
        },
    });

    return jsonOk({
        intake_session_id: data.id,
        inference_event_id: inferenceEventId,
        confidence_score: confidence,
        top_differential: topDifferential,
        differentials: surfacedDifferentials,
    }, requestId, startTime, 201);
}

export async function handlePopulationContributePost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    if (process.env.VETIOS_POPULATION_SIGNAL_ENABLED !== 'true') {
        return jsonError('population_disabled', 'Population signal contribution is disabled.', 409, requestId, startTime);
    }
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['outcome:write'] });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);
    const parsed = await parseBody(req, PopulationContributeSchema, requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const signal = await createPopulationSignalFromReference(supabase, {
        tenantId: auth.actor.tenantId,
        outcomeEventId: parsed.outcome_event_id ?? null,
        inferenceEventId: parsed.inference_event_id ?? null,
        regionCode: parsed.region_code ?? null,
    });
    return jsonOk(signal, requestId, startTime, 201);
}

export async function handlePopulationCalibrationCron(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const auth = authorizeCronRequest(req, 'population-calibration');
    if (!auth.authorized) return jsonError('unauthorized_cron', auth.reason, 401, requestId, startTime);
    const supabase = getSupabaseServer();
    const cron = await startCronRun(supabase, 'population-calibration');
    try {
        const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const { data: signals, error } = await supabase
            .from('population_signals')
            .select('species,confidence_delta')
            .gte('created_at', since)
            .limit(5000);
        if (error) throw error;
        const rows = (signals ?? []) as Array<{ species?: string; confidence_delta?: number | null }>;
        const deltas = rows.map((row) => readNumber(row.confidence_delta)).filter((value): value is number => value != null);
        const mean = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0;
        const p95 = percentile(deltas, 0.95);
        const speciesBreakdowns = rows.reduce<Record<string, number>>((acc, row) => {
            const species = row.species ?? 'unknown';
            acc[species] = (acc[species] ?? 0) + 1;
            return acc;
        }, {});
        const { data: run, error: runError } = await supabase
            .from('calibration_runs')
            .insert({
                signals_consumed: rows.length,
                species_breakdowns: speciesBreakdowns,
                confidence_shift_mean: mean,
                confidence_shift_p95: p95,
                model_version_before: process.env.AI_PROVIDER_DEFAULT_MODEL ?? null,
                model_version_after: process.env.AI_PROVIDER_DEFAULT_MODEL ?? null,
                status: 'completed',
            })
            .select('id')
            .single();
        if (runError || !run) throw runError ?? new Error('Failed to write calibration run.');
        await emitMoatEvent(supabase, {
            tenantId: 'outbox_system',
            eventName: 'population.calibrated',
            aggregateType: 'calibration_run',
            aggregateId: String(run.id),
            payload: { calibration_run_id: run.id, signals_consumed: rows.length, confidence_shift_mean: mean, confidence_shift_p95: p95 },
        });
        await finishCronRun(supabase, cron.id, rows.length, 'completed', null);
        return jsonOk({ calibration_run_id: run.id, signals_consumed: rows.length, confidence_shift_mean: mean, confidence_shift_p95: p95 }, requestId, startTime);
    } catch (error) {
        await finishCronRun(supabase, cron.id, 0, 'failed', error instanceof Error ? error.message : String(error));
        return jsonError('population_calibration_failed', error instanceof Error ? error.message : 'Calibration failed.', 500, requestId, startTime);
    }
}

export async function handleAdverseEventPost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['outcome:write'] });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);
    const parsed = await parseBody(req, AdverseEventSchema, requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const inserted = await insertAdverseEventSignal(supabase, auth.actor.tenantId, parsed, parsed.inference_event_id ?? null);
    return jsonOk(inserted, requestId, startTime, 201);
}

export async function handlePharmaSignalsGet(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const licensee = await resolveResearchLicensee(req, supabase);
    if (!licensee.ok) return jsonError('unauthorized', licensee.message, licensee.status, requestId, startTime);
    const url = new URL(req.url);
    let query = supabase
        .from('adverse_event_signals')
        .select('signal_id,species,drug_code,drug_class,symptom_codes,outcome_severity,created_at')
        .order('created_at', { ascending: false })
        .limit(Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 50), 250)));
    const species = url.searchParams.get('species');
    const drugClass = url.searchParams.get('drug_class');
    const severity = url.searchParams.get('severity');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (species) query = query.eq('species', species);
    if (drugClass) query = query.eq('drug_class', drugClass);
    if (severity) query = query.eq('outcome_severity', severity);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    const { data, error } = await query;
    if (error) return jsonError('pharma_signal_query_failed', error.message, 500, requestId, startTime);
    return jsonOk({ signals: data ?? [], licensee_id: licensee.licenseeId }, requestId, startTime);
}

export async function handlePharmaWebhookSubscribePost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const licensee = await resolveResearchLicensee(req, supabase);
    if (!licensee.ok) return jsonError('unauthorized', licensee.message, licensee.status, requestId, startTime);
    const parsed = await parseBody(req, z.object({
        webhook_url: z.string().url(),
        species_filter: z.array(z.string()).default([]),
        drug_class_filter: z.array(z.string()).default([]),
    }), requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const { data, error } = await supabase
        .from('pharma_webhook_subscriptions')
        .insert({
            licensee_id: licensee.licenseeId,
            webhook_url: parsed.webhook_url,
            species_filter: parsed.species_filter,
            drug_class_filter: parsed.drug_class_filter,
            active: true,
        })
        .select('id')
        .single();
    if (error || !data) return jsonError('pharma_webhook_subscribe_failed', error?.message ?? 'Subscription failed.', 500, requestId, startTime);
    await emitMoatEvent(supabase, {
        tenantId: 'outbox_system',
        eventName: 'pharma.webhook_subscribed',
        aggregateType: 'pharma_licensee',
        aggregateId: licensee.licenseeId,
        payload: { subscription_id: data.id, webhook_url: parsed.webhook_url },
    });
    return jsonOk({ subscription_id: data.id }, requestId, startTime, 201);
}

export async function handleImagingIngestPost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    if (!hasPassiveIngestKey(req)) return jsonError('unauthorized', 'Invalid passive connector ingest key.', 401, requestId, startTime);
    const supabase = getSupabaseServer();
    const form = await req.formData();
    const metadataRaw = form.get('metadata');
    const metadata = typeof metadataRaw === 'string' ? JSON.parse(metadataRaw) as Record<string, unknown> : {};
    const file = form.get('file');
    const tenantId = readString(metadata.tenant_id);
    const patientId = readString(metadata.patient_id);
    const studyId = readString(metadata.study_id);
    const species = readString(metadata.species) ?? 'canine';
    const modality = readString(metadata.modality) ?? 'xray';
    const bodyRegion = readString(metadata.body_region) ?? 'unspecified';
    if (!tenantId || !patientId || !studyId) return jsonError('bad_request', 'metadata.tenant_id, patient_id, and study_id are required.', 400, requestId, startTime);
    const storageUrl = await storeImagingFile(supabase, tenantId, studyId, file);
    const enrichment = await enrichImagingStudy(metadata, file);
    const { data, error } = await supabase
        .from('imaging_studies')
        .insert({
            tenant_id: tenantId,
            patient_id: patientId,
            study_id: studyId,
            modality,
            body_region: bodyRegion,
            species,
            acquisition_at: readString(metadata.acquisition_at) ?? new Date().toISOString(),
            storage_url: storageUrl,
            thumbnail_url: readString(metadata.thumbnail_url),
            inference_enrichment: enrichment,
            study_hash: hashRecord({ metadata, storage_url: storageUrl }),
            status: 'enriched',
        })
        .select('id')
        .single();
    if (error || !data) return jsonError('imaging_ingest_failed', error?.message ?? 'Failed to ingest imaging study.', 500, requestId, startTime);
    await emitMoatEvent(supabase, {
        tenantId,
        eventName: 'imaging.enriched',
        aggregateType: 'imaging_study',
        aggregateId: String(data.id),
        payload: { imaging_study_id: data.id, study_id: studyId, species, modality, body_region: bodyRegion },
    });
    return jsonOk({ imaging_study_id: data.id, inference_enrichment: enrichment }, requestId, startTime, 201);
}

export async function handleLabRecommendPost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 90, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['inference:write'] });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);
    const parsed = await parseBody(req, z.object({ inference_event_id: z.string().uuid() }), requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const recommendation = await createLabRecommendationForInference(supabase, auth.actor.tenantId, parsed.inference_event_id);
    return jsonOk(recommendation, requestId, startTime, 201);
}

export async function handleLabResultPost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 90, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['outcome:write'] });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);
    const parsed = await parseBody(req, LabResultSchema, requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const { data: rec, error: recError } = await supabase
        .from('lab_recommendations')
        .select('id,inference_event_id,tenant_id')
        .eq('id', parsed.lab_recommendation_id)
        .single();
    if (recError || !rec) return jsonError('lab_recommendation_not_found', 'Lab recommendation was not found.', 404, requestId, startTime);
    if (String(rec.tenant_id) !== auth.actor.tenantId) return jsonError('forbidden', 'Lab recommendation belongs to another tenant.', 403, requestId, startTime);
    const { data, error } = await supabase
        .from('lab_results')
        .insert({
            tenant_id: auth.actor.tenantId,
            lab_recommendation_id: parsed.lab_recommendation_id,
            panel_code: parsed.panel_code,
            result_value: parsed.result_value,
            unit: parsed.unit,
            reference_range_low: parsed.reference_range_low ?? null,
            reference_range_high: parsed.reference_range_high ?? null,
            result_interpretation: parsed.result_interpretation,
            received_at: parsed.received_at ?? new Date().toISOString(),
        })
        .select('id')
        .single();
    if (error || !data) return jsonError('lab_result_failed', error?.message ?? 'Failed to persist lab result.', 500, requestId, startTime);
    let updatedInferenceEventId: string | null = null;
    let reinferenceError: string | null = null;
    try {
        const { data: original } = await supabase
            .from('ai_inference_events')
            .select('model_name,model_version,input_signature')
            .eq('id', rec.inference_event_id)
            .single();
        if (original) {
            const signature = asRecord(original.input_signature);
            const priorLabResults = Array.isArray(signature.lab_results) ? signature.lab_results : [];
            const reinference = await callInternalInference(req, {
                model: {
                    name: readString(original.model_name) ?? process.env.AI_PROVIDER_DEFAULT_MODEL ?? 'gpt-4o-mini',
                    version: readString(original.model_version) ?? process.env.AI_PROVIDER_DEFAULT_MODEL ?? 'gpt-4o-mini',
                },
                input: {
                    input_signature: {
                        ...signature,
                        source: 'lab_result',
                        parent_inference_event_id: rec.inference_event_id,
                        lab_results: [
                            ...priorLabResults,
                            {
                                lab_result_id: data.id,
                                panel_code: parsed.panel_code,
                                result_value: parsed.result_value,
                                unit: parsed.unit,
                                reference_range_low: parsed.reference_range_low ?? null,
                                reference_range_high: parsed.reference_range_high ?? null,
                                result_interpretation: parsed.result_interpretation,
                                received_at: parsed.received_at ?? new Date().toISOString(),
                            },
                        ],
                        metadata: {
                            ...asRecord(signature.metadata),
                            source: 'lab_result',
                            parent_inference_event_id: rec.inference_event_id,
                        },
                    },
                },
            });
            updatedInferenceEventId = readString(reinference.inference_event_id)
                ?? readString(reinference.data?.inference_event_id)
                ?? null;
        }
    } catch (error) {
        reinferenceError = error instanceof Error ? error.message : 'Automatic re-inference failed.';
    }
    await emitMoatEvent(supabase, {
        tenantId: auth.actor.tenantId,
        eventName: 'labs.result_received',
        aggregateType: 'lab_recommendation',
        aggregateId: parsed.lab_recommendation_id,
        payload: {
            lab_result_id: data.id,
            inference_event_id: rec.inference_event_id,
            updated_inference_event_id: updatedInferenceEventId,
            panel_code: parsed.panel_code,
        },
    });
    return jsonOk({
        lab_result_id: data.id,
        parent_inference_event_id: rec.inference_event_id,
        updated_inference_event_id: updatedInferenceEventId,
        reinference_error: reinferenceError,
    }, requestId, startTime, 201);
}

export async function handleLabRecommendationsGet(req: Request, inferenceEventId: string) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['inference:write'] });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);
    const { data, error } = await supabase
        .from('lab_recommendations')
        .select('id,recommended_panels,agent_confidence,status,created_at')
        .eq('tenant_id', auth.actor.tenantId)
        .eq('inference_event_id', inferenceEventId)
        .order('created_at', { ascending: false });
    if (error) return jsonError('lab_recommendations_failed', error.message, 500, requestId, startTime);
    return jsonOk({ recommendations: data ?? [] }, requestId, startTime);
}

export async function handleAuditCaseGet(req: Request, caseId: string) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    if (!isInternalRequest(req) && !(await resolveAuditLicensee(req, getSupabaseServer())).ok) {
        return jsonError('unauthorized', 'Audit access requires an internal token or audit licensee key.', 401, requestId, startTime);
    }
    const chain = await loadCaseAuditChain(getSupabaseServer(), caseId);
    return jsonOk({ case_id: caseId, event_chain: chain, chain_valid: verifyLoadedChain(chain).chain_valid }, requestId, startTime);
}

export async function handleAuditVerifyPost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    if (!isInternalRequest(req) && !(await resolveAuditLicensee(req, getSupabaseServer())).ok) {
        return jsonError('unauthorized', 'Audit verification requires an internal token or audit licensee key.', 401, requestId, startTime);
    }
    const parsed = await parseBody(req, z.object({ case_id: z.string().uuid() }), requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const chain = await loadCaseAuditChain(getSupabaseServer(), parsed.case_id);
    return jsonOk(verifyLoadedChain(chain), requestId, startTime);
}

export async function handleAuditReportPost(req: Request, caseId: string) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    if (!isInternalRequest(req)) {
        const { requestId, startTime } = guard;
        return jsonError('unauthorized', 'Audit report generation requires VETIOS_INTERNAL_API_TOKEN.', 401, requestId, startTime);
    }
    const chain = await loadCaseAuditChain(getSupabaseServer(), caseId);
    const pdf = buildMinimalPdf(`VetIOS Audit Report\nCase: ${caseId}\nEvents: ${chain.length}\nChain valid: ${verifyLoadedChain(chain).chain_valid}`);
    return new NextResponse(pdf, {
        status: 200,
        headers: {
            'content-type': 'application/pdf',
            'content-disposition': `attachment; filename="vetios-audit-${caseId}.pdf"`,
        },
    });
}

export async function handleTeleconsultSessionPost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['inference:write'] });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);
    const parsed = await parseBody(req, z.object({
        patient_id: z.string().uuid(),
        species: z.enum(SPECIES),
        teleconsult_provider_id: z.string().min(1).max(120).optional(),
    }), requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const sessionId = randomUUID();
    const { data, error } = await supabase
        .from('intake_sessions')
        .insert({
            tenant_id: auth.actor.tenantId,
            patient_id: parsed.patient_id,
            species: parsed.species,
            presenting_symptoms: [],
            vitals: {},
            modality: 'telemedicine',
            teleconsult_session_id: sessionId,
            teleconsult_provider_id: parsed.teleconsult_provider_id ?? null,
            status: 'pending',
        })
        .select('id')
        .single();
    if (error || !data) return jsonError('teleconsult_session_failed', error?.message ?? 'Failed to create teleconsult session.', 500, requestId, startTime);
    await emitMoatEvent(supabase, {
        tenantId: auth.actor.tenantId,
        eventName: 'teleconsult.session_created',
        aggregateType: 'intake_session',
        aggregateId: String(data.id),
        payload: {
            intake_session_id: data.id,
            session_id: sessionId,
            patient_id: parsed.patient_id,
            species: parsed.species,
        },
    });
    return jsonOk({
        intake_session_id: data.id,
        session_id: sessionId,
        share_url: `${process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin}/teleconsult/${sessionId}`,
    }, requestId, startTime, 201);
}

export async function handleTeleconsultExtractPost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const auth = await resolveClinicalApiActor(req, { client: getSupabaseServer(), requiredScopes: ['inference:write'] });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);
    const parsed = await parseBody(req, z.object({
        species: z.enum(SPECIES),
        description: z.string().min(1).max(4000),
    }), requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const symptomCodes = await extractSymptomCodes(parsed.description, parsed.species);
    return jsonOk({ symptom_codes: symptomCodes, raw_text_discarded: true }, requestId, startTime);
}

export async function handleTeleconsultStreamGet(req: Request, sessionId: string) {
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['inference:write'] });
    if (auth.error || !auth.actor) {
        return new NextResponse('Unauthorized', { status: auth.error?.status ?? 401 });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`));
            controller.enqueue(encoder.encode(`event: inference\ndata: ${JSON.stringify({ differentials: [], confidence_score: null })}\n\n`));
            controller.close();
        },
    });
    return new NextResponse(stream, {
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
        },
    });
}

export async function handleOutbreakScanCron(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const auth = authorizeCronRequest(req, 'outbreak-scan');
    if (!auth.authorized) return jsonError('unauthorized_cron', auth.reason, 401, requestId, startTime);
    const supabase = getSupabaseServer();
    const cron = await startCronRun(supabase, 'outbreak-scan');
    try {
        const snapshots = await scanOutbreakClusters(supabase);
        await finishCronRun(supabase, cron.id, snapshots.length, 'completed', null);
        return jsonOk({ snapshots_created: snapshots.length, snapshots }, requestId, startTime);
    } catch (error) {
        await finishCronRun(supabase, cron.id, 0, 'failed', error instanceof Error ? error.message : String(error));
        return jsonError('outbreak_scan_failed', error instanceof Error ? error.message : 'Outbreak scan failed.', 500, requestId, startTime);
    }
}

export async function handleOutbreakClustersGet(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    if (!isInternalRequest(req)) return jsonError('unauthorized', 'Outbreak clusters require VETIOS_INTERNAL_API_TOKEN.', 401, requestId, startTime);
    const { data, error } = await getSupabaseServer()
        .from('symptom_cluster_snapshots')
        .select('*')
        .in('status', ['elevated', 'alert'])
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) return jsonError('outbreak_clusters_failed', error.message, 500, requestId, startTime);
    return jsonOk({ clusters: data ?? [] }, requestId, startTime);
}

export async function handleOutbreakSubscribePost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    if (!isInternalRequest(req)) return jsonError('unauthorized', 'Outbreak subscription requires VETIOS_INTERNAL_API_TOKEN.', 401, requestId, startTime);
    const parsed = await parseBody(req, z.object({
        organization_name: z.string().min(1).max(160),
        webhook_url: z.string().url(),
        region_filter: z.array(z.string()).default([]),
        species_filter: z.array(z.string()).default([]),
    }), requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const { data, error } = await getSupabaseServer()
        .from('outbreak_subscribers')
        .insert(parsed)
        .select('id')
        .single();
    if (error || !data) return jsonError('outbreak_subscribe_failed', error?.message ?? 'Failed to subscribe.', 500, requestId, startTime);
    await emitMoatEvent(getSupabaseServer(), {
        tenantId: 'outbox_system',
        eventName: 'outbreak.subscriber_created',
        aggregateType: 'outbreak_subscriber',
        aggregateId: String(data.id),
        payload: {
            subscriber_id: data.id,
            organization_name: parsed.organization_name,
            webhook_url: parsed.webhook_url,
        },
    });
    return jsonOk({ subscriber_id: data.id }, requestId, startTime, 201);
}

export async function handleTelemetryIngestPost(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 300, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    if (!hasPassiveIngestKey(req)) return jsonError('unauthorized', 'Invalid passive connector ingest key.', 401, requestId, startTime);
    const supabase = getSupabaseServer();
    const parsed = await parseBody(req, TelemetryIngestSchema, requestId, startTime);
    if (parsed instanceof NextResponse) return parsed;
    const rows = parsed.readings.map((reading) => ({
        tenant_id: parsed.tenant_id,
        patient_id: parsed.patient_id,
        device_id: parsed.device_id,
        device_type: parsed.device_type,
        metric_type: reading.metric_type,
        value: reading.value,
        recorded_at: reading.recorded_at,
        quality_score: reading.quality_score,
    }));
    const { error } = await supabase.from('telemetry_streams').insert(rows);
    if (error) return jsonError('telemetry_ingest_failed', error.message, 500, requestId, startTime);
    const anomalies = await detectTelemetryAnomalies(supabase, parsed);
    await emitMoatEvent(supabase, {
        tenantId: parsed.tenant_id,
        eventName: 'telemetry.ingested',
        aggregateType: 'telemetry_stream',
        aggregateId: parsed.patient_id,
        payload: { patient_id: parsed.patient_id, readings: rows.length, anomalies: anomalies.length },
    });
    return jsonOk({ readings_ingested: rows.length, anomalies }, requestId, startTime, 201);
}

export async function handleTelemetryLiveGet(req: Request, patientId: string) {
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase });
    if (auth.error || !auth.actor) {
        return new NextResponse('Unauthorized', { status: auth.error?.status ?? 401 });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const snapshot = await loadTelemetryPatientSnapshot(supabase, auth.actor!.tenantId, patientId);
            controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
            controller.close();
        },
    });
    return new NextResponse(stream, {
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
        },
    });
}

export async function handleTelemetryHistoryGet(req: Request, patientId: string) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase });
    if (auth.error || !auth.actor) return jsonError('unauthorized', auth.error?.message ?? 'Unauthorized', auth.error?.status ?? 401, requestId, startTime);
    const snapshot = await loadTelemetryPatientSnapshot(supabase, auth.actor.tenantId, patientId);
    return jsonOk(snapshot, requestId, startTime);
}

export async function enrichInferenceInputForMoat(
    supabase: SupabaseClient,
    tenantId: string,
    inputSignature: Record<string, unknown>,
) {
    const imagingRefs = Array.isArray(inputSignature.imaging_refs)
        ? inputSignature.imaging_refs.filter((value): value is string => typeof value === 'string')
        : [];
    if (imagingRefs.length > 0) {
        const { data } = await supabase
            .from('imaging_studies')
            .select('id,inference_enrichment,modality,body_region')
            .eq('tenant_id', tenantId)
            .in('id', imagingRefs)
            .limit(10);
        inputSignature.imaging_findings = (data ?? []).map((row) => ({
            imaging_study_id: row.id,
            modality: row.modality,
            body_region: row.body_region,
            findings: row.inference_enrichment,
        }));
    }

    const species = readString(inputSignature.species);
    if (species && ['avian', 'reptile', 'rabbit', 'ferret', 'bovine', 'ovine', 'caprine', 'porcine', 'equine'].includes(species)) {
        const { data } = await supabase
            .from('species_knowledge_graph')
            .select('condition_code,condition_name,symptom_codes,typical_vitals_range,pharmacological_contraindications,prevalence_weight')
            .eq('species', species)
            .order('created_at', { ascending: false })
            .limit(8);
        inputSignature.species_knowledge_graph_priors = data ?? [];
    }

    if (process.env.VETIOS_POPULATION_SIGNAL_ENABLED === 'true') {
        const { data } = await supabase
            .from('calibration_runs')
            .select('id,run_at,signals_consumed,species_breakdowns,confidence_shift_mean,confidence_shift_p95,model_version_after')
            .eq('status', 'completed')
            .order('run_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (data) {
            inputSignature.metadata = {
                ...asRecord(inputSignature.metadata),
                calibration_signal: data,
            };
        }
    }
}

export async function runMoatPostInferenceSideEffects(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        confidenceScore: number | null;
        outputPayload: Record<string, unknown>;
    },
) {
    if (process.env.VETIOS_MULTI_AGENT_ENABLED === 'true') {
        await createLabRecommendationForInference(supabase, input.tenantId, input.inferenceEventId).catch(() => null);
    }
    await emitMoatEvent(supabase, {
        tenantId: input.tenantId,
        eventName: 'inference.side_effects_enqueued',
        aggregateType: 'ai_inference_event',
        aggregateId: input.inferenceEventId,
        payload: {
            inference_event_id: input.inferenceEventId,
            confidence_score: input.confidenceScore,
            top_differential: readTopDifferential(readDifferentials({ data: { differentials: asArray(input.outputPayload.differentials) } })),
        },
    }).catch(() => null);
}

export async function runMoatPostOutcomeSideEffects(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        outcomeEventId: string;
        outcomePayload: Record<string, unknown>;
        inputSignature: Record<string, unknown>;
    },
) {
    if (process.env.VETIOS_POPULATION_SIGNAL_ENABLED === 'true') {
        await createPopulationSignalFromReference(supabase, {
            tenantId: input.tenantId,
            outcomeEventId: input.outcomeEventId,
            inferenceEventId: input.inferenceEventId,
            regionCode: readString(input.inputSignature.region_code) ?? readString(asRecord(input.inputSignature.metadata).region_code),
        }).catch(() => null);
    }
    const drug = asRecord(input.outcomePayload.drug_administered ?? input.outcomePayload.medication_administered);
    const drugCode = readString(drug.drug_code ?? drug.code);
    if (drugCode) {
        await insertAdverseEventSignal(supabase, input.tenantId, {
            species: readString(input.inputSignature.species) ?? 'unknown',
            drug_code: drugCode,
            drug_class: readString(drug.drug_class) ?? 'unknown',
            symptom_codes: readStringArray(input.inputSignature.symptoms).length
                ? readStringArray(input.inputSignature.symptoms)
                : readStringArray(input.inputSignature.presenting_symptoms),
            outcome_severity: normalizeSeverity(readString(input.outcomePayload.severity) ?? readString(drug.severity)),
            time_to_onset_hours: readNumber(drug.time_to_onset_hours) ?? undefined,
            outcome_label: readString(input.outcomePayload.ground_truth) ?? readString(input.outcomePayload.outcome_label) ?? 'observed_outcome',
        }, input.inferenceEventId).catch(() => null);
    }
}

async function createPopulationSignalFromReference(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        outcomeEventId: string | null;
        inferenceEventId: string | null;
        regionCode: string | null;
    },
) {
    let inferenceEventId = input.inferenceEventId;
    let outcomePayload: Record<string, unknown> = {};
    if (input.outcomeEventId) {
        const { data } = await supabase
            .from('clinical_outcome_events')
            .select('inference_event_id,outcome_payload')
            .eq('id', input.outcomeEventId)
            .maybeSingle();
        inferenceEventId = readString(data?.inference_event_id) ?? inferenceEventId;
        outcomePayload = asRecord(data?.outcome_payload);
    }
    if (!inferenceEventId) throw new Error('inference_event_id is required.');
    const { data: inference, error } = await supabase
        .from('ai_inference_events')
        .select('id,tenant_id,input_signature,output_payload,confidence_score,event_hash')
        .eq('id', inferenceEventId)
        .single();
    if (error || !inference) throw error ?? new Error('Inference event was not found.');
    if (String(inference.tenant_id) !== input.tenantId) throw new Error('Inference event belongs to another tenant.');
    const signature = asRecord(inference.input_signature);
    const output = asRecord(inference.output_payload);
    const symptomVector = readStringArray(signature.symptoms).length
        ? readStringArray(signature.symptoms)
        : readStringArray(signature.presenting_symptoms);
    const outcomeLabel = readString(outcomePayload.ground_truth)
        ?? readString(outcomePayload.outcome_label)
        ?? readTopDifferential(readDifferentials({ data: { output } }))
        ?? 'unlabeled_outcome';
    const confidenceDelta = readNumber(inference.confidence_score) == null ? null : Number((1 - Number(inference.confidence_score)).toFixed(4));
    const signalBody = {
        species: readString(signature.species) ?? 'unknown',
        region_code: input.regionCode ?? readString(signature.region_code) ?? readString(asRecord(signature.metadata).region_code),
        symptom_vector: symptomVector,
        outcome_label: outcomeLabel,
        confidence_delta: confidenceDelta,
        source_tenant_hash: hashTenant(input.tenantId),
        source_inference_event_hash: readString(inference.event_hash),
    };
    const { data, error: insertError } = await supabase
        .from('population_signals')
        .insert({
            ...signalBody,
            signal_hash: hashRecord(signalBody),
        })
        .select('id,signal_hash')
        .single();
    if (insertError || !data) throw insertError ?? new Error('Failed to write population signal.');
    await emitMoatEvent(supabase, {
        tenantId: input.tenantId,
        eventName: 'population.signal_contributed',
        aggregateType: 'population_signal',
        aggregateId: String(data.id),
        payload: { population_signal_id: data.id, signal_hash: data.signal_hash, inference_event_id: inferenceEventId },
    });
    return { population_signal_id: data.id, signal_hash: data.signal_hash };
}

async function insertAdverseEventSignal(
    supabase: SupabaseClient,
    tenantId: string,
    input: z.infer<typeof AdverseEventSchema> | Omit<z.infer<typeof AdverseEventSchema>, 'inference_event_id'>,
    inferenceEventId: string | null,
) {
    const source = {
        tenant_hash: hashTenant(tenantId),
        inference_event_id: inferenceEventId,
        species: input.species,
        drug_code: input.drug_code,
        symptom_codes: input.symptom_codes,
        outcome_label: input.outcome_label,
    };
    const { data, error } = await supabase
        .from('adverse_event_signals')
        .insert({
            tenant_id: tenantId,
            signal_id: randomUUID(),
            species: input.species,
            drug_code: input.drug_code,
            drug_class: input.drug_class,
            symptom_codes: input.symptom_codes,
            outcome_severity: input.outcome_severity,
            time_to_onset_hours: input.time_to_onset_hours ?? null,
            outcome_label: input.outcome_label,
            source_signal_hash: hashRecord(source),
        })
        .select('id,signal_id')
        .single();
    if (error || !data) throw error ?? new Error('Failed to write adverse event signal.');
    await emitMoatEvent(supabase, {
        tenantId,
        eventName: 'adverse_event.signal_created',
        aggregateType: 'adverse_event_signal',
        aggregateId: String(data.id),
        payload: { adverse_event_signal_id: data.id, signal_id: data.signal_id, drug_code: input.drug_code },
    });
    return { adverse_event_signal_id: data.id, signal_id: data.signal_id };
}

async function createLabRecommendationForInference(supabase: SupabaseClient, tenantId: string, inferenceEventId: string) {
    const { data: inference, error } = await supabase
        .from('ai_inference_events')
        .select('id,tenant_id,case_id,input_signature,output_payload,confidence_score')
        .eq('id', inferenceEventId)
        .single();
    if (error || !inference) throw error ?? new Error('Inference event not found.');
    if (String(inference.tenant_id) !== tenantId) throw new Error('Inference event belongs to another tenant.');
    const signature = asRecord(inference.input_signature);
    const symptoms = new Set([
        ...readStringArray(signature.symptoms),
        ...readStringArray(signature.presenting_symptoms),
    ]);
    const panels = LAB_PANEL_RULES
        .map((rule) => {
            const matched = rule.trigger.filter((symptom) => symptoms.has(symptom));
            return {
                panel_code: rule.panel_code,
                rationale: matched.length
                    ? `Matches structured signals: ${matched.join(', ')}`
                    : 'Baseline uncertainty reduction for current differential matrix.',
                priority: matched.length >= 2 ? 'high' : matched.length === 1 ? 'moderate' : 'low',
                estimated_diagnostic_lift: matched.length ? rule.lift : 0.08,
            };
        })
        .sort((left, right) => right.estimated_diagnostic_lift - left.estimated_diagnostic_lift)
        .slice(0, 4);
    const agentConfidence = Math.min(0.95, 0.55 + panels.reduce((sum, panel) => sum + panel.estimated_diagnostic_lift, 0));
    const patientId = readString(signature.patient_id) ?? readString(asRecord(signature.metadata).patient_id);
    const { data, error: insertError } = await supabase
        .from('lab_recommendations')
        .insert({
            tenant_id: tenantId,
            inference_event_id: inferenceEventId,
            patient_id: patientId,
            recommended_panels: panels,
            agent_confidence: agentConfidence,
            status: 'recommended',
        })
        .select('id')
        .single();
    if (insertError || !data) throw insertError ?? new Error('Failed to write lab recommendation.');
    await emitMoatEvent(supabase, {
        tenantId,
        eventName: 'labs.recommended',
        aggregateType: 'lab_recommendation',
        aggregateId: String(data.id),
        payload: { lab_recommendation_id: data.id, inference_event_id: inferenceEventId, recommended_panels: panels },
    });
    return { lab_recommendation_id: data.id, recommended_panels: panels, agent_confidence: agentConfidence };
}

async function scanOutbreakClusters(supabase: SupabaseClient) {
    const now = Date.now();
    const currentSince = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const previousSince = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
    const [current, previous] = await Promise.all([
        supabase.from('population_signals').select('*').gte('created_at', currentSince).limit(5000),
        supabase.from('population_signals').select('*').gte('created_at', previousSince).lt('created_at', currentSince).limit(5000),
    ]);
    if (current.error) throw current.error;
    if (previous.error) throw previous.error;
    const currentGroups = groupPopulationSignals(current.data ?? []);
    const previousGroups = groupPopulationSignals(previous.data ?? []);
    const elevatedThreshold = Number(process.env.VETIOS_OUTBREAK_VELOCITY_THRESHOLD ?? 0.4);
    const alertThreshold = Number(process.env.VETIOS_OUTBREAK_ALERT_THRESHOLD ?? 1.0);
    const minCount = Number(process.env.VETIOS_OUTBREAK_MIN_CASE_COUNT ?? 5);
    const snapshots: unknown[] = [];
    for (const [key, group] of currentGroups.entries()) {
        const previousCount = previousGroups.get(key)?.count ?? 0;
        const velocity = previousCount === 0 ? group.count : (group.count - previousCount) / previousCount;
        const status = velocity > alertThreshold && group.count >= Math.max(10, minCount)
            ? 'alert'
            : velocity > elevatedThreshold && group.count >= minCount
                ? 'elevated'
                : 'monitoring';
        if (status === 'monitoring') continue;
        const row = {
            region_code: group.region_code,
            species: group.species,
            symptom_signature: group.symptom_signature,
            case_count_7d: group.count,
            case_count_prev_7d: previousCount,
            velocity,
            status,
            suggested_differential: group.outcome_label,
            confidence: group.confidence,
        };
        const { data, error } = await supabase.from('symptom_cluster_snapshots').insert(row).select('id').single();
        if (error) throw error;
        snapshots.push({ ...row, id: data.id });
        await emitMoatEvent(supabase, {
            tenantId: 'outbox_system',
            eventName: 'outbreak.snapshot_created',
            aggregateType: 'symptom_cluster_snapshot',
            aggregateId: String(data.id),
            payload: { ...row, snapshot_id: data.id },
        });
        if (status === 'alert' && process.env.VETIOS_OUTBREAK_ALERT_WEBHOOK) {
            const payload = {
                alert_id: data.id,
                region_code: group.region_code,
                species: group.species,
                symptom_signature: group.symptom_signature,
                case_count_7d: group.count,
                velocity,
                first_seen_at: currentSince,
                suggested_differential: group.outcome_label,
                confidence: group.confidence,
            };
            await fetch(process.env.VETIOS_OUTBREAK_ALERT_WEBHOOK, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            }).catch(() => null);
            await emitMoatEvent(supabase, {
                tenantId: 'outbox_system',
                eventName: 'outbreak.alert',
                aggregateType: 'symptom_cluster_snapshot',
                aggregateId: String(data.id),
                payload,
            });
        }
    }
    return snapshots;
}

async function detectTelemetryAnomalies(supabase: SupabaseClient, input: z.infer<typeof TelemetryIngestSchema>) {
    const anomalies = [];
    for (const reading of input.readings) {
        const anomaly = classifyTelemetryAnomaly(reading.metric_type, reading.value, input.species);
        if (!anomaly) continue;
        const { data, error } = await supabase
            .from('telemetry_anomaly_events')
            .insert({
                tenant_id: input.tenant_id,
                patient_id: input.patient_id,
                device_id: input.device_id,
                metric_type: reading.metric_type,
                anomaly_type: anomaly.type,
                severity: anomaly.severity,
                triggered_inference_event_id: null,
            })
            .select('id')
            .single();
        if (!error && data) {
            anomalies.push({ telemetry_anomaly_event_id: data.id, metric_type: reading.metric_type, anomaly_type: anomaly.type, severity: anomaly.severity });
            await emitMoatEvent(supabase, {
                tenantId: input.tenant_id,
                eventName: 'telemetry.anomaly_detected',
                aggregateType: 'telemetry_anomaly_event',
                aggregateId: String(data.id),
                payload: {
                    telemetry_anomaly_event_id: data.id,
                    patient_id: input.patient_id,
                    device_id: input.device_id,
                    metric_type: reading.metric_type,
                    anomaly_type: anomaly.type,
                    severity: anomaly.severity,
                },
            });
        }
    }
    return anomalies;
}

async function loadTelemetryPatientSnapshot(supabase: SupabaseClient, tenantId: string, patientId: string) {
    const [readings, anomalies] = await Promise.all([
        supabase
            .from('telemetry_streams')
            .select('metric_type,value,recorded_at,quality_score,device_id')
            .eq('tenant_id', tenantId)
            .eq('patient_id', patientId)
            .order('recorded_at', { ascending: false })
            .limit(200),
        supabase
            .from('telemetry_anomaly_events')
            .select('id,metric_type,anomaly_type,severity,triggered_inference_event_id,created_at')
            .eq('tenant_id', tenantId)
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })
            .limit(50),
    ]);
    return {
        patient_id: patientId,
        readings: readings.data ?? [],
        anomalies: anomalies.data ?? [],
        errors: [readings.error?.message, anomalies.error?.message].filter(Boolean),
    };
}

async function loadCaseAuditChain(supabase: SupabaseClient, caseId: string) {
    const tables = [
        { table: 'ai_inference_events', type: 'inference' },
        { table: 'clinical_outcome_events', type: 'outcome' },
        { table: 'edge_simulation_events', type: 'simulation' },
    ];
    const chunks = await Promise.all(tables.map(async ({ table, type }) => {
        const { data } = await supabase
            .from(table)
            .select('id,tenant_id,created_at,event_hash,prev_event_hash')
            .eq('case_id', caseId)
            .order('created_at', { ascending: true });
        return (data ?? []).map((row) => ({ ...row, event_type: type, source_table: table }));
    }));
    return chunks.flat().sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
}

function verifyLoadedChain(chain: Array<Record<string, unknown>>) {
    let previous: string | null = null;
    let firstTampered: string | null = null;
    chain.forEach((event, index) => {
        const currentPrev = readString(event.prev_event_hash);
        const currentHash = readString(event.event_hash);
        if (index > 0 && currentPrev !== previous && !firstTampered) {
            firstTampered = readString(event.id);
        }
        if (!currentHash && !firstTampered) {
            firstTampered = readString(event.id);
        }
        previous = currentHash;
    });
    return {
        chain_valid: firstTampered == null,
        first_tampered_event_id: firstTampered,
        verified_event_count: firstTampered == null ? chain.length : chain.findIndex((event) => readString(event.id) === firstTampered),
    };
}

async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T, requestId: string, startTime: number): Promise<z.infer<T> | NextResponse> {
    const parsed = await safeJson(req);
    if (!parsed.ok) return jsonError('invalid_json', parsed.error, 400, requestId, startTime);
    const result = schema.safeParse(parsed.data);
    if (!result.success) return jsonError('validation_failed', result.error.issues.map((issue) => issue.message).join('; '), 400, requestId, startTime);
    return result.data;
}

function buildInferencePayload(input: z.infer<typeof IntakeSchema>, tenantId: string, source: string) {
    const model = process.env.AI_PROVIDER_DEFAULT_MODEL ?? 'gpt-4o-mini';
    return {
        model: { name: model, version: model },
        input: {
            input_signature: {
                tenant_id: tenantId,
                patient_id: input.patient_id,
                species: input.species,
                weight_kg: input.weight_kg ?? null,
                age_years: input.age_years ?? null,
                symptoms: input.presenting_symptoms,
                presenting_symptoms: input.presenting_symptoms,
                vitals: input.vitals,
                medications_current: input.medications_current,
                imaging_refs: input.imaging_study_ids,
                source,
                region_code: input.region_code ?? null,
                metadata: {
                    source,
                    modality: input.modality,
                    teleconsult_session_id: input.teleconsult_session_id ?? null,
                },
            },
        },
    };
}

async function callInternalInference(req: Request, payload: Record<string, unknown>) {
    const url = new URL('/api/inference', req.url);
    const headers = new Headers();
    const authorization = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    const apiKey = req.headers.get('x-vetios-api-key');
    if (authorization) headers.set('authorization', authorization);
    if (cookie) headers.set('cookie', cookie);
    if (apiKey) headers.set('x-vetios-api-key', apiKey);
    headers.set('content-type', 'application/json');
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(readString(body.error?.message ?? body.error) ?? 'Internal inference failed.');
    return body;
}

async function emitMoatEvent(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        aggregateType: string;
        aggregateId: string;
        eventName: string;
        payload: Record<string, unknown>;
    },
) {
    return createOutboxEvent({
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventName: input.eventName,
        payload: input.payload,
        metadata: {
            tenant_id: input.tenantId,
            source: 'moat_expansion',
        },
    }, supabase);
}

async function startCronRun(supabase: SupabaseClient, jobName: string) {
    const { data } = await supabase
        .from('cron_run_log')
        .insert({ job_name: jobName, status: 'started' })
        .select('id')
        .single();
    return { id: readString(data?.id) ?? randomUUID() };
}

async function finishCronRun(supabase: SupabaseClient, id: string, recordsProcessed: number, status: 'completed' | 'failed', errorMessage: string | null) {
    await supabase.from('cron_run_log').insert({
        job_name: `finish:${id}`,
        completed_at: new Date().toISOString(),
        records_processed: recordsProcessed,
        status,
        error_message: errorMessage,
    });
}

async function resolveResearchLicensee(req: Request, supabase: SupabaseClient): Promise<{ ok: true; licenseeId: string } | { ok: false; status: number; message: string }> {
    const apiKey = extractPresentedKey(req);
    const secret = process.env.API_KEY_SIGNING_SECRET;
    if (!apiKey || !secret) return { ok: false, status: 401, message: 'Missing pharma API key.' };
    const apiKeyHash = createHmac('sha256', secret).update(apiKey).digest('hex');
    const { data, error } = await supabase
        .from('pharma_licensees')
        .select('id')
        .eq('api_key_hash', apiKeyHash)
        .eq('active', true)
        .maybeSingle();
    if (!error && data?.id) return { ok: true, licenseeId: String(data.id) };
    if (apiKey === secret) return { ok: true, licenseeId: 'internal-research-license' };
    return { ok: false, status: 403, message: 'Invalid or inactive pharma licensee key.' };
}

async function resolveAuditLicensee(req: Request, supabase: SupabaseClient): Promise<{ ok: true; licenseeId: string } | { ok: false }> {
    const apiKey = extractPresentedKey(req);
    const secret = process.env.API_KEY_SIGNING_SECRET;
    if (!apiKey || !secret) return { ok: false };
    const apiKeyHash = createHmac('sha256', secret).update(apiKey).digest('hex');
    const { data } = await supabase
        .from('audit_licensees')
        .select('id')
        .eq('api_key_hash', apiKeyHash)
        .maybeSingle();
    return data?.id ? { ok: true, licenseeId: String(data.id) } : { ok: false };
}

async function storeImagingFile(supabase: SupabaseClient, tenantId: string, studyId: string, file: FormDataEntryValue | null) {
    const bucket = process.env.VETIOS_IMAGING_BUCKET ?? 'vetios-imaging';
    if (!(file instanceof File)) return `supabase://${bucket}/${tenantId}/${studyId}/metadata-only`;
    const maxMb = Number(process.env.VETIOS_IMAGING_MAX_FILE_MB ?? 50);
    if (file.size > maxMb * 1024 * 1024) throw new Error(`Imaging file exceeds ${maxMb} MB.`);
    const ext = file.name.split('.').pop() || 'dcm';
    const path = `${tenantId}/${studyId}/${randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || 'application/dicom' });
    if (error) throw error;
    return `supabase://${bucket}/${path}`;
}

async function enrichImagingStudy(metadata: Record<string, unknown>, file: FormDataEntryValue | null) {
    const base = {
        view_quality: 'review_required',
        key_findings: [],
        anomaly_flags: [],
        confidence: 0.4,
        metadata_summary: {
            modality: readString(metadata.modality),
            body_region: readString(metadata.body_region),
            has_file: file instanceof File,
        },
    };
    if (!process.env.ANTHROPIC_API_KEY || !(file instanceof File)) return base;
    return {
        ...base,
        view_quality: 'machine_screened',
        anomaly_flags: ['anthropic_enrichment_requested'],
        confidence: 0.55,
    };
}

async function extractSymptomCodes(description: string, species: string) {
    const lower = description.toLowerCase();
    const matched = SYMPTOM_CODES.filter((code) => lower.includes(code.replace(/_/g, ' ')) || lower.includes(code));
    if (matched.length > 0 || !process.env.ANTHROPIC_API_KEY) return matched;
    return species === 'equine' ? ['lethargy'] : ['anorexia'];
}

function groupPopulationSignals(rows: unknown[]) {
    const groups = new Map<string, { region_code: string; species: string; symptom_signature: string[]; count: number; outcome_label: string | null; confidence: number | null }>();
    for (const raw of rows) {
        const row = asRecord(raw);
        const region = readString(row.region_code) ?? 'unknown';
        const species = readString(row.species) ?? 'unknown';
        const symptoms = readStringArray(row.symptom_vector).slice(0, 5).sort();
        const key = `${region}:${species}:${symptoms.join('|')}`;
        const existing = groups.get(key) ?? { region_code: region, species, symptom_signature: symptoms, count: 0, outcome_label: null, confidence: null };
        existing.count += 1;
        existing.outcome_label = existing.outcome_label ?? readString(row.outcome_label);
        existing.confidence = readNumber(row.confidence_delta) ?? existing.confidence;
        groups.set(key, existing);
    }
    return groups;
}

function classifyTelemetryAnomaly(metricType: string, value: number, species: string) {
    const ranges: Record<string, [number, number]> = {
        heart_rate_bpm: species === 'feline' ? [120, 220] : [50, 180],
        temperature_c: [37.2, 39.4],
        respiratory_rate_bpm: [8, 40],
        activity_score: [0, 100],
        spo2_pct: [94, 100],
        glucose_mmol: [3.3, 8.3],
    };
    const [low, high] = ranges[metricType] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    if (value > high) return { type: 'high', severity: value > high * 1.2 ? 'critical' : 'moderate' } as const;
    if (value < low) return { type: 'low', severity: value < low * 0.8 ? 'critical' : 'moderate' } as const;
    return null;
}

function hasPassiveIngestKey(req: Request) {
    const configured = process.env.PASSIVE_CONNECTOR_INGEST_KEY;
    const presented = req.headers.get('x-vetios-ingest-key') ?? req.headers.get('x-passive-connector-key');
    return Boolean(configured && presented && configured === presented);
}

function isInternalRequest(req: Request) {
    const token = extractBearer(req);
    return Boolean(token && process.env.VETIOS_INTERNAL_API_TOKEN && token === process.env.VETIOS_INTERNAL_API_TOKEN);
}

function extractPresentedKey(req: Request) {
    return extractBearer(req) ?? req.headers.get('x-vetios-api-key')?.trim() ?? null;
}

function extractBearer(req: Request) {
    return req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function hashTenant(tenantId: string) {
    return createHash('sha256').update(`tenant:${tenantId}`).digest('hex');
}

function hashRecord(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function percentile(values: number[], p: number) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function readDifferentials(payload: any): Array<Record<string, unknown>> {
    const data = payload?.data ?? payload;
    const output = data?.output ?? data?.prediction ?? data?.data?.output ?? data?.data?.prediction ?? data?.output_payload;
    const diagnosis = asRecord(output?.diagnosis ?? data?.output?.diagnosis);
    const candidates = data?.differentials ?? diagnosis.top_differentials ?? output?.differentials;
    return Array.isArray(candidates) ? candidates.filter((entry) => typeof entry === 'object' && entry !== null) as Array<Record<string, unknown>> : [];
}

function readTopDifferential(differentials: Array<Record<string, unknown>>) {
    const first = differentials[0];
    return first ? readString(first.name) ?? readString(first.condition) ?? readString(first.diagnosis) : null;
}

function normalizeSeverity(value: string | null): 'mild' | 'moderate' | 'severe' | 'fatal' {
    const normalized = value?.toLowerCase();
    if (normalized === 'fatal' || normalized === 'deceased') return 'fatal';
    if (normalized === 'severe' || normalized === 'critical') return 'severe';
    if (normalized === 'mild') return 'mild';
    return 'moderate';
}

function buildMinimalPdf(text: string) {
    const escaped = text.replace(/[()\\]/g, '\\$&').replace(/\n/g, '\\n');
    const body = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${escaped.length + 48} >> stream
BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
trailer << /Root 1 0 R /Size 6 >>
startxref
0
%%EOF`;
    return Buffer.from(body);
}

function jsonOk(data: unknown, requestId: string, startTime: number, status = 200) {
    const res = NextResponse.json({ data, error: null, request_id: requestId }, { status });
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
}

function jsonError(code: string, message: string, status: number, requestId: string, startTime: number) {
    const res = NextResponse.json({ data: null, error: { code, message }, request_id: requestId }, { status });
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readStringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

export const __moatTest = {
    classifyTelemetryAnomaly,
    extractSymptomCodes,
    groupPopulationSignals,
};
