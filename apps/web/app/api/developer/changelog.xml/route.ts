import { NextResponse } from 'next/server';
import { listChangelogEntries } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const entries = await listChangelogEntries();
    const items = entries.map((entry) => `
        <item>
            <title>VetIOS API ${entry.version}</title>
            <description><![CDATA[${entry.summary}]]></description>
            <pubDate>${entry.releasedAt?.toUTCString() ?? new Date().toUTCString()}</pubDate>
            <guid>${entry.id}</guid>
        </item>
    `).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>VetIOS API Changelog</title>
    <link>https://www.vetios.tech/developer/changelog</link>
    <description>Version history for the VetIOS Clinical Intelligence API.</description>
    ${items}
  </channel>
</rss>`;

    return new NextResponse(xml, {
        headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
    });
}
