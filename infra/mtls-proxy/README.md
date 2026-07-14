# VetIOS mTLS Edge Proxy

Production mTLS for partner OAuth clients requires a trusted TLS termination layer before the
Next.js/Vercel app. The app now fails closed for mTLS-bound OAuth clients unless both are present:

- `x-vetios-mtls-proxy-secret` matches `VETIOS_MTLS_PROXY_SECRET` or `VETIOS_TRUSTED_MTLS_PROXY_SECRET`
- `x-vetios-client-cert-sha256` matches one of the OAuth client's pinned certificate SHA-256 thumbprints

This folder provides a deployable Envoy proxy that:

1. Requires and verifies partner client certificates.
2. Removes spoofable inbound trust headers.
3. Forwards Envoy's verified downstream client certificate SHA-256 fingerprint.
4. Adds the shared mTLS proxy secret header consumed by VetIOS.

## Required Runtime Values

Set these in the proxy runtime:

```env
VETIOS_MTLS_PROXY_SECRET=<same value configured in Vercel>
VETIOS_UPSTREAM_HOST=www.vetios.tech
VETIOS_UPSTREAM_PORT=443
VETIOS_MTLS_PROXY_CERT=/etc/envoy/certs/server.crt
VETIOS_MTLS_PROXY_KEY=/etc/envoy/certs/server.key
VETIOS_MTLS_CLIENT_CA=/etc/envoy/certs/client-ca.crt
```

Set the same secret in Vercel:

```env
VETIOS_MTLS_PROXY_SECRET=<same random 32-byte hex value>
```

## DNS Shape

Use a dedicated partner endpoint:

```text
mtls.vetios.tech -> your Envoy proxy load balancer / VM / container endpoint
```

Partner OAuth clients should use:

```text
https://mtls.vetios.tech/api/oauth/token
```

The normal app remains:

```text
https://www.vetios.tech
```

## Generate A Local Test CA And Server Certs

For local testing only:

```powershell
cd C:\VetIOS\infra\mtls-proxy
.\scripts\generate-local-certs.ps1
```

This writes demo certs to `infra/mtls-proxy/certs/`. Do not use those certs in production.

## Local Smoke Test

```powershell
cd C:\VetIOS\infra\mtls-proxy
$env:VETIOS_MTLS_PROXY_SECRET="<generated-secret>"
docker compose up --build
```

Then call with the generated partner cert:

```powershell
curl.exe --cert .\certs\partner-client.crt --key .\certs\partner-client.key `
  https://localhost:9443/api/health -k
```

Call without a client cert should fail at TLS before reaching VetIOS.

## Production Deployment Notes

- Use a real certificate for `mtls.vetios.tech`.
- Use a private partner/client CA file as `VETIOS_MTLS_CLIENT_CA`.
- Keep `VETIOS_MTLS_PROXY_SECRET` only in the proxy and Vercel secrets.
- Rotate the proxy secret if it is ever exposed.
- Configure OAuth clients in VetIOS with `mtls_required=true` and the partner certificate SHA-256 thumbprint.

Partner cert thumbprint example:

```powershell
openssl x509 -in partner-client.crt -noout -fingerprint -sha256
```

Normalize by removing colons and lowercasing before storing in VetIOS.
