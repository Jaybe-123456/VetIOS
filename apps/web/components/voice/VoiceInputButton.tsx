'use client';

import { useState } from 'react';
import { Check, Clipboard, Loader2, Mic, RotateCcw, Send, Settings, Square, X } from 'lucide-react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { fallbackExtractClinicalFields } from '@/lib/voice/extract';
import type { ExtractedClinicalFields, VoiceExtractResponse, VoiceSurface } from '@/lib/voice/types';

interface VoiceInputButtonProps {
    surface: VoiceSurface;
    onExtracted: (fields: ExtractedClinicalFields) => void;
    onSubmitExtracted?: (fields: ExtractedClinicalFields) => void;
    label?: string;
    fillLabel?: string;
    submitLabel?: string;
}

export function VoiceInputButton({
    surface,
    onExtracted,
    onSubmitExtracted,
    label = 'Voice input',
    fillLabel = 'Fill form',
    submitLabel = 'Start conversation',
}: VoiceInputButtonProps) {
    const speech = useSpeechRecognition();
    const [isOpen, setIsOpen] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [fields, setFields] = useState<ExtractedClinicalFields | null>(null);
    const [extractError, setExtractError] = useState<string | null>(null);
    const [copiedSettings, setCopiedSettings] = useState(false);

    async function extractTranscript(transcriptOverride?: string) {
        const transcript = (transcriptOverride ?? speech.getTranscript()).trim();
        if (!transcript) {
            setExtractError('No speech captured yet.');
            return;
        }
        setIsExtracting(true);
        setExtractError(null);
        try {
            const response = await fetch('/api/voice/extract', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ transcript, surface }),
            });
            const body = await response.json().catch(() => null) as VoiceExtractResponse | null;
            if (!response.ok || !body?.fields) {
                throw new Error('Voice extraction failed.');
            }
            setFields(body.fields);
        } catch (error) {
            setFields(fallbackExtractClinicalFields(transcript));
            setExtractError(error instanceof Error ? error.message : 'Voice extraction failed. Raw transcript was preserved.');
        } finally {
            setIsExtracting(false);
        }
    }

    async function startListening() {
        setFields(null);
        setExtractError(null);
        await speech.start();
    }

    async function openAndStartListening() {
        setIsOpen(true);
        await startListening();
    }

    function stopAndExtract() {
        speech.stop();
        window.setTimeout(() => {
            void extractTranscript();
        }, 350);
    }

    function fillForm() {
        if (!fields) return;
        onExtracted(fields);
        closePanel();
    }

    function submitExtracted() {
        if (!fields || !onSubmitExtracted) return;
        onSubmitExtracted(fields);
        closePanel();
    }

    function closePanel() {
        setIsOpen(false);
        setFields(null);
        speech.reset();
        setExtractError(null);
    }

    function hidePanel() {
        speech.stop();
        setIsOpen(false);
    }

    function resetAll() {
        setFields(null);
        setExtractError(null);
        speech.reset();
    }

    const statusLabel = getVoiceStatusLabel({
        isRequestingPermission: speech.isRequestingPermission,
        isListening: speech.isListening,
        isExtracting,
        hasFields: Boolean(fields),
        permissionState: speech.permissionState,
    });
    const canReset = Boolean(speech.transcript || fields || extractError);

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    if (!isOpen) {
                        void openAndStartListening();
                        return;
                    }
                    if (speech.isListening) {
                        stopAndExtract();
                        return;
                    }
                    closePanel();
                }}
                className={[
                    'fixed bottom-5 right-5 z-[70] flex h-14 w-14 items-center justify-center rounded-full border text-black shadow-[0_0_30px_rgba(0,255,102,0.35)] transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent/60',
                    speech.isListening ? 'border-accent bg-accent animate-pulse' : 'border-accent/45 bg-accent',
                ].join(' ')}
                aria-label={label}
                title={label}
            >
                {speech.isListening ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            {isOpen ? (
                <section className="fixed bottom-24 right-4 z-[70] w-[min(25rem,calc(100vw-2rem))] rounded-lg border border-white/12 bg-[hsl(0_0%_6%)] p-3 text-white shadow-2xl">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className={[
                                'h-2.5 w-2.5 rounded-full',
                                speech.isListening ? 'bg-accent animate-pulse' : fields ? 'bg-accent' : 'bg-white/30',
                            ].join(' ')}
                            />
                            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/70">VetIOS Voice</div>
                        </div>
                        <div className="ml-auto rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
                            {statusLabel}
                        </div>
                        <button
                            type="button"
                            onClick={hidePanel}
                            className="rounded-md border border-white/10 p-2 text-white/50 transition hover:text-white"
                            aria-label="Close voice input"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {!speech.isSupported ? (
                        <div className="rounded-md border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                            Voice input is not supported in this browser. Use Chrome or Edge with microphone permissions enabled.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className={[
                                'min-h-[96px] rounded-md border p-3 text-sm leading-relaxed transition',
                                speech.isListening
                                    ? 'border-accent/45 bg-accent/5 text-white'
                                    : 'border-white/10 bg-black/35 text-white/80',
                            ].join(' ')}
                            >
                                {speech.isRequestingPermission ? (
                                    <VoiceActivity label="Permission" />
                                ) : speech.isListening && !speech.transcript ? (
                                    <VoiceActivity label="Listening" />
                                ) : isExtracting ? (
                                    <VoiceActivity label="Structuring" />
                                ) : fields && !speech.transcript ? (
                                    <span className="text-white/70">Clinical fields extracted.</span>
                                ) : (
                                    speech.transcript || <span className="text-white/35">Ready</span>
                                )}
                            </div>

                            {speech.permissionState === 'denied' ? (
                                <MicrophonePermissionRecovery
                                    onRetry={() => { void startListening(); }}
                                    onCopySettings={() => {
                                        void copyBrowserSettingsUrl().then((copied) => {
                                            setCopiedSettings(copied);
                                            if (copied) {
                                                window.setTimeout(() => setCopiedSettings(false), 2200);
                                            }
                                        });
                                    }}
                                    copied={copiedSettings}
                                />
                            ) : speech.error ? <Notice tone="danger">{speech.error}</Notice> : null}
                            {extractError ? <Notice tone="warning">{extractError}</Notice> : null}
                            {speech.isListening ? (
                                <VoiceSignalMeter />
                            ) : null}

                            {fields ? (
                                <div className="rounded-md border border-accent/20 bg-accent/5 p-3">
                                    <Preview fields={fields} />
                                </div>
                            ) : null}

                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    {!speech.isListening ? (
                                        <IconActionButton
                                            onClick={() => { void startListening(); }}
                                            disabled={isExtracting || speech.isRequestingPermission}
                                            label={speech.isRequestingPermission ? 'Requesting microphone permission' : 'Start voice capture'}
                                        >
                                            {speech.isRequestingPermission ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                                        </IconActionButton>
                                    ) : (
                                        <IconActionButton onClick={stopAndExtract} disabled={isExtracting} label="Stop and extract">
                                            <Square className="h-4 w-4" />
                                        </IconActionButton>
                                    )}
                                    <IconActionButton onClick={resetAll} disabled={isExtracting || !canReset} label="Reset voice capture">
                                        <RotateCcw className="h-4 w-4" />
                                    </IconActionButton>
                                    {!speech.isListening && speech.transcript && !fields ? (
                                        <IconActionButton
                                            onClick={() => void extractTranscript()}
                                            disabled={isExtracting}
                                            label="Extract clinical fields"
                                        >
                                            {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                        </IconActionButton>
                                    ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                    {fields ? (
                                        <IconActionButton onClick={fillForm} disabled={isExtracting} accent label={fillLabel}>
                                            <Check className="h-4 w-4" />
                                        </IconActionButton>
                                    ) : null}
                                    {fields && onSubmitExtracted ? (
                                        <IconActionButton onClick={submitExtracted} disabled={isExtracting} accent label={submitLabel}>
                                            <Send className="h-4 w-4" />
                                        </IconActionButton>
                                    ) : null}
                                </div>
                            </div>

                        </div>
                    )}
                </section>
            ) : null}
        </>
    );
}

function IconActionButton({
    children,
    onClick,
    disabled,
    accent = false,
    label,
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    accent?: boolean;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={[
                'flex h-10 w-10 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-45',
                accent
                    ? 'border-accent/50 bg-accent/15 text-accent hover:bg-accent hover:text-black'
                    : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/25 hover:text-white',
            ].join(' ')}
        >
            {children}
        </button>
    );
}

function VoiceActivity({ label }: { label: string }) {
    return (
        <div className="flex h-full min-h-[64px] items-center justify-center gap-2 text-accent">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]">{label}</span>
        </div>
    );
}

