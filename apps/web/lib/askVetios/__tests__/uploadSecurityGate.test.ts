import { describe, expect, it } from 'vitest';
import { UploadSecurityGate } from '../uploadSecurityGate';

const gate = new UploadSecurityGate();

describe('Ask Vetios UploadSecurityGate', () => {
    it('accepts a plain text clinical note', () => {
        const result = gate.validate({
            fileName: 'case-note.txt',
            declaredMime: 'text/plain',
            sizeBytes: 31,
            buffer: Buffer.from('cat respiratory case note\nWBC 18'),
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.sourceType).toBe('txt');
            expect(result.contentHash).toHaveLength(64);
        }
    });

    it('rejects blocked archive MIME types', () => {
        const result = gate.validate({
            fileName: 'bundle.zip',
            declaredMime: 'application/zip',
            sizeBytes: 4,
            buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('BLOCKED_MIME');
    });

    it('rejects modality-specific oversized files', () => {
        const result = gate.validate({
            fileName: 'large.pdf',
            declaredMime: 'application/pdf',
            sizeBytes: 51 * 1024 * 1024,
            buffer: Buffer.from('%PDF-1.7\n'),
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('SIZE_EXCEEDED');
    });

    it('rejects files whose magic bytes do not match the declared MIME', () => {
        const result = gate.validate({
            fileName: 'not-a-pdf.pdf',
            declaredMime: 'application/pdf',
            sizeBytes: 18,
            buffer: Buffer.from('plain text content'),
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('MAGIC_BYTE_MISMATCH');
    });

    it('rejects archive signatures hidden behind an allowed text MIME', () => {
        const result = gate.validate({
            fileName: 'notes.txt',
            declaredMime: 'text/plain',
            sizeBytes: 10,
            buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('ARCHIVE_DETECTED');
    });

    it('rejects active content in PDFs', () => {
        const result = gate.validate({
            fileName: 'report.pdf',
            declaredMime: 'application/pdf',
            sizeBytes: 34,
            buffer: Buffer.from('%PDF-1.7\n1 0 obj\n/JavaScript\nendobj'),
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('EMBEDDED_SCRIPT');
    });

    it('rejects polyglot PDF uploads with embedded ZIP signatures', () => {
        const zipHeader = buildZipLocalHeader('payload.txt');
        const result = gate.validate({
            fileName: 'polyglot.pdf',
            declaredMime: 'application/pdf',
            sizeBytes: 30 + zipHeader.length,
            buffer: Buffer.concat([
                Buffer.from('%PDF-1.7\nclinical report\n'),
                zipHeader,
            ]),
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('POLYGLOT_DETECTED');
    });

    it('does not reject incidental archive-like bytes inside PDF streams', () => {
        const pdf = Buffer.concat([
            Buffer.from('%PDF-1.7\n1 0 obj\nstream\nclinical text '),
            Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x11, 0x22, 0x1f, 0x8b, 0x02, 0xe0]),
            Buffer.from('\nendstream\nendobj\n%%EOF'),
        ]);
        const result = gate.validate({
            fileName: 'lecture.pdf',
            declaredMime: 'application/pdf',
            sizeBytes: pdf.length,
            buffer: pdf,
        });

        expect(result.ok).toBe(true);
    });

    it('rejects previously flagged content hashes', () => {
        const result = gate.validate({
            fileName: 'case-note.txt',
            declaredMime: 'text/plain',
            sizeBytes: 18,
            buffer: Buffer.from('safe looking note'),
            knownFlaggedHash: true,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('FLAGGED_HASH');
    });

    it('allows DOCX packages only when they look like Word OpenXML and have no macros', () => {
        const fakeDocx = Buffer.from('PK\x03\x04[Content_Types].xml word/document.xml clinical text', 'latin1');
        const result = gate.validate({
            fileName: 'report.docx',
            declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: fakeDocx.length,
            buffer: fakeDocx,
        });

        expect(result.ok).toBe(true);
    });

    it('allows PPTX packages only when they look like PowerPoint OpenXML and have no macros', () => {
        const fakePptx = Buffer.from('PK\x03\x04[Content_Types].xml ppt/slides/slide1.xml rodent zoonosis lecture', 'latin1');
        const result = gate.validate({
            fileName: 'rodents-and-bats.pptx',
            declaredMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            sizeBytes: fakePptx.length,
            buffer: fakePptx,
        });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.sourceType).toBe('pptx');
    });

    it('rejects DOCX packages containing macro signatures', () => {
        const fakeDocx = Buffer.from('PK\x03\x04[Content_Types].xml word/document.xml vbaProject.bin', 'latin1');
        const result = gate.validate({
            fileName: 'report.docx',
            declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: fakeDocx.length,
            buffer: fakeDocx,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('EMBEDDED_SCRIPT');
    });

    it('rejects PPTX packages containing macro signatures', () => {
        const fakePptx = Buffer.from('PK\x03\x04[Content_Types].xml ppt/slides/slide1.xml ppt/vbaProject.bin', 'latin1');
        const result = gate.validate({
            fileName: 'macro.pptx',
            declaredMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            sizeBytes: fakePptx.length,
            buffer: fakePptx,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('EMBEDDED_SCRIPT');
    });

    it('allows legacy PPT files when they have Office compound magic and no macro markers', () => {
        const fakePpt = Buffer.concat([
            Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            Buffer.from('PowerPoint Document clinical rodent disease lecture', 'latin1'),
        ]);
        const result = gate.validate({
            fileName: 'lecture.ppt',
            declaredMime: 'application/vnd.ms-powerpoint',
            sizeBytes: fakePpt.length,
            buffer: fakePpt,
        });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.sourceType).toBe('ppt');
    });

    it('rejects legacy PPT files containing macro markers', () => {
        const fakePpt = Buffer.concat([
            Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            Buffer.from('PowerPoint Document clinical lecture _VBA_PROJECT', 'latin1'),
        ]);
        const result = gate.validate({
            fileName: 'macro.ppt',
            declaredMime: 'application/vnd.ms-powerpoint',
            sizeBytes: fakePpt.length,
            buffer: fakePpt,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.violationType).toBe('EMBEDDED_SCRIPT');
    });
});

function buildZipLocalHeader(fileName: string): Buffer {
    const name = Buffer.from(fileName, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    return Buffer.concat([header, name, Buffer.from('payload')]);
}
