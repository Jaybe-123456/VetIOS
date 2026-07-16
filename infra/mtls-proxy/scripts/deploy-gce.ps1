param(
    [string]$ProjectId = "vetios-488515",

    [string]$Zone = "us-west1-b",

    [string]$MachineType = "e2-small",

    [string]$InstanceName = "vetios-mtls-proxy",

    [string]$AddressName = "vetios-mtls-ip",

    [string]$Domain = "mtls.vetios.tech",

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    [string]$LetsEncryptEmail,

    [Parameter(Mandatory = $true)]
    [string]$ClientCaPath,

    [Parameter(Mandatory = $true)]
    [string]$ProxySecretPath,

    [Parameter(Mandatory = $true)]
    [switch]$ConfirmVercelSecretConfigured
)

$ErrorActionPreference = "Stop"

if ($Domain -notmatch '^[a-z0-9.-]+$') {
    throw "Domain contains unsupported characters."
}

if (-not $ConfirmVercelSecretConfigured) {
    throw "Set the proxy-secret file value as VETIOS_MTLS_PROXY_SECRET in Vercel Production, then pass -ConfirmVercelSecretConfigured."
}

if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
    throw "CLOUDFLARE_API_TOKEN is required with Zone DNS Edit permission for vetios.tech."
}

$ClientCa = (Resolve-Path $ClientCaPath).Path
$ProxySecret = (Resolve-Path $ProxySecretPath).Path
$SecretValue = (Get-Content -Raw $ProxySecret).Trim()
if ($SecretValue.Length -lt 32) {
    throw "ProxySecretPath must contain at least 32 characters."
}

$GcloudCandidates = @(
    (Get-Command gcloud -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
) | Where-Object { $_ -and (Test-Path $_) }

$Gcloud = $GcloudCandidates | Select-Object -First 1
if (-not $Gcloud) {
    throw "Google Cloud CLI is not installed."
}

$ProxyDir = Split-Path -Parent $PSScriptRoot
$Region = $Zone -replace '-[a-z]$', ''
$Tag = "vetios-mtls-proxy"
$HttpsFirewall = "vetios-mtls-allow-https"
$HttpFirewall = "vetios-mtls-allow-certbot"
$SshFirewall = "vetios-mtls-allow-operator-ssh"

function Invoke-Gcloud {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    & $Gcloud @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud failed: $($Arguments -join ' ')"
    }
}

function Test-GcloudResource {
    param([string[]]$Arguments)

    & $Gcloud @Arguments 1>$null 2>$null
    return $LASTEXITCODE -eq 0
}

$BillingEnabled = (& $Gcloud billing projects describe $ProjectId --format='value(billingEnabled)').Trim()
if ($LASTEXITCODE -ne 0 -or $BillingEnabled -ne 'True') {
    throw "Billing is not enabled for $ProjectId. Open https://console.cloud.google.com/billing/linkedaccount?project=$ProjectId first."
}

Invoke-Gcloud services enable compute.googleapis.com --project $ProjectId --quiet

if (-not (Test-GcloudResource @('compute', 'addresses', 'describe', $AddressName, '--region', $Region, '--project', $ProjectId))) {
    Invoke-Gcloud compute addresses create $AddressName --region $Region --project $ProjectId --quiet
}

$StaticIp = (& $Gcloud compute addresses describe $AddressName --region $Region --project $ProjectId --format='value(address)').Trim()
if ($LASTEXITCODE -ne 0 -or -not $StaticIp) {
    throw "Unable to resolve the reserved static IP."
}

$OperatorIp = (Invoke-RestMethod -Uri 'https://api.ipify.org').Trim()

if (-not (Test-GcloudResource @('compute', 'firewall-rules', 'describe', $HttpsFirewall, '--project', $ProjectId))) {
    Invoke-Gcloud compute firewall-rules create $HttpsFirewall --project $ProjectId --network default --allow tcp:443 --source-ranges 0.0.0.0/0 --target-tags $Tag --quiet
}

if (-not (Test-GcloudResource @('compute', 'firewall-rules', 'describe', $HttpFirewall, '--project', $ProjectId))) {
    Invoke-Gcloud compute firewall-rules create $HttpFirewall --project $ProjectId --network default --allow tcp:80 --source-ranges 0.0.0.0/0 --target-tags $Tag --quiet
}

if (-not (Test-GcloudResource @('compute', 'firewall-rules', 'describe', $SshFirewall, '--project', $ProjectId))) {
    Invoke-Gcloud compute firewall-rules create $SshFirewall --project $ProjectId --network default --allow tcp:22 --source-ranges "$OperatorIp/32" --target-tags $Tag --quiet
}

