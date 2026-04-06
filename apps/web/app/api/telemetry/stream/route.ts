import { getSupabaseServer } from '@/lib/supabaseServer';
import { listRecentPlatformTelemetry } from '@/lib/platform/telemetry';
import { subscribePlatformTelemetry } from '@/lib/platform/eventBus';
import { requirePlatformRequestContext } from '@/lib/platform/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const supabase = getSupabaseServer();

    try {
        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:read'],
            requestedTenantId: requestedTenantId ?? undefined,
        });

        if (!tenantId) {
            return new Response('tenant_id is required for telemetry streaming.', { status: 400 });
        }

        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const backlog = await listRecentPlatformTelemetry(supabase, tenantId, 20).catch(() => []);
                controller.enqueue(encoder.encode('retry: 3000\n\n'));
                for (const record of backlog) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(record)}\n\n`));
                }

                unsubscribe = subscribePlatformTelemetry(tenantId, (record) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(record)}\n\n`));
                });

                req.signal.addEventListener('abort', () => {
                    unsubscribe?.();
                    controller.close();
                });
            },
            cancel() {
                unsubscribe?.();
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        });
    } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Telemetry stream failed.', {
            status: 401,
        });
    }
}
