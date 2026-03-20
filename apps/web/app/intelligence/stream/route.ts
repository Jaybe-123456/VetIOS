import { resolveRequestActor } from '@/lib/auth/requestActor';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { getTopologySnapshot } from '@/lib/intelligence/topologyService';
import type { TopologyWindow } from '@/lib/intelligence/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_INTERVAL_MS = 1_500;

export async function GET(req: Request) {
    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return new Response('Unauthorized', { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const url = new URL(req.url);
    const window = resolveWindow(url.searchParams.get('window'));
    const encoder = new TextEncoder();
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const closeStream = () => {
                if (closed) return;
                closed = true;
                if (intervalId) {
                    clearInterval(intervalId);
                    intervalId = null;
                }
                controller.close();
            };

            const pushSnapshot = async () => {
                try {
                    const snapshot = await getTopologySnapshot(getSupabaseServer(), actor.tenantId, {
                        window,
                    });

                    if (closed) return;
                    controller.enqueue(
                        encoder.encode(
                            serializeSseMessage(JSON.stringify({ snapshot })),
                        ),
                    );
                } catch (error) {
                    if (closed) return;
                    controller.enqueue(
                        encoder.encode(
                            serializeSseMessage(
                                JSON.stringify({
                                    error: error instanceof Error ? error.message : 'Topology stream failure',
                                }),
                                'stream-error',
                            ),
                        ),
                    );
                }
            };

            controller.enqueue(encoder.encode(`retry: ${STREAM_INTERVAL_MS}\n\n`));
            void pushSnapshot();
            intervalId = setInterval(() => {
                void pushSnapshot();
            }, STREAM_INTERVAL_MS);

            req.signal.addEventListener('abort', closeStream);
        },
        cancel() {
            closed = true;
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
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
}

function resolveWindow(value: string | null): TopologyWindow {
    return value === '1h' ? '1h' : '24h';
}

function serializeSseMessage(data: string, event?: string) {
    const eventPrefix = event ? `event: ${event}\n` : '';
    return `${eventPrefix}data: ${data}\n\n`;
}
