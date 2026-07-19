import { NextResponse } from 'next/server';
import {
    runRecordedProofLoopReplay,
    type ReplayCandidate,
} from '../../../../lib/proofloop/replay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
    let body: unknown = {};
    try {
        body = await request.json();
    } catch {
        body = {};
    }
    const payload = isRecord(body) ? body : {};
    const candidate: ReplayCandidate = payload.candidate === 'corrected' ? 'corrected' : 'legacy';
    const tamper = payload.tamper === true;

    return NextResponse.json(runRecordedProofLoopReplay({ candidate, tamper }), {
        headers: { 'Cache-Control': 'no-store' },
    });
}

export function GET() {
    return NextResponse.json({
        mode: 'recorded_fixture',
        case_id: 'synthetic-canine-parvo-001',
        public: true,
        note: 'Use POST to run the signed synthetic outcome replay.',
    }, {
        headers: { 'Cache-Control': 'no-store' },
    });
}
