import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getVKG } from '@/lib/vkg/veterinaryKnowledgeGraph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/vkg/path
 *
 * GaaS tool endpoint — query_vkg_path.
 * Returns shortest relationship path between two VKG nodes.
 *
 * Body:
 *   from_id:    string   e.g. 'symptom:vomiting'
 *   to_id:      string   e.g. 'drug:metronidazole'
 *   max_depth?: number   default 4, max 6
 */
export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  try {
    const body = await req.json() as {
      from_id?: unknown;
      to_id?: unknown;
      max_depth?: unknown;
    };

    const fromId   = typeof body.from_id === 'string' ? body.from_id : '';
    const toId     = typeof body.to_id === 'string' ? body.to_id : '';
    const maxDepth = typeof body.max_depth === 'number'
      ? Math.min(body.max_depth, 6)
      : 4;

    if (!fromId || !toId) {
      const res = NextResponse.json(
        { data: null, error: { code: 'bad_request', message: 'from_id and to_id required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const vkg = getVKG();
    const path = vkg.findPath(fromId, toId, maxDepth);

    if (!path) {
      const res = NextResponse.json(
        {
          data: { found: false, from_id: fromId, to_id: toId, max_depth: maxDepth },
          meta: { timestamp: new Date().toISOString(), request_id: requestId },
          error: null,
        },
        { status: 200 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const res = NextResponse.json(
      {
        data: {
          found: true,
          from_id: fromId,
          to_id: toId,
          hops: path.edges.length,
          total_weight: Math.round(path.totalWeight * 100) / 100,
          clinical_significance: path.clinicalSignificance,
          path: path.nodes.map((n, i) => ({
            node: n.label,
            node_id: n.id,
            type: n.type,
            edge_to_next: path.edges[i]
              ? { type: path.edges[i].type, weight: path.edges[i].weight }
              : null,
          })),
        },
        meta: { timestamp: new Date().toISOString(), request_id: requestId },
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
