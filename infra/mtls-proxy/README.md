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

Envoy strips the alternate trust-header names and overwrites both canonical `x-vetios-*` headers.
Do not add the canonical headers to `request_headers_to_remove`: route-configuration removal runs
after virtual-host mutation and would erase the trusted values. Verify this contract after proxy
changes with `node infra/mtls-proxy/scripts/check-envoy-header-contract.mjs`.

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
  https://localhost:9443/healthz -k
```

Call without a client cert should fail at TLS before reaching VetIOS.

## Production VM Deployment

Use an Ubuntu 24.04 LTS VM with a static public IPv4 address. The production compose profile:

- publishes the mTLS listener on TCP 443;
- binds the health listener to VM loopback on port 8080;
- accepts only `/api/oauth/*` and `/healthz` on the mTLS hostname;
- runs Envoy as UID/GID 101 with all Linux capabilities dropped;
- mounts certificates read-only and reads the proxy secret from a Docker secret;
- restarts automatically and bounds memory, CPU, PIDs, and local logs.

### Automated Google Compute Engine Deployment

The repository includes a guarded GCE deployment script for project `vetios-488515`. It will not
run unless project billing is enabled, a Cloudflare DNS token is available, the public client-CA
bundle exists, and the same proxy secret has already been configured in Vercel Production.

Enable billing first:

```text
https://console.cloud.google.com/billing/linkedaccount?project=vetios-488515
```

Create a Cloudflare API token with `Zone:DNS:Edit` and `Zone:Zone:Read` limited to `vetios.tech`, then
place it in the current PowerShell process:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<token>"
```

Run the deployment from the repository root:

```powershell
.\infra\mtls-proxy\scripts\deploy-gce.ps1 `
  -LetsEncryptEmail "security@vetios.tech" `
  -ClientCaPath "$env:USERPROFILE\Documents\VetIOS-Production-Client-PKI\client-ca.crt" `
  -ProxySecretPath "$env:USERPROFILE\Documents\VetIOS-Production-Client-PKI\proxy-secret" `
  -ConfirmVercelSecretConfigured
```

The script enables Compute Engine, reserves a static regional IP, creates an Ubuntu 24.04 LTS
`e2-small` VM with Shielded VM controls, restricts SSH to the operator's current public IP, creates
the DNS-only Cloudflare record, uploads the proxy package and public CA bundle, issues the public
certificate, and starts the production compose profile.

### 1. Bootstrap the VM

Copy this directory to `/opt/vetios/mtls-proxy`, then run:

```bash
cd /opt/vetios/mtls-proxy
sudo bash ./scripts/bootstrap-ubuntu-vm.sh
sudo cp .env.production.example .env.production
```

Create the shared proxy secret without writing it to shell history:

```bash
sudo sh -c 'umask 077; openssl rand -hex 32 > /opt/vetios/mtls/secrets/proxy-secret'
```

Set the exact same value as `VETIOS_MTLS_PROXY_SECRET` in the VetIOS Vercel Production environment,
then redeploy the web application. Never commit or log this value.

### 2. Create the Partner Client PKI Offline

Generate the private client root and issuing CA on an offline operator workstation, outside this repo:

```powershell
$PassphraseFile = "$env:USERPROFILE\Documents\VetIOS-Production-Client-PKI\ca-passphrase"
$Parent = Split-Path -Parent $PassphraseFile
New-Item -ItemType Directory -Force -Path $Parent | Out-Null
$Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$Bytes = New-Object byte[] 48
$Rng.GetBytes($Bytes)
[System.IO.File]::WriteAllText($PassphraseFile, [Convert]::ToBase64String($Bytes))
$Rng.Dispose()

.\scripts\generate-production-client-pki.ps1 `
  -OutputDir "$env:USERPROFILE\Documents\VetIOS-Production-Client-PKI" `
  -PassphraseFile $PassphraseFile
```

Copy only `client-ca.crt` to the VM:

```text
/opt/vetios/mtls/certs/client-ca.crt
```

Keep `client-root-ca.key` and `client-intermediate-ca.key` offline and encrypted. They are not proxy
runtime files.

Create a separate delivery passphrase and issue a short-lived partner certificate from the offline
workstation. The issuer encrypts the private key and delivery PKCS#12 bundle, uses a unique random
certificate serial, verifies the chain, writes a non-secret manifest, and removes the standalone PEM
key unless `-RetainEncryptedPemKey` is explicitly set:

```powershell
$DeliveryPassphraseFile = "$env:USERPROFILE\Documents\VetIOS-Production-Client-PKI\partner-clinic-001-delivery-passphrase"
$Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$Bytes = New-Object byte[] 32
$Rng.GetBytes($Bytes)
[System.IO.File]::WriteAllText($DeliveryPassphraseFile, [Convert]::ToBase64String($Bytes))
$Rng.Dispose()

.\scripts\issue-partner-client.ps1 `
  -PkiDir "$env:USERPROFILE\Documents\VetIOS-Production-Client-PKI" `
  -CaPassphraseFile "$env:USERPROFILE\Documents\VetIOS-Production-Client-PKI\ca-passphrase" `
  -PartnerId "partner-clinic-001" `
  -OutputDir "$env:USERPROFILE\Documents\VetIOS-Partner-Certs\partner-clinic-001" `
  -DeliveryPassphraseFile $DeliveryPassphraseFile `
  -OAuthClientRecordId "<oauth_clients.id>" `
  -ValidityDays 30
```

Bind the manifest's `sha256_thumbprint` to the intended OAuth client from an MFA-authenticated admin
browser session. This preserves the tenant/admin gate and appends a `certificate_bound` lifecycle
event:

```js
await fetch('/api/platform/oauth-clients', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    action: 'bind_oauth_client_mtls_certificate',
    oauth_client_id: '<oauth_clients.id>',
    certificate_thumbprint: '<manifest.sha256_thumbprint>',
  }),
}).then(async (response) => ({ status: response.status, body: await response.json() }));
```

For a new client, pass `mtls_required: true` and `mtls_cert_thumbprints: [thumbprint]` to the existing
`create_oauth_client` action instead. VetIOS refuses to enable mTLS without at least one valid SHA-256
thumbprint.

Verify the newly bound certificate through `https://mtls.vetios.tech/api/oauth/token` before retiring
the previous certificate. During rotation both thumbprints remain accepted. After successful token
issuance, retire only the old thumbprint:

```js
await fetch('/api/platform/oauth-clients', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    action: 'retire_oauth_client_mtls_certificate',
    oauth_client_id: '<oauth_clients.id>',
    certificate_thumbprint: '<old.sha256_thumbprint>',
  }),
}).then(async (response) => ({ status: response.status, body: await response.json() }));
```

The service refuses to retire the final certificate from an mTLS-required client. Keep the encrypted
PKCS#12 bundle and its delivery passphrase in separate secure channels, and delete operator delivery
copies after the partner confirms import.

### 3. Configure Cloudflare DNS

The authoritative nameservers for `vetios.tech` are Cloudflare. Add this record after the VM has a
static IP:

```text
Type: A
Name: mtls
Target: <VM_STATIC_IPV4>
Proxy status: DNS only
TTL: Auto
```

The record must be DNS-only unless Cloudflare API Shield is deliberately configured to authenticate
clients and forward a cryptographically trusted certificate identity. The default orange-cloud proxy
terminates TLS before Envoy and prevents this direct client-certificate flow.

### 4. Issue the Public Server Certificate

After `mtls.vetios.tech` resolves to the VM, issue and install the Let's Encrypt certificate:

```bash
cd /opt/vetios/mtls-proxy
sudo LETSENCRYPT_EMAIL=security@vetios.tech bash ./scripts/provision-server-cert.sh
```

The script installs a Certbot deploy hook that refreshes `server.crt` and `server.key` and recreates
the proxy after renewals.

### 5. Start and Verify

```bash
cd /opt/vetios/mtls-proxy
sudo docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  up -d --build

sudo docker compose -f docker-compose.production.yml ps
curl --fail --silent http://127.0.0.1:8080/healthz
```

From an external machine, a call without a client certificate must fail during TLS negotiation:

```bash
curl -v https://mtls.vetios.tech/healthz
```

A call with a valid partner certificate must return `ok`:

```bash
curl --cert partner-client-chain.crt --key partner-client.key \
  https://mtls.vetios.tech/healthz
```

Partner OAuth clients then use:

```text
https://mtls.vetios.tech/api/oauth/token
```

## Production Rules

- Keep the proxy secret only in `/opt/vetios/mtls/secrets/proxy-secret` and Vercel Production secrets.
- Deploy only the public client CA bundle to the VM; never deploy client CA private keys.
- Revoke and rotate a partner certificate immediately if its private key may be exposed.
- Rotate the shared proxy secret if it is exposed and redeploy Vercel and the proxy together.
- Keep Cloudflare proxying disabled for this hostname unless API Shield replaces the direct mTLS design.
- Monitor `docker compose ps`, Envoy logs, certificate expiry, and `/healthz` from the VM.

Partner cert thumbprint example:

```powershell
openssl x509 -in partner-client.crt -noout -fingerprint -sha256
```

Normalize by removing colons and lowercasing before storing in VetIOS.
