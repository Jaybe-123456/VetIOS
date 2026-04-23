/**
 * GaaS Platform — Singleton Instance
 *
 * Bootstraps the GaaS runtime once per Next.js server process.
 * All API routes import from here so they share the same in-memory
 * run store, HITL manager, and agent runtime.
 *
 * In production, swap InMemoryStore → SupabaseMemoryStore by
 * providing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import {
    bootstrapGaaSPlatform,
    type GaaSPlatform,
} from '@vetios/gaas';

let _instance: GaaSPlatform | null = null;

export function getGaaSPlatform(): GaaSPlatform {
    if (!_instance) {
        _instance = bootstrapGaaSPlatform({
            vetiosBaseUrl:
                process.env.VETIOS_API_BASE_URL ??
                process.env.NEXT_PUBLIC_SUPABASE_URL ??
                'https://api.vetios.tech/v1',
            authToken:
                process.env.VETIOS_AUTH_TOKEN ??
                process.env.SUPABASE_SERVICE_ROLE_KEY ??
                '',
            // Only use Supabase persistence after gaas_* migrations are applied.
            // Set VETIOS_GAAS_DB=true in Vercel env vars once migrations are done.
            supabaseUrl: process.env.VETIOS_GAAS_DB === 'true'
                ? process.env.NEXT_PUBLIC_SUPABASE_URL
                : undefined,
            supabaseServiceKey: process.env.VETIOS_GAAS_DB === 'true'
                ? process.env.SUPABASE_SERVICE_ROLE_KEY
                : undefined,
            notifyOnHITL: async (interrupt) => {
                // Future: push to Realtime channel or webhook
                console.log(
                    `[GaaS] HITL interrupt raised: ${interrupt.interrupt_id} — ${interrupt.reason}`
                );
            },
        });

        console.log('[GaaS] Platform bootstrapped ✓');
    }

    return _instance;
}
