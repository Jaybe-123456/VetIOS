# @vetios/cire-engine

Reference implementation for the VetIOS Clinical Inference Reliability Engine (CIRE) open specification.

This package implements:

- `computePhiHat` for entropy-normalized differential richness.
- `computeInputMHat` for missingness, contradiction, and out-of-distribution input impairment.
- `computeCPS` for collapse proximity scoring.
- `classifySafetyState` for `HIGH`, `REVIEW`, `CAUTION`, and `SUPPRESSED` reliability bands.
- `updateRollingState` and `PhiSentinel` for runtime reliability monitoring.
- `validateCireConformanceReport` and `cire-conformance` for third-party compatibility checks.

## Conformance

Build the package and run the bundled conformance fixture:

```bash
pnpm --filter @vetios/cire-engine test
```

Validate another implementation report:

```bash
pnpm --filter @vetios/cire-engine build
node packages/cire-engine/dist/conformance-cli.js path/to/report.json --strict
```

The report can include:

- `differential_cases` for `phi_hat` checks.
- `input_cases` for `input_m_hat` checks.
- `cps_cases` for CPS and safety-state checks.
- `output_vector_cases` for probability vector extraction checks.

Passing the bundled fixture proves numerical compatibility with the CIRE v1 reference implementation. It does not prove clinical effectiveness; outcome-linked validation must still be performed with real, non-synthetic clinical outcomes.
