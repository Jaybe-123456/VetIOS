import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';

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

        const encoder = new TextEncoder();
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let closed = false;

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const pushProgress = async () => {
                    const { data, error } = await supabase
                        .from('simulations')
                        .select('id,status,completed,total,summary,error_message')
                        .eq('tenant_id', resolvedTenantId)
                        .eq('id', params.id)
                        .maybeSingle();

                    if (error) {
                        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`));
                        return;
                    }

                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data ?? null)}\n\n`));

                    if ((data as Record<string, unknown> | null)?.status === 'completed' || (data as Record<string, unknown> | null)?.status === 'failed') {
                        if (!closed) {
                            closed = true;
                            if (intervalId) {
                                clearInterval(intervalId);
                                intervalId = null;
                            }
                            controller.close();
                        }
                    }
                };

                controller.enqueue(encoder.encode('retry: 2000\n\n'));
                await pushProgress();
                intervalId = setInterval(() => {
                    void pushProgress();
                }, 2000);

                req.signal.addEventListener('abort', () => {
                    closed = true;
                    if (intervalId) {
                        clearInterval(intervalId);
                        intervalId = null;
                    }
                    controller.close();
                });
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
    } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Simulation progress stream failed.', {
            status: 401,
        });
    }
}
