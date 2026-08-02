import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvidenceNodeRawSource } from './index.js';

export interface EvidenceNodeSpoolJob {
    schema: 'vetios.evidence-node.spool-job.v1';
    id: string;
    source_key: string;
    source_digest: string;
    source: EvidenceNodeRawSource;
    attempt_count: number;
    available_at: string;
    created_at: string;
    updated_at: string;
    last_error: string | null;
}

export interface EvidenceNodeDeliveryReceipt {
    schema: 'vetios.evidence-node.delivery-receipt.v1';
    job_id: string;
    source_key: string;
    source_digest: string;
    submission_count: number;
    remote_receipts: Array<Record<string, unknown>>;
    completed_at: string;
    receipt_hash: string;
}

export interface EvidenceNodeSpoolSnapshot {
    pending: number;
    processing: number;
    dead_letter: number;
    delivered: number;
    oldest_pending_at: string | null;
}

export class EvidenceNodeSpool {
    readonly root: string;
    readonly key: Buffer;

    constructor(input: { root: string; encryptionKey: Buffer }) {
        if (input.encryptionKey.length !== 32) {
            throw new Error('Evidence Node spool encryption key must be exactly 32 bytes.');
        }
        this.root = input.root;
        this.key = input.encryptionKey;
    }

    async initialize(): Promise<void> {
        await Promise.all([
            this.ensureDirectory('pending'),
            this.ensureDirectory('processing'),
            this.ensureDirectory('dead-letter'),
            this.ensureDirectory('receipts'),
        ]);
    }

    async enqueue(
        sourceKey: string,
        source: EvidenceNodeRawSource,
        dedupeNamespace = sourceKey,
    ): Promise<{ job: EvidenceNodeSpoolJob; created: boolean }> {
        await this.initialize();
        const sourceDigest = hashSource(source, dedupeNamespace);
        const fileName = `${sourceDigest}.enc`;
        const delivered = await exists(join(this.root, 'receipts', `${sourceDigest}.json`));
        if (delivered) {
            return {
                job: buildSpoolJob(sourceKey, source, sourceDigest),
                created: false,
            };
        }
        for (const directory of ['pending', 'processing', 'dead-letter']) {
            const path = join(this.root, directory, fileName);
            if (await exists(path)) {
                return { job: await this.readEncryptedJob(path), created: false };
            }
        }
        const job = buildSpoolJob(sourceKey, source, sourceDigest);
        await this.writeEncryptedJob(join(this.root, 'pending', fileName), job);
        return { job, created: true };
    }

    async lease(limit = 10): Promise<EvidenceNodeSpoolJob[]> {
        await this.initialize();
        const now = Date.now();
        const names = (await readdir(join(this.root, 'pending')))
            .filter((name) => name.endsWith('.enc'))
            .sort();
        const jobs: EvidenceNodeSpoolJob[] = [];
        for (const name of names) {
            if (jobs.length >= Math.max(1, limit)) break;
            const pendingPath = join(this.root, 'pending', name);
            const processingPath = join(this.root, 'processing', name);
            let job: EvidenceNodeSpoolJob;
            try {
                job = await this.readEncryptedJob(pendingPath);
            } catch {
                await rename(pendingPath, join(this.root, 'dead-letter', name));
                continue;
            }
            if (Date.parse(job.available_at) > now) continue;
            try {
                await rename(pendingPath, processingPath);
                jobs.push(job);
            } catch {
                // Another process leased this job first.
            }
        }
        return jobs;
    }

    async complete(job: EvidenceNodeSpoolJob, remoteReceipts: Array<Record<string, unknown>>): Promise<EvidenceNodeDeliveryReceipt> {
        const receiptWithoutHash = {
            schema: 'vetios.evidence-node.delivery-receipt.v1' as const,
            job_id: job.id,
            source_key: job.source_key,
            source_digest: job.source_digest,
            submission_count: remoteReceipts.length,
            remote_receipts: remoteReceipts,
            completed_at: new Date().toISOString(),
        };
        const receipt: EvidenceNodeDeliveryReceipt = {
            ...receiptWithoutHash,
            receipt_hash: sha256(stableStringify(receiptWithoutHash)),
        };
        await atomicWrite(
            join(this.root, 'receipts', `${job.source_digest}.json`),
            `${JSON.stringify(receipt, null, 2)}\n`,
        );
        await rm(join(this.root, 'processing', `${job.source_digest}.enc`), { force: true });
        return receipt;
    }

    async retry(job: EvidenceNodeSpoolJob, error: unknown, options: {
        maxAttempts?: number;
        baseDelayMs?: number;
    } = {}): Promise<'retryable' | 'dead_letter'> {
        const attemptCount = job.attempt_count + 1;
        const maxAttempts = Math.max(1, options.maxAttempts ?? 6);
        const updated: EvidenceNodeSpoolJob = {
            ...job,
            attempt_count: attemptCount,
            available_at: new Date(Date.now() + Math.min(
                60 * 60_000,
                Math.max(1_000, options.baseDelayMs ?? 5_000) * 2 ** Math.max(0, attemptCount - 1),
            )).toISOString(),
            updated_at: new Date().toISOString(),
            last_error: sanitizeError(error),
        };
        const name = `${job.source_digest}.enc`;
        const destination = attemptCount >= maxAttempts ? 'dead-letter' : 'pending';
        await this.writeEncryptedJob(join(this.root, destination, name), updated);
        await rm(join(this.root, 'processing', name), { force: true });
        return destination === 'dead-letter' ? 'dead_letter' : 'retryable';
    }

