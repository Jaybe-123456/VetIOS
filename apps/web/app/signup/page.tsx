'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { isGoogleMailAddress } from '@/lib/auth/emailProviderHints';
import { validatePasswordPolicy } from '@/lib/auth/passwordPolicy';
import { AuthDomainNotice } from '@/components/auth/AuthDomainNotice';
import { buildClientAuthCallbackUrl } from '@/lib/site';
import {
    TerminalLabel,
    TerminalInput,
    TerminalButton,
    Container,
    PageHeader,
} from '@/components/ui/terminal';

export default function SignupPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const isGoogleEmail = isGoogleMailAddress(email);
    const showGooglePasswordWarning = isGoogleEmail && password.trim().length > 0;

    async function handleEmailPasswordSignup(e: React.FormEvent) {
        e.preventDefault();
        setStatus('submitting');
        setErrorMessage(null);

        if (password !== confirmPassword) {
            setStatus('error');
            setErrorMessage('Passwords do not match.');
            return;
        }

        const passwordValidation = validatePasswordPolicy(email, password);
        if (!passwordValidation.valid) {
            setStatus('error');
            setErrorMessage(passwordValidation.issues.join(' '));
            return;
        }

        const supabase = getSupabaseBrowser();
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: buildClientAuthCallbackUrl(window.location.origin),
            },
        });

        if (error) {
            setStatus('error');
            setErrorMessage(error.message);
        } else if (data.session) {
            setStatus('success');
            router.push('/inference');
            router.refresh();
        } else {
            setStatus('sent');
        }
    }

    async function handleGoogleOAuth() {
        const supabase = getSupabaseBrowser();
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: buildClientAuthCallbackUrl(window.location.origin),
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
                        title="CREATE ACCOUNT"
                        description="Create an account with email and password or continue with Google."
                    />

                    {status === 'success' ? (
                        <div className="p-6 border border-accent bg-accent/5 text-center space-y-4">
                            <div className="text-accent font-mono text-sm uppercase tracking-widest">
                                Account created
                            </div>
                            <p className="font-mono text-xs text-muted">
                                Redirecting you into the VetIOS console.
                            </p>
                        </div>
                    ) : status === 'sent' ? (
                        <div className="p-6 border border-accent bg-accent/5 text-center space-y-4">
                            <div className="text-accent font-mono text-sm uppercase tracking-widest">
                                Check your email
                            </div>
                            <p className="font-mono text-xs text-muted">
                                Your account was created. If email confirmation is enabled in Supabase,
                                use the verification email before signing in.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            <AuthDomainNotice actionLabel="create an account" />

                            <div className="p-4 border border-grid bg-dim/50 space-y-2">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-accent">
                                    Account Setup Guidance
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    Choose <span className="text-foreground">Continue with Google</span> if this account should authenticate through Google or Gmail.
                                    Use the password form only if you want a separate VetIOS password account.
                                </p>
                            </div>

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
                                <span className="font-mono text-xs text-muted uppercase">or create a VetIOS password</span>
                                <div className="flex-1 h-px bg-grid" />
                            </div>

                            <form onSubmit={handleEmailPasswordSignup} className="space-y-6">
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
                                        This form creates a VetIOS-specific password account for the email you enter.
                                    </p>
                                    {isGoogleEmail && (
                                        <p className="mt-2 font-mono text-[10px] text-accent leading-relaxed">
                                            Gmail address detected. If you want Google sign-in instead of a separate VetIOS password, use the Google button above.
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
                                            placeholder="Create a strong password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            autoComplete="new-password"
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
                                    <p className="mt-2 font-mono text-[10px] text-muted">
                                        Use 10+ characters with uppercase, lowercase, number, and symbol.
                                    </p>
                                    {showGooglePasswordWarning && (
                                        <div className="mt-2 p-3 border border-danger text-danger font-mono text-[10px] leading-relaxed">
                                            Do not reuse your Google password here. This creates a separate VetIOS password account, not a Google sign-in.
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <TerminalLabel htmlFor="confirmPassword">Confirm Password</TerminalLabel>
                                    <div className="relative">
                                        <TerminalInput
                                            id="confirmPassword"
                                            name="confirmPassword"
                                            type={showConfirmPassword ? 'text' : 'password'}
                                            placeholder="Repeat your password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            autoComplete="new-password"
                                            className="pr-20"
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirmPassword((value) => !value)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-widest text-muted hover:text-accent transition-colors"
                                            aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                                        >
                                            {showConfirmPassword ? 'Hide' : 'Show'}
                                        </button>
                                    </div>
                                </div>

                                <TerminalButton type="submit" disabled={status === 'submitting'}>
                                    {status === 'submitting' ? 'CREATING ACCOUNT...' : 'CREATE VETIOS PASSWORD ACCOUNT'}
                                </TerminalButton>

                                {status === 'error' && errorMessage && (
                                    <div className="p-3 border border-danger text-danger font-mono text-xs">
                                        ERR: {errorMessage}
                                    </div>
                                )}
                            </form>

                            <div className="text-center">
                                <a href="/login" className="font-mono text-xs text-muted hover:text-accent transition-colors">
                                    Already have an account? Sign in →
                                </a>
                            </div>
                        </div>
                    )}
                </Container>
            </main>
        </div>
    );
}
