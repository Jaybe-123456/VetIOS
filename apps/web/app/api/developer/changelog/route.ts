import { NextResponse } from 'next/server';
import { listChangelogEntries } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const changelog = await listChangelogEntries();
    return NextResponse.json(changelog);
}
