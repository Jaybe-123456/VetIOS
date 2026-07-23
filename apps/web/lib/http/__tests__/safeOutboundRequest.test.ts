import { describe, expect, it } from 'vitest';
import { isPublicInternetAddress, validateOutboundUrlSyntax } from '../safeOutboundRequest';

describe('safe outbound request policy', () => {
    it.each([
        '127.0.0.1',
        '10.10.1.2',
        '100.64.0.1',
        '169.254.169.254',
        '172.16.0.1',
        '192.168.1.1',
        '192.0.2.10',
        '198.51.100.10',
        '203.0.113.10',
        '::1',
        'fc00::1',
        'fe80::1',
        '2001:db8::1',
        '2001:0db8::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '64:ff9b::7f00:1',
    ])('rejects non-public address %s', (address) => {
        expect(isPublicInternetAddress(address)).toBe(false);
    });

    it.each([
        '8.8.8.8',
        '1.1.1.1',
        '2606:4700:4700::1111',
        '2001:4860:4860::8888',
    ])('accepts globally routable address %s', (address) => {
        expect(isPublicInternetAddress(address)).toBe(true);
    });

    it.each([
        'http://example.org/hook',
        'https://user:secret@example.org/hook',
        'https://example.org:8443/hook',
        'https://localhost/hook',
        'https://metadata.google.internal/computeMetadata/v1/',
        'https://127.0.0.1/hook',
        'https://[::ffff:7f00:1]/hook',
    ])('rejects unsafe URL %s before DNS or I/O', (url) => {
        expect(() => validateOutboundUrlSyntax(url)).toThrow();
    });

    it('normalizes a valid HTTPS URL without carrying fragments', () => {
        const parsed = validateOutboundUrlSyntax('https://hooks.example.org/events?version=1#secret');
        expect(parsed.toString()).toBe('https://hooks.example.org/events?version=1');
    });
});
