'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { ConsoleCard, DataRow, TerminalButton, TerminalInput, TerminalLabel } from '@/components/ui/terminal';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';

interface TotpEnrollment {
    factorId: string;
    qrCode: string;
    secret: string;
}

interface MfaFactorSnapshot {
    id: string;
    factor_type: string;
    status: string;
    friendly_name?: string;
}

type SecurityPhase = 'loading' | 'ready' | 'enrolling' | 'verifying';

interface MfaSecurityCardProps {
    actionKey?: string;
    resourceType?: string;
    operationLabel?: string;
    returnTo?: string;
}

export function MfaSecurityCard({
    actionKey = 'api_credential.create',
    resourceType = 'oauth_client',
    operationLabel = 'critical infrastructure operations',
    returnTo,
}: MfaSecurityCardProps) {
    const router = useRouter();
    const [phase, setPhase] = useState<SecurityPhase>('loading');
    const [currentLevel, setCurrentLevel] = useState<string | null>(null);
    const [verifiedFactors, setVerifiedFactors] = useState<MfaFactorSnapshot[]>([]);
    const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
    const [code, setCode] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refreshSecurityState = useCallback(async () => {
        setError(null);
        const supabase = getSupabaseBrowser();
        const factorResult = await supabase.auth.mfa.listFactors();
        if (factorResult.error) throw factorResult.error;

        // Supabase auth operations share one browser-session lock. Keep these
        // reads sequential so profile startup cannot manufacture lock pressure.
        const assuranceResult = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceResult.error) throw assuranceResult.error;

        const factors = (factorResult.data?.all ?? []) as MfaFactorSnapshot[];
        setVerifiedFactors(factors.filter((factor) => (
            factor.factor_type === 'totp' && factor.status === 'verified'
        )));
        setCurrentLevel(assuranceResult.data?.currentLevel ?? null);
    }, []);

    useEffect(() => {
        let active = true;
        void refreshSecurityState()
            .catch((cause: unknown) => {
                if (active) setError(errorMessage(cause));
            })
            .finally(() => {
                if (active) setPhase('ready');
            });
        return () => {
            active = false;
        };
    }, [refreshSecurityState]);

    useEffect(() => {
        if (phase === 'ready' && currentLevel === 'aal2' && returnTo) {
            router.replace(returnTo);
            router.refresh();
        }
    }, [currentLevel, phase, returnTo, router]);

    async function beginEnrollment() {
        setPhase('enrolling');
        setError(null);
        setNotice(null);
        setCode('');
        try {
            const supabase = getSupabaseBrowser();
            const factors = await supabase.auth.mfa.listFactors();
            if (factors.error) throw factors.error;

            const staleFactors = (factors.data?.all ?? []).filter((factor) => (
                factor.factor_type === 'totp' && factor.status === 'unverified'
            ));
            for (const factor of staleFactors) {
                const cleanup = await supabase.auth.mfa.unenroll({ factorId: factor.id });
                if (cleanup.error) throw cleanup.error;
            }

            const result = await supabase.auth.mfa.enroll({
                factorType: 'totp',
                friendlyName: 'VetIOS Authenticator',
                issuer: 'VetIOS',
            });
            if (result.error || !result.data) throw result.error ?? new Error('MFA enrollment did not return a factor.');

            setEnrollment({
                factorId: result.data.id,
                qrCode: result.data.totp.qr_code,
                secret: result.data.totp.secret,
            });
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setPhase('ready');
        }
    }

    async function verifyFactor() {
        const normalizedCode = normalizeTotpCode(code);
        if (normalizedCode.length !== 6) {
            setError('Enter the six-digit code from your authenticator app.');
            return;
        }

        const factorId = enrollment?.factorId ?? verifiedFactors[0]?.id;
        if (!factorId) {
            setError('No authenticator factor is available. Start enrollment first.');
            return;
        }

        setPhase('verifying');
        setError(null);
        setNotice(null);
        try {
            const supabase = getSupabaseBrowser();
            const verification = await supabase.auth.mfa.challengeAndVerify({
                factorId,
                code: normalizedCode,
            });
            if (verification.error) throw verification.error;

            const completion = await fetch('/api/auth/step-up/complete', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    action_key: actionKey,
                    resource_type: resourceType,
                }),
            });
            const completionBody = await completion.json().catch(() => ({})) as {
                error?: string;
                auth_trust?: { blockers?: string[] };
            };
            if (!completion.ok) {
                const blockers = completionBody.auth_trust?.blockers?.join(', ');
                throw new Error(blockers || completionBody.error || 'The VetIOS step-up gate did not accept the MFA session.');
            }

            setEnrollment(null);
            setCode('');
            setShowSecret(false);
            await refreshSecurityState();
            setNotice(`AAL2 is active. Authorization is ready for ${operationLabel}.`);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setPhase('ready');
        }
    }

    const busy = phase !== 'ready';
    const aal2 = currentLevel === 'aal2';
    const needsChallenge = verifiedFactors.length > 0 && !aal2 && !enrollment;

    return (
        <ConsoleCard title="Account Security" className="mt-4">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="min-w-0">
                    <DataRow label="Session Assurance" value={aal2 ? 'AAL2 / MFA' : 'AAL1'} tone={aal2 ? 'accent' : 'warning'} />
                    <DataRow label="Authenticator" value={verifiedFactors.length > 0 ? 'Enrolled' : 'Not Enrolled'} tone={verifiedFactors.length > 0 ? 'accent' : 'muted'} />
                    <DataRow label="Critical Operations" value={aal2 ? 'Enabled' : 'Step-Up Required'} tone={aal2 ? 'accent' : 'warning'} />
                    <p className="pt-2 font-mono text-[11px] leading-relaxed text-[hsl(0_0%_64%)]">
                        A verified authenticator session is required for {operationLabel}.
                    </p>
                </div>

                <div className="min-w-0 border-t border-[hsl(0_0%_100%_/_0.08)] pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                    {phase === 'loading' ? (
                        <div className="flex min-h-32 items-center justify-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-[hsl(0_0%_68%)]">
                            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                            Checking Security
                        </div>
                    ) : aal2 ? (
                        <div className="flex min-h-32 flex-col items-start justify-center gap-3">
                            <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.14em] text-accent">
                                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                                MFA Session Active
                            </div>
                            <TerminalButton type="button" variant="secondary" disabled={busy} onClick={() => void refreshSecurityState()}>
                                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                                Refresh Status
                            </TerminalButton>
                        </div>
                    ) : enrollment ? (
                        <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
                            <div className="bg-white p-3">
                                <Image
                                    src={enrollment.qrCode}
                                    alt="VetIOS authenticator enrollment QR code"
                                    width={196}
                                    height={196}
                                    unoptimized
                                    className="h-auto w-full"
                                />
                            </div>
                            <div className="min-w-0 space-y-4">
                                <p className="font-mono text-[12px] leading-relaxed text-[hsl(0_0%_78%)]">
                                    Scan the QR code with an authenticator app, then enter its current code.
                                </p>
                                <div>
                                    <TerminalLabel htmlFor="mfa-secret">Manual Setup Key</TerminalLabel>
                                    <div className="flex gap-2">
                                        <TerminalInput id="mfa-secret" type={showSecret ? 'text' : 'password'} readOnly value={enrollment.secret} className="min-w-0" />
                                        <button
                                            type="button"
                                            onClick={() => setShowSecret((value) => !value)}
                                            className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[hsl(0_0%_32%)] text-[hsl(0_0%_72%)] transition-colors hover:border-accent/60 hover:text-accent"
                                            aria-label={showSecret ? 'Hide manual setup key' : 'Show manual setup key'}
                                        >
                                            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>
                                <TotpCodeInput code={code} setCode={setCode} disabled={busy} />
                                <TerminalButton type="button" disabled={busy} onClick={() => void verifyFactor()}>
                                    {phase === 'verifying' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                    Verify And Activate
                                </TerminalButton>
                            </div>
                        </div>
                    ) : needsChallenge ? (
                        <div className="space-y-4">
                            <p className="font-mono text-[12px] leading-relaxed text-[hsl(0_0%_78%)]">
                                Enter the current code from your enrolled authenticator to elevate this session to AAL2.
                            </p>
                            <TotpCodeInput code={code} setCode={setCode} disabled={busy} />
                            <TerminalButton type="button" disabled={busy} onClick={() => void verifyFactor()}>
                                {phase === 'verifying' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                Verify Session
                            </TerminalButton>
                        </div>
                    ) : (
                        <div className="flex min-h-32 flex-col items-start justify-center gap-3">
                            <p className="font-mono text-[12px] leading-relaxed text-[hsl(0_0%_78%)]">
                                Add a time-based authenticator before approving protected infrastructure operations.
                            </p>
                            <TerminalButton type="button" disabled={busy} onClick={() => void beginEnrollment()}>
                                {phase === 'enrolling' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                                Set Up Authenticator
                            </TerminalButton>
                        </div>
                    )}
                </div>
            </div>

            <div aria-live="polite" className="min-h-5 font-mono text-[11px] leading-relaxed">
                {error && <p className="text-destructive">{error}</p>}
                {!error && notice && <p className="text-accent">{notice}</p>}
            </div>
        </ConsoleCard>
    );
}

function TotpCodeInput({
    code,
    setCode,
    disabled,
}: {
    code: string;
    setCode: (value: string) => void;
    disabled: boolean;
}) {
    return (
        <div>
            <TerminalLabel htmlFor="mfa-code">Authenticator Code</TerminalLabel>
            <TerminalInput
                id="mfa-code"
                name="mfa-code"
                value={code}
                onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                disabled={disabled}
                className="text-lg tracking-[0.3em]"
            />
        </div>
    );
}

function normalizeTotpCode(value: string): string {
    return value.replace(/\D/g, '').slice(0, 6);
}

function errorMessage(value: unknown): string {
    const message = value instanceof Error ? value.message.trim() : '';
    if (/lockmanager|exclusive.*lock|timed out waiting/i.test(message)) {
        return 'The browser authentication session is locked. Close every VetIOS tab, reopen one tab, and retry MFA verification.';
    }
    return message || 'Unable to complete MFA setup. Refresh the page and try again.';
}
