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

    [int]$ValidityDays = 90
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
$OutputRoot = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$IntermediateKey = Join-Path $PkiRoot "client-intermediate-ca.key"
$IntermediateCert = Join-Path $PkiRoot "client-intermediate-ca.crt"
$RootCert = Join-Path $PkiRoot "client-root-ca.crt"

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

& $OpenSsl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out $ClientKey
& $OpenSsl req -new -sha256 -key $ClientKey -out $ClientCsr `
    -subj "/O=VetIOS Partner/CN=$PartnerId"

$ClientExtLines = @(
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=clientAuth",
    "subjectAltName=URI:spiffe://vetios.tech/partner/$PartnerId",
    "subjectKeyIdentifier=hash",
    "authorityKeyIdentifier=keyid,issuer"
)
Set-Content -Encoding ascii -Path $ClientExt -Value $ClientExtLines

& $OpenSsl x509 -req -sha256 -days $ValidityDays `
    -in $ClientCsr -CA $IntermediateCert -CAkey $IntermediateKey -CAcreateserial `
    -passin "file:$ResolvedPassphrase" `
    -out $ClientCert -extfile $ClientExt

Get-Content $ClientCert, $IntermediateCert, $RootCert | Set-Content -Encoding ascii $ClientChain

$FingerprintLine = & $OpenSsl x509 -in $ClientCert -noout -fingerprint -sha256
$Fingerprint = ($FingerprintLine -replace '^.*=', '' -replace ':', '').ToLowerInvariant()

Write-Host "Partner client certificate issued at $ClientCert"
Write-Host "OAuth client SHA-256 thumbprint:"
Write-Host $Fingerprint
