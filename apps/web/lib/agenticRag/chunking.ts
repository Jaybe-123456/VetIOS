import { createHash } from 'crypto';

export interface RagChunkingOptions {
    maxTokens?: number;
    overlapTokens?: number;
    maxChunks?: number;
}

export interface PreparedRagChunk {
    chunk_index: number;
    chunk_text: string;
    chunk_hash: string;
    heading: string | null;
    token_estimate: number;
}

const DEFAULT_MAX_TOKENS = 420;
const DEFAULT_OVERLAP_TOKENS = 60;
const DEFAULT_MAX_CHUNKS = 80;

export function normalizeRagContent(input: string): string {
    return decodeCommonHtmlEntities(input)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function chunkRagDocument(content: string, options: RagChunkingOptions = {}): PreparedRagChunk[] {
    const normalized = normalizeRagContent(content);
    if (!normalized) return [];

    const maxTokens = clampInt(options.maxTokens ?? DEFAULT_MAX_TOKENS, 120, 1200);
    const overlapTokens = clampInt(options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS, 0, Math.floor(maxTokens / 3));
    const maxChunks = clampInt(options.maxChunks ?? DEFAULT_MAX_CHUNKS, 1, 200);
    const paragraphs = normalized
        .split(/\n\s*\n/g)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    const chunks: PreparedRagChunk[] = [];
    let buffer: string[] = [];
    let bufferTokens = 0;
    let activeHeading: string | null = null;

    for (const paragraph of paragraphs) {
        const heading = inferHeading(paragraph);
        if (heading) {
            activeHeading = heading;
        }

        const tokenEstimate = estimateTokens(paragraph);
        if (buffer.length > 0 && bufferTokens + tokenEstimate > maxTokens) {
            pushChunk(chunks, buffer.join('\n\n'), activeHeading);
            if (chunks.length >= maxChunks) return chunks;
            buffer = buildOverlap(buffer, overlapTokens);
            bufferTokens = estimateTokens(buffer.join('\n\n'));
        }

        if (tokenEstimate > maxTokens) {
            const sentences = splitLongParagraph(paragraph, maxTokens);
            for (const sentenceBlock of sentences) {
                if (buffer.length > 0 && bufferTokens + estimateTokens(sentenceBlock) > maxTokens) {
                    pushChunk(chunks, buffer.join('\n\n'), activeHeading);
                    if (chunks.length >= maxChunks) return chunks;
                    buffer = buildOverlap(buffer, overlapTokens);
                    bufferTokens = estimateTokens(buffer.join('\n\n'));
                }
                buffer.push(sentenceBlock);
                bufferTokens += estimateTokens(sentenceBlock);
            }
            continue;
        }

        buffer.push(paragraph);
        bufferTokens += tokenEstimate;
    }

    if (buffer.length > 0 && chunks.length < maxChunks) {
        pushChunk(chunks, buffer.join('\n\n'), activeHeading);
    }

    return chunks;
}

export function contentHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function estimateTokens(value: string): number {
    return Math.max(1, Math.ceil(value.trim().length / 4));
}

function pushChunk(chunks: PreparedRagChunk[], text: string, heading: string | null): void {
    const chunkText = normalizeRagContent(text);
    if (!chunkText) return;
    chunks.push({
        chunk_index: chunks.length,
        chunk_text: chunkText,
        chunk_hash: contentHash(chunkText),
        heading,
        token_estimate: estimateTokens(chunkText),
    });
}

function inferHeading(paragraph: string): string | null {
    const trimmed = paragraph.trim();
    if (/^#{1,4}\s+/.test(trimmed)) {
        return trimmed.replace(/^#{1,4}\s+/, '').slice(0, 160);
    }
    if (trimmed.length <= 100 && /^[A-Z0-9][A-Za-z0-9\s:()/-]+$/.test(trimmed) && !/[.!?]$/.test(trimmed)) {
        return trimmed;
    }
    return null;
}

function buildOverlap(buffer: string[], overlapTokens: number): string[] {
    if (overlapTokens <= 0 || buffer.length === 0) return [];
    const overlap: string[] = [];
    let total = 0;
    for (let index = buffer.length - 1; index >= 0; index -= 1) {
        const paragraph = buffer[index];
        const tokens = estimateTokens(paragraph);
        if (total + tokens > overlapTokens && overlap.length > 0) break;
        overlap.unshift(paragraph);
        total += tokens;
        if (total >= overlapTokens) break;
    }
    return overlap;
}

function splitLongParagraph(paragraph: string, maxTokens: number): string[] {
    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
    const blocks: string[] = [];
    let buffer: string[] = [];
    let tokens = 0;

    for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (buffer.length > 0 && tokens + sentenceTokens > maxTokens) {
            blocks.push(buffer.join(' '));
            buffer = [];
            tokens = 0;
        }
        buffer.push(sentence);
        tokens += sentenceTokens;
    }

    if (buffer.length > 0) {
        blocks.push(buffer.join(' '));
    }

    return blocks.length > 0 ? blocks : [paragraph.slice(0, maxTokens * 4)];
}

function clampInt(value: number, min: number, max: number): number {
    const parsed = Number.isFinite(value) ? Math.round(value) : min;
    return Math.min(Math.max(parsed, min), max);
}

function decodeCommonHtmlEntities(value: string): string {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/gi, "'");
}
