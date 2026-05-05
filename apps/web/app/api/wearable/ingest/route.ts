/**
 * POST /api/wearable/ingest
 *
 * Ingests raw wearable device readings.
 * Called by pet wearable devices or their cloud platforms via webhook.
 *
 * Body:
 *   tenant_id:   string
 *   patient_id:  string
 *   device_id:   string
 *   device_type: 'generic'|'whistle'|'petpace'|'felcana'
 *   species:     string
 *   breed?:      string
 *   region?:     string
 *   payload:     Record<string, unknown>  — raw device data
 *   recorded_at?: string                  — ISO timestamp (defaults to now)
 *
 * Returns:
 *   anomaly_assessment: AnomalyAssessment
 *   device_registered:  boolean
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getPassiveVitalConnector } from '@/lib/wearable/passiveVitalConnector';
import type { DeviceType } from '@/lib/wearable/passiveVitalConnector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_DEVICE_TYPES = new Set<DeviceType>(['generic', 'whistle', 'petpace', 'felcana']);

export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 300, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  try {
    const body = await req.json() as Record<string, unknown>;

    const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : null;
    const patientId = typeof body.patient_id === 'string' ? body.patient_id : null;
    const deviceId = typeof body.device_id === 'string' ? body.device_id : null;
    const deviceType = typeof body.device_type === 'string' && VALID_DEVICE_TYPES.has(body.device_type as DeviceType)
      ? body.device_type as DeviceType
      : 'generic';
    const species = typeof body.species === 'string' ? body.species : null;
    const payload = body.payload && typeof body.payload === 'object'
      ? body.payload as Record<string, unknown>
      : body; // treat entire body as payload if no payload field

    if (!tenantId || !patientId || !deviceId || !species) {
      const res = NextResponse.json(
        { data: null, error: { code: 'bad_request', message: 'tenant_id, patient_id, device_id, species required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const connector = getPassiveVitalConnector();
    const result = await connector.ingest({
      tenantId,
      patientId,
      deviceId,
      deviceType,
      species,
      breed: typeof body.breed === 'string' ? body.breed : null,
      region: typeof body.region === 'string' ? body.region : null,
      payload,
      recordedAt: typeof body.recorded_at === 'string' ? body.recorded_at : undefined,
    });

    const res = NextResponse.json(
      {
        data: {
          anomaly_assessment: result.anomalyAssessment,
          device_registered: result.deviceRegistered,
        },
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
        },
        error: null,
      },
      { status: 200 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      { data: null, error: { code: 'internal_error', message: String(err) } },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}
