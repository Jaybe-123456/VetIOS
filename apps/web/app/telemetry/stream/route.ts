import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import {
    emitTelemetryHeartbeat,
    generateFakeEvents,
    getTelemetrySnapshot,
    TELEMETRY_HEARTBEAT_INTERVAL_MS,
} from '@/lib/telemetry/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_INTERVAL_MS = 1_500;

export async function GET(req: Request) {
    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return new Response('Unauthorized', { status: 401 });
    }

    const { tenantId } = resolveRequestActor(session);
    const supabase = getSupabaseServer();
    const url = new URL(req.url);
    const simulationMode = url.searchParams.get('simulation') === '1';
    const encoder = new TextEncoder();
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    let lastHeartbeatAtMs = 0;

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
                    if (simulationMode) {
                        await generateFakeEvents(supabase, tenantId);
                    }

                    const nowMs = Date.now();
                    if (nowMs - lastHeartbeatAtMs >= TELEMETRY_HEARTBEAT_INTERVAL_MS) {
                        await emitTelemetryHeartbeat(supabase, {
                            tenantId,
                            source: 'telemetry_stream',
                            targetNodeId: 'telemetry_observer',
                            metadata: {
                                stream: 'telemetry',
                                simulation_mode: simulationMode,
                            },
                        });
                        lastHeartbeatAtMs = nowMs;
                    }

                    const snapshot = await getTelemetrySnapshot(supabase, tenantId);
                    if (closed) return;

                    controller.enqueue(
                        encoder.encode(
                            serializeSseMessage(JSON.stringify({
                                snapshot,
                                simulation_mode: simulationMode,
                            })),
                        ),
                    );
                } catch (error) {
                    if (closed) return;

                    controller.enqueue(
                        encoder.encode(
                            serializeSseMessage(
                                JSON.stringify({
                                    error: error instanceof Error ? error.message : 'Telemetry stream failure',
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

function serializeSseMessage(data: string, event?: string) {
    const eventPrefix = event ? `event: ${event}\n` : '';
    return `${eventPrefix}data: ${data}\n\n`;
}
