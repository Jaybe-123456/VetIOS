'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

declare global {
    interface Window {
        turnstile?: {
            remove: (widgetId: string) => void;
            render: (container: HTMLElement, options: {
                sitekey: string;
                theme?: 'light' | 'dark' | 'auto';
                callback?: (token: string) => void;
                'expired-callback'?: () => void;
                'error-callback'?: () => void;
            }) => string;
        };
    }
}

interface TurnstileWidgetProps {
    enabled: boolean;
    siteKey: string;
    resetKey: number;
    onTokenChange: (token: string | null) => void;
}

export function TurnstileWidget({
    enabled,
    siteKey,
    resetKey,
    onTokenChange,
}: TurnstileWidgetProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [scriptReady, setScriptReady] = useState(false);

    useEffect(() => {
        if (!enabled || !siteKey) {
            onTokenChange(null);
            destroyWidget();
            return;
        }

        if (!scriptReady || !window.turnstile || !containerRef.current) {
            return;
        }

        destroyWidget();
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: 'dark',
            callback: (token) => onTokenChange(token),
            'expired-callback': () => onTokenChange(null),
            'error-callback': () => onTokenChange(null),
        });

        return () => {
            destroyWidget();
        };
    }, [enabled, onTokenChange, resetKey, scriptReady, siteKey]);

    function destroyWidget() {
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
    }

    return (
        <>
            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                strategy="afterInteractive"
                onLoad={() => setScriptReady(true)}
            />
            {enabled ? <div ref={containerRef} className="min-h-16" /> : null}
        </>
    );
}
