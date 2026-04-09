import { getSupabaseServer } from '@/lib/supabaseServer';
import { subscribeSovereignSignal } from '@/lib/platform/eventBus';
import { getSovereignRun, requireSovereignClient } from '@/lib/sovereign/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const supabase = getSupabaseServer();

    try {
        const sovereignClient = await requireSovereignClient(supabase, req);
        const run = await getSovereignRun(supabase, sovereignClient, params.id);

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const encoder = new TextEncoder();
                const emit = async () => {
                    const latestRun = await getSovereignRun(supabase, sovereignClient, params.id);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: latestRun.status === 'running' ? 'progress' : latestRun.status === 'complete' ? 'complete' : 'error',
                        status: latestRun.status,
                        summary: latestRun.summary,
                        report_url: latestRun.report_url,
                        sentinel_config: latestRun.sentinel_config,
                        collapse_profile: latestRun.collapse_profile,
                        hii: latestRun.hii,
                    })}\n\n`));
                    if (latestRun.status !== 'running') {
                        cleanup();
                        controller.close();
                    }
                };

                const unsubscribe = subscribeSovereignSignal(sovereignClient.id, run.id, () => {
                    void emit();
                });
                const interval = setInterval(() => {
                    void emit();
                }, 2_000);

                const cleanup = () => {
                    clearInterval(interval);
                    unsubscribe();
                };

                void emit();

                req.signal.addEventListener('abort', () => {
                    cleanup();
                    try {
                        controller.close();
                    } catch {
                        // Stream already closed.
                    }
                });
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        });
    } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Failed to open Sovereign progress stream.', {
            status: typeof (error as { status?: number })?.status === 'number'
                ? (error as { status: number }).status
                : 500,
        });
    }
}
