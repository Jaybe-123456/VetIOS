import { handleTeleconsultStreamGet } from '@/lib/moat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ session_id: string }> }) {
    const params = await context.params;
    return handleTeleconsultStreamGet(req, params.session_id);
}
