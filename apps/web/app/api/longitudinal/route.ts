/**
 * GET  /api/longitudinal?patient_id=X  — fetch patient trajectory
 * POST /api/longitudinal               — record a visit
 * PATCH /api/longitudinal              — confirm outcome
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { getLongitudinalService } from '@/lib/longitudinal/longitudinalPatientService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    const { tenantId } = await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const url = new URL(req.url);
    const patientId = url.searchParams.get('patient_id');

    if (!patientId) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: '?patient_id= required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const service = getLongitudinalService();
    const trajectory = await service.buildTrajectory(patientId, tenantId);

    if (!trajectory) {
      const res = NextResponse.json(
        { error: { code: 'not_found', message: `No longitudinal records found for patient ${patientId}` } },
        { status: 404 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const res = NextResponse.json(
      {
        data: trajectory,
        meta: { timestamp: new Date().toISOString(), request_id: requestId },
      },
      { status: 200 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      { error: { code: 'internal_error', message: String(err) } },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}

export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    const { tenantId } = await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const body = await req.json();

    if (!body.patient_id || !body.species || !body.visit_date) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: 'patient_id, species, visit_date are required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const service = getLongitudinalService();
    const result = await service.recordVisit({
      patient_id: body.patient_id,
      tenant_id: tenantId,
      visit_date: body.visit_date,
      species: body.species,
      breed: body.breed ?? null,
      age_years: body.age_years ?? null,
      weight_kg: body.weight_kg ?? null,
      symptoms: body.symptoms ?? [],
      biomarkers: body.biomarkers ?? null,
      inference_event_id: body.inference_event_id ?? null,
      primary_diagnosis: body.primary_diagnosis ?? null,
      diagnosis_confidence: body.diagnosis_confidence ?? null,
      treatment_prescribed: body.treatment_prescribed ?? null,
      outcome_confirmed: false,
      confirmed_diagnosis: null,
      vet_notes: body.vet_notes ?? null,
    });

    const res = NextResponse.json(
      {
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: requestId },
      },
      { status: 201 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      { error: { code: 'internal_error', message: String(err) } },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}

export async function PATCH(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const body = await req.json();

    if (!body.visit_id || !body.confirmed_diagnosis) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: 'visit_id and confirmed_diagnosis required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const service = getLongitudinalService();
    await service.confirmVisitOutcome(
      body.visit_id,
      body.confirmed_diagnosis,
      body.vet_notes
    );

    const res = NextResponse.json(
      {
        data: { confirmed: true },
        meta: { timestamp: new Date().toISOString(), request_id: requestId },
      },
      { status: 200 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      { error: { code: 'internal_error', message: String(err) } },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}
