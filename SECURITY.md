# VetIOS Security Policy

VetIOS is clinical infrastructure. Treat every tenant identifier, control-plane API key,
 partner credential, service-role key, webhook secret, and session token as sensitive.

## Supported Surface

Security reports should cover the deployed control plane, developer APIs, Supabase
database policies/functions, authentication flows, model-governance workflows, and
clinical AI safety gates.

## Reporting a Vulnerability

Do not open a public issue for exploitable security findings.

Report privately to the repository owner with:

- affected route, page, workflow, or database object
- reproduction steps and expected impact
- whether any tenant data, credentials, or clinical records may have been exposed
- suggested severity: critical, high, medium, or low

The project owner should acknowledge critical and high severity reports within 48 hours
and publish a remediation note after the issue is fixed.

## Credential Handling

- Raw JWT access tokens, refresh tokens, Supabase service-role keys, OpenAI/provider
  keys, Stripe secrets, and VetIOS API keys must never be committed or displayed after
  initial issuance.
- Any key pasted into chat, logs, tickets, screenshots, pull requests, or commits is
  considered compromised and must be revoked.
- Control-plane API keys must be stored as hashes server-side and displayed only once
  at creation time.
- Production must never run with `VETIOS_DEV_BYPASS=true` or
  `NEXT_PUBLIC_VETIOS_DEV_BYPASS=true`.
- Partner and control-plane keys should be rotated after staff changes, suspected
  exposure, scope changes, or at least every 90 days.

## Production Gates

The repository should fail CI or deployment when:

- production builds enable dev bypass
- API routes are added without an explicit auth/protection classification
- dependency audit reports unresolved production vulnerabilities
- secret scanning finds committed credentials
- CodeQL reports exploitable application-security issues

## Clinical AI Safety

Clinical outputs must be treated as decision support, not autonomous diagnosis or
treatment. Production releases should preserve:

- clinician review and override paths
- audit trails for inference, outcome, simulation, model promotion, and rollback
- adverse-event or unsafe-recommendation reporting
- model cards with dataset lineage, calibration evidence, known limitations, and
  certification/attestation status
- red-team evaluation for dosage, contraindication, emergency triage, hallucination,
  and species/breed-specific failure modes

## Incident Response

For credential exposure:

1. Revoke the exposed credential immediately.
2. Issue a replacement with the minimum required scopes.
3. Review `last_used_at`, request logs, and control-plane action logs.
4. Rotate adjacent secrets if lateral access is possible.
5. Record the incident and remediation in the security log.

For tenant-data exposure:

1. Disable the affected integration or route if containment requires it.
2. Identify affected tenant IDs, records, and time window.
3. Preserve request IDs, audit rows, and deployment SHAs.
4. Patch and verify the fix with a regression test.
5. Notify affected operators according to contractual and legal requirements.
