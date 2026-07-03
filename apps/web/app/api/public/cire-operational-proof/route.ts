import { NextResponse } from 'next/server';
import {
    buildPublicCireOperationalProofSnapshot,
    type CireOperationalProofRow,
} from '@/lib/cire/operationalProof';
import { CIRE_STANDARD_VERSION } from '@/lib/cire/standard';
import { apiGuard } from '@/lib/http/apiGuard';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT_PUBLIC_OPERATIONAL_PROOF_FIELDS = [
    'id',
    'proof_kind',
    'proof_target',
    'proof_status',
    'runtime_environment',
    'deployment_ref',
    'git_sha',
    'cron_job_name',
    'cron_schedule',
    'latency_ms',
    'records_processed',
    'schema_targets',
    'blockers',
    'warnings',
    'proof_digest',
    'observed_at',
    'created_at',
].join(', ');

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    try {
        const { data, error } = await getSupabaseServer()
            .from('cire_operational_proof_events')
            .select(SELECT_PUBLIC_OPERATIONAL_PROOF_FIELDS)
            .order('observed_at', { ascending: false })
            .limit(100);

        if (error) {
            return NextResponse.json(
                {
                    configured: false,
                    snapshot: buildPublicCireOperationalProofSnapshot([]),
                    error: 'cire_operational_proof_unavailable',
                },
                { status: 503 },
            );
        }

        return NextResponse.json({
            configured: true,
            snapshot: buildPublicCireOperationalProofSnapshot((Array.isArray(data) ? data : []) as unknown as CireOperationalProofRow[]),
            error: null,
        }, {
            headers: {
                'Cache-Control': 'public, max-age=120, s-maxage=600',
                'CIRE-Standard-Version': CIRE_STANDARD_VERSION,
            },
        });
    } catch {
        return NextResponse.json({
            configured: false,
            snapshot: buildPublicCireOperationalProofSnapshot([]),
            error: null,
        });
    }
}