function VoiceSignalMeter() {
    return (
        <div className="flex items-center justify-center gap-1" aria-label="Microphone is live">
            {[14, 22, 30, 18, 26].map((height, index) => (
                <span
                    key={height}
                    className="w-1 rounded-full bg-accent/80 animate-pulse"
                    style={{
                        height,
                        animationDelay: `${index * 90}ms`,
                    }}
                />
            ))}
        </div>
    );
}

function getVoiceStatusLabel({
    isRequestingPermission,
    isListening,
    isExtracting,
    hasFields,
    permissionState,
}: {
    isRequestingPermission: boolean;
    isListening: boolean;
    isExtracting: boolean;
    hasFields: boolean;
    permissionState: string;
}) {
    if (isRequestingPermission) return 'Permission';
    if (isListening) return 'Live';
    if (isExtracting) return 'Parsing';
    if (hasFields) return 'Ready';
    if (permissionState === 'denied') return 'Blocked';
    return 'Standby';
}

function Preview({ fields }: { fields: ExtractedClinicalFields }) {
    const rows = [
        ['Species', fields.species],
        ['Breed', fields.breed],
        ['Age', fields.age_value && fields.age_unit ? `${fields.age_value} ${fields.age_unit}` : undefined],
        ['Sex', fields.sex?.replace(/_/g, ' ')],
        ['Signs', fields.symptoms.join(', ')],
        ['Duration', fields.duration_value && fields.duration_unit ? `${fields.duration_value} ${fields.duration_unit}` : undefined],
        ['Labs', fields.labs ? Object.entries(fields.labs).map(([key, value]) => `${key.toUpperCase()} ${value}`).join(', ') : undefined],
    ].filter(([, value]) => Boolean(value));

    return (
        <div className="space-y-1.5 text-xs">
            {rows.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[88px_1fr] gap-2">
                    <span className="text-white/40">{key}</span>
                    <span className="text-white/85">{value}</span>
                </div>
            ))}
        </div>
    );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: 'warning' | 'danger' }) {
    return (
        <div className={[
            'rounded-md border p-2 text-xs',
            tone === 'danger'
                ? 'border-red-400/30 bg-red-400/10 text-red-100'
                : 'border-yellow-400/30 bg-yellow-400/10 text-yellow-100',
        ].join(' ')}
        >
            {children}
        </div>
    );
}

