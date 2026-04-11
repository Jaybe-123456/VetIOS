'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { getEmailVerificationState } from '@/lib/auth/emailVerification';
import { sanitizeInternalPath } from '@/lib/site';
import {
    Container,
    PageHeader,
    TerminalButton,
} from '@/components/ui/terminal';

type ViewState = 'checking' | 'pending' | 'verified' | 'signed_out' | 'error';

export default function VerifyEmailPage() {
    const router = useRouter();
    const [status, setStatus] = useState<ViewState>('checking');
    const [email, setEmail] = useState('');
    const [source, setSource] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [nextPath, setNextPath] = useState('/inference');
    const [sending, setSending] = useState(false);

    const applyUserState = useCallback(async (user: User | null, requestedNextPath: string) => {
        if (!user) {
            setStatus('signed_out');
            setEmail('');
            setSource(null);
            return;
        }

        const verificationState = getEmailVerificationState(user);
        setEmail(user.email ?? '');
        setSource(verificationState.source);

        if (!verificationState.requiresVerification) {
            setStatus('verified');
            router.push(requestedNextPath);
            router.refresh();
            return;
        }

        setStatus('pending');
    }, [router]);

    useEffect(() => {
        let active = true;
        const params = new URLSearchParams(window.location.search);
        const requestedNextPath = sanitizeInternalPath(params.get('next'), '/inference');
        const verificationError = params.get('error');
        const supabase = getSupabaseBrowser();

        setNextPath(requestedNextPath);
        if (verificationError === 'verification_setup_failed') {
            setMessage('Your sign-in worked, but VetIOS could not send the verification email automatically. Use resend below.');
        }

        async function hydrateUser() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!active) {
                return;
            }
            await applyUserState(user, requestedNextPath);
        }

        void hydrateUser();

        const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (!active) {
                return;
            }
            await applyUserState(session?.user ?? null, requestedNextPath);
        });

        return () => {
            active = false;
            authListener.subscription.unsubscribe();
        };
    }, [applyUserState]);

    async function handleResend() {
        setSending(true);
        setMessage(null);

        try {
            const response = await fetch('/api/auth/email-verification/resend', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                credentials: 'same-origin',
                body: JSON.stringify({ nextPath }),
            });

            const payload = await response.json().catch(() => null) as {
                error?: string;
                code?: string;
                sent_at?: string;
            } | null;

            if (!response.ok) {
                setStatus('error');
                setMessage(payload?.error ?? 'Unable to resend the verification email right now.');
                return;
            }

            setStatus('pending');
            setMessage(
                payload?.code === 'already_verified'
                    ? 'Your email is already verified. Redirecting now.'
                    : 'Verification email sent. Open the latest message and click the link to continue.',
            );

            const supabase = getSupabaseBrowser();
            const { data: { user } } = await supabase.auth.getUser();
            await applyUserState(user, nextPath);
        } finally {
            setSending(false);
        }
    }

    async function handleRefresh() {
        setMessage(null);
        setStatus('checking');
        const supabase = getSupabaseBrowser();
        await supabase.auth.refreshSession();
        const { data: { user } } = await supabase.auth.getUser();
        await applyUserState(user, nextPath);
    }

    async function handleSignOut() {
        const supabase = getSupabaseBrowser();
        await supabase.auth.signOut();
        router.push('/login');
        router.refresh();
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-background">
            <header className="h-12 border-b border-grid flex items-center px-4 shrink-0 bg-dim">
                <span className="font-mono font-bold tracking-tight text-accent">VET_IOS //</span>
                <span className="font-mono text-sm text-muted ml-4">V1.0 OMEGA</span>
            </header>

            <main className="flex-1 flex items-center justify-center">
                <Container className="max-w-md w-full">
                    <PageHeader
                        title="VERIFY EMAIL"
                        description="Confirm your inbox before VetIOS unlocks this account."
                    />

                    {status === 'checking' ? (
                        <div className="p-6 border border-grid bg-dim/50 text-center space-y-3">
                            <div className="font-mono text-xs uppercase tracking-widest text-accent">
                                Checking verification status
                            </div>
                            <p className="font-mono text-xs text-muted">
                                Hold on while VetIOS checks whether this account is ready.
                            </p>
                        </div>
                    ) : status === 'signed_out' ? (
                        <div className="space-y-6">
                            <div className="p-6 border border-danger/60 bg-danger/5 space-y-3">
                                <div className="font-mono text-xs uppercase tracking-widest text-danger">
                                    Sign-in required
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    Sign in first so VetIOS knows which account should receive the verification email.
                                </p>
                            </div>

                            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                                <a href="/login" className="hover:text-accent transition-colors">
                                    Back to sign in
                                </a>
                                <a href="/signup" className="hover:text-accent transition-colors">
                                    Create account
                                </a>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="p-4 border border-accent/60 bg-accent/5 space-y-2">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-accent">
                                    Verification Required
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    VetIOS sent a confirmation link to <span className="text-foreground">{email || 'your email address'}</span>.
                                    Open that email and click the link before continuing.
                                </p>
                                {source === 'google_oauth' && (
                                    <p className="font-mono text-[10px] text-muted leading-relaxed">
                                        Google sign-in proved your identity, but VetIOS still requires a one-time inbox confirmation before first access.
                                    </p>
                                )}
                            </div>

                            {message && (
                                <div className={`p-3 border font-mono text-xs ${status === 'error' ? 'border-danger text-danger' : 'border-accent text-accent'}`}>
                                    {message}
                                </div>
                            )}

                            <div className="space-y-3">
                                <TerminalButton type="button" onClick={() => void handleResend()} disabled={sending}>
                                    {sending ? 'SENDING VERIFICATION EMAIL...' : 'RESEND VERIFICATION EMAIL'}
                                </TerminalButton>
                                <TerminalButton type="button" variant="secondary" onClick={() => void handleRefresh()}>
                                    CHECK AGAIN
                                </TerminalButton>
                            </div>

                            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                                <button type="button" onClick={() => void handleSignOut()} className="hover:text-danger transition-colors">
                                    Sign out
                                </button>
                                <span>Next destination: {nextPath}</span>
                            </div>
                        </div>
                    )}
                </Container>
            </main>
        </div>
    );
}
