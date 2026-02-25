'use client';

import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import {
    TerminalLabel,
    TerminalInput,
    TerminalButton,
    Container,
    PageHeader,
} from '@/components/ui/terminal';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    async function handleMagicLink(e: React.FormEvent) {
        e.preventDefault();
        setStatus('sending');
        setErrorMessage(null);

        const supabase = getSupabaseBrowser();
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        if (error) {
            setStatus('error');
            setErrorMessage(error.message);
        } else {
            setStatus('sent');
        }
    }

    async function handleGoogleOAuth() {
        const supabase = getSupabaseBrowser();
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
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
                        title="AUTHENTICATE"
                        description="Sign in to access the VetIOS Intelligence Console."
                    />

                    {status === 'sent' ? (
                        <div className="p-6 border border-accent bg-accent/5 text-center space-y-4">
                            <div className="text-accent font-mono text-sm uppercase tracking-widest">
                                Magic link sent
                            </div>
                            <p className="font-mono text-xs text-muted">
                                Check your email for a sign-in link.
                                <br />
                                (Local dev: check Inbucket at <a href="http://127.0.0.1:54324" className="text-accent underline" target="_blank">127.0.0.1:54324</a>)
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            <form onSubmit={handleMagicLink} className="space-y-6">
                                <div>
                                    <TerminalLabel htmlFor="email">Email Address</TerminalLabel>
                                    <TerminalInput
                                        id="email"
                                        name="email"
                                        type="email"
                                        placeholder="vet@clinic.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>

                                <TerminalButton type="submit" disabled={status === 'sending'}>
                                    {status === 'sending' ? 'SENDING LINK...' : 'SEND MAGIC LINK'}
                                </TerminalButton>

                                {status === 'error' && errorMessage && (
                                    <div className="p-3 border border-danger text-danger font-mono text-xs">
                                        ERR: {errorMessage}
                                    </div>
                                )}
                            </form>

                            <div className="flex items-center gap-4">
                                <div className="flex-1 h-px bg-grid" />
                                <span className="font-mono text-xs text-muted uppercase">or</span>
                                <div className="flex-1 h-px bg-grid" />
                            </div>

                            <button
                                onClick={handleGoogleOAuth}
                                className="w-full font-mono text-sm uppercase tracking-widest px-6 py-3 border border-muted text-muted hover:border-foreground hover:text-foreground transition-colors flex items-center justify-center gap-3"
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                Continue with Google
                            </button>

                            <div className="text-center">
                                <a href="/signup" className="font-mono text-xs text-muted hover:text-accent transition-colors">
                                    First time? Create an account →
                                </a>
                            </div>
                        </div>
                    )}
                </Container>
            </main>
        </div>
    );
}
