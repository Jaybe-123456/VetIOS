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
