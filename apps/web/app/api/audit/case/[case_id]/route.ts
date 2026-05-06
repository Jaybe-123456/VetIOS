import { handleAuditCaseGet } from '@/lib/moat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ case_id: string }> }) {
    const params = await context.params;
    return handleAuditCaseGet(req, params.case_id);
}
