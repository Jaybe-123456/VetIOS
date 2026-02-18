/**
 * Server-side Supabase client.
 *
 * One reusable client for all API routes.
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from environment.
 *
 * For v1: simple server client.
 * Later: pass user JWT from cookies for RLS-enforced queries.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
    if (_client) return _client;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
        throw new Error(
            'Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables. ' +
            'Add them to .env.local and restart your dev server.'
        );
    }

    _client = createClient(url, key, {
        auth: { persistSession: false },
    });

    return _client;
}
