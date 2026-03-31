'use client';

import { useEffect, useState } from 'react';
import { getConfiguredPublicSiteHost, isPreviewHostname } from '@/lib/site';

type AuthDomainNoticeProps = {
    actionLabel: string;
};

export function AuthDomainNotice({ actionLabel }: AuthDomainNoticeProps) {
    const [currentHost, setCurrentHost] = useState<string | null>(null);
    const officialHost = getConfiguredPublicSiteHost();

    useEffect(() => {
        setCurrentHost(window.location.host);
    }, []);

    if (!officialHost) {
        return null;
    }

    const hostMismatch = currentHost !== null && currentHost !== officialHost;
    const shouldWarn = hostMismatch || (currentHost !== null && isPreviewHostname(currentHost));

    return (
        <div className={`p-4 border space-y-2 ${shouldWarn ? 'border-danger bg-danger/5' : 'border-grid bg-dim/50'}`}>
            <div className={`font-mono text-[10px] uppercase tracking-widest ${shouldWarn ? 'text-danger' : 'text-accent'}`}>
                Official VetIOS Auth Domain
            </div>
            <p className="font-mono text-xs text-muted leading-relaxed">
                Only {actionLabel} if the address bar shows <span className="text-foreground">{officialHost}</span>.
            </p>
            {hostMismatch && currentHost && (
                <p className="font-mono text-[10px] leading-relaxed text-danger">
                    Current host <span className="text-foreground">{currentHost}</span> does not match the configured VetIOS domain.
                    This page should redirect to the official domain automatically.
                </p>
            )}
        </div>
    );
}
