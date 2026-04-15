'use client';

import { useState, useEffect } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import type { User } from '@supabase/supabase-js';

export default function UserNav() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const supabase = getSupabaseBrowser();

        // Get initial user
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUser(user);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    async function handleSignOut() {
        const supabase = getSupabaseBrowser();
        await supabase.auth.signOut();
        window.location.href = '/login';
    }

    if (loading) {
        return <span className="font-mono text-[10px] text-[var(--text-ghost)] animate-pulse">···</span>;
    }

    if (!user) return null;

    return (
        <div className="flex items-center gap-3">
            <span className="font-sans text-[12px] text-[var(--text-ghost)] truncate max-w-[200px]" title={user.email}>
                {user.email}
            </span>
            <span className="h-4 w-px bg-[var(--border-subtle)]" />
            <button
                onClick={handleSignOut}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)] hover:text-[var(--text-muted)] transition-all"
            >
                Sign Out
            </button>
        </div>
    );
}
