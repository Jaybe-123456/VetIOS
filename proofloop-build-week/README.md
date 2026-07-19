# VetIOS ProofLoop — OpenAI Build Week 2026

> Turn a verified outcome into an executable eval and a deterministic AI release gate.

ProofLoop is an isolated, judge-runnable extension to the pre-existing VetIOS platform. Its first vertical slice takes one synthetic closed veterinary case through:

```text
Inference → verified outcome → signed Outcome Receipt → eval spec → regression gate
                                                               ├─ legacy candidate: BLOCK
                                                               └─ corrected candidate: PASS
```

## What is verified now

- Outcome evidence is reduced to SHA-256 manifests instead of copying raw payloads into the receipt.
- Outcome Receipts are signed with Ed25519 and fail verification after post-signature modification.
- Eval specifications are content-addressed and bound to the signed receipt digest.
- The release gate is deterministic; a model cannot directly approve a release.
- A committed synthetic fixture blocks the intentionally unsafe legacy candidate and passes the corrected candidate.
- The GPT-5.6 adapter targets the Responses API with strict JSON Schema Structured Outputs.
- The Codex SDK adapter uses an explicit `workspace-write` target and a digest-bound regression prompt.
- Six automated tests cover tampering, provenance, request shape, adapter parsing, and gate behavior.

See [VERIFICATION.md](VERIFICATION.md) for the exact evidence and limitations.

## Judge quickstart

Prerequisites: Node.js 20.x and Corepack.

```bash
corepack enable
corepack prepare pnpm@9.14.4 --activate
pnpm install --filter @vetios/proofloop-build-week...
pnpm proofloop:test
pnpm proofloop:demo
```

Expected gate result:

```text
Receipt integrity        VERIFIED (SHA-256 + Ed25519)
Eval source              RECORDED FIXTURE (offline, explicitly labeled)
Eval integrity           VERIFIED
Legacy candidate         BLOCK
Corrected candidate      PASS
```

The default demo is fully offline and never pretends that a recorded fixture came from a live model call.

## Public replay

The public `/proofloop` page invokes a Node-runtime endpoint that runs the synthetic recorded-fixture chain in the browser session: a fresh Outcome Receipt is signed and verified, the eval is bound to its receipt digest, and the legacy or corrected candidate is evaluated through the deterministic gate. The tamper control mutates the signed receipt and forces `HOLD` before candidate evaluation. No case data or replay result is persisted, and the page does not represent a live GPT-5.6 or Codex execution.

## Why this is a reliability moat

Most AI systems leave real-world corrections as passive feedback. ProofLoop turns one verified correction into a signed, schema-bound, repository-native regression test that prevents the same failure from being promoted again. Its compounding asset is verifiable failure-to-test lineage—not a generic LLM score, an unvalidated accuracy claim, or a proprietary training-data assertion.

## Live GPT-5.6 mode

Set `OPENAI_API_KEY` locally; never commit it. Then run:

```bash
pnpm --filter @vetios/proofloop-build-week demo:live
```

Live mode sends the signed receipt to `POST /v1/responses` with model `gpt-5.6`, `store: false`, and a strict JSON Schema in `text.format`. The returned response ID is preserved in eval provenance.

OpenAI documentation: [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-5.6 model family](https://developers.openai.com/api/docs/models).

## Codex mode

Inspect the exact Codex task without allowing repository writes:

```bash
pnpm --filter @vetios/proofloop-build-week codex:prompt
```

Run it only with an explicit target repository:

```bash
pnpm --filter @vetios/proofloop-build-week codex:run -- --repo=/absolute/path/to/target-repository
```

The adapter uses the official server-side `@openai/codex-sdk`, an explicit working directory, `workspace-write`, and Git-repository validation. It instructs Codex not to weaken existing tests and to report changed files and commands.

OpenAI documentation: [Codex SDK](https://developers.openai.com/codex/sdk/).

## Package map

```text
proofloop-build-week/
├── fixtures/                  Synthetic closed case and recorded eval draft
├── src/
│   ├── outcome-receipt.ts     Evidence manifests, Ed25519 signing, verification
│   ├── eval-schema.ts         Strict eval contract and receipt binding
│   ├── gpt56-generator.ts     Live GPT-5.6 Responses adapter
│   ├── gate.ts                Deterministic BLOCK/PASS checks
│   ├── codex-runner.ts        Repository-aware regression task adapter
│   └── demo.ts                One-command vertical slice
├── tests/proofloop.test.ts    Six verification tests
├── BUILD_WEEK_CHANGELOG.md    Eligibility boundary and dated scope
└── VERIFICATION.md            Claims ledger and test evidence
```

## Data and safety

All committed case data is synthetic. ProofLoop is reliability infrastructure, not a diagnostic product, and does not replace licensed veterinary judgment. A verified result means the software integrity and release-policy checks passed; it does not mean that a clinical claim has been externally validated.

## License

This Build Week extension is covered by the repository's root [MIT License](../LICENSE).
