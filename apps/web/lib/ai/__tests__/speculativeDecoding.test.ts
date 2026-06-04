import { afterEach, describe, expect, it } from 'vitest';
import {
    buildSpeculativeDecodingRequestFields,
    resolveSpeculativeDecodingPlan,
} from '../speculativeDecoding';

const ORIGINAL_ENV = process.env;

describe('speculative decoding provider config', () => {
    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('is disabled by default', () => {
        process.env = { ...ORIGINAL_ENV };
        delete process.env.AI_SPECULATIVE_DECODING_ENABLED;
        delete process.env.VETIOS_SPECULATIVE_DECODING_ENABLED;

        const plan = resolveSpeculativeDecodingPlan({
            providerName: 'openai',
            baseUrl: 'https://api.openai.com/v1',
        });

        expect(plan.requested).toBe(false);
        expect(plan.applied).toBe(false);
        expect(buildSpeculativeDecodingRequestFields(plan)).toEqual({});
    });

    it('does not send speculative fields to the public OpenAI API by default', () => {
        process.env = {
            ...ORIGINAL_ENV,
            AI_SPECULATIVE_DECODING_ENABLED: 'true',
            AI_SPECULATIVE_DRAFT_MODEL: 'vetios-draft-0.5b',
            AI_SPECULATIVE_DECODING_MODE: 'top_level',
        };

        const plan = resolveSpeculativeDecodingPlan({
            providerName: 'openai',
            baseUrl: 'https://api.openai.com/v1',
        });

        expect(plan.requested).toBe(true);
        expect(plan.applied).toBe(false);
        expect(plan.reason).toBe('not_sent_to_public_openai_api');
        expect(buildSpeculativeDecodingRequestFields(plan)).toEqual({});
    });

    it('builds top-level speculative config for compatible custom providers', () => {
        process.env = {
            ...ORIGINAL_ENV,
            AI_SPECULATIVE_DECODING_ENABLED: 'true',
            AI_SPECULATIVE_DECODING_MODE: 'top_level',
            AI_SPECULATIVE_DRAFT_MODEL: 'vetios-qwen-draft-0.5b',
            AI_SPECULATIVE_NUM_DRAFT_TOKENS: '6',
        };

        const plan = resolveSpeculativeDecodingPlan({
            providerName: 'vllm',
            baseUrl: 'https://inference.internal.example/v1',
        });

        expect(plan.applied).toBe(true);
        expect(buildSpeculativeDecodingRequestFields(plan)).toEqual({
            speculative_config: {
                draft_model: 'vetios-qwen-draft-0.5b',
                num_draft_tokens: 6,
            },
        });
    });

    it('tracks server-side speculative decoding without mutating the request body', () => {
        process.env = {
            ...ORIGINAL_ENV,
            AI_SPECULATIVE_DECODING_ENABLED: 'true',
            AI_SPECULATIVE_DECODING_MODE: 'server',
        };

        const plan = resolveSpeculativeDecodingPlan({
            providerName: 'tensorrt-llm',
            baseUrl: 'https://trtllm.internal.example/v1',
        });

        expect(plan.applied).toBe(true);
        expect(plan.mode).toBe('server');
        expect(buildSpeculativeDecodingRequestFields(plan)).toEqual({});
    });
});
