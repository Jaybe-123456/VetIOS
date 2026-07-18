import {
    createHash,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    sign,
    verify,
    type KeyObject,
} from 'node:crypto';
import type { JsonValue } from './types.js';

function normalize(value: unknown): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Canonical JSON does not support non-finite numbers.');
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(normalize);
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return Object.fromEntries(entries.map(([key, entry]) => [key, normalize(entry)]));
    }
    throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(normalize(value));
}

export function sha256(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function generateReceiptSigningKeys(): { privateKey: KeyObject; publicKey: KeyObject } {
    return generateKeyPairSync('ed25519');
}

export function exportPublicKeyPem(publicKey: KeyObject): string {
    return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

export function signCanonical(value: unknown, privateKey: KeyObject): string {
    return sign(null, Buffer.from(canonicalJson(value)), privateKey).toString('base64');
}

export function verifyCanonical(value: unknown, signatureBase64: string, publicKeyPem: string): boolean {
    try {
        const publicKey = createPublicKey(publicKeyPem);
        return verify(null, Buffer.from(canonicalJson(value)), publicKey, Buffer.from(signatureBase64, 'base64'));
    } catch {
        return false;
    }
}

export function importPrivateKeyPem(privateKeyPem: string): KeyObject {
    return createPrivateKey(privateKeyPem);
}
