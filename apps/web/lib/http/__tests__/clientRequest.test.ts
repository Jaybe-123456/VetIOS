import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRequestError, fetchWithTimeout } from '../clientRequest';

const originalFetch = globalThis.fetch;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
        Reflect.deleteProperty(globalThis, 'navigator');
    }
});

describe('fetchWithTimeout', () => {
    it('fails before fetch when the browser is offline', async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        Object.defineProperty(globalThis, 'navigator', {
            value: { onLine: false },
            configurable: true,
        });

        await expect(fetchWithTimeout('/api/test')).rejects.toMatchObject({
            name: 'ClientRequestError',
            code: 'offline',
        } satisfies Partial<ClientRequestError>);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('turns hanging requests into timeout errors', async () => {
        vi.useFakeTimers();
        globalThis.fetch = vi.fn((_input, init) => new Promise((_resolve, reject) => {
            (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
            });
        })) as unknown as typeof fetch;

        const promise = fetchWithTimeout('/api/slow', {}, { timeoutMs: 50 }).catch((error) => error);
        await vi.advanceTimersByTimeAsync(60);

        await expect(promise).resolves.toMatchObject({
            name: 'ClientRequestError',
            code: 'timeout',
        } satisfies Partial<ClientRequestError>);
    });

    it('normalizes network drops into retryable network errors', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
        Object.defineProperty(globalThis, 'navigator', {
            value: { onLine: true },
            configurable: true,
        });

        await expect(fetchWithTimeout('/api/flaky')).rejects.toMatchObject({
            name: 'ClientRequestError',
            code: 'network',
        } satisfies Partial<ClientRequestError>);
    });
});
