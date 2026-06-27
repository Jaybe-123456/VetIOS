# VetIOS Federation Node SDK

Clinic and lab-side SDK for outcome-confirmed federated learning.

The node keeps raw clinical records local. It emits only eligibility summaries,
record digests, public task summaries, and secure-aggregation commitments.

Design basis:

- Federated learning keeps training data decentralized while coordinating model
  improvement across participants.
- Secure aggregation protects participant updates so the coordinator can reason
  over aggregate commitments rather than raw local deltas.
- AMR surveillance value comes from standardized clinical, epidemiological,
  laboratory, and population context, not isolated model activity.

Primary package responsibilities:

- Normalize local veterinary records into a de-identified learning view.
- Score whether local records are eligible for federation.
- Produce site-level eligibility snapshots for VetIOS federation activation.
- Train deterministic local task deltas over eligible outcome-confirmed records.
- Materialize pairwise secure-aggregation masks over the local delta.
- Build task-specific masked model-delta commitment payloads without sending
  raw records, raw vectors, or raw model deltas.
- Call the VetIOS federation node API for heartbeat, task pull, and update
  submission.

The local runner is intentionally conservative: raw records and raw model
deltas stay on the clinic/lab node. VetIOS receives eligibility summaries,
record digests, aggregate task metrics, pairwise mask commitments, unmask-share
commitments, and masked delta commitments only.

Minimal local execution flow:

```ts
import {
  VetiosFederationNodeAgent,
  VetiosFederationNodeClient,
} from '@vetios/federation-node';

const client = new VetiosFederationNodeClient({
  baseUrl: process.env.VETIOS_BASE_URL!,
  machineToken: process.env.VETIOS_MACHINE_TOKEN!,
  federationKey: 'one_health_amr',
  nodeRef: 'clinic-a-node',
  partnerRef: 'clinic-a',
});

const agent = new VetiosFederationNodeAgent({
  client,
  records: localOutcomeConfirmedRecords,
  secret: process.env.VETIOS_NODE_SECRET!,
  tenantId: process.env.VETIOS_TENANT_ID!,
  federationKey: 'one_health_amr',
  partnerRef: 'clinic-a',
  outcomeEligibilitySnapshotId: 'snapshot-id-from-vetios',
});

const { commitment } = agent.trainTask(taskFromVetios);
await client.submitUpdate(taskFromVetios.federation_round_id, commitment);
```

CLI dry run:

```bash
vetios-federation-node \
  --records records.json \
  --task task.json \
  --tenant-id tenant-a \
  --secret "$VETIOS_NODE_SECRET" \
  --out commitment.json
```

Dry-run output includes:

- `snapshot_draft`: site-level outcome eligibility evidence.
- `local_delta_summary`: local training summary without raw feature vectors.
- `secure_aggregation_materialization`: local mask commitment evidence.
- `submission_payload`: the sanitized payload sent to VetIOS submit mode.

The `submission_payload` intentionally excludes `local_delta` and the full
local secure-aggregation materialization object.

CLI submit mode:

```bash
vetios-federation-node \
  --records records.json \
  --task task.json \
  --tenant-id tenant-a \
  --base-url "$VETIOS_BASE_URL" \
  --machine-token "$VETIOS_MACHINE_TOKEN" \
  --secret "$VETIOS_NODE_SECRET" \
  --submit
```

Initializer:

```bash
vetios-federation-node init \
  --tenant-id tenant-a \
  --federation-key one_health_amr \
  --node-ref clinic-a-node \
  --partner-ref clinic-a \
  --records exports/pims-cases.csv \
  --out-dir .vetios-node
```

The initializer writes:

- `clinic-a-node.config.json`: service-mode config with local record sources.
- `clinic-a-node.state.json`: local X25519 key state. Keep this on the node.
- `clinic-a-node.enrollment.json`: public enrollment packet for the VetIOS
  federation coordinator.
- `clinic-a-node.run-service.ps1`: Windows runner template.
- `clinic-a-node.service`: systemd unit template.

The initializer does not persist `VETIOS_MACHINE_TOKEN` or
`VETIOS_NODE_SECRET`; inject those with the host secret manager or environment.

Service mode:

```bash
vetios-federation-node service \
  --records records.json \
  --base-url "$VETIOS_BASE_URL" \
  --machine-token "$VETIOS_MACHINE_TOKEN" \
  --tenant-id tenant-a \
  --federation-key one_health_amr \
  --node-ref clinic-a-node \
  --partner-ref clinic-a \
  --secret "$VETIOS_NODE_SECRET" \
  --state .vetios-node/clinic-a-node.state.json \
  --log .vetios-node/clinic-a-node.audit.jsonl
```

Service mode continuously:

- Loads local outcome-confirmed records from the configured JSON file.
- Creates or reuses a local X25519 node keypair in the state file.
- Heartbeats with node public-key metadata and record eligibility evidence.
- Pulls the current issued task for the node.
- Injects the local private key into the task runtime config without sending it
  to VetIOS.
- Trains locally, submits the masked update, and appends an audit JSONL event.

Use `--once` for a single service iteration, or `--max-iterations <n>` for a
bounded smoke test.

Config-file equivalent:

```json
{
  "record_sources": [
    {
      "kind": "pims_csv",
      "path": "exports/pims-cases.csv",
      "source_system": "clinic-pims",
      "defaults": {
        "consent_status": "granted",
        "provenance_status": "source_attested"
      }
    },
    {
      "kind": "lab_csv",
      "path": "exports/lab-results.csv",
      "source_system": "reference-lab",
      "columns": {
        "local_record_id": "case_id",
        "test_name": "panel",
        "result": "result_value",
        "organism": "organism_name",
        "antimicrobial": "drug_name",
        "interpretation": "sir"
      },
      "defaults": {
        "consent_status": "granted",
        "provenance_status": "externally_verified"
      }
    },
    {
      "kind": "pacs_json",
      "path": "exports/imaging-reports.json",
      "source_system": "pacs"
    }
  ],
  "state_path": ".vetios-node/clinic-a-node.state.json",
  "log_path": ".vetios-node/clinic-a-node.audit.jsonl",
  "poll_ms": 30000,
  "retry_attempts": 3,
  "retry_base_ms": 1000,
  "base_url": "https://vetios.tech",
  "tenant_id": "tenant-a",
  "federation_key": "one_health_amr",
  "node_ref": "clinic-a-node",
  "partner_ref": "clinic-a"
}
```

Supported service `record_sources`:

- `vetios_json`: array of `LocalClinicalLearningRecord`-shaped objects.
- `vetios_jsonl`: newline-delimited local record objects.
- `pims_csv`: appointment/history/case export rows.
- `lab_csv`: lab/culture/AST export rows, automatically marked lab/culture
  contextual.
- `pacs_json`: de-identified imaging/report metadata. Store report hashes and
  summaries, not raw image files or full reports.

The service state file contains local private key material and must stay on the
clinic or lab machine. The audit log intentionally stores only operational
digests, task identifiers, commitment hashes, and submission status.
