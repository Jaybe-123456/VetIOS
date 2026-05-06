import { handleAuditReportPost } from '@/lib/moat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, context: { params: Promise<{ case_id: string }> }) {
    const params = await context.params;
    return handleAuditReportPost(req, params.case_id);
}
