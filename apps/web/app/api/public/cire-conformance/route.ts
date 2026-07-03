import { NextResponse } from 'next/server';
import { getCirePublicConformanceArtifact } from '@/lib/cire/conformance';
import { getConfiguredSiteOrigin } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const artifact = getCirePublicConformanceArtifact(getConfiguredSiteOrigin() ?? 'https://www.vetios.tech');

    return NextResponse.json(artifact, {
        headers: {
            'Cache-Control': 'public, max-age=300, s-maxage=3600',
            'CIRE-Standard-Version': artifact.standard_version,
            'CIRE-Conformance-Result': artifact.validation.passed ? 'passed' : 'failed',
        },
    });
}
