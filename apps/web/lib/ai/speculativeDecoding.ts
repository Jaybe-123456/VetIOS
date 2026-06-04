export type SpeculativeDecodingMode = 'server' | 'top_level' | 'extra_body';

export interface SpeculativeDecodingPlan {
    requested: boolean;
    applied: boolean;
    mode: SpeculativeDecodingMode;
    provider_name: string;
    draft_model: string | null;
    num_draft_tokens: number | null;
    reason: string;
}

export interface SpeculativeDecodingRequestContext {
    providerName: string;
    baseUrl: string;
}

const DEFAULT_NUM_DRAFT_TOKENS = 4;
const OPENAI_HOSTS = new Set(['api.openai.com']);

export function resolveSpeculativeDecodingPlan(context: SpeculativeDecodingRequestContext): SpeculativeDecodingPlan {
    const providerName = context.providerName.trim().toLowerCase();
    const enabled = readBooleanEnv('AI_SPECULATIVE_DECODING_ENABLED')
        || readBooleanEnv('VETIOS_SPECULATIVE_DECODING_ENABLED');

    if (!enabled) {
        return buildPlan(context, {
            requested: false,
            applied: false,
            reason: 'disabled',
        });
    }

    if (isOpenAiPublicEndpoint(context.baseUrl) && !readBooleanEnv('AI_SPECULATIVE_DECODING_ALLOW_OPENAI')) {
        return buildPlan(context, {
            requested: true,
            applied: false,
            reason: 'not_sent_to_public_openai_api',
        });
    }

    const mode = readSpeculativeMode();
    const draftModel = readTextEnv('AI_SPECULATIVE_DRAFT_MODEL')
        ?? readTextEnv('VETIOS_SPECULATIVE_DRAFT_MODEL')
        ?? null;
    const numDraftTokens = readPositiveIntegerEnv('AI_SPECULATIVE_NUM_DRAFT_TOKENS')
        ?? readPositiveIntegerEnv('VETIOS_SPECULATIVE_NUM_DRAFT_TOKENS')
        ?? DEFAULT_NUM_DRAFT_TOKENS;

    if ((mode === 'top_level' || mode === 'extra_body') && !draftModel) {
        return buildPlan(context, {
            requested: true,
            applied: false,
            mode,
            num_draft_tokens: numDraftTokens,
            reason: 'draft_model_required_for_request_body_mode',
        });
    }

    return buildPlan(context, {
        requested: true,
        applied: true,
        mode,
        draft_model: draftModel,
        num_draft_tokens: numDraftTokens,
        reason: mode === 'server'
            ? `${providerName || 'provider'}_server_side_speculative_decoding_expected`
            : `${providerName || 'provider'}_request_body_speculative_decoding_requested`,
    });
}

export function buildSpeculativeDecodingRequestFields(plan: SpeculativeDecodingPlan): Record<string, unknown> {
    if (!plan.applied || plan.mode === 'server') {
        return {};
    }

    const speculativeConfig = {
        draft_model: plan.draft_model,
        num_draft_tokens: plan.num_draft_tokens,
    };

    if (plan.mode === 'extra_body') {
        return {
            extra_body: {
                speculative_config: speculativeConfig,
            },
        };
    }

    return {
        speculative_config: speculativeConfig,
    };
}

function buildPlan(
    context: SpeculativeDecodingRequestContext,
    patch: Partial<SpeculativeDecodingPlan>,
): SpeculativeDecodingPlan {
    return {
        requested: patch.requested ?? false,
        applied: patch.applied ?? false,
        mode: patch.mode ?? readSpeculativeMode(),
        provider_name: context.providerName || 'unknown',
        draft_model: patch.draft_model ?? null,
        num_draft_tokens: patch.num_draft_tokens ?? null,
        reason: patch.reason ?? 'unknown',
    };
}

function readSpeculativeMode(): SpeculativeDecodingMode {
    const raw = readTextEnv('AI_SPECULATIVE_DECODING_MODE')
        ?? readTextEnv('VETIOS_SPECULATIVE_DECODING_MODE')
        ?? 'server';
    if (raw === 'top_level' || raw === 'extra_body' || raw === 'server') {
        return raw;
    }
    return 'server';
}

function isOpenAiPublicEndpoint(value: string): boolean {
    try {
        return OPENAI_HOSTS.has(new URL(value).hostname.toLowerCase());
    } catch {
        return false;
    }
}

function readTextEnv(key: string): string | null {
    const value = process.env[key]?.trim();
    return value ? value : null;
}

function readBooleanEnv(key: string): boolean {
    const value = process.env[key]?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function readPositiveIntegerEnv(key: string): number | null {
    const value = readTextEnv(key);
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
