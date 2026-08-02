# VetIOS Evidence Node

Contract-bound laboratory adapter runtime for the VetIOS AMR Outcome Network.

The node runs inside a laboratory or clinic trust boundary. It collects vendor
payloads, maps them into the canonical VetIOS culture/AST contract, and sends
only de-identified packets plus cryptographic provenance through mTLS-bound
OAuth. The delivery copy stays in an AES-256-GCM encrypted local spool.
Patient, accession, and isolate references are pseudonymized locally with
HMAC-SHA-256 under a dedicated, versioned reference key before any packet
leaves the source trust boundary. That key is separate from spool encryption so
spool-key rotation cannot silently break episode linkage.

## Operating Capabilities

- RFC 4180 CSV and VetIOS JSON normalization.
- HL7 v2 ORU/R01 parsing for patient, accession, specimen, organism, and AST observations.
- FHIR R4 `DiagnosticReport`, `Specimen`, `Observation`, and animal `Patient` parsing.
- File-drop collection with a laboratory-controlled source archive.
- Signed webhook intake with timestamp replay protection and a 10 MB payload cap.
- HTTPS API polling with bounded responses and secret-manager-backed credentials.
- OpenSSH SFTP collection using key authentication and pinned `known_hosts`.
- Deterministic deduplication, exponential retry, stale-lease recovery, dead-letter, and replay.
- Record-isolated batch normalization: valid records continue while rejected
  record indexes and blocker codes are retained locally without raw values.
- mTLS OAuth client-credentials exchange and contract-bound ingestion receipts.
- Automatic mTLS heartbeat renewal; delivery fails closed if current connector
  proof cannot be issued, and each packet is rebound to the latest probe ID.

This package does not contain CLSI breakpoint tables and does not reinterpret
laboratory susceptibility results. It preserves the source interpretation,
method, standard, standard version, and breakpoint basis.

## Initialize

Build the package, then create a node directory using IDs issued by the VetIOS
control plane:

```bash
vetios-evidence-node init \
  --out-dir .vetios-evidence-node \
  --node-id reference-lab-001 \
  --contract-id 11111111-1111-4111-8111-111111111111 \
  --site-id 22222222-2222-4222-8222-222222222222 \
  --lab-site-id 33333333-3333-4333-8333-333333333333
```

Initialization writes a private config, versioned mapping, independent random
256-bit spool and reference keys, file-drop directories, and service runner. It
does not write OAuth secrets, certificate passphrases, or vendor credentials.
Production deployments should inject both keys from a host secret manager and
retain the versioned `reference_key_id` for pseudonym continuity.

## Activate

1. Review the generated mapping with the laboratory and hash the approved file.
2. Draft, approve, and activate the matching adapter contract through
   `POST /api/amr/evidence-node`.
   Keep write-back disabled unless the signed agreement and vendor API permit it;
   when permitted, bind the exact destination channel in the contract.
3. Bind the contract to an active OAuth client with `amr:ingest`, mTLS required,
   and the issued certificate thumbprint.
4. Place the issued PFX or PEM keypair in the node's `certs` directory. Leave
   `ca_path` unset for a publicly trusted server certificate; use it only for
   the private CA that issued the control-plane server certificate, never the
   CA that issued the client certificate.
5. Inject secrets with the host secret manager:

```bash
VETIOS_EVIDENCE_NODE_CLIENT_SECRET=...
VETIOS_EVIDENCE_NODE_PFX_PASSPHRASE=...
LAB_WEBHOOK_HMAC_SECRET=...
LAB_API_TOKEN=...
```

6. Run local and remote readiness checks:

```bash
vetios-evidence-node doctor --config .vetios-evidence-node/reference-lab-001.config.json
vetios-evidence-node doctor --config .vetios-evidence-node/reference-lab-001.config.json --remote
```

7. Run one cycle, inspect the control-plane receipt, then start service mode:

```bash
vetios-evidence-node once --config .vetios-evidence-node/reference-lab-001.config.json
vetios-evidence-node service --config .vetios-evidence-node/reference-lab-001.config.json
```

## Dead-Letter Replay

Correct the source mapping or contract blocker first, then replay bounded jobs:

```bash
vetios-evidence-node replay-dead-letter \
  --config .vetios-evidence-node/reference-lab-001.config.json \
  --limit 25
```

Delivery receipts contain remote event IDs and hashes only. They never contain
the original source body.

The AES-256-GCM spool is encrypted. The configured file-drop `archive_path`
retains the original source file inside the laboratory trust boundary and is
not encrypted by this process. Place it on an encrypted, access-controlled
volume and apply the laboratory's approved retention policy. VetIOS never sends
that archive to the control plane.

## Transport Security

- SFTP requires `BatchMode=yes`, `IdentitiesOnly=yes`, strict host-key checking,
  a private key, and a pinned known-hosts file.
- Webhooks require `HMAC-SHA256(timestamp + "." + body)` and reject stale timestamps.
- API polling requires HTTPS and refuses redirects.
- VetIOS delivery requires HTTPS plus a PFX or certificate/private-key pair.
- Source bodies are capped at 10 MB before normalization.

## Honest Boundary

Synthetic fixtures prove parser, privacy, dedupe, spool, and replay behavior.
Production operationality additionally requires a signed laboratory agreement,
approved mapping, real vendor endpoint, production certificate, current
connector probe, and live reconciliation/outcome records. InFARM, NAHLN, and
KABS projections are compatibility artifacts until the receiving authority
returns an acceptance receipt.
