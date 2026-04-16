'use client';

import { useState, useEffect } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import type { User } from '@supabase/supabase-js';
import { LogOut } from 'lucide-react';

export default function UserNav() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const supabase = getSupabaseBrowser();
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUser(user);
            setLoading(false);
        });
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
        return (
            <span className="font-mono text-[11px] text-[hsl(0_0%_35%)] animate-pulse tracking-widest">
                ···
            </span>
        );
    }

    if (!user) return null;

    return (
        <div className="flex items-center gap-3">
            {/* Divider */}
            <div className="hidden sm:block w-px h-4 bg-[hsl(0_0%_20%)]" />

            {/* Email — readable but subdued */}
            <span
                className="hidden sm:block font-mono text-[11px] text-[hsl(0_0%_52%)] truncate max-w-[180px] tracking-[0.06em]"
                title={user.email}
            >
                {user.email}
            </span>

            {/* Sign Out */}
            <button
                onClick={handleSignOut}
                className="
                    flex items-center gap-1.5 px-2.5 py-1.5
                    font-mono text-[10px] uppercase tracking-[0.14em]
                    text-[hsl(0_0%_48%)] hover:text-[hsl(0_72%_65%)]
                    border border-transparent hover:border-[hsl(0_72%_35%_/_0.4)]
                    transition-all
                "
                title="Sign out"
            >
                <LogOut className="w-3 h-3" />
                <span className="hidden sm:inline">Sign Out</span>
            </button>
        </div>
    );
}
