import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { callInferenceModel } from '@/lib/inference-client';

const ORIGINAL_ENV = process.env;

describe('callInferenceModel', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        process.env = {
            ...ORIGINAL_ENV,
            HF_API_URL: 'https://api-inference.huggingface.co/models/vetios/test',
            HF_API_TOKEN: 'hf_test',
            OPENAI_API_KEY: 'sk-test',
            OPENAI_FALLBACK_MODEL: 'gpt-4o-mini',
        };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
        vi.unstubAllGlobals();
    });

    test('returns Hugging Face output when HF succeeds', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([
            { generated_text: '{"differentials":[],"primary_confidence":0}' },
        ]));
        vi.stubGlobal('fetch', fetchMock);

        await expect(callInferenceModel('prompt')).resolves.toBe('{"differentials":[],"primary_confidence":0}');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe(process.env.HF_API_URL);
    });

    test('falls back to OpenAI when HF returns non-200', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
            .mockResolvedValueOnce(jsonResponse({
                choices: [{ message: { content: '{"differentials":[{"label":"x","p":0.7}],"primary_confidence":0.7}' } }],
            }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(callInferenceModel('prompt')).resolves.toBe('{"differentials":[{"label":"x","p":0.7}],"primary_confidence":0.7}');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.openai.com/v1/chat/completions');
    });

    test('throws when both providers fail', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('hf down', { status: 503 }))
            .mockResolvedValueOnce(new Response('openai down', { status: 500 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(callInferenceModel('prompt')).rejects.toThrow('OpenAI fallback failed');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

function jsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
