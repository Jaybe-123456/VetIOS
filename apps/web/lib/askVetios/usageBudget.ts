import { createHash } from 'crypto';

export type AskVetiosBudgetKind = 'chat' | 'document_query';

export type AskVetiosTokenBudgetResult =
    | {
        allowed: true;
        identity: string;
        limit: number;
        remaining: number;
        resetAt: number;
        requestedTokens: number;
    }
    | {
        allowed: false;
        identity: string;
        limit: number;
        remaining: number;
        resetAt: number;
        retryAfterSeconds: number;
        requestedTokens: number;
    };

type BudgetEntry = {
    windowStart: number;
    tokens: number;
};

declare global {
    // eslint-disable-next-line no-var
    var __vetiosAskVetiosTokenBudgetStore: Map<string, BudgetEntry> | undefined;
}

const WINDOW_MS = 6 * 60 * 60 * 1000;
const FREE_TOKEN_LIMIT = 120_000;
const MAX_REQUEST_INPUT_TOKENS = 18_000;
const RESERVED_COMPLETION_TOKENS = 2_048;

function getStore() {
    if (!globalThis.__vetiosAskVetiosTokenBudgetStore) {
        globalThis.__vetiosAskVetiosTokenBudgetStore = new Map<string, BudgetEntry>();
    }
    return globalThis.__vetiosAskVetiosTokenBudgetStore;
}

export function enforceAskVetiosTokenBudget(input: {
    req: Request;
    kind: AskVetiosBudgetKind;
    message: string;
    conversation?: Array<{ role: string; content: string }>;
}): AskVetiosTokenBudgetResult {
    const identity = resolveAskVetiosIdentity(input.req);
    const requestedTokens = estimateAskVetiosRequestTokens(input);

    if (requestedTokens > MAX_REQUEST_INPUT_TOKENS + RESERVED_COMPLETION_TOKENS) {
        return buildBlockedResult(identity, requestedTokens, Date.now(), 0);
    }

    const now = Date.now();
    const store = getStore();
    const key = `${identity}:${input.kind}`;
    const existing = store.get(key);
    const active = existing && now - existing.windowStart < WINDOW_MS
        ? existing
        : { windowStart: now, tokens: 0 };

    if (active.tokens + requestedTokens > FREE_TOKEN_LIMIT) {
        store.set(key, active);
        return buildBlockedResult(identity, requestedTokens, active.windowStart, active.tokens);
    }

    const next = {
        windowStart: active.windowStart,
        tokens: active.tokens + requestedTokens,
    };
    store.set(key, next);

    return {
        allowed: true,
        identity,
        limit: FREE_TOKEN_LIMIT,
        remaining: Math.max(0, FREE_TOKEN_LIMIT - next.tokens),
        resetAt: next.windowStart + WINDOW_MS,
        requestedTokens,
    };
}

export function estimateTokens(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function addAskVetiosBudgetHeaders(headers: Headers, budget: AskVetiosTokenBudgetResult): void {
    headers.set('x-vetios-token-limit', String(budget.limit));
    headers.set('x-vetios-token-remaining', String(budget.remaining));
    headers.set('x-vetios-token-reset', String(Math.floor(budget.resetAt / 1000)));
    headers.set('x-vetios-token-request', String(budget.requestedTokens));
}

function estimateAskVetiosRequestTokens(input: {
    kind: AskVetiosBudgetKind;
    message: string;
    conversation?: Array<{ role: string; content: string }>;
}): number {
    const conversationTokens = (input.conversation ?? [])
        .slice(-16)
        .reduce((sum, message) => sum + estimateTokens(message.content), 0);
    const requestTokens = estimateTokens(input.message) + conversationTokens;
    const completionReserve = input.kind === 'chat' ? RESERVED_COMPLETION_TOKENS : 512;
    return requestTokens + completionReserve;
}

function resolveAskVetiosIdentity(req: Request): string {
    const clientId = req.headers.get('x-vetios-client-id')?.trim();
    if (clientId && /^[a-zA-Z0-9:_-]{16,96}$/.test(clientId)) {
        return `client:${hashIdentity(clientId)}`;
    }

    const auth = req.headers.get('authorization')?.trim();
    if (auth && auth.length > 16) {
        return `auth:${hashIdentity(auth)}`;
    }

    const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'unknown';
    return `ip:${hashIdentity(ip)}`;
}

function buildBlockedResult(
    identity: string,
    requestedTokens: number,
    windowStart: number,
    usedTokens: number,
): Extract<AskVetiosTokenBudgetResult, { allowed: false }> {
    const resetAt = windowStart + WINDOW_MS;
    const now = Date.now();
    return {
        allowed: false,
        identity,
        limit: FREE_TOKEN_LIMIT,
        remaining: Math.max(0, FREE_TOKEN_LIMIT - usedTokens),
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
        requestedTokens,
    };
}

function hashIdentity(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
