'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { isGoogleMailAddress } from '@/lib/auth/emailProviderHints';
import {
    TerminalLabel,
    TerminalInput,
    TerminalButton,
    Container,
    PageHeader,
} from '@/components/ui/terminal';

export default function LoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const isGoogleEmail = isGoogleMailAddress(email);
    const showGooglePasswordWarning = isGoogleEmail && password.trim().length > 0;
    const showResetSuccess = searchParams.get('reset') === 'success';
    const authError = searchParams.get('error');

    async function handleEmailPasswordLogin(e: React.FormEvent) {
        e.preventDefault();
        setStatus('submitting');
        setErrorMessage(null);

        const supabase = getSupabaseBrowser();
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            setStatus('error');
            setErrorMessage(error.message);
            return;
        }

        setStatus('success');
        router.push('/inference');
        router.refresh();
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
                        description="Sign in with email and password or continue with Google."
                    />

                    {status === 'success' ? (
                        <div className="p-6 border border-accent bg-accent/5 text-center space-y-4">
                            <div className="text-accent font-mono text-sm uppercase tracking-widest">
                                Authentication successful
                            </div>
                            <p className="font-mono text-xs text-muted">
                                Redirecting you into the VetIOS console.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            <div className="p-4 border border-grid bg-dim/50 space-y-2">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-accent">
                                    Sign-In Guidance
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    If this account uses Google or Gmail, choose <span className="text-foreground">Continue with Google</span>.
                                    The password form below is only for a separate VetIOS password created for this email.
                                </p>
                            </div>

                            {showResetSuccess && (
                                <div className="p-3 border border-accent text-accent font-mono text-xs">
                                    Password reset complete. Sign in with your new VetIOS password.
                                </div>
                            )}

                            {authError === 'auth_failed' && (
                                <div className="p-3 border border-danger text-danger font-mono text-xs">
                                    ERR: The authentication link could not be verified. Request a fresh sign-in or password reset email.
                                </div>
                            )}

                            <button
                                type="button"
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

                            <div className="flex items-center gap-4">
                                <div className="flex-1 h-px bg-grid" />
                                <span className="font-mono text-xs text-muted uppercase">or use a VetIOS password</span>
                                <div className="flex-1 h-px bg-grid" />
                            </div>

                            <form onSubmit={handleEmailPasswordLogin} className="space-y-6">
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
                                    <p className="mt-2 font-mono text-[10px] text-muted leading-relaxed">
                                        Use this form only if you already created a VetIOS password for this email.
                                    </p>
                                    {isGoogleEmail && (
                                        <p className="mt-2 font-mono text-[10px] text-accent leading-relaxed">
                                            Gmail address detected. If you usually sign in through Google, use the Google button above.
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <TerminalLabel htmlFor="password">VetIOS Password</TerminalLabel>
                                    <div className="relative">
                                        <TerminalInput
                                            id="password"
                                            name="password"
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="Enter your password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            autoComplete="current-password"
                                            className="pr-20"
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword((value) => !value)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-widest text-muted hover:text-accent transition-colors"
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showPassword ? 'Hide' : 'Show'}
                                        </button>
                                    </div>
                                    {showGooglePasswordWarning && (
                                        <div className="mt-2 p-3 border border-danger text-danger font-mono text-[10px] leading-relaxed">
                                            Stop if this is your Google password. Google accounts should use <span className="text-foreground">Continue with Google</span>, not the VetIOS password form.
                                        </div>
                                    )}
                                </div>

                                <TerminalButton type="submit" disabled={status === 'submitting'}>
                                    {status === 'submitting' ? 'SIGNING IN...' : 'SIGN IN WITH VETIOS PASSWORD'}
                                </TerminalButton>

                                <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                                    <a href="/forgot-password" className="hover:text-accent transition-colors">
                                        Forgot password?
                                    </a>
                                    <a href="/signup" className="hover:text-accent transition-colors">
                                        Create account
                                    </a>
                                </div>

                                {status === 'error' && errorMessage && (
                                    <div className="p-3 border border-danger text-danger font-mono text-xs">
                                        ERR: {errorMessage}
                                    </div>
                                )}
                            </form>
                        </div>
                    )}
                </Container>
            </main>
        </div>
    );
}
