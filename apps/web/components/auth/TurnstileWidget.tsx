'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';

declare global {
    interface Window {
        turnstile?: {
            remove: (widgetId: string) => void;
            reset: (widgetId: string) => void;
            render: (container: HTMLElement, options: {
                sitekey: string;
                theme?: 'light' | 'dark' | 'auto';
                retry?: 'auto' | 'never';
                'retry-interval'?: number;
                'refresh-expired'?: 'auto' | 'manual' | 'never';
                'refresh-timeout'?: 'auto' | 'manual' | 'never';
                callback?: (token: string) => void;
                'expired-callback'?: () => void;
                'timeout-callback'?: () => void;
                'error-callback'?: (errorCode?: string | number) => boolean | void;
            }) => string;
        };
    }
}

interface TurnstileWidgetProps {
    enabled: boolean;
    siteKey: string;
    resetKey: number;
    onTokenChange: (token: string | null) => void;
    onErrorChange?: (message: string | null) => void;
}

export function TurnstileWidget({
    enabled,
    siteKey,
    resetKey,
    onTokenChange,
    onErrorChange,
}: TurnstileWidgetProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [scriptReady, setScriptReady] = useState(false);
    const loadTimeoutRef = useRef<number | null>(null);

    const clearLoadTimeout = useCallback(() => {
        if (typeof window === 'undefined') {
            return;
        }
        if (loadTimeoutRef.current != null) {
            window.clearTimeout(loadTimeoutRef.current);
            loadTimeoutRef.current = null;
        }
    }, []);

    const destroyWidget = useCallback(() => {
        if (typeof window === 'undefined') {
            return;
        }

        if (widgetIdRef.current && window.turnstile) {
            window.turnstile.remove(widgetIdRef.current);
        }

        widgetIdRef.current = null;

        if (containerRef.current) {
            containerRef.current.innerHTML = '';
        }
    }, []);

    const queueReset = useCallback(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const widgetId = widgetIdRef.current;
        if (!widgetId || !window.turnstile?.reset) {
            return;
        }

        window.setTimeout(() => {
            if (widgetIdRef.current === widgetId) {
                window.turnstile?.reset(widgetId);
            }
        }, 250);
    }, []);

    const scheduleLoadTimeout = useCallback(() => {
        if (typeof window === 'undefined') {
            return;
        }
        if (loadTimeoutRef.current != null) {
            return;
        }

        loadTimeoutRef.current = window.setTimeout(() => {
            loadTimeoutRef.current = null;
            if (enabled && !window.turnstile) {
                onTokenChange(null);
                onErrorChange?.('Security challenge could not load. Check whether a blocker, CSP rule, or network filter is interfering.');
            }
        }, 6000);
    }, [enabled, onErrorChange, onTokenChange]);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.turnstile) {
            setScriptReady(true);
        }
    }, []);

    useEffect(() => {
        if (!enabled || !siteKey) {
            onTokenChange(null);
            onErrorChange?.(null);
            clearLoadTimeout();
            destroyWidget();
            return;
        }

        if (!scriptReady || !window.turnstile || !containerRef.current) {
            scheduleLoadTimeout();
            return;
        }

        clearLoadTimeout();
        destroyWidget();
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: 'dark',
            retry: 'auto',
            'retry-interval': 8000,
            'refresh-expired': 'auto',
            'refresh-timeout': 'auto',
            callback: (token) => {
                onErrorChange?.(null);
                onTokenChange(token);
            },
            'expired-callback': () => {
                onTokenChange(null);
                onErrorChange?.('Security challenge expired. Please complete it again.');
                queueReset();
            },
            'timeout-callback': () => {
                onTokenChange(null);
                onErrorChange?.('Security challenge timed out. Please try again.');
                queueReset();
            },
            'error-callback': (errorCode) => {
                onTokenChange(null);
                onErrorChange?.(describeTurnstileError(errorCode));
                queueReset();
                return true;
            },
        });

        return () => {
            clearLoadTimeout();
            destroyWidget();
        };
    }, [
        clearLoadTimeout,
        destroyWidget,
        enabled,
        onErrorChange,
        onTokenChange,
        queueReset,
        resetKey,
        scheduleLoadTimeout,
        scriptReady,
        siteKey,
    ]);

    return (
        <>
            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                strategy="afterInteractive"
                onLoad={() => setScriptReady(true)}
                onError={() => {
                    onTokenChange(null);
                    onErrorChange?.('Security challenge script failed to load. Please retry or disable blockers for this site.');
                }}
            />
            {enabled ? <div ref={containerRef} className="min-h-16" /> : null}
        </>
    );
}

function describeTurnstileError(errorCode?: string | number) {
    const normalized = String(errorCode ?? '');
    if (normalized.startsWith('1101') || normalized === '400020') {
        return 'Security challenge configuration is invalid. Please contact support.';
    }
    if (normalized === '110200') {
        return 'This domain is not authorized for the security challenge. Please contact support.';
    }
    if (normalized === '110600' || normalized === '110620') {
        return 'Security challenge timed out. Please try again.';
    }
    if (normalized.startsWith('200500')) {
        return 'The security challenge could not load. Check whether a blocker or network filter is interfering.';
    }
    if (normalized.startsWith('300') || normalized.startsWith('600')) {
        return 'Security challenge verification failed. Please retry or use a different browser/network.';
    }
    return 'Security challenge verification failed. Please try again.';
}
