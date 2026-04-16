/**
 * Server-side auth helpers for API routes.
 *
 * Provides a shared `getAuthenticatedUser()` function that verifies
 * the Supabase session and returns the user, or null if unauthenticated.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Create a Supabase server client from the request cookies.
 */
export function createApiSupabaseClient() {
    const cookieStore = cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet: Array<{ name: string; value: string; options: any }>) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // In Server Components, cookies cannot be set — this is expected
                    }
                },
            },
        }
    );
}

/**
 * Verify the current user from the API request cookies.
 * Returns { user } if authenticated, or a 401 NextResponse if not.
 */
export async function requireAuth(): Promise<
    | { user: { id: string; email?: string }; error: null }
    | { user: null; error: NextResponse }
> {
    const supabase = createApiSupabaseClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return {
            user: null,
            error: NextResponse.json(
                { error: 'Unauthorized — valid Supabase session required' },
                { status: 401 }
            ),
        };
    }

    return { user, error: null };
}
