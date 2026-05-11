import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
    GLOBAL_MAX_UPLOAD_BYTES,
    UploadSecurityGate,
    hashPrivacyValue,
    type UploadSecurityGateResult,
} from '@/lib/askVetios/uploadSecurityGate';
import { writeUploadSecurityEvent } from '@/lib/askVetios/uploadSecurityEvent';
import { ingestClinicalUploadToRag, type ClinicalUploadIngestionResult } from '@/lib/askVetios/documentIngestion';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FORM_OVERHEAD_BYTES = 1024 * 1024;

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 10,
        windowMs: 60 * 60 * 1000,
        maxBodySize: GLOBAL_MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES,
    });
    if (guard.blocked) return guard.response!;

    const { requestId, startTime } = guard;
    const form = await req.formData().catch(() => null);
    if (!form) {
        const res = NextResponse.json({ error: 'Invalid multipart upload', request_id: requestId }, { status: 400 });
        return withUploadHeaders(res, requestId, startTime);
    }

    const file = form.get('file');
    const sessionId = normalizeOptionalString(form.get('session_id'));
    if (!isUploadFile(file)) {
        const res = NextResponse.json({ error: 'Missing file field', request_id: requestId }, { status: 400 });
        return withUploadHeaders(res, requestId, startTime);
    }

    const declaredMime = file.type || 'application/octet-stream';
    const buffer = Buffer.from(await file.arrayBuffer());
    const gate = new UploadSecurityGate();
    let result = gate.validate({
        fileName: file.name,
        declaredMime,
        sizeBytes: file.size,
        buffer,
    });

    if (result.ok && await isFlaggedUploadHash(result.contentHash)) {
        result = gate.validate({
            fileName: file.name,
            declaredMime,
            sizeBytes: file.size,
            buffer,
            knownFlaggedHash: true,
        });
    }

    if (!result.ok) {
        writeUploadSecurityEvent({
            req,
            requestId,
            sessionId,
            fileName: file.name,
            declaredMime,
            fileSizeBytes: file.size,
            result,
        });
        const res = NextResponse.json({
            error: 'Upload rejected by security gate',
            code: result.violationType,
            reason: result.reason,
            detected_mime: result.detectedMime,
            request_id: requestId,
        }, { status: 400 });
        return withUploadHeaders(res, requestId, startTime);
    }

    await registerUploadHash(result, file.name).catch((error: unknown) => {
        console.warn('[ask-vetios/upload] upload hash registration failed:', error);
    });

    const species = normalizeOptionalString(form.get('species'));
    const domain = normalizeOptionalString(form.get('domain'));
    const ingestion = await ingestUpload(req, {
        sessionId,
        fileName: file.name,
        species,
        domain,
        buffer,
        result,
    });

    const res = NextResponse.json({
        upload_id: result.contentHash,
        status: ingestion.status,
        processing_eta: ingestion.indexed ? 'ready' : 'processor_not_attached',
        source_type: result.sourceType,
        detected_mime: result.detectedMime,
        file_size_bytes: file.size,
        file_name_hash: hashPrivacyValue(file.name),
        rag_source_id: ingestion.source_id,
        rag_document_id: ingestion.document_id,
        chunks_indexed: ingestion.chunks_indexed,
        extracted_characters: ingestion.extracted_characters,
        processing_note: ingestion.reason,
        request_id: requestId,
    }, { status: ingestion.indexed ? 201 : 202 });
    return withUploadHeaders(res, requestId, startTime);
}

function withUploadHeaders(res: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', 'no-store');
    return res;
}

function normalizeOptionalString(value: FormDataEntryValue | null): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
    return typeof value === 'object'
        && value !== null
        && typeof (value as File).arrayBuffer === 'function'
        && typeof (value as File).name === 'string'
        && typeof (value as File).size === 'number';
}

async function isFlaggedUploadHash(contentHash: string): Promise<boolean> {
    try {
        const { data, error } = await getSupabaseServer()
            .from('upload_hashes')
            .select('flagged')
            .eq('content_hash', contentHash)
            .maybeSingle();
        if (error) return false;
        return data?.flagged === true;
    } catch {
        return false;
    }
}

async function registerUploadHash(result: Extract<UploadSecurityGateResult, { ok: true }>, fileName: string): Promise<void> {
    const { error } = await getSupabaseServer()
        .from('upload_hashes')
        .upsert({
            content_hash: result.contentHash,
            source_type: result.sourceType,
            detected_mime: result.detectedMime,
            first_seen_file_name_hash: hashPrivacyValue(fileName),
            upload_status: 'validated',
            last_seen_at: new Date().toISOString(),
        }, { onConflict: 'content_hash' });
    if (error) throw new Error(error.message);
}

async function ingestUpload(
    req: Request,
    input: {
        sessionId: string | null;
        fileName: string;
        species: string | null;
        domain: string | null;
        buffer: Buffer;
        result: Extract<UploadSecurityGateResult, { ok: true }>;
    },
): Promise<ClinicalUploadIngestionResult> {
    try {
        const client = getSupabaseServer();
        const ingestion = await ingestClinicalUploadToRag({
            client,
            tenantId: process.env.VETIOS_PUBLIC_RAG_TENANT_ID || 'public',
            actorLabel: req.headers.get('x-vetios-actor') ?? 'ask_vetios_upload',
            sessionId: input.sessionId,
            fileName: input.fileName,
            species: input.species,
            domain: input.domain,
            buffer: input.buffer,
            gateResult: input.result,
        });

        await client
            .from('upload_hashes')
            .update({
                upload_status: ingestion.status,
                rag_source_id: ingestion.source_id,
                rag_document_id: ingestion.document_id,
                chunks_indexed: ingestion.chunks_indexed,
                processing_error: ingestion.reason,
                processed_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
            })
            .eq('content_hash', input.result.contentHash);

        return ingestion;
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown ingestion failure';
        console.warn('[ask-vetios/upload] ingestion failed:', reason);
        try {
            await getSupabaseServer()
                .from('upload_hashes')
                .update({
                    upload_status: 'validated_pending_processing',
                    processing_error: reason,
                    last_seen_at: new Date().toISOString(),
                })
                .eq('content_hash', input.result.contentHash);
        } catch {
            // Non-fatal: the client still receives a validated/deferred upload response.
        }

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
}
