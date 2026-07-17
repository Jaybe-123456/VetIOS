param(
    [Parameter(Mandatory = $true)]
    [string]$PkiDir,

    [Parameter(Mandatory = $true)]
    [string]$CaPassphraseFile,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[a-z0-9][a-z0-9._-]{1,62}$")]
    [string]$PartnerId,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $true)]
    [string]$DeliveryPassphraseFile,

    [ValidateRange(1, 90)]
    [int]$ValidityDays = 30,

    [string]$OAuthClientRecordId,

    [switch]$RetainEncryptedPemKey
)

$ErrorActionPreference = "Stop"

$OpenSslCommand = Get-Command openssl -ErrorAction SilentlyContinue
$OpenSsl = if ($OpenSslCommand) {
    $OpenSslCommand.Source
} elseif (Test-Path "C:\Program Files\Git\usr\bin\openssl.exe") {
    "C:\Program Files\Git\usr\bin\openssl.exe"
} else {
    $null
}
if (-not $OpenSsl) {
    throw "OpenSSL is required. Install Git for Windows or OpenSSL and retry."
}

$PkiRoot = [System.IO.Path]::GetFullPath($PkiDir)
$ResolvedPassphrase = (Resolve-Path $CaPassphraseFile).Path
$ResolvedDeliveryPassphrase = (Resolve-Path $DeliveryPassphraseFile).Path
$DeliveryPassphrase = (Get-Content -Raw $ResolvedDeliveryPassphrase).Trim()
if ($DeliveryPassphrase.Length -lt 24) {
    throw "DeliveryPassphraseFile must contain at least 24 characters."
}
$DeliveryPassphraseEnvironmentName = "VETIOS_PARTNER_CERT_DELIVERY_PASSPHRASE"
$PreviousDeliveryPassphrase = [Environment]::GetEnvironmentVariable($DeliveryPassphraseEnvironmentName, "Process")
$OutputRoot = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$IntermediateKey = Join-Path $PkiRoot "client-intermediate-ca.key"
$IntermediateCert = Join-Path $PkiRoot "client-intermediate-ca.crt"
$RootCert = Join-Path $PkiRoot "client-root-ca.crt"
$ClientCa = Join-Path $PkiRoot "client-ca.crt"

foreach ($RequiredFile in @($IntermediateKey, $IntermediateCert, $RootCert)) {
    if (-not (Test-Path $RequiredFile)) {
        throw "Missing required PKI file: $RequiredFile"
    }
}

$ClientKey = Join-Path $OutputRoot "$PartnerId.key"
$ClientCsr = Join-Path $OutputRoot "$PartnerId.csr"
$ClientCert = Join-Path $OutputRoot "$PartnerId.crt"
$ClientChain = Join-Path $OutputRoot "$PartnerId-chain.crt"
$ClientExt = Join-Path $OutputRoot "$PartnerId.ext"
$ClientPfx = Join-Path $OutputRoot "$PartnerId.pfx"
$ManifestPath = Join-Path $OutputRoot "$PartnerId-manifest.json"
$TemporaryCaBundle = $null

foreach ($Artifact in @($ClientKey, $ClientCsr, $ClientCert, $ClientChain, $ClientExt, $ClientPfx, $ManifestPath)) {
    if (Test-Path -LiteralPath $Artifact) {
        throw "Refusing to overwrite existing partner certificate artifact: $Artifact"
    }
}

if (-not (Test-Path -LiteralPath $ClientCa)) {
    $TemporaryCaBundle = Join-Path $OutputRoot "$PartnerId-ca-bundle.tmp"
    Get-Content $IntermediateCert, $RootCert | Set-Content -Encoding ascii $TemporaryCaBundle
    $ClientCa = $TemporaryCaBundle
}

function Invoke-OpenSsl {
    param([Parameter(Mandatory = $true)][string[]]$OpenSslArguments)

    & $OpenSsl @OpenSslArguments
    if ($LASTEXITCODE -ne 0) {
        throw "OpenSSL failed: $($OpenSslArguments -join ' ')"
    }
}

$Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$SerialBytes = New-Object byte[] 20
$Rng.GetBytes($SerialBytes)
$Rng.Dispose()
$Serial = "0x$([System.BitConverter]::ToString($SerialBytes).Replace('-', ''))"

