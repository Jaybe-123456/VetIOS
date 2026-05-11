import { createHash } from 'crypto';

export type UploadViolationType =
    | 'BLOCKED_MIME'
    | 'SIZE_EXCEEDED'
    | 'MAGIC_BYTE_MISMATCH'
    | 'ARCHIVE_DETECTED'
    | 'EMBEDDED_SCRIPT'
    | 'POLYGLOT_DETECTED'
    | 'FLAGGED_HASH';

export type UploadSourceType =
    | 'video'
    | 'pdf'
    | 'docx'
    | 'ppt'
    | 'pptx'
    | 'txt'
    | 'md'
    | 'csv'
    | 'xlsx'
    | 'json'
    | 'image'
    | 'audio'
    | 'dicom';

export interface UploadSecurityGateInput {
    fileName: string;
    declaredMime: string;
    sizeBytes: number;
    buffer: Buffer;
    knownFlaggedHash?: boolean;
}

export type UploadSecurityGateResult =
    | {
        ok: true;
        contentHash: string;
        detectedMime: string;
        sourceType: UploadSourceType;
        sizeLimitBytes: number;
    }
    | {
        ok: false;
        violationType: UploadViolationType;
        reason: string;
        contentHash: string | null;
        detectedMime: string;
        sourceType: UploadSourceType | null;
        sizeLimitBytes: number | null;
    };

export const GLOBAL_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

const MIME_TYPES = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    json: 'application/json',
    jpg: 'image/jpeg',
    png: 'image/png',
    tiff: 'image/tiff',
    dicom: 'application/dicom',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
} as const;

export const ALLOWED_MIME_TYPES = new Set<string>(Object.values(MIME_TYPES));

export const BLOCKED_MIME_TYPES = new Set<string>([
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',
    'application/x-bzip2',
    'application/x-xz',
    'application/octet-stream',
    'application/x-executable',
    'application/x-msdownload',
    'text/html',
    'application/javascript',
    'application/x-httpd-php',
]);

const SIZE_LIMITS = {
    video: 500 * 1024 * 1024,
    pdf: 50 * 1024 * 1024,
    docx: 50 * 1024 * 1024,
    ppt: 50 * 1024 * 1024,
    pptx: 50 * 1024 * 1024,
    txt: 10 * 1024 * 1024,
    md: 10 * 1024 * 1024,
    csv: 10 * 1024 * 1024,
    xlsx: 10 * 1024 * 1024,
    json: 10 * 1024 * 1024,
    image: 25 * 1024 * 1024,
    dicom: 25 * 1024 * 1024,
    audio: 100 * 1024 * 1024,
} satisfies Record<UploadSourceType, number>;

const PDF_SCRIPT_MARKERS = [
    '/JS',
    '/JavaScript',
    '/OpenAction',
    '/AA',
    '/Launch',
    '/EmbeddedFile',
];

const OPENXML_ACTIVE_CONTENT_MARKERS = [
    'vbaProject.bin',
    'oleObject',
    'activeX',
    'macros/',
    'word/embeddings/',
    'xl/embeddings/',
    'ppt/vbaProject.bin',
    'ppt/embeddings/',
    'ppt/activeX/',
];

const LEGACY_OFFICE_ACTIVE_CONTENT_MARKERS = [
    '_VBA_PROJECT',
    'VBA',
    'Macros',
];

const ARCHIVE_SIGNATURES = [
    { name: 'zip', bytes: bytes(0x50, 0x4b, 0x03, 0x04) },
    { name: 'zip_empty', bytes: bytes(0x50, 0x4b, 0x05, 0x06) },
    { name: 'zip_spanned', bytes: bytes(0x50, 0x4b, 0x07, 0x08) },
    { name: 'zip_central_directory', bytes: bytes(0x50, 0x4b, 0x01, 0x02) },
    { name: 'rar', bytes: bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07) },
    { name: '7z', bytes: bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) },
    { name: 'gzip', bytes: bytes(0x1f, 0x8b) },
];

const EXECUTABLE_SIGNATURE = bytes(0x4d, 0x5a);
const ZIP_PREFIX = bytes(0x50, 0x4b);
const OLE_COMPOUND_SIGNATURE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

