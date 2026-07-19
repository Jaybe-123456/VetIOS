# ProofLoop verification ledger

Verified on **2026-07-18** in the local Build Week branch.

## Automated verification

Command:

```bash
node --test dist/tests/proofloop.test.js
```

Result: **6 passed, 0 failed**.

Coverage:

1. A valid Ed25519 Outcome Receipt verifies.
2. Editing the signed inference invalidates its digest and signature.
3. An eval spec verifies only against its source receipt.
4. The legacy candidate is blocked and the corrected candidate passes.
5. The GPT-5.6 request uses the Responses API Structured Outputs contract.
6. A mocked Responses result is schema-validated and preserves the response ID.
7. The Codex prompt is bound to both integrity digests and forbids weakening existing tests.

The list has seven assertions grouped into six Node test cases.

## Offline demo

Command:

```bash
node dist/src/demo.js
```

Observed result:

```text
Receipt integrity        VERIFIED (SHA-256 + Ed25519)
Eval source              RECORDED FIXTURE (offline, explicitly labeled)
Eval integrity           VERIFIED
Legacy candidate         BLOCK
Corrected candidate      PASS
```

## Hosted walkthrough

The public `/proofloop` interface is a recorded-fixture walkthrough of the same synthetic closed case. It makes the Outcome Receipt, strict eval expectations, repository-aware regression test, and legacy `BLOCK` versus corrected `PASS` decision inspectable in a browser. It does not represent a live GPT-5.6 or Codex call; those adapters, their strict contracts, and their safety constraints remain reviewable in source.

## Claims not yet verified

- No live GPT-5.6 API request was executed during this local verification because no API key was provided to the build process.
- No Codex SDK mutation run was executed against an external target repository; prompt generation and safety constraints were verified.
- No real clinical data, clinical accuracy, production deployment, or external veterinary validation is claimed.
- The hosted walkthrough is not evidence of live GPT-5.6 or Codex execution; it is explicitly labeled as a recorded fixture.

These limitations must remain visible until corresponding evidence exists.
