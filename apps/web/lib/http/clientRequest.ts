export type ClientRequestErrorCode = 'offline' | 'timeout' | 'network';

export class ClientRequestError extends Error {
    code: ClientRequestErrorCode;

    constructor(code: ClientRequestErrorCode, message: string) {
        super(message);
        this.name = 'ClientRequestError';
        this.code = code;
    }
}

export interface FetchWithTimeoutOptions {
    timeoutMs?: number;
    timeoutMessage?: string;
    offlineMessage?: string;
    networkErrorMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit = {},
    options: FetchWithTimeoutOptions = {},
): Promise<Response> {
    if (isDefinitelyOffline()) {
        throw new ClientRequestError('offline', options.offlineMessage ?? 'No network connection. Reconnect and retry.');
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const externalSignal = init.signal;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
        abortFromExternal();
    } else {
        externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    }

    if (timeoutMs > 0) {
        timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
    }

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (timedOut) {
            throw new ClientRequestError('timeout', options.timeoutMessage ?? `Request timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Retry when the connection is stable.`);
        }
        if (isDefinitelyOffline()) {
            throw new ClientRequestError('offline', options.offlineMessage ?? 'Network connection was lost. Reconnect and retry.');
        }
        if (error instanceof TypeError) {
            throw new ClientRequestError('network', options.networkErrorMessage ?? 'Network request failed. Check the connection and retry.');
        }
        throw error;
    } finally {
        if (timeout) clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abortFromExternal);
    }
}

function isDefinitelyOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}
