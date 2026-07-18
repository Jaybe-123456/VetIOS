import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildCodexRegressionPrompt, runCodexRegressionTask } from './codex-runner.js';
import { finalizeEvalSpec, parseEvalDraft } from './eval-schema.js';
import { parseClosedCase, readJsonFixture } from './fixtures.js';
import { generateReceiptSigningKeys } from './integrity.js';
import { createOutcomeReceipt } from './outcome-receipt.js';

function repoArgument(): string | undefined {
    const entry = process.argv.find((value) => value.startsWith('--repo='));
    return entry?.slice('--repo='.length);
}

async function buildRecordedSpec() {
    const closedCase = parseClosedCase(await readJsonFixture('synthetic-closed-case.json'));
    const receipt = createOutcomeReceipt(closedCase, generateReceiptSigningKeys(), '2026-07-18T12:00:00.000Z');
    const draft = parseEvalDraft(await readJsonFixture('recorded-eval-draft.json'));
    return finalizeEvalSpec(draft, receipt, {
        mode: 'recorded_fixture',
        model: 'gpt-5.6',
        response_id: null,
    });
}

async function main(): Promise<void> {
    const spec = await buildRecordedSpec();
    if (process.argv.includes('--prompt-only')) {
        console.log(buildCodexRegressionPrompt(spec));
        return;
    }

    const requestedRepo = repoArgument();
    if (!requestedRepo) {
        throw new Error('Codex execution requires an explicit --repo=<path>. Use codex:prompt to inspect the task first.');
    }
    const targetRepository = resolve(requestedRepo);
    await access(resolve(targetRepository, '.git'));
    const result = await runCodexRegressionTask({ targetRepository, spec });
    console.log(result.finalResponse);
    console.log(`\nCodex thread: ${result.threadId ?? 'not reported'}`);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
