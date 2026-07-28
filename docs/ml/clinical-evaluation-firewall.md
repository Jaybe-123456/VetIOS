# Clinical Evaluation Firewall

The clinical evaluation firewall separates iterative optimization from clinical
release evidence. Its default policy is fail-closed.

## Dataset Roles

- `search`: iterative synthetic fixtures used to explore implementation choices.
- `development`: hidden synthetic fixtures used to compare deterministic candidates.
- `validation`: optimizer-blind, deidentified, authorized, reviewed clinical evidence.
- `sealed_holdout`: a single-use, optimizer-blind release cohort with outcome-confirmed
  labels and a sealed manifest.

Weco is approved only for `pure_function_latency` over synthetic search or
development data. It may receive only aggregate `latency_ms` or
`throughput_rps` packets. Real clinical rows, prompts, labels, accuracy metrics,
validation records, and holdout records are blocked.

## Leakage Controls

Every dataset has a canonical SHA-256 manifest seal and a declared content hash.
Before evaluation, the firewall checks:

- manifest integrity and row counts;
- sensitive identifiers, credentials, and secret-shaped values;
- exact case fingerprints across splits;
- near-duplicate clinical text across splits;
- feature and target path overlap;
- target-shaped fields in model inputs;
- a bounded duplicate-comparison budget that fails closed when exhausted.

The firewall returns aggregate counts and blocker identifiers. It does not return
the sensitive values it detects.

## Release Gate

A candidate is not eligible for clinical claims or model promotion unless:

- evaluation is optimizer-blind;
- a validation split and exactly one sealed holdout are present;
- release evidence is real, deidentified, authorized, provenance-complete,
  clinician-reviewed, and outcome-confirmed;
- the holdout has not been exposed or reused;
- cohort, site, and subgroup minimums are met;
- critical recall, false reassurance, contradiction detection, abstention,
  calibration, subgroup safety, and non-regression gates all pass.

Synthetic evidence remains benchmark-only even when every benchmark test passes.

## Operational Boundary

The implementation is
`apps/web/lib/evaluation/clinicalEvaluationFirewall.ts`. Any future optimizer
launcher must obtain an `allowed` decision before starting and use
`createOptimizerMetricPacket()` for optimizer feedback.

The SHA-256 manifest seal detects accidental or post-seal modification. It does
not establish signer identity. Production release manifests still require an
external signing key, immutable storage, access logging, and independent clinical
review.
