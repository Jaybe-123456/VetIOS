'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BellRing, CheckCircle2, HeartPulse, ShieldCheck } from 'lucide-react';

interface InvitationPreview {
    invitation_id: string;
    status: 'pending' | 'accepted' | 'expired' | 'revoked';
    expires_at: string;
    clinic_name: string;
    owner_display_name: string;
    pet: {
        id: string;
        pet_name: string;
        species: string | null;
        breed: string | null;
        age_display: string | null;
        risk_state: 'stable' | 'watch' | 'urgent';
    } | null;
}

interface OwnerAppSnapshot {
    owner: {
        id: string;
        display_name: string;
        status: string;
        activated_at: string | null;
    };
    pets: Array<{
        id: string;
        pet_name: string;
        species: string | null;
        breed: string | null;
        age_display: string | null;
        risk_state: string;
        clinic_name: string | null;
    }>;
    clinic_links: Array<{
        id: string;
        clinic_name: string;
        status: string;
    }>;
    timeline: Array<{
        id: string;
        title: string;
        at: string;
        type: string;
        detail: string;
    }>;
    alerts: Array<{
        id: string;
        title: string;
        severity: string;
        detail: string;
        action: string;
    }>;
}

type LoadState = 'loading' | 'ready' | 'accepted' | 'error';

