/**
 * @vetios/db — Supabase Client Factory
 *
 * Creates typed Supabase clients for server and browser contexts.
 * All clients are scoped to the Database type for full type safety.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export type TypedSupabaseClient = SupabaseClient<Database>;

interface SupabaseConfig {
    url: string;
    anonKey: string;
    serviceRoleKey?: string;
}

function getConfig(): SupabaseConfig {
    const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
    const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

    if (!url || !anonKey) {
        throw new Error(
            'Missing Supabase configuration. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
        );
    }

    return { url, anonKey, serviceRoleKey };
}

/**
 * Creates a Supabase client for browser-side usage.
 * Uses the anon key; RLS policies enforce tenant isolation.
 */
export function createBrowserClient(): TypedSupabaseClient {
    const { url, anonKey } = getConfig();
    return createClient<Database>(url, anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
        },
    });
}

/**
 * Creates a Supabase client for server-side usage.
 * Uses the anon key by default; RLS is enforced via the user's JWT.
 */
export function createServerClient(accessToken?: string): TypedSupabaseClient {
    const { url, anonKey } = getConfig();
    return createClient<Database>(url, anonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
        global: {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        },
    });
}

/**
 * Creates a Supabase client with the service role key.
 * Bypasses RLS — use ONLY for administrative operations (migrations, seeding, background jobs).
 */
export function createServiceClient(): TypedSupabaseClient {
    const { url, serviceRoleKey } = getConfig();

    if (!serviceRoleKey) {
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for service client.');
    }

    return createClient<Database>(url, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}