    async deadLetter(job: EvidenceNodeSpoolJob, reason: string): Promise<void> {
        const updated: EvidenceNodeSpoolJob = {
            ...job,
            attempt_count: job.attempt_count + 1,
            updated_at: new Date().toISOString(),
            last_error: sanitizeError(reason),
        };
        const name = `${job.source_digest}.enc`;
        await this.writeEncryptedJob(join(this.root, 'dead-letter', name), updated);
        await rm(join(this.root, 'processing', name), { force: true });
    }

    async replayDeadLetters(limit = 25): Promise<string[]> {
        await this.initialize();
        const names = (await readdir(join(this.root, 'dead-letter')))
            .filter((name) => name.endsWith('.enc'))
            .sort()
            .slice(0, Math.max(1, limit));
        const replayed: string[] = [];
        for (const name of names) {
            const from = join(this.root, 'dead-letter', name);
            const job = await this.readEncryptedJob(from);
            const reset: EvidenceNodeSpoolJob = {
                ...job,
                attempt_count: 0,
                available_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_error: null,
            };
            await this.writeEncryptedJob(join(this.root, 'pending', name), reset);
            await rm(from, { force: true });
            replayed.push(job.id);
        }
        return replayed;
    }

    async releaseStaleProcessing(olderThanMs = 15 * 60_000): Promise<string[]> {
        await this.initialize();
        const names = (await readdir(join(this.root, 'processing'))).filter((name) => name.endsWith('.enc'));
        const released: string[] = [];
        for (const name of names) {
            const path = join(this.root, 'processing', name);
            const details = await stat(path);
            if (Date.now() - details.mtimeMs < olderThanMs) continue;
            const job = await this.readEncryptedJob(path);
            await this.writeEncryptedJob(join(this.root, 'pending', name), {
                ...job,
                available_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_error: 'stale_processing_lease_released',
            });
            await rm(path, { force: true });
            released.push(job.id);
        }
        return released;
    }

    async snapshot(): Promise<EvidenceNodeSpoolSnapshot> {
        await this.initialize();
        const [pending, processing, deadLetter, receipts] = await Promise.all([
            listFiles(join(this.root, 'pending'), '.enc'),
            listFiles(join(this.root, 'processing'), '.enc'),
            listFiles(join(this.root, 'dead-letter'), '.enc'),
            listFiles(join(this.root, 'receipts'), '.json'),
        ]);
        const pendingJobs = await Promise.all(pending.map((name) =>
            this.readEncryptedJob(join(this.root, 'pending', name)).catch(() => null)
        ));
        const oldest = pendingJobs
            .filter((job): job is EvidenceNodeSpoolJob => job != null)
            .map((job) => job.created_at)
            .sort()[0] ?? null;
        return {
            pending: pending.length,
            processing: processing.length,
            dead_letter: deadLetter.length,
            delivered: receipts.length,
            oldest_pending_at: oldest,
        };
    }

    private async ensureDirectory(name: string) {
        await mkdir(join(this.root, name), { recursive: true });
    }

    private async writeEncryptedJob(path: string, job: EvidenceNodeSpoolJob): Promise<void> {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(job), 'utf8'),
            cipher.final(),
        ]);
        const envelope = {
            schema: 'vetios.evidence-node.encrypted-spool.v1',
            algorithm: 'aes-256-gcm',
            iv: iv.toString('base64'),
            auth_tag: cipher.getAuthTag().toString('base64'),
            ciphertext: ciphertext.toString('base64'),
        };
        await atomicWrite(path, `${JSON.stringify(envelope)}\n`);
    }

    private async readEncryptedJob(path: string): Promise<EvidenceNodeSpoolJob> {
        const envelope = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        if (envelope.schema !== 'vetios.evidence-node.encrypted-spool.v1') {
            throw new Error('Evidence Node encrypted spool schema is invalid.');
        }
        const decipher = createDecipheriv(
            'aes-256-gcm',
            this.key,
            Buffer.from(String(envelope.iv), 'base64'),
        );
        decipher.setAuthTag(Buffer.from(String(envelope.auth_tag), 'base64'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(String(envelope.ciphertext), 'base64')),
            decipher.final(),
        ]).toString('utf8');
        const job = JSON.parse(plaintext) as EvidenceNodeSpoolJob;
        if (job.schema !== 'vetios.evidence-node.spool-job.v1') {
            throw new Error('Evidence Node spool job schema is invalid.');
        }
        return job;
    }
}

export function decodeSpoolKey(value: string): Buffer {
    const normalized = value.trim();
    const key = /^[a-f0-9]{64}$/i.test(normalized)
        ? Buffer.from(normalized, 'hex')
        : Buffer.from(normalized, 'base64');
    if (key.length !== 32) throw new Error('Evidence Node spool key must decode to 32 bytes.');
    return key;
}

function buildSpoolJob(sourceKey: string, source: EvidenceNodeRawSource, sourceDigest: string): EvidenceNodeSpoolJob {
    const now = new Date().toISOString();
    return {
        schema: 'vetios.evidence-node.spool-job.v1',
        id: randomUUID(),
        source_key: sourceKey,
        source_digest: sourceDigest,
        source,
        attempt_count: 0,
        available_at: now,
        created_at: now,
        updated_at: now,
        last_error: null,
    };
}

function hashSource(source: EvidenceNodeRawSource, dedupeNamespace: string): string {
    return sha256(stableStringify({
        dedupe_namespace: dedupeNamespace,
        format: source.format,
        content: source.content,
    }));
}

async function atomicWrite(path: string, content: string): Promise<void> {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function listFiles(path: string, suffix: string): Promise<string[]> {
    return (await readdir(path)).filter((name) => name.endsWith(suffix));
}

function sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
