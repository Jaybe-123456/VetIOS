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
- Build task-specific masked model-delta commitment payloads.
- Call the VetIOS federation node API for heartbeat, task pull, and update
  submission.

The local runner is intentionally conservative: raw records and raw model
deltas stay on the clinic/lab node. VetIOS receives eligibility summaries,
record digests, aggregate task metrics, and masked delta commitments only.

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
