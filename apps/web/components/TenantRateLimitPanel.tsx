'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { ConsoleCard, TerminalButton, TerminalInput, TerminalLabel } from '@/components/ui/terminal';
import { extractApiErrorMessage, extractEnvelopeData, requestJson } from '@/lib/debugTools/client';

type RateLimitConfig = {
    inference_requests_per_minute: number;
    evaluation_requests_per_minute: number;
    simulate_requests_per_minute: number;
};

export default function TenantRateLimitPanel() {
    const [draft, setDraft] = useState<RateLimitConfig>({
        inference_requests_per_minute: 60,
        evaluation_requests_per_minute: 120,
        simulate_requests_per_minute: 10,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function loadConfig() {
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            const { response, body } = await requestJson('/api/rate-limits');
            if (!response.ok) {
                throw new Error(extractApiErrorMessage(body, 'Failed to load tenant rate limits.'));
            }
            const data = extractEnvelopeData<Partial<RateLimitConfig>>(body);
            setDraft((current) => ({
                ...current,
                ...data,
            }));
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load tenant rate limits.');
        } finally {
            setLoading(false);
        }
    }

    async function saveConfig() {
        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const { response, body } = await requestJson('/api/rate-limits', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(draft),
            });
            if (!response.ok) {
                throw new Error(extractApiErrorMessage(body, 'Failed to save tenant rate limits.'));
            }
            const data = extractEnvelopeData<Partial<RateLimitConfig>>(body);
            setDraft((current) => ({
                ...current,
                ...data,
            }));
            setMessage('Tenant rate limits saved.');
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Failed to save tenant rate limits.');
        } finally {
            setSaving(false);
        }
    }

    useEffect(() => {
        void loadConfig();
    }, []);

    return (
        <ConsoleCard title="Tenant Rate Limits">
            {loading ? (
                <div className="font-mono text-xs text-muted">Loading tenant rate limits...</div>
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <TerminalLabel>Inference / min</TerminalLabel>
                            <TerminalInput
                                type="number"
                                value={draft.inference_requests_per_minute}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft((current) => ({
                                    ...current,
                                    inference_requests_per_minute: Number(event.target.value),
                                }))}
                            />
                        </div>
                        <div>
                            <TerminalLabel>Evaluation / min</TerminalLabel>
                            <TerminalInput
                                type="number"
                                value={draft.evaluation_requests_per_minute}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft((current) => ({
                                    ...current,
                                    evaluation_requests_per_minute: Number(event.target.value),
                                }))}
                            />
                        </div>
                        <div>
                            <TerminalLabel>Simulate / min</TerminalLabel>
                            <TerminalInput
                                type="number"
                                value={draft.simulate_requests_per_minute}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft((current) => ({
                                    ...current,
                                    simulate_requests_per_minute: Number(event.target.value),
                                }))}
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <TerminalButton onClick={() => void saveConfig()} disabled={saving}>
                            {saving ? 'Saving...' : 'Save Rate Limits'}
                        </TerminalButton>
                        <TerminalButton variant="secondary" onClick={() => void loadConfig()} disabled={saving}>
                            Refresh
                        </TerminalButton>
                    </div>

                    {message && (
                        <div className="font-mono text-xs text-accent">{message}</div>
                    )}
                    {error && (
                        <div className="font-mono text-xs text-danger">{error}</div>
                    )}
                </div>
            )}
        </ConsoleCard>
    );
}
