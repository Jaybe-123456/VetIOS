import { handleTelemetryLiveGet } from '@/lib/moat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ patient_id: string }> }) {
    const params = await context.params;
    return handleTelemetryLiveGet(req, params.patient_id);
}
