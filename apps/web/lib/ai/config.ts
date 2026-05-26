export function getAiProviderApiKey(): string {
    const key = process.env.OPENAI_API_KEY || process.env.AI_PROVIDER_API_KEY;
    if (!key) {
        throw new Error('Missing AI provider key: set OPENAI_API_KEY or AI_PROVIDER_API_KEY.');
    }
    return key;
}

export function getAiProviderBaseUrl(): string {
    return process.env.AI_PROVIDER_BASE_URL || 'https://api.openai.com/v1';
}

export function getAiProviderName(): string {
    return process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER_NAME || 'openai';
}

export function getAiProviderDefaultModel(fallback = 'gpt-4o-mini'): string {
    return process.env.AI_PROVIDER_DEFAULT_MODEL || fallback;
}

export function getAiFallbackProviderName(): string | null {
    return process.env.AI_FALLBACK_PROVIDER_NAME || process.env.AI_FALLBACK_PROVIDER || null;
}

export function getAiFallbackProviderBaseUrl(): string | null {
    return process.env.AI_FALLBACK_PROVIDER_BASE_URL || null;
}

export function getAiFallbackProviderApiKey(): string | null {
    return process.env.AI_FALLBACK_PROVIDER_API_KEY || null;
}

export function getAiFallbackProviderDefaultModel(): string | null {
    return process.env.AI_FALLBACK_PROVIDER_DEFAULT_MODEL || null;
}

// ─── Hugging Face / Custom Model Config ───
export function getHfProviderApiKey(): string | null {
    return process.env.HF_PROVIDER_API_KEY || null;
}

export function getHfProviderBaseUrl(): string | null {
    return process.env.HF_PROVIDER_BASE_URL || null;
}

export function getHfProviderModel(): string {
    return process.env.HF_PROVIDER_MODEL || 'vetios-qwen-0.5b';
}

export function isHfEnabled(): boolean {
    return !!process.env.HF_PROVIDER_BASE_URL;
}

export function shouldUseAiHeuristicFallback(): boolean {
    return process.env.VETIOS_DEV_BYPASS === 'true'
        || process.env.VETIOS_LOCAL_REASONER === 'true'
        || process.env.NODE_ENV === 'test';
}
