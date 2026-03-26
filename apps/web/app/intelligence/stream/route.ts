import { resolveRequestActor } from '@/lib/auth/requestActor';
import { applyDecisionEngineToTopologySnapshot, evaluateDecisionEngine } from '@/lib/decisionEngine/service';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { getTopologySnapshot, syncControlPlaneAlerts } from '@/lib/intelligence/topologyService';
import { emitTelemetryHeartbeat, TELEMETRY_HEARTBEAT_INTERVAL_MS } from '@/lib/telemetry/service';
import type { TopologyWindow } from '@/lib/intelligence/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_INTERVAL_MS = 10_000;

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
    let lastHeartbeatAtMs = 0;
    let lastSnapshot: Awaited<ReturnType<typeof getTopologySnapshot>> | null = null;
    let lastPayloadSignature: string | null = null;

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
                    const client = getSupabaseServer();
                    const nowMs = Date.now();
                    if (nowMs - lastHeartbeatAtMs >= TELEMETRY_HEARTBEAT_INTERVAL_MS) {
                        await emitTelemetryHeartbeat(client, {
                            tenantId: actor.tenantId,
                            source: 'topology_stream',
                            targetNodeId: 'telemetry_observer',
                            metadata: {
                                stream: 'intelligence',
                                window,
                            },
                        });
                        lastHeartbeatAtMs = nowMs;
                    }
                    const snapshot = await getTopologySnapshot(client, actor.tenantId, {
                        window,
                    });
                    await syncControlPlaneAlerts(client, actor.tenantId, snapshot.alerts);
                    const decisionEngine = await evaluateDecisionEngine({
                        client,
                        tenantId: actor.tenantId,
                        topologySnapshot: snapshot,
                        triggerSource: 'topology_stream',
                    });
                    const enrichedSnapshot = applyDecisionEngineToTopologySnapshot(snapshot, decisionEngine);
                    lastSnapshot = enrichedSnapshot;

                    if (closed) return;
                    const payload = { snapshot: enrichedSnapshot };
                    const payloadSignature = buildTopologyPayloadSignature(payload);
                    if (payloadSignature === lastPayloadSignature) {
                        controller.enqueue(encoder.encode(': keepalive\n\n'));
                        return;
                    }
                    lastPayloadSignature = payloadSignature;
                    controller.enqueue(
                        encoder.encode(
                            serializeSseMessage(JSON.stringify(payload)),
                        ),
                    );
                } catch (error) {
                    if (closed) return;
                    if (lastSnapshot) {
                        controller.enqueue(
                            encoder.encode(
                                serializeSseMessage(JSON.stringify({
                                    snapshot: lastSnapshot,
                                    degraded: true,
                                    stream_warning: error instanceof Error ? error.message : 'Topology stream degraded',
                                })),
                            ),
                        );
                        return;
                    }
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

function buildTopologyPayloadSignature(payload: {
    snapshot: Awaited<ReturnType<typeof getTopologySnapshot>>;
}) {
    return JSON.stringify({
        snapshot: {
            ...payload.snapshot,
            refreshed_at: '',
        },
    });
}
