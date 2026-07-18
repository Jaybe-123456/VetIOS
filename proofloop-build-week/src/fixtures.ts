import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ClosedCase } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readJsonFixture(name: string): Promise<unknown> {
    if (!/^[a-z0-9-]+\.json$/u.test(name)) {
        throw new Error('Fixture name is invalid.');
    }
    const fixturePath = resolve(process.cwd(), 'fixtures', name);
    return JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
}

export function parseClosedCase(value: unknown): ClosedCase {
    if (!isRecord(value) || !isRecord(value.inference) || !isRecord(value.outcome) || !isRecord(value.review)) {
        throw new TypeError('Closed case fixture is malformed.');
    }
    if (typeof value.case_id !== 'string' || value.case_id.length === 0) {
        throw new TypeError('Closed case requires case_id.');
    }
    if (!isRecord(value.inference.input) || !isRecord(value.inference.output)) {
        throw new TypeError('Closed case inference is malformed.');
    }
    if (!Array.isArray(value.outcome.evidence) || value.outcome.evidence.length === 0) {
        throw new TypeError('Closed case requires outcome evidence.');
    }
    if (value.review.status !== 'confirmed') {
        throw new TypeError('Closed case requires confirmed review state.');
    }
    return value as unknown as ClosedCase;
}