export class UploadSecurityGate {
    validate(input: UploadSecurityGateInput): UploadSecurityGateResult {
        const declaredMime = input.declaredMime.trim().toLowerCase();
        const sourceType = resolveSourceType(declaredMime);
        const sizeLimitBytes = sourceType ? SIZE_LIMITS[sourceType] : null;
        const detectedMime = detectMime(input.buffer, declaredMime);
        const contentHash = sha256(input.buffer);

        if (BLOCKED_MIME_TYPES.has(declaredMime) || !ALLOWED_MIME_TYPES.has(declaredMime) || !sourceType) {
            return reject('BLOCKED_MIME', `Unsupported or blocked MIME type: ${declaredMime}`, contentHash, detectedMime, sourceType, sizeLimitBytes);
        }

        if (input.sizeBytes > GLOBAL_MAX_UPLOAD_BYTES || input.sizeBytes > sizeLimitBytes!) {
            return reject('SIZE_EXCEEDED', `File exceeds ${sizeLimitBytes} byte limit for ${declaredMime}`, contentHash, detectedMime, sourceType, sizeLimitBytes);
        }

        if (isRawArchiveMime(declaredMime) || (detectArchiveAtStart(input.buffer) && !isOpenXml(sourceType))) {
            return reject('ARCHIVE_DETECTED', 'Archive containers are blocked before processing', contentHash, detectedMime, sourceType, sizeLimitBytes);
        }

        if (!magicBytesMatch(input.buffer, sourceType, declaredMime)) {
            return reject('MAGIC_BYTE_MISMATCH', `File contents do not match declared MIME type: ${declaredMime}`, contentHash, detectedMime, sourceType, sizeLimitBytes);
        }

        const embeddedScript = detectEmbeddedActiveContent(input.buffer, sourceType);
        if (embeddedScript) {
            return reject('EMBEDDED_SCRIPT', embeddedScript, contentHash, detectedMime, sourceType, sizeLimitBytes);
        }

        if (detectPolyglot(input.buffer, sourceType)) {
            return reject('POLYGLOT_DETECTED', 'Secondary executable or archive signature detected inside upload', contentHash, detectedMime, sourceType, sizeLimitBytes);
        }

        if (input.knownFlaggedHash) {
            return reject('FLAGGED_HASH', 'Previously flagged content rejected', contentHash, detectedMime, sourceType, sizeLimitBytes);
        }

        return {
            ok: true,
            contentHash,
            detectedMime,
            sourceType,
            sizeLimitBytes: sizeLimitBytes!,
        };
    }
}

function reject(
    violationType: UploadViolationType,
    reason: string,
    contentHash: string | null,
    detectedMime: string,
    sourceType: UploadSourceType | null,
    sizeLimitBytes: number | null,
): UploadSecurityGateResult {
    return {
        ok: false,
        violationType,
        reason,
        contentHash,
        detectedMime,
        sourceType,
        sizeLimitBytes,
    };
}

export function sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
}

export function hashPrivacyValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function resolveSourceType(mime: string): UploadSourceType | null {
    switch (mime) {
        case MIME_TYPES.mp4:
        case MIME_TYPES.mov:
        case MIME_TYPES.webm:
            return 'video';
        case MIME_TYPES.pdf:
            return 'pdf';
        case MIME_TYPES.docx:
            return 'docx';
        case MIME_TYPES.ppt:
            return 'ppt';
        case MIME_TYPES.pptx:
            return 'pptx';
        case MIME_TYPES.txt:
            return 'txt';
        case MIME_TYPES.md:
            return 'md';
        case MIME_TYPES.csv:
            return 'csv';
        case MIME_TYPES.xlsx:
            return 'xlsx';
        case MIME_TYPES.json:
            return 'json';
        case MIME_TYPES.jpg:
        case MIME_TYPES.png:
        case MIME_TYPES.tiff:
            return 'image';
        case MIME_TYPES.dicom:
            return 'dicom';
        case MIME_TYPES.mp3:
        case MIME_TYPES.wav:
        case MIME_TYPES.m4a:
            return 'audio';
        default:
            return null;
    }
}

function detectMime(buffer: Buffer, declaredMime: string): string {
    if (startsWith(buffer, bytes(0x25, 0x50, 0x44, 0x46))) return MIME_TYPES.pdf;
    if (startsWith(buffer, bytes(0xff, 0xd8, 0xff))) return MIME_TYPES.jpg;
    if (startsWith(buffer, bytes(0x89, 0x50, 0x4e, 0x47))) return MIME_TYPES.png;
    if (startsWith(buffer, bytes(0x49, 0x49, 0x2a, 0x00)) || startsWith(buffer, bytes(0x4d, 0x4d, 0x00, 0x2a))) return MIME_TYPES.tiff;
    if (hasFtypBox(buffer)) return declaredMime.startsWith('video/') || declaredMime === MIME_TYPES.m4a ? declaredMime : MIME_TYPES.mp4;
    if (startsWith(buffer, bytes(0x1a, 0x45, 0xdf, 0xa3))) return MIME_TYPES.webm;
    if (startsWith(buffer, bytes(0x49, 0x44, 0x33)) || startsWith(buffer, bytes(0xff, 0xfb))) return MIME_TYPES.mp3;
    if (startsWith(buffer, Buffer.from('RIFF', 'ascii')) && buffer.subarray(8, 12).equals(Buffer.from('WAVE', 'ascii'))) return MIME_TYPES.wav;
    if (buffer.length > 132 && buffer.subarray(128, 132).equals(Buffer.from('DICM', 'ascii'))) return MIME_TYPES.dicom;
    if (startsWith(buffer, OLE_COMPOUND_SIGNATURE)) return declaredMime;
    if (startsWith(buffer, ZIP_PREFIX)) return declaredMime;
    return declaredMime;
}