[Environment]::SetEnvironmentVariable(
    $DeliveryPassphraseEnvironmentName,
    $DeliveryPassphrase,
    "Process"
)
try {
    Invoke-OpenSsl @(
        'genpkey', '-algorithm', 'RSA', '-aes-256-cbc',
        '-pass', "env:$DeliveryPassphraseEnvironmentName",
        '-pkeyopt', 'rsa_keygen_bits:3072', '-out', $ClientKey
    )
    Invoke-OpenSsl @(
        'req', '-new', '-sha256', '-key', $ClientKey,
        '-passin', "env:$DeliveryPassphraseEnvironmentName",
        '-out', $ClientCsr, '-subj', "/O=VetIOS Partner/CN=$PartnerId"
    )

    $ClientExtLines = @(
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=clientAuth",
        "subjectAltName=URI:spiffe://vetios.tech/partner/$PartnerId",
        "subjectKeyIdentifier=hash",
        "authorityKeyIdentifier=keyid,issuer"
    )
    Set-Content -Encoding ascii -Path $ClientExt -Value $ClientExtLines

    Invoke-OpenSsl @(
        'x509', '-req', '-sha256', '-days', [string]$ValidityDays,
        '-in', $ClientCsr, '-CA', $IntermediateCert, '-CAkey', $IntermediateKey,
        '-set_serial', $Serial, '-passin', "file:$ResolvedPassphrase",
        '-out', $ClientCert, '-extfile', $ClientExt
    )

    Get-Content $ClientCert, $IntermediateCert, $RootCert | Set-Content -Encoding ascii $ClientChain
    Invoke-OpenSsl @('verify', '-CAfile', $ClientCa, $ClientCert)
    Invoke-OpenSsl @(
        'pkcs12', '-export', '-out', $ClientPfx,
        '-inkey', $ClientKey, '-passin', "env:$DeliveryPassphraseEnvironmentName",
        '-in', $ClientCert, '-certfile', $ClientCa,
        '-name', $PartnerId, '-passout', "env:$DeliveryPassphraseEnvironmentName"
    )

    $FingerprintLine = & $OpenSsl x509 -in $ClientCert -noout -fingerprint -sha256
    if ($LASTEXITCODE -ne 0) { throw "Failed to read the client certificate fingerprint." }
    $Fingerprint = ($FingerprintLine -replace '^.*=', '' -replace ':', '').ToLowerInvariant()
    $EndDateLine = & $OpenSsl x509 -in $ClientCert -noout -enddate
    if ($LASTEXITCODE -ne 0) { throw "Failed to read the client certificate expiry." }
    $SerialLine = & $OpenSsl x509 -in $ClientCert -noout -serial
    if ($LASTEXITCODE -ne 0) { throw "Failed to read the client certificate serial number." }

    $Manifest = [ordered]@{
        schema_version = "vetios_partner_certificate_manifest_v1"
        partner_id = $PartnerId
        oauth_client_record_id = if ([string]::IsNullOrWhiteSpace($OAuthClientRecordId)) { $null } else { $OAuthClientRecordId.Trim() }
        spiffe_id = "spiffe://vetios.tech/partner/$PartnerId"
        sha256_thumbprint = $Fingerprint
        serial_number = ($SerialLine -replace '^serial=', '').Trim().ToLowerInvariant()
        not_after = ($EndDateLine -replace '^notAfter=', '').Trim()
        validity_days = $ValidityDays
        certificate_file = [System.IO.Path]::GetFileName($ClientCert)
        certificate_chain_file = [System.IO.Path]::GetFileName($ClientChain)
        encrypted_pkcs12_file = [System.IO.Path]::GetFileName($ClientPfx)
        encrypted_pem_key_retained = $RetainEncryptedPemKey.IsPresent
        issued_at = [DateTime]::UtcNow.ToString("o")
    }
    $Manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $ManifestPath

    if (-not $RetainEncryptedPemKey) {
        Remove-Item -LiteralPath $ClientKey -Force
    }
} finally {
    Remove-Item -LiteralPath $ClientCsr -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ClientExt -Force -ErrorAction SilentlyContinue
    if ($TemporaryCaBundle) {
        Remove-Item -LiteralPath $TemporaryCaBundle -Force -ErrorAction SilentlyContinue
    }
    [Environment]::SetEnvironmentVariable(
        $DeliveryPassphraseEnvironmentName,
        $PreviousDeliveryPassphrase,
        "Process"
    )
}

Write-Host "Partner client certificate issued at $ClientCert"
Write-Host "Encrypted delivery bundle issued at $ClientPfx"
Write-Host "Certificate manifest issued at $ManifestPath"
Write-Host "OAuth client SHA-256 thumbprint:"
Write-Host $Fingerprint
