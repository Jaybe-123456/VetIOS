import { inflateRawSync } from 'zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestRagDocument } from '@/lib/agenticRag/service';
import { hashPrivacyValue, type UploadSecurityGateResult } from './uploadSecurityGate';

export interface ClinicalUploadIngestionInput {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    sessionId: string | null;
    fileName: string;
    species?: string | null;
    domain?: string | null;
    buffer: Buffer;
    gateResult: Extract<UploadSecurityGateResult, { ok: true }>;
}

export interface ClinicalUploadIngestionResult {
    indexed: boolean;
    status: 'indexed' | 'validated_pending_processing' | 'validated_no_extractable_text';
    reason: string | null;
    source_id: string | null;
    document_id: string | null;
    chunks_indexed: number;
    embedding_model: string | null;
    deterministic_embeddings: boolean;
    extracted_characters: number;
}

const TEXT_INDEXABLE_TYPES = new Set(['txt', 'md', 'csv', 'json', 'pdf', 'docx', 'ppt', 'pptx', 'xlsx']);

export async function ingestClinicalUploadToRag(
    input: ClinicalUploadIngestionInput,
): Promise<ClinicalUploadIngestionResult> {
    if (!TEXT_INDEXABLE_TYPES.has(input.gateResult.sourceType)) {
        return deferred('Modality validated. Dedicated multimodal processor is not attached yet.');
    }

    const extracted = extractClinicalUploadText({
        sourceType: input.gateResult.sourceType,
        buffer: input.buffer,
    });

    if (extracted.text.trim().length < 32) {
        return {
            ...deferred(extracted.reason ?? 'No extractable clinical text found.'),
            status: 'validated_no_extractable_text',
            extracted_characters: extracted.text.trim().length,
        };
    }

    const sessionScope = normalizeScope(input.sessionId) ?? 'global';
    const sourceName = `Ask Vetios uploads (${sessionScope})`;
    const result = await ingestRagDocument({
        tenantId: input.tenantId,
        actorLabel: input.actorLabel,
        client: input.client,
        source: {
            external_key: `ask_vetios_uploads_${sessionScope}`.slice(0, 120),
            name: sourceName,
            source_type: 'file',
            authority_tier: 'clinic_local',
            species_scope: input.species ? [input.species] : [],
            medicine_domain: normalizeDomainList(input.domain),
            ingestion_policy: {
                upload_security_gate: 'passed',
                session_id: input.sessionId,
                no_archive_uploads: true,
            },
        },
        document: {
            title: input.fileName,
            document_type: input.gateResult.sourceType,
            language: 'en',
            content_text: extracted.text,
            metadata: {
                upload_id: input.gateResult.contentHash,
                content_hash: input.gateResult.contentHash,
                file_name_hash: hashPrivacyValue(input.fileName),
                session_id: input.sessionId,
                detected_mime: input.gateResult.detectedMime,
                declared_source_type: input.gateResult.sourceType,
                extraction_method: extracted.method,
            },
        },
        chunking: {
            maxTokens: 512,
            overlapTokens: 64,
            maxChunks: 200,
        },
    });

    return {
        indexed: true,
        status: 'indexed',
        reason: null,
        source_id: result.source.id,
        document_id: result.document.id,
        chunks_indexed: result.chunks_indexed,
        embedding_model: result.embedding_model,
        deterministic_embeddings: result.deterministic_embeddings,
        extracted_characters: extracted.text.length,
    };
}

export function extractClinicalUploadText(input: {
    sourceType: string;
    buffer: Buffer;
}): { text: string; method: string; reason: string | null } {
    switch (input.sourceType) {
        case 'txt':
        case 'md':
        case 'csv':
            return {
                text: decodeUtf8Text(input.buffer),
                method: input.sourceType,
                reason: null,
            };
        case 'json':
            return {
                text: extractJsonText(input.buffer),
                method: 'json_flatten',
                reason: null,
            };
        case 'pdf':
            return extractPdfText(input.buffer);
        case 'docx':
            return extractDocxText(input.buffer);
        case 'ppt':
            return extractPptText(input.buffer);
        case 'pptx':
            return extractPptxText(input.buffer);
        case 'xlsx':
            return extractXlsxText(input.buffer);
        default:
            return { text: '', method: 'none', reason: 'Source type is not text-indexable.' };
    }
}

