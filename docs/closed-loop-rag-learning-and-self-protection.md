# VetIOS Closed-Loop RAG Learning and Self-Protection

This document confirms how the veterinary and medicine source corpus forms a closed-loop learning system for VetIOS clinical reasoning and diagnostic intelligence, and how the platform defends itself against abuse and clone-style frontends.

## Closed-Loop Confirmation

The corpus state reported on May 10, 2026 is ready for evidence-grounded reasoning:

- Sources: `23`
- Documents: `41`
- Indexed documents: `41`
- Retrieval chunks: `126`
- High-trust or high-authority sources: `20`
- Stale documents: `0`

That means VetIOS can use the indexed veterinary and medicine datasets as a clinical reasoning infrastructure layer and as input to diagnostic intelligence pipelines. The loop is not autonomous clinical self-training. It is evidence-grounded and human-gated.

## Learning Loop

VetIOS closes the evidence loop through these stages:

- Source registration: veterinary, medicine, regulatory, One Health, literature, and BioVenic discovery sources are registered with authority tier, species scope, domain scope, URL, attribution, and refresh policy.
- Evidence indexing: documents become hashed, provenance-preserving chunks in `rag_documents` and `rag_chunks`.
- Retrieval: clinical questions retrieve citation-first evidence by vector, lexical, or hybrid strategy.
- Reasoning: retrieved citations feed VetIOS clinical reasoning, diagnostic differential support, causal memory, counterfactual review, and One Health surveillance context.
- Feedback: no-result queries, low citation coverage, diagnostic misses, clinician feedback, and outcome events become active-learning candidates.
- Review: candidates require clinician or steward review before changing source trust, prompts, datasets, or model behavior.
- Promotion: no model or clinical behavior promotion happens without citations, counterfactual review, audit trace, and human approval.

The result is a closed loop for evidence improvement and diagnostic intelligence, with a deliberate clinical safety gate before any learning signal can affect production behavior.

## Self-Protection Mechanism

The platform now has a layered protection model:

- Origin binding: approved VetIOS domains and configured origins are allowed; unknown browser origins are reported or blocked in strict mode.
- Host mismatch detection: requests served through unexpected hosts are flagged as clone-risk signals.
- Client attestation: short-lived HMAC tokens bind a browser request to origin, path, method, timestamp, and nonce.
- Machine credentials: server-to-server clinical APIs still require scoped service-account or connector credentials.
- Rate and body-size protection: handlers inherit request volume and payload limits from `apiGuard`.
- Output fingerprinting: inference/intelligence outputs can carry traceable VetIOS fingerprints.
- Security event ledger: clone suspicion, blocks, risk signals, and actions are stored in `vetios_security_events`.
- RAG source safety: private/local URLs are rejected and unverified commercial sources cannot silently become high-authority clinical evidence.

The mechanism is clone-resistant, not clone-proof. A copied frontend can exist, but it cannot safely impersonate VetIOS against protected APIs when origin enforcement and client attestation are enabled, and copied outputs remain traceable through fingerprints and audit logs.

## Operating Modes

Default mode should be report-only while production traffic is observed:

```dotenv
VETIOS_PROTECTION_REPORT_ONLY=true
VETIOS_STRICT_ORIGIN_GUARD=false
VETIOS_STRICT_CLIENT_ATTESTATION=false
```

After approved domains and client attestation are deployed, strict mode can be enabled:

```dotenv
VETIOS_ALLOWED_ORIGINS=https://www.vetios.tech,https://vetios.tech,https://app.vetios.tech
VETIOS_CLIENT_ATTESTATION_SECRET=replace-with-32-char-random-hex
VETIOS_PROTECTION_REPORT_ONLY=false
VETIOS_STRICT_ORIGIN_GUARD=true
VETIOS_STRICT_CLIENT_ATTESTATION=true
```

The `GET /api/rag/closed-loop` endpoint returns the current corpus closed-loop status, self-protection posture, and per-request risk assessment for authenticated `rag:read` callers.

## Security Basis

The controls align with OWASP API Security Top 10 principles for broken authentication, broken authorization, unrestricted resource consumption, and unsafe API exposure; OWASP ASVS verification themes for authentication, access control, validation, logging, and configuration; and NIST SP 800-218 secure software development practices for protecting, verifying, and responding across the software lifecycle.
