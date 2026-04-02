'use client';

import { useState } from 'react';

export function PublicDeveloperOnboardingForm() {
    const [draft, setDraft] = useState({
        company_name: '',
        contact_name: '',
        contact_email: '',
        use_case: '',
        requested_products: '',
        requested_scopes: 'inference:write',
    });
    const [status, setStatus] = useState<{ tone: 'idle' | 'success' | 'error' | 'running'; message: string }>({
        tone: 'idle',
        message: '',
    });

    async function submit() {
        setStatus({ tone: 'running', message: 'Submitting onboarding request...' });
        try {
            const res = await fetch('/api/public/developer-catalog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...draft,
                    requested_products: splitCsv(draft.requested_products),
                    requested_scopes: splitCsv(draft.requested_scopes),
                }),
            });
            const data = await res.json() as { error?: string; onboarding_request?: { id: string } };
            if (!res.ok || !data.onboarding_request) {
                throw new Error(data.error ?? 'Unable to submit onboarding request.');
            }
            setStatus({
                tone: 'success',
                message: `Onboarding request submitted: ${data.onboarding_request.id}`,
            });
        } catch (error) {
            setStatus({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Unable to submit onboarding request.',
            });
        }
    }

    const toneClass = status.tone === 'success'
        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
        : status.tone === 'error'
            ? 'border-rose-400/20 bg-rose-400/10 text-rose-200'
            : status.tone === 'running'
                ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                : '';

    return (
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Self-serve onboarding</div>
            <h2 className="mt-2 text-xl font-semibold text-white">Request partner access</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">
                Submit a partner use case and requested products. The admin control plane can approve it and mint a scoped machine credential.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Company Name" value={draft.company_name} onChange={(value) => setDraft((current) => ({ ...current, company_name: value }))} />
                <Field label="Contact Name" value={draft.contact_name} onChange={(value) => setDraft((current) => ({ ...current, contact_name: value }))} />
                <Field label="Contact Email" value={draft.contact_email} onChange={(value) => setDraft((current) => ({ ...current, contact_email: value }))} />
                <Field label="Requested Products" value={draft.requested_products} onChange={(value) => setDraft((current) => ({ ...current, requested_products: value }))} />
                <Field label="Requested Scopes" value={draft.requested_scopes} onChange={(value) => setDraft((current) => ({ ...current, requested_scopes: value }))} />
            </div>

            <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Use Case</label>
                <textarea
                    value={draft.use_case}
                    onChange={(event) => setDraft((current) => ({ ...current, use_case: event.target.value }))}
                    className="mt-2 min-h-[132px] w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-white/20"
                />
            </div>

            <button
                type="button"
                onClick={() => void submit()}
                className="mt-5 inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
            >
                Submit onboarding request
            </button>

            {status.message ? (
                <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>
                    {status.message}
                </div>
            ) : null}
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</label>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-white/20"
            />
        </div>
    );
}

function splitCsv(value: string): string[] {
    return value.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}