function extractJsonText(buffer: Buffer): string {
    const raw = decodeUtf8Text(buffer);
    try {
        const parsed = JSON.parse(raw) as unknown;
        return flattenJson(parsed).join('\n');
    } catch {
        return raw;
    }
}

function extractPdfText(buffer: Buffer): { text: string; method: string; reason: string | null } {
    const raw = buffer.toString('latin1');
    const values: string[] = [];

    for (const match of raw.matchAll(/\((?:\\.|[^\\)]){2,}\)\s*Tj/g)) {
        values.push(decodePdfLiteral(match[0].replace(/\)\s*Tj$/, '').slice(1, -1)));
    }

    for (const match of raw.matchAll(/\[([\s\S]{1,4000}?)\]\s*TJ/g)) {
        const items = match[1] ?? '';
        for (const item of items.matchAll(/\((?:\\.|[^\\)]){2,}\)/g)) {
            values.push(decodePdfLiteral(item[0].slice(1, -1)));
        }
    }

    const extracted = values
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (extracted.length >= 32) {
        return { text: extracted, method: 'pdf_literal_text', reason: null };
    }

    const fallback = raw
        .split(/[^A-Za-z0-9.,;:()/%+\-\s]+/)
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter((part) => part.length >= 24 && /[A-Za-z]{4}/.test(part))
        .slice(0, 600)
        .join('\n');

    return {
        text: fallback,
        method: 'pdf_printable_text_fallback',
        reason: fallback.length >= 32 ? null : 'PDF did not expose extractable text without an external OCR/parser.',
    };
}

function extractDocxText(buffer: Buffer): { text: string; method: string; reason: string | null } {
    const files = readZipEntries(buffer);
    const xmlNames = [
        'word/document.xml',
        ...[...files.keys()].filter((name) => /^word\/(header|footer)\d+\.xml$/.test(name)),
    ];
    const text = xmlNames
        .map((name) => files.get(name))
        .filter((value): value is Buffer => Boolean(value))
        .map((value) => xmlToText(value.toString('utf8')))
        .filter(Boolean)
        .join('\n\n');

    return {
        text,
        method: 'docx_openxml',
        reason: text.length > 0 ? null : 'DOCX package did not contain readable document XML.',
    };
}

function extractPptxText(buffer: Buffer): { text: string; method: string; reason: string | null } {
    const files = readZipEntries(buffer);
    const xmlNames = [
        ...[...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(),
        ...[...files.keys()].filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).sort(),
    ];
    const text = xmlNames
        .map((name) => files.get(name))
        .filter((value): value is Buffer => Boolean(value))
        .map((value) => xmlToText(value.toString('utf8')))
        .filter(Boolean)
        .join('\n\n');

    return {
        text,
        method: 'pptx_openxml',
        reason: text.length > 0 ? null : 'PPTX package did not contain readable slide XML.',
    };
}

function extractPptText(buffer: Buffer): { text: string; method: string; reason: string | null } {
    const text = buffer
        .toString('latin1')
        .split(/[^\x20-\x7e]+/)
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter((part) => part.length >= 4 && /[A-Za-z]{3}/.test(part))
        .filter((part) => !/^(PowerPoint Document|Current User|DocumentSummaryInformation|SummaryInformation)$/i.test(part))
        .slice(0, 1200)
        .join('\n');

    return {
        text,
        method: 'ppt_printable_text_fallback',
        reason: text.length > 0 ? null : 'PPT file did not expose readable printable text.',
    };
}

