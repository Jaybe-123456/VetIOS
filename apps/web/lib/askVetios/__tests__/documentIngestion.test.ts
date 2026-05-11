import { deflateRawSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import { extractClinicalUploadText } from '../documentIngestion';

describe('Ask Vetios clinical upload text extraction', () => {
    it('extracts plain text and JSON content for RAG indexing', () => {
        const text = extractClinicalUploadText({
            sourceType: 'txt',
            buffer: Buffer.from('Canine case: vomiting, diarrhea, dehydration. CBC and chemistry requested.'),
        });
        const json = extractClinicalUploadText({
            sourceType: 'json',
            buffer: Buffer.from(JSON.stringify({
                species: 'feline',
                findings: ['nasal discharge', 'sneezing'],
                wbc: 18.2,
            })),
        });

        expect(text.text).toContain('Canine case');
        expect(json.text).toContain('findings.0: nasal discharge');
        expect(json.text).toContain('wbc: 18.2');
    });

    it('extracts literal text from simple PDF content streams', () => {
        const pdf = Buffer.from('%PDF-1.4\nBT (Canine pancreatitis case with vomiting, abdominal pain, and elevated cPLI.) Tj ET');
        const extracted = extractClinicalUploadText({ sourceType: 'pdf', buffer: pdf });

        expect(extracted.method).toBe('pdf_literal_text');
        expect(extracted.text).toContain('elevated cPLI');
    });

    it('extracts DOCX OpenXML document text', () => {
        const docx = makeZip({
            'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Feline respiratory case with sneezing and nasal discharge.</w:t></w:r></w:p></w:body></w:document>',
        });
        const extracted = extractClinicalUploadText({ sourceType: 'docx', buffer: docx });

        expect(extracted.method).toBe('docx_openxml');
        expect(extracted.text).toContain('Feline respiratory case');
        expect(extracted.text).toContain('nasal discharge');
    });

    it('extracts XLSX shared strings and worksheet values', () => {
        const xlsx = makeZip({
            'xl/sharedStrings.xml': '<sst><si><t>Analyte</t></si><si><t>WBC</t></si><si><t>Result</t></si></sst>',
            'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c><c><v>18.2</v></c></row></sheetData></worksheet>',
        });
        const extracted = extractClinicalUploadText({ sourceType: 'xlsx', buffer: xlsx });

        expect(extracted.method).toBe('xlsx_openxml');
        expect(extracted.text).toContain('Analyte, WBC, Result, 18.2');
    });

    it('extracts PPTX slide and note text', () => {
        const pptx = makeZip({
            'ppt/slides/slide1.xml': '<p:sld><p:txBody><a:p><a:r><a:t>Rodent zoonosis overview: lymphocytic choriomeningitis.</a:t></a:r></a:p></p:txBody></p:sld>',
            'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:t>Bat rabies safety note.</a:t></p:notes>',
        });
        const extracted = extractClinicalUploadText({ sourceType: 'pptx', buffer: pptx });

        expect(extracted.method).toBe('pptx_openxml');
        expect(extracted.text).toContain('Rodent zoonosis overview');
        expect(extracted.text).toContain('Bat rabies safety note');
    });

    it('extracts printable text from legacy PPT files', () => {
        const ppt = Buffer.concat([
            Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            Buffer.from('\0\0Diseases of rodents and bats\0\0Rabies exposure and zoonotic risk\0', 'latin1'),
        ]);
        const extracted = extractClinicalUploadText({ sourceType: 'ppt', buffer: ppt });

        expect(extracted.method).toBe('ppt_printable_text_fallback');
        expect(extracted.text).toContain('Diseases of rodents and bats');
        expect(extracted.text).toContain('zoonotic risk');
    });
});

function makeZip(files: Record<string, string>): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let localOffset = 0;

    for (const [name, content] of Object.entries(files)) {
        const nameBuffer = Buffer.from(name, 'utf8');
        const raw = Buffer.from(content, 'utf8');
        const compressed = deflateRawSync(raw);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(0, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuffer.length, 26);

        localParts.push(local, nameBuffer, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(0, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBuffer.length, 28);
        central.writeUInt32LE(localOffset, 42);
        centralParts.push(central, nameBuffer);

        localOffset += local.length + nameBuffer.length + compressed.length;
    }

    const centralDirectoryOffset = localOffset;
    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(centralDirectoryOffset, 16);

    return Buffer.concat([...localParts, centralDirectory, end]);
}
