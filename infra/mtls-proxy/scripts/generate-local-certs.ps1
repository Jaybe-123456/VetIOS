$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$CertDir = Join-Path $Root "certs"
New-Item -ItemType Directory -Force -Path $CertDir | Out-Null

$OpenSslCommand = Get-Command openssl -ErrorAction SilentlyContinue
$OpenSsl = if ($OpenSslCommand) {
    $OpenSslCommand.Source
} elseif (Test-Path "C:\Program Files\Git\usr\bin\openssl.exe") {
    "C:\Program Files\Git\usr\bin\openssl.exe"
} else {
    $null
}
if (-not $OpenSsl) {
    throw "OpenSSL is required. Install Git for Windows, OpenSSL, or run this in an environment that has openssl."
}

Push-Location $CertDir
try {
    & $OpenSsl genrsa -out client-ca.key 4096
    & $OpenSsl req -x509 -new -nodes -key client-ca.key -sha256 -days 3650 -out client-ca.crt -subj "/CN=VetIOS Local Partner Client CA"

    & $OpenSsl genrsa -out server.key 2048
    & $OpenSsl req -new -key server.key -out server.csr -subj "/CN=localhost"
    @"
subjectAltName=DNS:localhost,DNS:mtls.vetios.tech,IP:127.0.0.1
extendedKeyUsage=serverAuth
"@ | Set-Content -Encoding ascii server.ext
    & $OpenSsl x509 -req -in server.csr -CA client-ca.crt -CAkey client-ca.key -CAcreateserial -out server.crt -days 825 -sha256 -extfile server.ext

    & $OpenSsl genrsa -out partner-client.key 2048
    & $OpenSsl req -new -key partner-client.key -out partner-client.csr -subj "/CN=vetios-local-partner-client"
    @"
extendedKeyUsage=clientAuth
"@ | Set-Content -Encoding ascii partner-client.ext
    & $OpenSsl x509 -req -in partner-client.csr -CA client-ca.crt -CAkey client-ca.key -CAcreateserial -out partner-client.crt -days 825 -sha256 -extfile partner-client.ext

    $Fingerprint = & $OpenSsl x509 -in partner-client.crt -noout -fingerprint -sha256
    $Normalized = ($Fingerprint -replace '^.*=', '' -replace ':', '').ToLower()

    Write-Host "Generated local mTLS certs in $CertDir"
    Write-Host "Partner client SHA-256 thumbprint:"
    Write-Host $Normalized
}
finally {
    Pop-Location
}
