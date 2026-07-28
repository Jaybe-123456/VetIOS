# Weco Pilot Review Contract

Optimize only `target.mjs` for lower `latency_ms`.

Hard constraints:

- Preserve exact JavaScript output for every input record array.
- Do not edit, replace, import, read, or inspect the evaluator, fixtures, reference implementation, logs, environment, clock, command line, or filesystem.
- Do not add imports, `require`, dynamic code execution, subprocesses, network access, filesystem access, persistent state, fixture-specific branches, hard-coded benchmark answers, or result caching keyed to known fixtures.
- Keep `computeVvrbAuditSignals(records)` deterministic and side-effect free.
- Preserve the exported function name and return shape.
- Handle empty arrays, malformed records, missing nested fields, duplicate values, and arbitrary unseen synthetic fixtures.
- Preserve fallback from a blank/whitespace `evaluation_targets.top1_differential` to `differential_diagnoses[0]`.
- Preserve the existing two-pass Pearson calculation and its `0` result for zero-variance inputs; algebraically equivalent formulas can still change floating-point rounding.
- Optimize the computation itself. A lower metric that fails exact equivalence is invalid.

Prefer small, readable changes with a clear runtime rationale. Every proposal requires human review before evaluation.
