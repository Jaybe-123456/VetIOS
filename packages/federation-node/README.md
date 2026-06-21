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
- Build task-specific masked update commitment payloads.
- Call the VetIOS federation node API for heartbeat, task pull, and update
  submission.

This package is intentionally not a trainer yet. It is the node contract that a
local trainer will sit behind.
