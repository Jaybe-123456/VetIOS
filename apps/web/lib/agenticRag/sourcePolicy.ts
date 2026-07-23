import type { RagAuthorityTier, RagSourceType } from './types';
import { validateOutboundUrlSyntax } from '@/lib/http/safeOutboundRequest';

const TRUSTED_MEDICAL_HOSTS = [
    'avma.org',
    'aaha.org',
    'wsava.org',
    'acvim.org',
    'aafponline.org',
    'capcvet.org',
    'esccap.org',
    'iris-kidney.com',
    'vet.cornell.edu',
    'vin.com',
    'merckvetmanual.com',
    'ncbi.nlm.nih.gov',
    'pubmed.ncbi.nlm.nih.gov',
    'pmc.ncbi.nlm.nih.gov',
    'nih.gov',
    'fda.gov',
    'ema.europa.eu',
    'usda.gov',
    'cdc.gov',
    'woah.org',
    'wormsandgermsblog.com',
];

export function normalizeRagSourceType(value: string | null | undefined): RagSourceType {
    const allowed: RagSourceType[] = [
        'guideline',
        'journal',
        'textbook',
        'drug_label',
        'lab_reference',
        'clinical_protocol',
        'client_handout',
        'dataset',
        'web',
        'file',
        'other',
    ];
    return allowed.includes(value as RagSourceType) ? value as RagSourceType : 'other';
}

export function normalizeAuthorityTier(value: string | null | undefined): RagAuthorityTier {
    const allowed: RagAuthorityTier[] = [
        'peer_reviewed',
        'specialist_guideline',
        'regulatory',
        'institutional',
        'clinic_local',
        'unverified',
    ];
    return allowed.includes(value as RagAuthorityTier) ? value as RagAuthorityTier : 'unverified';
}

export function normalizeStringList(values: unknown, limit = 12): string[] {
    if (!Array.isArray(values)) return [];
    return [...new Set(values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[a-z0-9 _/-]{1,80}$/.test(value))
        .map((value) => value.replace(/\s+/g, '_')))]
        .slice(0, limit);
}

export function validatePublicSourceUrl(value: string | null | undefined): {
    ok: true;
    url: string | null;
    trusted: boolean;
} | {
    ok: false;
    error: string;
} {
    const raw = value?.trim();
    if (!raw) {
        return { ok: true, url: null, trusted: false };
    }

    let parsed: URL;
    try {
        parsed = validateOutboundUrlSyntax(raw);
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Source URL is not allowed.',
        };
    }

    return {
        ok: true,
        url: parsed.toString(),
        trusted: isTrustedMedicalHost(parsed.hostname),
    };
}

export function isTrustedMedicalHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return TRUSTED_MEDICAL_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}
