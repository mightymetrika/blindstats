# Opt-in DEVELOPMENT-only synthetic v46 Storage and two-account authorization.
# Prompts for account passwords in memory; never writes or prints them.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$vars = @("BLINDSTATS_IT_CONFIRM", "BLINDSTATS_IT_SUPABASE_URL",
    "BLINDSTATS_IT_SUPABASE_PUBLISHABLE_KEY", "BLINDSTATS_IT_A_EMAIL",
    "BLINDSTATS_IT_A_PASSWORD", "BLINDSTATS_IT_B_EMAIL", "BLINDSTATS_IT_B_PASSWORD")

function Get-EnvValue([string]$key, [string[]]$lines) {
    $matched = @($lines | Where-Object { $_ -match ("^\s*" + [regex]::Escape($key) + "\s*=") })
    if ($matched.Count -ne 1) { throw "Expected exactly one $key in ignored .env.local." }
    $raw = $matched[0].Substring($matched[0].IndexOf("=") + 1).Trim()
    if ($raw.Length -ge 2 -and (($raw.StartsWith('"') -and $raw.EndsWith('"')) -or
        ($raw.StartsWith("'") -and $raw.EndsWith("'")))) {
        $raw = $raw.Substring(1, $raw.Length - 2)
    }
    if (-not $raw) { throw "Empty $key in .env.local." }
    return $raw
}
function Get-Password([string]$prompt) {
    $secured = Read-Host $prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secured)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$exitCode = 1
try {
    $lines = Get-Content -LiteralPath (Join-Path $repo ".env.local")
    $url = Get-EnvValue "NEXT_PUBLIC_SUPABASE_URL" $lines
    $publishableKey = Get-EnvValue "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" $lines
    if ($url.TrimEnd('/') -ne "https://kfrfemqoalzxwzecyjjf.supabase.co") {
        throw "Refusing: .env.local must target BlindStats DEVELOPMENT Supabase."
    }
    if (-not $publishableKey.StartsWith("sb_publishable_")) {
        throw "Expected DEVELOPMENT publishable key."
    }
    $env:BLINDSTATS_IT_CONFIRM = "DEVELOPMENT_ONLY"
    $env:BLINDSTATS_IT_SUPABASE_URL = $url
    $env:BLINDSTATS_IT_SUPABASE_PUBLISHABLE_KEY = $publishableKey
    $env:BLINDSTATS_IT_A_EMAIL = Read-Host "Development account A email (custodian)"
    $env:BLINDSTATS_IT_A_PASSWORD = Get-Password "Account A password"
    $env:BLINDSTATS_IT_B_EMAIL = Read-Host "Development account B email (analyst)"
    $env:BLINDSTATS_IT_B_PASSWORD = Get-Password "Account B password"
    Write-Host "Running v46 synthetic DEVELOPMENT-only Storage authorization test..."
    & npx vitest run --config vitest.integration.config.mts tests/integration/research-transfer.integration.test.ts
    $exitCode = $LASTEXITCODE
}
finally {
    foreach ($name in $vars) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
}
exit $exitCode
