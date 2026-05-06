import { handleLabRecommendationsGet } from '@/lib/moat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ inference_event_id: string }> }) {
    const params = await context.params;
    return handleLabRecommendationsGet(req, params.inference_event_id);
}
