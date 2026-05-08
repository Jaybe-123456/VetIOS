interface HuggingFaceGeneration {
    generated_text?: unknown;
}

interface OpenAIChatCompletion {
    choices?: Array<{
        message?: {
            content?: unknown;
        };
    }>;
}

export async function callInferenceModel(prompt: string): Promise<string> {
    try {
        return await callHuggingFace(prompt);
    } catch (error) {
        console.warn('Hugging Face inference failed; falling back to OpenAI.', error);
    }

    return callOpenAIFallback(prompt);
}

async function callHuggingFace(prompt: string): Promise<string> {
    const apiUrl = process.env.HF_API_URL;
    const token = process.env.HF_API_TOKEN;

    if (!apiUrl || !token) {
        throw new Error('HF_API_URL and HF_API_TOKEN are required.');
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            inputs: prompt,
            parameters: { return_full_text: false },
        }),
    });

    if (!response.ok) {
        throw new Error(`HF inference failed with status ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json() as HuggingFaceGeneration[] | HuggingFaceGeneration;
    const generatedText = Array.isArray(payload)
        ? payload[0]?.generated_text
        : payload.generated_text;

    if (typeof generatedText !== 'string' || generatedText.trim().length === 0) {
        throw new Error('HF inference returned no generated_text.');
    }

    return generatedText;
}

async function callOpenAIFallback(prompt: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_PROVIDER_API_KEY;
    const model = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required for fallback inference.');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0,
        }),
    });

    if (!response.ok) {
        throw new Error(`OpenAI fallback failed with status ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json() as OpenAIChatCompletion;
    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('OpenAI fallback returned no message content.');
    }

    return content;
}
