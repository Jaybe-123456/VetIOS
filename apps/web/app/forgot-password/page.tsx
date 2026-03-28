'use client';

import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { isGoogleMailAddress } from '@/lib/auth/emailProviderHints';
import {
    TerminalLabel,
    TerminalInput,
    TerminalButton,
    Container,
    PageHeader,
} from '@/components/ui/terminal';

function buildResetRedirectUrl(): string {
    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('next', '/reset-password');
    return callbackUrl.toString();
}

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const isGoogleEmail = isGoogleMailAddress(email);

    async function handleResetRequest(e: React.FormEvent) {
        e.preventDefault();
        setStatus('submitting');
        setErrorMessage(null);

        const supabase = getSupabaseBrowser();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: buildResetRedirectUrl(),
        });

        if (error) {
            setStatus('error');
            setErrorMessage(error.message);
            return;
        }

        setStatus('sent');
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
                        title="RESET ACCESS"
                        description="Request a password reset email for a VetIOS password account."
                    />

                    {status === 'sent' ? (
                        <div className="space-y-6">
                            <div className="p-6 border border-accent bg-accent/5 text-center space-y-4">
                                <div className="text-accent font-mono text-sm uppercase tracking-widest">
                                    Reset email sent
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    If a VetIOS password exists for this email, the reset link is on its way now.
                                </p>
                            </div>

                            <div className="p-4 border border-grid bg-dim/50 space-y-2">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-accent">
                                    Check Before Retrying
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    Google or Gmail users who sign in with Google may not have a separate VetIOS password to reset.
                                </p>
                            </div>

                            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                                <a href="/login" className="hover:text-accent transition-colors">
                                    Back to sign in
                                </a>
                                <button
                                    type="button"
                                    onClick={() => setStatus('idle')}
                                    className="hover:text-accent transition-colors"
                                >
                                    Send again
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            <div className="p-4 border border-grid bg-dim/50 space-y-2">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-accent">
                                    Password Recovery Guidance
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    Use this only for a VetIOS password account. If you normally use Google sign-in,
                                    return to login and choose <span className="text-foreground">Continue with Google</span>.
                                </p>
                            </div>

                            <form onSubmit={handleResetRequest} className="space-y-6">
                                <div>
                                    <TerminalLabel htmlFor="email">Email Address</TerminalLabel>
                                    <TerminalInput
                                        id="email"
                                        name="email"
                                        type="email"
                                        placeholder="name@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        autoComplete="email"
                                        required
                                    />
                                    {isGoogleEmail && (
                                        <p className="mt-2 font-mono text-[10px] text-accent leading-relaxed">
                                            Gmail address detected. Only request a reset if this email also has a separate VetIOS password.
                                        </p>
                                    )}
                                </div>

                                <TerminalButton type="submit" disabled={status === 'submitting'}>
                                    {status === 'submitting' ? 'SENDING RESET LINK...' : 'SEND PASSWORD RESET EMAIL'}
                                </TerminalButton>

                                {status === 'error' && errorMessage && (
                                    <div className="p-3 border border-danger text-danger font-mono text-xs">
                                        ERR: {errorMessage}
                                    </div>
                                )}
                            </form>

                            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                                <a href="/login" className="hover:text-accent transition-colors">
                                    Back to sign in
                                </a>
                                <a href="/signup" className="hover:text-accent transition-colors">
                                    Create account
                                </a>
                            </div>
                        </div>
                    )}
                </Container>
            </main>
        </div>
    );
}