function MicrophonePermissionRecovery({
    onRetry,
    onCopySettings,
    copied,
}: {
    onRetry: () => void;
    onCopySettings: () => void;
    copied: boolean;
}) {
    const browser = detectBrowser();
    return (
        <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-50">
            <div className="mb-2 flex items-center gap-2 font-medium text-red-100">
                <Settings className="h-4 w-4" />
                Microphone permission is blocked
            </div>
            <ol className="list-decimal space-y-1 pl-5 leading-relaxed text-red-50/85">
                {permissionSteps(browser).map((step) => (
                    <li key={step}>{step}</li>
                ))}
            </ol>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-md border border-red-200/25 bg-white/5 px-3 py-2 text-left text-red-50 transition hover:bg-white/10"
                >
                    Try again
                </button>
                <button
                    type="button"
                    onClick={onCopySettings}
                    className="flex items-center justify-between gap-2 rounded-md border border-red-200/25 bg-white/5 px-3 py-2 text-left text-red-50 transition hover:bg-white/10"
                >
                    <span>{copied ? 'Settings address copied' : 'Copy browser settings address'}</span>
                    <Clipboard className="h-3.5 w-3.5" />
                </button>
            </div>
            <p className="mt-2 leading-relaxed text-red-50/65">
                Browsers do not allow websites to force-open protected microphone settings or switch browsers automatically.
                Paste the copied settings address in a new tab if the site controls icon is not visible.
            </p>
        </div>
    );
}

function detectBrowser(): 'chrome' | 'edge' | 'firefox' | 'safari' | 'other' {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('edg/')) return 'edge';
    if (userAgent.includes('firefox/')) return 'firefox';
    if (userAgent.includes('safari/') && !userAgent.includes('chrome/') && !userAgent.includes('chromium/')) return 'safari';
    if (userAgent.includes('chrome/') || userAgent.includes('chromium/')) return 'chrome';
    return 'other';
}

function permissionSteps(browser: ReturnType<typeof detectBrowser>): string[] {
    if (browser === 'chrome') {
        return [
            'Click the site controls icon beside the address bar.',
            'Set Microphone to Allow for vetios.tech.',
            'Reload this page, then click Start again.',
        ];
    }
    if (browser === 'edge') {
        return [
            'Click the lock or site controls icon beside the address bar.',
            'Open Permissions for this site and set Microphone to Allow.',
            'Reload VetIOS, then click Start again.',
        ];
    }
    if (browser === 'firefox') {
        return [
            'Click the permissions icon beside the address bar.',
            'Remove the blocked microphone permission or choose Allow.',
            'Reload VetIOS, then click Start again.',
        ];
    }
    if (browser === 'safari') {
        return [
            'Open Safari Settings, then Websites, then Microphone.',
            'Set vetios.tech to Allow.',
            'Reload VetIOS. Chrome or Edge gives more reliable Web Speech support.',
        ];
    }
    return [
        'Open this site in Chrome or Edge for the most reliable voice mode.',
        'Allow microphone access for vetios.tech in browser site settings.',
        'Reload VetIOS, then click Start again.',
    ];
}

async function copyBrowserSettingsUrl(): Promise<boolean> {
    const browser = detectBrowser();
    const settingsUrl = browser === 'edge'
        ? 'edge://settings/content/microphone'
        : browser === 'firefox'
            ? 'about:preferences#privacy'
            : browser === 'safari'
                ? 'Safari Settings > Websites > Microphone'
                : 'chrome://settings/content/microphone';
    try {
        await navigator.clipboard.writeText(settingsUrl);
        return true;
    } catch {
        return false;
    }
}