function magicBytesMatch(buffer: Buffer, sourceType: UploadSourceType, declaredMime: string): boolean {
    if (sourceType === 'pdf') return startsWith(buffer, Buffer.from('%PDF', 'ascii'));
    if (sourceType === 'docx') return isOpenXmlPackage(buffer, 'word/');
    if (sourceType === 'pptx') return isOpenXmlPackage(buffer, 'ppt/');
    if (sourceType === 'ppt') return isLegacyPowerPoint(buffer);
    if (sourceType === 'xlsx') return isOpenXmlPackage(buffer, 'xl/');
    if (sourceType === 'image') return imageMagicMatches(buffer, declaredMime);
    if (sourceType === 'video') return videoMagicMatches(buffer, declaredMime);
    if (sourceType === 'audio') return audioMagicMatches(buffer, declaredMime);
    if (sourceType === 'dicom') return buffer.length > 132 && buffer.subarray(128, 132).equals(Buffer.from('DICM', 'ascii'));
    if (sourceType === 'json') return /^[\s\r\n]*[\[{]/.test(buffer.toString('utf8', 0, Math.min(buffer.length, 512)));
    return isTextLike(buffer);
}

function detectEmbeddedActiveContent(buffer: Buffer, sourceType: UploadSourceType): string | null {
    const latin = buffer.toString('latin1');
    if (sourceType === 'pdf') {
        const marker = PDF_SCRIPT_MARKERS.find((entry) => latin.includes(entry));
        return marker ? `PDF contains active content marker ${marker}` : null;
    }
    if (sourceType === 'docx' || sourceType === 'xlsx' || sourceType === 'pptx') {
        const marker = OPENXML_ACTIVE_CONTENT_MARKERS.find((entry) => latin.includes(entry));
        return marker ? `OpenXML document contains active content marker ${marker}` : null;
    }
    if (sourceType === 'ppt') {
        const marker = LEGACY_OFFICE_ACTIVE_CONTENT_MARKERS.find((entry) => latin.includes(entry));
        return marker ? `Legacy PowerPoint contains active content marker ${marker}` : null;
    }
    return null;
}

function detectPolyglot(buffer: Buffer, sourceType: UploadSourceType): boolean {
    if (hasEmbeddedExecutable(buffer)) return true;

    for (const signature of ARCHIVE_SIGNATURES) {
        if (isOpenXml(sourceType) && signature.name.startsWith('zip')) continue;
        if (hasEmbeddedArchive(buffer, signature.name, signature.bytes)) return true;
    }

    return false;
}

function hasEmbeddedArchive(buffer: Buffer, name: string, signature: Buffer): boolean {
    let offset = findSignature(buffer, signature, 1);
    while (offset >= 0) {
        if (isPlausibleArchiveAt(buffer, name, offset)) return true;
        offset = findSignature(buffer, signature, offset + 1);
    }
    return false;
}

function isPlausibleArchiveAt(buffer: Buffer, name: string, offset: number): boolean {
    if (name === 'zip') return isPlausibleZipLocalHeader(buffer, offset);
    if (name === 'zip_central_directory') return isPlausibleZipCentralDirectory(buffer, offset);
    if (name === 'zip_empty') return isPlausibleZipEndOfCentralDirectory(buffer, offset);
    if (name === 'zip_spanned') return offset + 16 <= buffer.length;
    if (name === 'gzip') return isPlausibleGzipHeader(buffer, offset);
    return offset + 16 <= buffer.length;
}

function isPlausibleZipLocalHeader(buffer: Buffer, offset: number): boolean {
    if (offset + 30 > buffer.length) return false;
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const headerEnd = offset + 30 + fileNameLength + extraFieldLength;
    if (![0, 8, 9, 12, 14, 98].includes(compressionMethod)) return false;
    if (fileNameLength < 1 || fileNameLength > 512 || headerEnd > buffer.length) return false;
    return isPrintableZipName(buffer.subarray(offset + 30, offset + 30 + fileNameLength));
}

function isPlausibleZipCentralDirectory(buffer: Buffer, offset: number): boolean {
    if (offset + 46 > buffer.length) return false;
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const headerEnd = offset + 46 + fileNameLength + extraFieldLength + commentLength;
    if (fileNameLength < 1 || fileNameLength > 512 || headerEnd > buffer.length) return false;
    return isPrintableZipName(buffer.subarray(offset + 46, offset + 46 + fileNameLength));
}

function isPlausibleZipEndOfCentralDirectory(buffer: Buffer, offset: number): boolean {
    if (offset + 22 > buffer.length) return false;
    const commentLength = buffer.readUInt16LE(offset + 20);
    return offset + 22 + commentLength <= buffer.length;
}

function isPrintableZipName(value: Buffer): boolean {
    if (value.includes(0)) return false;
    const text = value.toString('utf8').trim();
    return text.length > 0 && /^[\x20-\x7e]+$/.test(text);
}

function isPlausibleGzipHeader(buffer: Buffer, offset: number): boolean {
    if (offset + 10 > buffer.length) return false;
    const compressionMethod = buffer[offset + 2];
    const flags = buffer[offset + 3];
    return compressionMethod === 0x08 && (flags & 0xe0) === 0;
}

function hasEmbeddedExecutable(buffer: Buffer): boolean {
    let offset = findSignature(buffer, EXECUTABLE_SIGNATURE, 1);
    while (offset >= 0) {
        if (offset + 64 <= buffer.length) {
            const peOffset = buffer.readUInt32LE(offset + 0x3c);
            const peSignatureOffset = offset + peOffset;
            if (
                peOffset >= 64
                && peSignatureOffset + 4 <= buffer.length
                && buffer.subarray(peSignatureOffset, peSignatureOffset + 4).equals(Buffer.from('PE\0\0', 'ascii'))
            ) {
                return true;
            }
        }
        offset = findSignature(buffer, EXECUTABLE_SIGNATURE, offset + 1);
    }
    return false;
}

function detectArchiveAtStart(buffer: Buffer): boolean {
    return ARCHIVE_SIGNATURES.some((signature) => startsWith(buffer, signature.bytes));
}

function isRawArchiveMime(mime: string): boolean {
    return mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || mime.includes('tar') || mime.includes('gzip');
}

function isOpenXml(sourceType: UploadSourceType): boolean {
    return sourceType === 'docx' || sourceType === 'xlsx' || sourceType === 'pptx';
}

function isOpenXmlPackage(buffer: Buffer, requiredPath: 'word/' | 'xl/' | 'ppt/'): boolean {
    if (!startsWith(buffer, ZIP_PREFIX)) return false;
    const latin = buffer.toString('latin1');
    return latin.includes('[Content_Types].xml') && latin.includes(requiredPath);
}

function isLegacyPowerPoint(buffer: Buffer): boolean {
    return startsWith(buffer, OLE_COMPOUND_SIGNATURE) && buffer.toString('latin1').includes('PowerPoint Document');
}

function imageMagicMatches(buffer: Buffer, declaredMime: string): boolean {
    if (declaredMime === MIME_TYPES.jpg) return startsWith(buffer, bytes(0xff, 0xd8, 0xff));
    if (declaredMime === MIME_TYPES.png) return startsWith(buffer, bytes(0x89, 0x50, 0x4e, 0x47));
    if (declaredMime === MIME_TYPES.tiff) {
        return startsWith(buffer, bytes(0x49, 0x49, 0x2a, 0x00)) || startsWith(buffer, bytes(0x4d, 0x4d, 0x00, 0x2a));
    }
    return false;
}

function videoMagicMatches(buffer: Buffer, declaredMime: string): boolean {
    if (declaredMime === MIME_TYPES.webm) return startsWith(buffer, bytes(0x1a, 0x45, 0xdf, 0xa3));
    return hasFtypBox(buffer);
}

function audioMagicMatches(buffer: Buffer, declaredMime: string): boolean {
    if (declaredMime === MIME_TYPES.wav) {
        return startsWith(buffer, Buffer.from('RIFF', 'ascii')) && buffer.subarray(8, 12).equals(Buffer.from('WAVE', 'ascii'));
    }
    if (declaredMime === MIME_TYPES.m4a) return hasFtypBox(buffer);
    return startsWith(buffer, bytes(0x49, 0x44, 0x33)) || startsWith(buffer, bytes(0xff, 0xfb)) || startsWith(buffer, bytes(0xff, 0xf3));
}

function hasFtypBox(buffer: Buffer): boolean {
    return buffer.length >= 12 && buffer.subarray(4, 8).equals(Buffer.from('ftyp', 'ascii'));
}

function isTextLike(buffer: Buffer): boolean {
    if (buffer.length === 0) return false;
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
    return !sample.includes(0);
}

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
    return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}

function findSignature(buffer: Buffer, signature: Buffer, startOffset: number): number {
    for (let index = startOffset; index <= buffer.length - signature.length; index += 1) {
        if (buffer.subarray(index, index + signature.length).equals(signature)) return index;
    }
    return -1;
}

function bytes(...values: number[]): Buffer {
    return Buffer.from(values);
}
