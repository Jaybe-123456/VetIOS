import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { subscribeSimulationSignal } from '@/lib/platform/eventBus';
import { assertSimulationTenantAccess, resolveSimulationProgress } from '@/lib/platform/simulations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const supabase = getSupabaseServer();

    try {
        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['simulation:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });

        const resolvedTenantId = tenantId ?? actor.tenantId;
        if (!resolvedTenantId) {
            return new Response('tenant_id is required for simulation progress.', { status: 400 });
        }
        await assertSimulationTenantAccess(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let heartbeatId: ReturnType<typeof setInterval> | null = null;
        let fallbackPollId: ReturnType<typeof setInterval> | null = null;
        let closed = false;
        let pushInFlight = false;
        let pushQueued = false;

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const pushProgress = async () => {
                    if (closed) return;
                    if (pushInFlight) {
                        pushQueued = true;
                        return;
                    }
                    pushInFlight = true;

                    try {
                        const progress = await resolveSimulationProgress(supabase, {
                            tenantId: resolvedTenantId,
                            simulationId: params.id,
                        });

                        if (!progress) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Simulation not found.' })}\n\n`));
                            if (!closed) {
                                closed = true;
                                unsubscribe?.();
                                if (heartbeatId) clearInterval(heartbeatId);
                                if (fallbackPollId) clearInterval(fallbackPollId);
                                controller.close();
                            }
                            return;
                        }

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));

                        if (progress.type === 'complete' || progress.type === 'error') {
                            if (!closed) {
                                closed = true;
                                unsubscribe?.();
                                if (heartbeatId) clearInterval(heartbeatId);
                                if (fallbackPollId) clearInterval(fallbackPollId);
                                controller.close();
                            }
                        }
                    } catch (error) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Simulation progress failed.' })}\n\n`));
                        if (!closed) {
                            closed = true;
                            unsubscribe?.();
                            if (heartbeatId) clearInterval(heartbeatId);
                            if (fallbackPollId) clearInterval(fallbackPollId);
                            controller.close();
                        }
                    } finally {
                        pushInFlight = false;
                        if (pushQueued && !closed) {
                            pushQueued = false;
                            void pushProgress();
                        }
                    }
                };

                controller.enqueue(encoder.encode('retry: 2000\n\n'));
                await pushProgress();
                unsubscribe = subscribeSimulationSignal(resolvedTenantId, params.id, () => {
                    void pushProgress();
                });
                heartbeatId = setInterval(() => {
                    if (!closed) {
                        controller.enqueue(encoder.encode(': keep-alive\n\n'));
                    }
                }, 15_000);
                fallbackPollId = setInterval(() => {
                    void pushProgress();
                }, 5_000);

                req.signal.addEventListener('abort', () => {
                    if (closed) return;
                    closed = true;
                    unsubscribe?.();
                    if (heartbeatId) clearInterval(heartbeatId);
                    if (fallbackPollId) clearInterval(fallbackPollId);
                    controller.close();
                });
            },
            cancel() {
                closed = true;
                unsubscribe?.();
                if (heartbeatId) clearInterval(heartbeatId);
                if (fallbackPollId) clearInterval(fallbackPollId);
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
        const status = typeof (error as { status?: number })?.status === 'number'
            ? (error as { status: number }).status
            : 401;
        return new Response(error instanceof Error ? error.message : 'Simulation progress stream failed.', {
            status,
        });
    }
}
