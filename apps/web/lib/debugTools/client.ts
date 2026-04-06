const HTTP_STATUS_TEXT: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
};

export class ApiResponseError extends Error {
    status: number;
    statusText: string;
    body: unknown;

    constructor(status: number, statusText: string, body: unknown, message?: string) {
        super(message ?? `${status} ${statusText || 'Request failed'}`);
        this.name = 'ApiResponseError';
        this.status = status;
        this.statusText = statusText;
        this.body = body;
    }
}

export async function requestJson(input: RequestInfo | URL, init?: RequestInit) {
    const response = await fetch(input, {
        cache: 'no-store',
        ...init,
    });

    const body = await parseResponseBody(response);
    return { response, body };
}

export function extractApiErrorMessage(body: unknown, fallback: string) {
    if (typeof body === 'string' && body.trim().length > 0) {
        return body;
    }

    if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        if (typeof record.error === 'object' && record.error !== null) {
            const nestedMessage = (record.error as Record<string, unknown>).message;
            if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) {
                return nestedMessage;
            }
        }
        if (typeof record.error === 'string' && record.error.trim().length > 0) {
            return record.error;
        }
        if (typeof record.message === 'string' && record.message.trim().length > 0) {
            return record.message;
        }
    }

    return fallback;
}

export function formatHttpStatus(status: number, statusText?: string | null) {
    const normalizedText = statusText?.trim() || HTTP_STATUS_TEXT[status] || (status >= 200 && status < 300 ? 'OK' : 'Error');
    return `${status} ${normalizedText}`;
}

export function stringifyApiBody(body: unknown) {
    if (typeof body === 'string') {
        return body;
    }

    try {
        return JSON.stringify(body ?? null, null, 2);
    } catch {
        return JSON.stringify({ error: 'Response could not be serialized.' }, null, 2);
    }
}

export function extractEnvelopeData<T = unknown>(body: unknown): T | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return body as T;
    }

    const record = body as Record<string, unknown>;
    if ('data' in record) {
        return record.data as T;
    }

    return body as T;
}

async function parseResponseBody(response: Response) {
    const text = await response.text();
    if (text.trim().length === 0) {
        return null;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}
