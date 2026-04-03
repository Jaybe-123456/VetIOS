/**
 * Server-side cookie-aware Supabase client.
 *
 * Creates a new client per request (necessary for SSR to read
 * the correct session from cookies). Used in middleware, server
 * components, and API routes that need auth context.
 *
 * V1 Tenant Model: tenant_id = auth.uid() (1 user = 1 tenant).
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
    const cookieStore = await cookies();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        throw new Error(
            'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
        );
    }

    return createServerClient(url, anonKey, {
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
                    // Ignore set errors in Server Components (read-only context).
                    // Middleware and Route Handlers can set cookies.
                }
            },
        },
    });
}

/**
 * Resolves the current authenticated user's tenant_id.
 * V1: tenant_id = user.id (auth.uid()).
 *
 * Returns null if not authenticated.
 */
export async function resolveSessionTenant(): Promise<{
    supabase: SupabaseClient;
    tenantId: string;
    userId: string;
    email: string;
} | null> {
    const cookieStore = await cookies();
    if (!hasSupabaseAuthCookies(cookieStore.getAll())) {
        return null;
    }

    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) return null;

    return {
        supabase,
        tenantId: user.id, // V1: tenant_id = auth.uid()
        userId: user.id,
        email: user.email ?? '',
    };
}

function hasSupabaseAuthCookies(cookieEntries: Array<{ name: string }>): boolean {
    return cookieEntries.some(({ name }) => (
        (name.startsWith('sb-') && name.includes('-auth-token'))
        || name === 'supabase-auth-token'
        || name.startsWith('supabase-auth-token.')
    ));
}
