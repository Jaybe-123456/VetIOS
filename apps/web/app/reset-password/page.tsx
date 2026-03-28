'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import { validatePasswordPolicy } from '@/lib/auth/passwordPolicy';
import {
    TerminalLabel,
    TerminalInput,
    TerminalButton,
    Container,
    PageHeader,
} from '@/components/ui/terminal';

type ResetStatus = 'checking' | 'ready' | 'submitting' | 'success' | 'invalid' | 'error';

export default function ResetPasswordPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [status, setStatus] = useState<ResetStatus>('checking');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [email, setEmail] = useState('');

    useEffect(() => {
        let active = true;
        const supabase = getSupabaseBrowser();

        async function hydrateRecoverySession() {
            const { data, error } = await supabase.auth.getUser();

            if (!active) {
                return;
            }

            if (error || !data.user) {
                setStatus('invalid');
                return;
            }

            setEmail(data.user.email ?? '');
            setStatus('ready');
        }

        hydrateRecoverySession();

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!active) {
                return;
            }

            if (session?.user) {
                setEmail(session.user.email ?? '');
                setStatus((currentStatus) => (currentStatus === 'submitting' ? currentStatus : 'ready'));
            }
        });

        return () => {
            active = false;
            authListener.subscription.unsubscribe();
        };
    }, []);

    async function handlePasswordReset(e: React.FormEvent) {
        e.preventDefault();
        setErrorMessage(null);

        if (status === 'checking' || status === 'invalid' || status === 'submitting') {
            return;
        }

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

        setStatus('submitting');

        const supabase = getSupabaseBrowser();
        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
            setStatus('error');
            setErrorMessage(error.message);
            return;
        }

        setStatus('success');
        await supabase.auth.signOut();
        router.push('/login?reset=success');
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
                        title="SET NEW PASSWORD"
                        description="Create a new VetIOS password from your password reset link."
                    />

                    {status === 'checking' ? (
                        <div className="p-6 border border-grid bg-dim/50 text-center space-y-3">
                            <div className="font-mono text-xs uppercase tracking-widest text-accent">
                                Verifying reset session
                            </div>
                            <p className="font-mono text-xs text-muted">
                                Hold on while VetIOS checks your password reset link.
                            </p>
                        </div>
                    ) : status === 'invalid' ? (
                        <div className="space-y-6">
                            <div className="p-6 border border-danger/60 bg-danger/5 space-y-3">
                                <div className="font-mono text-xs uppercase tracking-widest text-danger">
                                    Reset link unavailable
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    This page needs a fresh password reset email. The link may be expired, already used,
                                    or opened outside the recovery flow.
                                </p>
                            </div>

                            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                                <a href="/forgot-password" className="hover:text-accent transition-colors">
                                    Request new reset link
                                </a>
                                <a href="/login" className="hover:text-accent transition-colors">
                                    Back to sign in
                                </a>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            <div className="p-4 border border-grid bg-dim/50 space-y-2">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-accent">
                                    Reset Guidance
                                </div>
                                <p className="font-mono text-xs text-muted leading-relaxed">
                                    This changes the password for your VetIOS account only. It does not change your Google password.
                                </p>
                                {email && (
                                    <p className="font-mono text-[10px] text-muted">
                                        Resetting access for <span className="text-foreground">{email}</span>
                                    </p>
                                )}
                            </div>

                            <form onSubmit={handlePasswordReset} className="space-y-6">
                                <div>
                                    <TerminalLabel htmlFor="password">New VetIOS Password</TerminalLabel>
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
                                </div>

                                <div>
                                    <TerminalLabel htmlFor="confirmPassword">Confirm New Password</TerminalLabel>
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
                                    {status === 'submitting' ? 'UPDATING PASSWORD...' : 'SAVE NEW PASSWORD'}
                                </TerminalButton>

                                {status === 'success' && (
                                    <div className="p-3 border border-accent text-accent font-mono text-xs">
                                        Password updated. Redirecting you to sign in.
                                    </div>
                                )}

                                {status === 'error' && errorMessage && (
                                    <div className="p-3 border border-danger text-danger font-mono text-xs">
                                        ERR: {errorMessage}
                                    </div>
                                )}
                            </form>

                            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                                <a href="/forgot-password" className="hover:text-accent transition-colors">
                                    Request another link
                                </a>
                                <a href="/login" className="hover:text-accent transition-colors">
                                    Back to sign in
                                </a>
                            </div>
                        </div>
                    )}
                </Container>
            </main>
        </div>
    );
}
