import { isIP } from 'net';
import type { RagAuthorityTier, RagSourceType } from './types';

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

const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /\.localhost$/i,
    /^metadata\.google\.internal$/i,
    /^169\.254\.169\.254$/,
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
        parsed = new URL(raw);
    } catch {
        return { ok: false, error: 'Source URL must be a valid URL.' };
    }

    if (parsed.protocol !== 'https:') {
        return { ok: false, error: 'Source URL must use HTTPS.' };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname)) || isPrivateIp(hostname)) {
        return { ok: false, error: 'Private, local, and metadata URLs are not allowed for RAG ingestion.' };
    }

    return {
        ok: true,
        url: parsed.toString(),
        trusted: isTrustedMedicalHost(hostname),
    };
}

export function isTrustedMedicalHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return TRUSTED_MEDICAL_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

function isPrivateIp(hostname: string): boolean {
    const ipHost = hostname.replace(/^\[|\]$/g, '');
    const family = isIP(ipHost);
    if (family === 0) return false;

    if (family === 4) {
        const octets = ipHost.split('.').map((part) => Number(part));
        const [a, b] = octets;
        return a === 10
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || a === 127
            || (a === 169 && b === 254)
            || a === 0;
    }

    const lower = ipHost.toLowerCase();
    return lower === '::1'
        || lower.startsWith('fc')
        || lower.startsWith('fd')
        || lower.startsWith('fe80:');
}
