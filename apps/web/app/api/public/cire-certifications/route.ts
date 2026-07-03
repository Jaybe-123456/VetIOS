import { NextResponse } from 'next/server';
import { buildPublicCireCertificationRegistry, type CireCertificationEventRow } from '@/lib/cire/certification';
import { CIRE_STANDARD_VERSION } from '@/lib/cire/standard';
import { apiGuard } from '@/lib/http/apiGuard';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT_PUBLIC_CERTIFICATION_FIELDS = [
    'id',
    'standard_version',
    'implementation_name',
    'implementation_version',
    'implementation_url',
    'package_name',
    'repository_url',
    'artifact_url',
    'certification_status',
    'verification_status',
    'conformance_result',
    'total_checks',
    'passed_checks',
    'failed_checks',
    'conformance_score',
    'public_listing_eligible',
    'public_listing_label',
    'signed_payload_hash',
    'observed_at',
    'created_at',
].join(', ');

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    try {
        const { data, error } = await getSupabaseServer()
            .from('cire_conformance_certification_events')
            .select(SELECT_PUBLIC_CERTIFICATION_FIELDS)
            .eq('standard_version', CIRE_STANDARD_VERSION)
            .eq('public_listing_eligible', true)
            .eq('certification_status', 'passed')
            .eq('conformance_result', 'passed')
            .order('observed_at', { ascending: false })
            .limit(100);

        if (error) {
            return NextResponse.json(
                { configured: false, error: 'cire_certification_registry_unavailable' },
                { status: 503 },
            );
        }

        return NextResponse.json({
            configured: true,
            registry: buildPublicCireCertificationRegistry((Array.isArray(data) ? data : []) as CireCertificationEventRow[]),
            error: null,
        }, {
            headers: {
                'Cache-Control': 'public, max-age=300, s-maxage=3600',
                'CIRE-Standard-Version': CIRE_STANDARD_VERSION,
            },
        });
    } catch {
        return NextResponse.json({
            configured: false,
            registry: buildPublicCireCertificationRegistry([]),
            error: null,
        });
    }
}