if (-not (Test-GcloudResource @('compute', 'instances', 'describe', $InstanceName, '--zone', $Zone, '--project', $ProjectId))) {
    Invoke-Gcloud compute instances create $InstanceName `
        --project $ProjectId `
        --zone $Zone `
        --machine-type $MachineType `
        --image-family ubuntu-2404-lts-amd64 `
        --image-project ubuntu-os-cloud `
        --boot-disk-size 20GB `
        --boot-disk-type pd-balanced `
        --address $StaticIp `
        --tags $Tag `
        --shielded-secure-boot `
        --shielded-vtpm `
        --shielded-integrity-monitoring `
        --no-service-account `
        --no-scopes `
        --quiet
}

$CloudflareHeaders = @{
    Authorization = "Bearer $($env:CLOUDFLARE_API_TOKEN)"
    'Content-Type' = 'application/json'
}
$ZoneResponse = Invoke-RestMethod -Method Get -Headers $CloudflareHeaders -Uri 'https://api.cloudflare.com/client/v4/zones?name=vetios.tech&status=active'
if (-not $ZoneResponse.success -or $ZoneResponse.result.Count -ne 1) {
    throw "Cloudflare zone lookup failed for vetios.tech."
}
$ZoneId = $ZoneResponse.result[0].id
$RecordResponse = Invoke-RestMethod -Method Get -Headers $CloudflareHeaders -Uri "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records?type=A&name=$Domain"
$RecordBody = @{
    type = 'A'
    name = $Domain
    content = $StaticIp
    ttl = 1
    proxied = $false
} | ConvertTo-Json

if ($RecordResponse.result.Count -eq 0) {
    $DnsResult = Invoke-RestMethod -Method Post -Headers $CloudflareHeaders -Uri "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records" -Body $RecordBody
} else {
    $RecordId = $RecordResponse.result[0].id
    $DnsResult = Invoke-RestMethod -Method Put -Headers $CloudflareHeaders -Uri "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records/$RecordId" -Body $RecordBody
}
if (-not $DnsResult.success) {
    throw "Cloudflare DNS update failed."
}

Invoke-Gcloud compute ssh $InstanceName --project $ProjectId --zone $Zone --quiet --command 'mkdir -p ~/vetios-mtls-upload'
Invoke-Gcloud compute scp --recurse "$ProxyDir\*" "${InstanceName}:~/vetios-mtls-upload/" --project $ProjectId --zone $Zone --quiet
Invoke-Gcloud compute scp $ClientCa "${InstanceName}:~/client-ca.crt" --project $ProjectId --zone $Zone --quiet
Invoke-Gcloud compute scp $ProxySecret "${InstanceName}:~/proxy-secret" --project $ProjectId --zone $Zone --quiet

$RemoteBootstrap = @"
set -euo pipefail
find ~/vetios-mtls-upload/scripts -type f -name '*.sh' -exec sed -i 's/\r$//' {} +
sudo bash ~/vetios-mtls-upload/scripts/bootstrap-ubuntu-vm.sh
sudo cp -R ~/vetios-mtls-upload/. /opt/vetios/mtls-proxy/
sudo cp ~/client-ca.crt /opt/vetios/mtls/certs/client-ca.crt
sudo cp ~/proxy-secret /opt/vetios/mtls/secrets/proxy-secret
sudo chmod 0600 /opt/vetios/mtls/secrets/proxy-secret
sudo cp /opt/vetios/mtls-proxy/.env.production.example /opt/vetios/mtls-proxy/.env.production
sudo rm -f ~/client-ca.crt ~/proxy-secret
"@
Invoke-Gcloud compute ssh $InstanceName --project $ProjectId --zone $Zone --quiet --command $RemoteBootstrap

$DnsReady = $false
for ($Attempt = 1; $Attempt -le 30; $Attempt++) {
    $Resolved = Resolve-DnsName $Domain -Type A -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq $StaticIp }
    if ($Resolved) {
        $DnsReady = $true
        break
    }
    Start-Sleep -Seconds 10
}
if (-not $DnsReady) {
    throw "DNS did not resolve to $StaticIp within five minutes. The VM is provisioned; rerun certificate provisioning after DNS propagates."
}

$RemoteCertificate = "sudo env LETSENCRYPT_EMAIL='$LetsEncryptEmail' VETIOS_MTLS_DOMAIN='$Domain' bash /opt/vetios/mtls-proxy/scripts/provision-server-cert.sh"
Invoke-Gcloud compute ssh $InstanceName --project $ProjectId --zone $Zone --quiet --command $RemoteCertificate

Write-Host "VetIOS mTLS proxy deployed at https://$Domain"
Write-Host "Static IP: $StaticIp"
Write-Host "Calls without a trusted partner certificate should fail during TLS negotiation."
