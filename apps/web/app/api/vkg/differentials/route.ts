import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getVKG } from '@/lib/vkg/veterinaryKnowledgeGraph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/vkg/differentials
 *
 * GaaS tool endpoint — query_vkg_differentials.
 * Accepts JSON body and returns ranked differentials with labs + contraindications.
 *
 * Body:
 *   symptoms:   string[]
 *   species:    string
 *   breed?:     string | null
 *   biomarkers?: Record<string, number | string> | null
 */
export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  try {
    const body = await req.json() as {
      symptoms?: unknown;
      species?: unknown;
      breed?: unknown;
      biomarkers?: unknown;
    };

    const symptoms = Array.isArray(body.symptoms) ? body.symptoms as string[] : [];
    const species  = typeof body.species === 'string' ? body.species : undefined;
    const breed    = typeof body.breed === 'string' ? body.breed : null;
    const biomarkers = body.biomarkers && typeof body.biomarkers === 'object'
      ? body.biomarkers as Record<string, number | string>
      : null;

    if (symptoms.length === 0) {
      const res = NextResponse.json(
        { data: null, error: { code: 'bad_request', message: 'symptoms[] required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const vkg = getVKG();
    const candidates = vkg.getDiseasesForSymptoms(symptoms, species, breed, biomarkers);

    const differentials = candidates.slice(0, 5).map(({ disease, matchedSymptoms, score }) => {
      const labNodes = vkg.neighbours(disease.id, 'associated_lab');
      const treatmentNodes = vkg.neighbours(disease.id, 'treated_by');
      const contraindications: string[] = [];
      for (const t of treatmentNodes.slice(0, 2)) {
        const drugNodes = vkg.neighbours(t.id, 'uses_drug');
        for (const d of drugNodes.slice(0, 2)) {
          const ci = vkg.getDrugContraindications(d.id.replace('drug:', ''), species);
          contraindications.push(...ci.map((c) => `${d.label}: ${c.label}`));
        }
      }
      return {
        diagnosis: disease.label,
        vkg_score: Math.round(score * 100),
        matched_symptoms: matchedSymptoms,
        expected_labs: labNodes.map((l) => l.label),
        contraindications: [...new Set(contraindications)].slice(0, 3),
      };
    });

    const res = NextResponse.json(
      {
        data: {
          differentials,
          total_candidates: candidates.length,
          species,
          hops_traversed: 5,
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
