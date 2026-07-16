param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $true)]
    [string]$PassphraseFile,

    [string]$Organization = "VetIOS",

    [int]$RootValidityDays = 3650,

    [int]$IntermediateValidityDays = 1825
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

$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDir)
$ResolvedPassphrase = (Resolve-Path $PassphraseFile).Path
$RepoCertDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\certs"))
if ($ResolvedOutput.StartsWith($RepoCertDir, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Production CA material must be generated outside the repository."
}
if ((Get-Content -Raw $ResolvedPassphrase).Trim().Length -lt 24) {
    throw "PassphraseFile must contain at least 24 characters."
}

New-Item -ItemType Directory -Force -Path $ResolvedOutput | Out-Null

$RootKey = Join-Path $ResolvedOutput "client-root-ca.key"
$RootCert = Join-Path $ResolvedOutput "client-root-ca.crt"
$IntermediateKey = Join-Path $ResolvedOutput "client-intermediate-ca.key"
$IntermediateCsr = Join-Path $ResolvedOutput "client-intermediate-ca.csr"
$IntermediateCert = Join-Path $ResolvedOutput "client-intermediate-ca.crt"
$IntermediateExt = Join-Path $ResolvedOutput "client-intermediate-ca.ext"
$Bundle = Join-Path $ResolvedOutput "client-ca.crt"

& $OpenSsl genpkey -algorithm RSA -aes-256-cbc -pass "file:$ResolvedPassphrase" -pkeyopt rsa_keygen_bits:4096 -out $RootKey
& $OpenSsl req -x509 -new -sha256 -days $RootValidityDays -key $RootKey -out $RootCert `
    -passin "file:$ResolvedPassphrase" `
    -subj "/O=$Organization/CN=VetIOS Partner Client Root CA" `
    -addext "basicConstraints=critical,CA:TRUE,pathlen:1" `
    -addext "keyUsage=critical,keyCertSign,cRLSign" `
    -addext "subjectKeyIdentifier=hash"

& $OpenSsl genpkey -algorithm RSA -aes-256-cbc -pass "file:$ResolvedPassphrase" -pkeyopt rsa_keygen_bits:4096 -out $IntermediateKey
& $OpenSsl req -new -sha256 -key $IntermediateKey -out $IntermediateCsr `
    -passin "file:$ResolvedPassphrase" `
    -subj "/O=$Organization/CN=VetIOS Partner Client Issuing CA"

$IntermediateExtLines = @(
    "basicConstraints=critical,CA:TRUE,pathlen:0",
    "keyUsage=critical,keyCertSign,cRLSign",
    "subjectKeyIdentifier=hash",
    "authorityKeyIdentifier=keyid,issuer"
)
Set-Content -Encoding ascii -Path $IntermediateExt -Value $IntermediateExtLines

& $OpenSsl x509 -req -sha256 -days $IntermediateValidityDays `
    -in $IntermediateCsr -CA $RootCert -CAkey $RootKey -CAcreateserial `
    -passin "file:$ResolvedPassphrase" `
    -out $IntermediateCert -extfile $IntermediateExt

Get-Content $IntermediateCert, $RootCert | Set-Content -Encoding ascii $Bundle

Write-Host "Production client PKI created at $ResolvedOutput"
Write-Host "Deploy only client-ca.crt to the proxy. Keep both encrypted CA private keys and the passphrase file offline."
