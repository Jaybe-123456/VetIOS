import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexRegressionPrompt } from '../src/codex-runner.js';
import { correctedCandidate, legacyCandidate } from '../src/candidates.js';
import { finalizeEvalSpec, parseEvalDraft, verifyEvalSpec } from '../src/eval-schema.js';
import { parseClosedCase, readJsonFixture } from '../src/fixtures.js';
import { runReleaseGate } from '../src/gate.js';
import { buildGpt56ResponsesRequest, generateEvalWithGpt56 } from '../src/gpt56-generator.js';
import { generateReceiptSigningKeys } from '../src/integrity.js';
import { createOutcomeReceipt, verifyOutcomeReceipt } from '../src/outcome-receipt.js';
import type { EvalDraft, OutcomeReceipt } from '../src/types.js';

const fixedReceiptTime = '2026-07-18T12:00:00.000Z';

async function buildFixtureArtifacts() {
    const closedCase = parseClosedCase(await readJsonFixture('synthetic-closed-case.json'));
    const receipt = createOutcomeReceipt(closedCase, generateReceiptSigningKeys(), fixedReceiptTime);
    const draft = parseEvalDraft(await readJsonFixture('recorded-eval-draft.json'));
    const spec = finalizeEvalSpec(draft, receipt, {
        mode: 'recorded_fixture',
        model: 'gpt-5.6',
        response_id: null,
    });
    return { closedCase, receipt, draft, spec };
}

test('Outcome Receipt verifies and detects post-signature tampering', async () => {
    const { receipt } = await buildFixtureArtifacts();
    assert.equal(verifyOutcomeReceipt(receipt).valid, true);

    const tampered = structuredClone(receipt) as OutcomeReceipt;
    tampered.inference.output.confidence = 0.12;
    const verification = verifyOutcomeReceipt(tampered);
    assert.equal(verification.valid, false);
    assert.equal(verification.content_digest_valid, false);
    assert.equal(verification.signature_valid, false);
});

test('eval spec is bound to the signed receipt', async () => {
    const { receipt, spec } = await buildFixtureArtifacts();
    assert.equal(verifyEvalSpec(spec, receipt), true);
    const altered = { ...spec, source_receipt_sha256: '0'.repeat(64) };
    assert.equal(verifyEvalSpec(altered, receipt), false);
});

test('verified outcome blocks legacy candidate and passes corrected candidate', async () => {
    const { spec } = await buildFixtureArtifacts();
    const legacy = await runReleaseGate(spec, 'legacy-candidate', legacyCandidate);
    const corrected = await runReleaseGate(spec, 'corrected-candidate', correctedCandidate);
    assert.equal(legacy.decision, 'BLOCK');
    assert.equal(corrected.decision, 'PASS');
    assert.ok(legacy.case_results[0]?.checks.some((check) => !check.passed));
    assert.ok(corrected.case_results[0]?.checks.every((check) => check.passed));
});

test('GPT-5.6 request uses Responses API structured outputs contract', async () => {
    const { receipt } = await buildFixtureArtifacts();
    const request = buildGpt56ResponsesRequest(receipt);
    assert.equal(request.model, 'gpt-5.6');
    assert.equal(request.store, false);
    const text = request.text as { format: { type: string; strict: boolean; schema: unknown } };
    assert.equal(text.format.type, 'json_schema');
    assert.equal(text.format.strict, true);
    assert.ok(text.format.schema);
});

test('GPT-5.6 adapter validates a mocked Responses API result and records provenance', async () => {
    const { receipt, draft } = await buildFixtureArtifacts();
    let requestedUrl = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({
            id: 'resp_proofloop_test',
            output: [{ content: [{ type: 'output_text', text: JSON.stringify(draft satisfies EvalDraft) }] }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const spec = await generateEvalWithGpt56({
        receipt,
        apiKey: 'test-key-never-sent',
        fetchImpl,
    });
    assert.equal(requestedUrl, 'https://api.openai.com/v1/responses');
    assert.equal(spec.generated_by.mode, 'gpt-5.6');
    assert.equal(spec.generated_by.response_id, 'resp_proofloop_test');
    assert.equal(verifyEvalSpec(spec, receipt), true);
});

test('Codex prompt is digest-bound and forbids weakening existing tests', async () => {
    const { spec } = await buildFixtureArtifacts();
    const prompt = buildCodexRegressionPrompt(spec);
    assert.match(prompt, new RegExp(spec.spec_sha256));
    assert.match(prompt, new RegExp(spec.source_receipt_sha256));
    assert.match(prompt, /Do not weaken, skip, delete, or rewrite existing tests/u);
});