export function PetPassInviteClient({ token }: { token: string | null }) {
    const [state, setState] = useState<LoadState>('loading');
    const [preview, setPreview] = useState<InvitationPreview | null>(null);
    const [ownerApp, setOwnerApp] = useState<OwnerAppSnapshot | null>(null);
    const [identity, setIdentity] = useState('');
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [notificationChannel, setNotificationChannel] = useState<'email' | 'sms' | 'push'>('email');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!token) {
            setError('This PetPass invite link is missing its token.');
            setState('error');
            return;
        }

        let canceled = false;
        setState('loading');
        fetch(`/api/public/petpass/invite?token=${encodeURIComponent(token)}`)
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(readError(payload, 'This PetPass invite is not available.'));
                }
                return payload as { invitation: InvitationPreview };
            })
            .then((payload) => {
                if (canceled) return;
                setPreview(payload.invitation);
                setState(payload.invitation.status === 'accepted' ? 'accepted' : 'ready');
            })
            .catch((loadError) => {
                if (canceled) return;
                setError(loadError instanceof Error ? loadError.message : 'Unable to load PetPass invite.');
                setState('error');
            });

        return () => {
            canceled = true;
        };
    }, [token]);

    const expiresLabel = useMemo(() => {
        if (!preview?.expires_at) return null;
        const date = new Date(preview.expires_at);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }, [preview?.expires_at]);

    async function acceptInvite() {
        if (!token || submitting) return;
        if (!acceptedTerms) {
            setError('Accept the PetPass access terms to continue.');
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch('/api/public/petpass/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    accepted_terms: acceptedTerms,
                    identity_email: identity.includes('@') ? identity : null,
                    identity_phone: identity.includes('@') ? null : identity,
                    notification_channel: notificationChannel,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(readError(payload, 'Unable to accept PetPass invite.'));
            }
            setOwnerApp((payload as { owner_app: OwnerAppSnapshot }).owner_app);
            setState('accepted');
        } catch (acceptError) {
            setError(acceptError instanceof Error ? acceptError.message : 'Unable to accept PetPass invite.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="min-h-screen bg-[#061313] text-white">
            <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8 lg:px-10">
                <header className="flex items-center justify-between border-b border-white/10 pb-5">
                    <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
                            <HeartPulse className="h-5 w-5" />
                        </span>
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200">VetIOS</div>
                            <h1 className="font-mono text-xl font-semibold tracking-wide">PetPass</h1>
                        </div>
                    </div>
                    <div className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300">
                        Invite
                    </div>
                </header>

                <section className="grid flex-1 items-start gap-6 py-8 lg:grid-cols-[0.92fr_1.08fr]">
                    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
                        {state === 'loading' ? (
                            <StatusBlock title="Loading PetPass invite" detail="Checking the clinic link." />
                        ) : state === 'error' ? (
                            <StatusBlock title="Invite unavailable" detail={error ?? 'This invite could not be opened.'} tone="error" />
                        ) : preview ? (
                            <>
                                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Clinic invitation</div>
                                <div className="mt-5 text-3xl font-semibold tracking-tight text-white">{preview.pet?.pet_name ?? 'PetPass'}</div>
                                <div className="mt-2 text-sm leading-6 text-slate-300">
                                    {preview.pet?.breed ?? preview.pet?.species ?? 'Linked pet'} - {preview.clinic_name}
                                </div>
                                <div className="mt-5 grid gap-3 text-sm text-slate-200">
                                    <InfoRow label="Owner" value={preview.owner_display_name} />
                                    <InfoRow label="Risk state" value={preview.pet?.risk_state ?? 'stable'} />
                                    <InfoRow label="Expires" value={expiresLabel ?? 'Soon'} />
                                </div>

                                {state !== 'accepted' || !ownerApp ? (
                                    <div className="mt-6 space-y-4">
                                        <label className="block">
                                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Email or phone</span>
                                            <input
                                                value={identity}
                                                onChange={(event) => setIdentity(event.target.value)}
                                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-300/50"
                                                placeholder="name@example.com"
                                            />
                                        </label>

                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Alerts</div>
                                            <div className="mt-2 grid grid-cols-3 gap-2">
                                                {(['email', 'sms', 'push'] as const).map((channel) => (
                                                    <button
                                                        key={channel}
                                                        type="button"
                                                        onClick={() => setNotificationChannel(channel)}
                                                        className={`rounded-2xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                                                            notificationChannel === channel
                                                                ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
                                                                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20'
                                                        }`}
                                                    >
                                                        {channel}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-200">
                                            <input
                                                type="checkbox"
                                                checked={acceptedTerms}
                                                onChange={(event) => setAcceptedTerms(event.target.checked)}
                                                className="mt-1 h-4 w-4 accent-emerald-300"
                                            />
                                            <span>I authorize this clinic-linked PetPass record and owner-safe health updates.</span>
                                        </label>

                                        {error ? <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</div> : null}

                                        <button
                                            type="button"
                                            onClick={acceptInvite}
                                            disabled={submitting}
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <CheckCircle2 className="h-4 w-4" />
                                            {submitting ? 'Activating' : 'Activate PetPass'}
                                        </button>
                                    </div>
                                ) : null}
                            </>
                        ) : null}
                    </div>

                    <div className="space-y-6">
                        {ownerApp ? (
                            <>
                                <div className="rounded-[28px] border border-emerald-300/20 bg-emerald-300/10 p-6">
                                    <div className="flex items-center gap-3 text-emerald-100">
                                        <ShieldCheck className="h-5 w-5" />
                                        <div className="font-semibold">PetPass active for {ownerApp.owner.display_name}</div>
                                    </div>
                                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                        {ownerApp.pets.map((pet) => (
                                            <div key={pet.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                                <div className="font-semibold">{pet.pet_name}</div>
                                                <div className="mt-1 text-sm text-slate-300">{pet.breed ?? pet.species ?? 'Linked pet'}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <Panel title="Care alerts" icon={<BellRing className="h-4 w-4" />}>
                                    {ownerApp.alerts.length > 0 ? ownerApp.alerts.map((alert) => (
                                        <TimelineRow key={alert.id} title={alert.title} detail={alert.detail} meta={alert.action} />
                                    )) : <EmptyLine text="No active alerts." />}
                                </Panel>

                                <Panel title="Health timeline">
                                    {ownerApp.timeline.length > 0 ? ownerApp.timeline.map((item) => (
                                        <TimelineRow key={item.id} title={item.title} detail={item.detail} meta={`${item.type} - ${item.at}`} />
                                    )) : <EmptyLine text="No timeline entries yet." />}
                                </Panel>
                            </>
                        ) : (
                            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
                                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Owner-safe distribution</div>
                                <p className="mt-4 text-sm leading-7 text-slate-300">
                                    Clinic-approved updates, alerts, and visit summaries appear here after activation.
                                </p>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

function StatusBlock({ title, detail, tone = 'neutral' }: { title: string; detail: string; tone?: 'neutral' | 'error' }) {
    return (
        <div className={tone === 'error' ? 'text-rose-100' : 'text-slate-200'}>
            <div className="text-lg font-semibold">{title}</div>
            <div className="mt-2 text-sm leading-6 opacity-80">{detail}</div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <span className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</span>
            <span className="text-right font-medium text-white">{value}</span>
        </div>
    );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
    return (
        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {icon}
                {title}
            </div>
            <div className="mt-4 space-y-3">{children}</div>
        </div>
    );
}

function TimelineRow({ title, detail, meta }: { title: string; detail: string; meta: string }) {
    return (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="font-semibold text-white">{title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-300">{detail}</div>
            <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-slate-500">{meta}</div>
        </div>
    );
}

function EmptyLine({ text }: { text: string }) {
    return <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">{text}</div>;
}

function readError(payload: unknown, fallback: string): string {
    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const value = (payload as { error?: unknown }).error;
        return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
    }
    return fallback;
}
