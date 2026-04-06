'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Monitors user activity and automatically signs out after a period of inactivity.
 * This enhances security for shared or unattended workstations.
 */
export function AuthInactivityTimer() {
    const router = useRouter();
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const handleSignOut = useCallback(async () => {
        const supabase = getSupabaseBrowser();
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
            console.log('[AuthInactivityTimer] User inactive for 30m. Signing out.');
            await supabase.auth.signOut();
            
            // Clear the "Remember Me" if we want to be extra strict on timeout
            // localStorage.setItem('vetios_remember_me', 'false');
            
            router.push('/login?reason=inactivity');
            router.refresh();
        }
    }, [router]);

    const resetTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(handleSignOut, INACTIVITY_LIMIT_MS);
    }, [handleSignOut]);

    useEffect(() => {
        // Events to monitor for activity
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];

        // Initial timer start
        resetTimer();

        // Attach listeners
        events.forEach((event) => {
            document.addEventListener(event, resetTimer);
        });

        // Cleanup
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
            events.forEach((event) => {
                document.removeEventListener(event, resetTimer);
            });
        };
    }, [resetTimer]);

    return null; // This component doesn't render any UI
}
