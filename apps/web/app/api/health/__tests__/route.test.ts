import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../route';

const mocks = vi.hoisted(() => ({
    getSupabaseServer: vi.fn(),
}));

vi.mock('@/lib/supabaseServer', () => ({
    getSupabaseServer: mocks.getSupabaseServer,
}));

const ORIGINAL_ENV = process.env;

describe('/api/health', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        process.env = {
            ...ORIGINAL_ENV,
            OPENAI_API_KEY: 'sk-test',
            AI_PROVIDER_BASE_URL: 'https://api.openai.test/v1',
        };
        mocks.getSupabaseServer.mockReturnValue(createSupabaseMock(null));
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
        vi.unstubAllGlobals();
    });

    it('returns ok when database and AI provider connectivity checks pass', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.db).toBe('ok');
        expect(body.ai_provider).toBe('ok');
        expect(body.timestamp).toEqual(expect.any(String));
    });

    it('returns degraded instead of throwing when AI provider check fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.status).toBe('degraded');
        expect(body.db).toBe('ok');
        expect(body.ai_provider).toBe('degraded');
    });
});

function createSupabaseMock(error: { message: string } | null) {
    return {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve({ error })),
            })),
        })),
    };
}