function extractXlsxText(buffer: Buffer): { text: string; method: string; reason: string | null } {
    const files = readZipEntries(buffer);
    const sharedStrings = extractSharedStrings(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '');
    const sheetNames = [...files.keys()]
        .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
        .sort();
    const rows: string[] = [];

    for (const sheetName of sheetNames.slice(0, 20)) {
        const xml = files.get(sheetName)?.toString('utf8') ?? '';
        const cells = [...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
            .map((match) => extractCellValue(match[1] ?? '', match[2] ?? '', sharedStrings))
            .filter(Boolean);
        if (cells.length > 0) {
            rows.push(`# ${sheetName}`);
            rows.push(cells.join(', '));
        }
    }

    const text = rows.join('\n');
    return {
        text,
        method: 'xlsx_openxml',
        reason: text.length > 0 ? null : 'XLSX package did not contain readable worksheet values.',
    };
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
    const entries = new Map<string, Buffer>();
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) return entries;

    const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const centralDirectoryEnd = Math.min(buffer.length, centralDirectoryOffset + centralDirectorySize);
    let offset = centralDirectoryOffset;

    while (offset + 46 <= centralDirectoryEnd && buffer.readUInt32LE(offset) === 0x02014b50) {
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength).replace(/\\/g, '/');

        if (!name.endsWith('/') && uncompressedSize <= 10 * 1024 * 1024) {
            const data = readZipEntryData(buffer, localHeaderOffset, method, compressedSize);
            if (data && data.length <= 10 * 1024 * 1024) entries.set(name, data);
        }

        offset += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
    const start = Math.max(0, buffer.length - 65_557);
    for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
    }
    return -1;
}

function readZipEntryData(
    buffer: Buffer,
    localHeaderOffset: number,
    method: number,
    compressedSize: number,
): Buffer | null {
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        return null;
    }
    const nameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) return null;

    const compressed = buffer.subarray(dataStart, dataEnd);
    if (method === 0) return compressed;
    if (method === 8) return inflateRawSync(compressed);
    return null;
}

function extractSharedStrings(xml: string): string[] {
    return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
        .map((match) => xmlToText(match[1] ?? ''))
        .filter(Boolean);
}

function extractCellValue(attributes: string, body: string, sharedStrings: string[]): string {
    const raw = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1]?.trim() ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]?.trim() ?? '';
    if (!raw) return '';
    if (/\bt="s"/.test(attributes)) {
        const index = Number.parseInt(raw, 10);
        return Number.isFinite(index) ? sharedStrings[index] ?? '' : '';
    }
    return decodeXmlEntities(raw);
}

function xmlToText(xml: string): string {
    return decodeXmlEntities(xml
        .replace(/<w:tab\s*\/>/g, '\t')
        .replace(/<w:br\s*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim());
}

function decodeUtf8Text(buffer: Buffer): string {
    return buffer.toString('utf8').replace(/\u0000/g, '').trim();
}

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number.parseInt(code, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function decodePdfLiteral(value: string): string {
    return value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f')
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function flattenJson(value: unknown, prefix = ''): string[] {
    if (value === null || value === undefined) return [];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [`${prefix ? `${prefix}: ` : ''}${String(value)}`];
    }
    if (Array.isArray(value)) {
        return value.flatMap((entry, index) => flattenJson(entry, prefix ? `${prefix}.${index}` : String(index)));
    }
    if (typeof value === 'object') {
        return Object.entries(value).flatMap(([key, entry]) => flattenJson(entry, prefix ? `${prefix}.${key}` : key));
    }
    return [];
}

function normalizeDomainList(value: string | null | undefined): string[] {
    const raw = value?.trim();
    if (!raw) return ['clinical_document'];
    return raw
        .split(/[,;|]+/)
        .map((entry) => entry.trim().toLowerCase().replace(/\s+/g, '_'))
        .filter((entry) => /^[a-z0-9_-]{2,80}$/.test(entry))
        .slice(0, 12);
}

function normalizeScope(value: string | null): string | null {
    const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') ?? '';
    return normalized.length > 0 ? normalized.slice(0, 80) : null;
}

function deferred(reason: string): ClinicalUploadIngestionResult {
    return {
        indexed: false,
        status: 'validated_pending_processing',
        reason,
        source_id: null,
        document_id: null,
        chunks_indexed: 0,
        embedding_model: null,
        deterministic_embeddings: false,
        extracted_characters: 0,
    };
}
