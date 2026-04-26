/**
 * GET /api/vkg
 *
 * Veterinary Knowledge Graph query endpoint.
 *
 * Query modes (via ?mode=):
 *   differentials  — diseases matching a symptom set (?symptoms=a,b,c&species=feline)
 *   contraindications — drug contraindications (?drug=meloxicam&species=feline)
 *   path           — relationship path between two nodes (?from=X&to=Y)
 *   progression    — disease progression pathways (?disease=feline_ckd)
 *   stats          — graph statistics
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getVKG } from '@/lib/vkg/veterinaryKnowledgeGraph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') ?? 'differentials';
  const vkg = getVKG();

  try {
    let data: unknown;

    switch (mode) {
      case 'differentials': {
        const symptomsParam = url.searchParams.get('symptoms') ?? '';
        const species = url.searchParams.get('species') ?? undefined;
        const symptoms = symptomsParam.split(',').map((s) => s.trim()).filter(Boolean);

        if (symptoms.length === 0) {
          const res = NextResponse.json(
            { error: { code: 'bad_request', message: '?symptoms= required (comma-separated)' } },
            { status: 400 }
          );
          withRequestHeaders(res.headers, requestId, startTime);
          return res;
        }

        data = vkg.getDiseasesForSymptoms(symptoms, species);
        break;
      }

      case 'contraindications': {
        const drug = url.searchParams.get('drug');
        const species = url.searchParams.get('species') ?? undefined;

        if (!drug) {
          const res = NextResponse.json(
            { error: { code: 'bad_request', message: '?drug= required' } },
            { status: 400 }
          );
          withRequestHeaders(res.headers, requestId, startTime);
          return res;
        }

        data = vkg.getDrugContraindications(drug, species);
        break;
      }

      case 'path': {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const maxDepth = Math.min(Number(url.searchParams.get('depth') ?? '4'), 6);

        if (!from || !to) {
          const res = NextResponse.json(
            { error: { code: 'bad_request', message: '?from= and ?to= required' } },
            { status: 400 }
          );
          withRequestHeaders(res.headers, requestId, startTime);
          return res;
        }

        data = vkg.findPath(from, to, maxDepth);
        break;
      }

      case 'progression': {
        const disease = url.searchParams.get('disease');
        if (!disease) {
          const res = NextResponse.json(
            { error: { code: 'bad_request', message: '?disease= required' } },
            { status: 400 }
          );
          withRequestHeaders(res.headers, requestId, startTime);
          return res;
        }
        data = vkg.getProgressionPathway(disease);
        break;
      }

      case 'differentials_for_disease': {
        const disease = url.searchParams.get('disease');
        const species = url.searchParams.get('species') ?? undefined;
        if (!disease) {
          const res = NextResponse.json(
            { error: { code: 'bad_request', message: '?disease= required' } },
            { status: 400 }
          );
          withRequestHeaders(res.headers, requestId, startTime);
          return res;
        }
        data = vkg.getDifferentials(disease, species);
        break;
      }

      case 'stats': {
        data = vkg.getStats();
        break;
      }

      default: {
        const res = NextResponse.json(
          {
            error: {
              code: 'bad_request',
              message: `Unknown mode: ${mode}. Valid: differentials, contraindications, path, progression, stats`,
            },
          },
          { status: 400 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
      }
    }

    const res = NextResponse.json(
      {
        data,
        meta: {
          mode,
          timestamp: new Date().toISOString(),
          request_id: requestId,
          vkg_stats: vkg.getStats(),
        },
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
