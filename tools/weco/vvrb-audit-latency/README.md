# Weco VVRB Audit Latency Pilot

This isolated pilot optimizes one deterministic aggregation kernel over generated
VVRB-shaped synthetic records.

Safety properties:

- no production, patient, clinic, laboratory, or licensed-source records;
- exact output equivalence against an immutable reference implementation;
- public, edge, fixed hidden, and runtime-randomized holdouts;
- source scan blocks imports, process access, dynamic evaluation, network calls,
  filesystem access, and subprocesses;
- aggregate evaluator output only;
- manual review required for every candidate;
- no automatic application to production code.

Baseline:

```powershell
node tools/weco/vvrb-audit-latency/evaluate.mjs
```

Reviewed Weco run:

```powershell
weco run `
  --source tools/weco/vvrb-audit-latency/target.mjs `
  --eval-command "node tools/weco/vvrb-audit-latency/evaluate.mjs" `
  --metric latency_ms `
  --goal minimize `
  --steps 5 `
  --require-review `
  --no-open
```

The optimized candidate is not production code. It must pass the hidden
equivalence harness and the complete VetIOS regression suite before a human
reviewed implementation can be integrated.

Final reviewed pilot result:

- six fixed hidden cases plus randomized hidden fixtures passed exact output
  equivalence;
- three alternating paired comparisons improved latency by 22.399%, 7.641%,
  and 11.627% (median 11.627%);
- unsafe empty-value, zero-variance Pearson, and malformed-differential
  candidates were rejected during review;
- `.runs/` contains local Weco logs and snapshots and is excluded from Git.

Weco remains blocked from model accuracy, prompts, real clinical rows,
validation cohorts, and sealed holdouts by the
[clinical evaluation firewall](../../../docs/ml/clinical-evaluation-firewall.md).
