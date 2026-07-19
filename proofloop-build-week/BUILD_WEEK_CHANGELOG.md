# Build Week eligibility and changelog

## Submission window

- OpenAI Build Week submission period began: **2026-07-13 09:00 Pacific**.
- Last VetIOS commit before that boundary: `941e72867a5dbb0d3f3670a1e87de5f3413ff66f` at **2026-07-13 06:45:20 Pacific**.
- ProofLoop directory before the boundary: **did not exist**.

## Pre-existing VetIOS baseline

VetIOS already contained a broad veterinary platform, inference and outcome APIs, adversarial tests, CIRE reliability components, Supabase persistence, and a Next.js interface. None of that pre-existing work is presented as new ProofLoop Build Week work.

Several unrelated security and infrastructure commits were added to `main` after the submission window opened. They are not part of this ProofLoop entry and should not be evaluated as Build Week work.

## New ProofLoop work

### 2026-07-18 — verified vertical slice

- Created the isolated `proofloop-build-week/` workspace package.
- Added a synthetic, de-identified closed-case fixture.
- Added canonical JSON and SHA-256 evidence manifests.
- Added Ed25519 Outcome Receipt signing and verification.
- Added a strict, versioned eval specification bound to the receipt digest.
- Added a deterministic release gate with explicit checks.
- Added intentionally unsafe legacy and corrected candidate adapters.
- Added a GPT-5.6 Responses API adapter using strict Structured Outputs.
- Added a pinned official Codex SDK adapter with explicit repository targeting.
- Added six automated verification tests and an offline demo.
- Added judge instructions and an explicit claims/limitations ledger.

## Reproducing the eligible diff

ProofLoop's clean branch base is `a51f660` (`main` before this Build Week branch). Review the eligible, judge-facing change set from that base and the paths below; this intentionally excludes unrelated post-window work elsewhere in VetIOS.

From the repository root on `codex/proofloop-build-week`:

```bash
git diff a51f660...HEAD -- \
  proofloop-build-week \
  apps/web/app/proofloop \
  apps/web/components/proofloop/ProofLoopDemo.tsx \
  apps/web/lib/seo/publicPages.ts \
  apps/web/lib/site.ts \
  apps/web/app/opengraph-image.tsx \
  vercel.json package.json pnpm-workspace.yaml pnpm-lock.yaml README.md
```

The Build Week evaluation should focus on those paths only. The deployed `/proofloop` page is a recorded-fixture walkthrough of the isolated Build Week slice.
