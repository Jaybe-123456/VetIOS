import { correctedCandidate, legacyCandidate } from './candidates.js';
import { finalizeEvalSpec, parseEvalDraft, verifyEvalSpec } from './eval-schema.js';
import { parseClosedCase, readJsonFixture } from './fixtures.js';
import { runReleaseGate } from './gate.js';
import { generateEvalWithGpt56 } from './gpt56-generator.js';
import { generateReceiptSigningKeys } from './integrity.js';
import { createOutcomeReceipt, verifyOutcomeReceipt } from './outcome-receipt.js';

function line(label: string, value: string): void {
    console.log(`${label.padEnd(24)} ${value}`);
}

async function main(): Promise<void> {
    const liveGpt = process.argv.includes('--live-gpt');
    const closedCase = parseClosedCase(await readJsonFixture('synthetic-closed-case.json'));
    const receipt = createOutcomeReceipt(closedCase, generateReceiptSigningKeys(), '2026-07-18T12:00:00.000Z');
    const receiptVerification = verifyOutcomeReceipt(receipt);
    if (!receiptVerification.valid) {
        throw new Error('Outcome Receipt verification failed.');
    }

    let evalSpec;
    if (liveGpt) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY is required for --live-gpt. The offline demo never simulates a live call.');
        }
        evalSpec = await generateEvalWithGpt56({
            receipt,
            apiKey,
            ...(process.env.OPENAI_BASE_URL ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
        });
    } else {
        const draft = parseEvalDraft(await readJsonFixture('recorded-eval-draft.json'));
        evalSpec = finalizeEvalSpec(draft, receipt, {
            mode: 'recorded_fixture',
            model: 'gpt-5.6',
            response_id: null,
        });
    }
    if (!verifyEvalSpec(evalSpec, receipt)) {
        throw new Error('Eval specification verification failed.');
    }

    const legacy = await runReleaseGate(evalSpec, 'legacy-candidate', legacyCandidate);
    const corrected = await runReleaseGate(evalSpec, 'corrected-candidate', correctedCandidate);

    console.log('\nVetIOS ProofLoop — verified vertical slice\n');
    line('Case', closedCase.case_id);
    line('Receipt', receipt.receipt_id);
    line('Receipt integrity', 'VERIFIED (SHA-256 + Ed25519)');
    line('Eval source', liveGpt ? `LIVE GPT-5.6 (${evalSpec.generated_by.response_id ?? 'no response id'})` : 'RECORDED FIXTURE (offline, explicitly labeled)');
    line('Eval integrity', 'VERIFIED');
    line('Legacy candidate', legacy.decision);
    line('Corrected candidate', corrected.decision);

    if (legacy.decision !== 'BLOCK' || corrected.decision !== 'PASS') {
        process.exitCode = 1;
        throw new Error('Expected legacy candidate to BLOCK and corrected candidate to PASS.');
    }
    console.log('\nReality → Outcome Receipt → Eval → Regression → Release gate\n');
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
