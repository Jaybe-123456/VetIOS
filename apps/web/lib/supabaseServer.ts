/**
 * Server-side Supabase client.
 *
 * Supports both naming schemes:
 *   - SUPABASE_URL / SUPABASE_ANON_KEY (server-only, preferred)
 *   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (fallback)
 *
 * Prefers SUPABASE_SERVICE_ROLE_KEY for server-side inserts if available.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

let _client: SupabaseClient | null = null;

function resolveEnv(primary: string, fallback: string, label: string): string {
    const value = process.env[primary] || process.env[fallback];
    if (!value) {
        throw new Error(
            `Missing environment variable: set ${primary} or ${fallback}. ` +
            `This is required for ${label}.`
        );
    }
    return value;
}

export function getSupabaseServer(): SupabaseClient {
    if (_client) return _client;

    const url = resolveEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'Supabase URL');

    // Prefer service role key for server-side inserts (bypasses RLS)
    // Fall back to anon key if service role is not set
    const key =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!key) {
        throw new Error(
            'Missing Supabase key: set SUPABASE_SERVICE_ROLE_KEY (preferred for server), ' +
            'SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
        );
    }

    _client = createClient(url, key, {
        auth: { persistSession: false },
    });

    return _client;
}

/**
 * Resolves the current authenticated user's tenant_id from cookies.
 *
 * V1 Tenant Model: tenant_id = auth.uid() (1 user = 1 tenant).
 *
 * Returns null if the user is not authenticated.
 * API routes should return 401 when this returns null.
 */
export async function resolveSessionTenant(): Promise<{
    supabase: SupabaseClient;
    tenantId: string;
    userId: string;
} | null> {
    const cookieStore = await cookies();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) return null;

    const supabase = createServerClient(url, anonKey, {
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        cookieStore.set(name, value, options)
                    );
                } catch {
                    // Ignored in read-only server component context
                }
            },
        },
    });

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) return null;

    return {
        supabase,
        tenantId: user.id, // V1: tenant_id = auth.uid()
        userId: user.id,
    };
}
