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
        return <span className="font-mono text-xs text-muted animate-pulse">···</span>;
    }

    if (!user) return null;

    return (
        <div className="flex items-center gap-4">
            <span className="font-mono text-xs text-muted truncate max-w-[200px]" title={user.email}>
                {user.email}
            </span>
            <button
                onClick={handleSignOut}
                className="font-mono text-xs uppercase tracking-widest text-muted hover:text-danger transition-colors"
            >
                Sign Out
            </button>
        </div>
    );
}
