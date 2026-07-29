$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'

$weco = Join-Path $env:USERPROFILE '.local\bin\weco.exe'
if (-not (Test-Path -LiteralPath $weco)) {
    throw "Weco is not installed at $weco"
}

& $weco run `
    --source 'tools/weco/vvrb-audit-latency/target.mjs' `
    --eval-command 'node tools/weco/vvrb-audit-latency/evaluate.mjs' `
    --metric 'latency_ms' `
    --goal 'minimize' `
    --steps 5 `
    --require-review `
    --no-open `
    --output 'plain' `
    --save-logs `
    --eval-timeout 120 `
    --additional-instructions 'tools/weco/vvrb-audit-latency/instructions.md'
