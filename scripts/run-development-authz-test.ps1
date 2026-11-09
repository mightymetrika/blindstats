# One-command launcher for the opt-in two-account development integration test.
# No API keys or account passwords are printed or written to disk.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$namesToClear = @(
    "BLINDSTATS_IT_CONFIRM",
    "BLINDSTATS_IT_SUPABASE_URL",
    "BLINDSTATS_IT_SUPABASE_PUBLISHABLE_KEY",
    "BLINDSTATS_IT_A_EMAIL",
    "BLINDSTATS_IT_A_PASSWORD",
    "BLINDSTATS_IT_B_EMAIL",
    "BLINDSTATS_IT_B_PASSWORD"
)

function Get-LocalEnvironmentValue([string]$name, [string[]]$lines) {
    $pattern = "^\s*" + [regex]::Escape($name) + "\s*="
    $matchedLines = @($lines | Where-Object { $_ -match $pattern })
    if ($matchedLines.Count -ne 1) {
        throw "Expected exactly one '$name' entry in ignored .env.local."
    }
    $value = $matchedLines[0].Substring($matchedLines[0].IndexOf("=") + 1).Trim()
    if ($value.Length -ge 2 -and (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
    )) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not $value) { throw "The '$name' value is empty in .env.local." }
    return $value
}

function Read-TestPassword([string]$prompt) {
    $secure = Read-Host $prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$exitCode = 1
try {
    $envFile = Join-Path $root ".env.local"
    if (-not (Test-Path -LiteralPath $envFile)) {
        throw "Expected ignored .env.local at $envFile."
    }
    $lines = Get-Content -LiteralPath $envFile
    $url = Get-LocalEnvironmentValue "NEXT_PUBLIC_SUPABASE_URL" $lines
    $key = Get-LocalEnvironmentValue "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" $lines

    # Abort before prompting for credentials or sending network requests if
    # the local application configuration points anywhere but development.
    if ($url.TrimEnd('/') -ne "https://kfrfemqoalzxwzecyjjf.supabase.co") {
        throw "Refusing to run: .env.local is not linked to the expected DEVELOPMENT Supabase URL."
    }
    if (-not $key.StartsWith("sb_publishable_")) {
        throw "Refusing to run: .env.local key must begin with sb_publishable_."
    }

    $env:BLINDSTATS_IT_CONFIRM = "DEVELOPMENT_ONLY"
    $env:BLINDSTATS_IT_SUPABASE_URL = $url
    $env:BLINDSTATS_IT_SUPABASE_PUBLISHABLE_KEY = $key
    $env:BLINDSTATS_IT_A_EMAIL = Read-Host "Existing development account A email (Study creator)"
    $env:BLINDSTATS_IT_A_PASSWORD = Read-TestPassword "Account A password"
    $env:BLINDSTATS_IT_B_EMAIL = Read-Host "Existing development account B email (authorizer)"
    $env:BLINDSTATS_IT_B_PASSWORD = Read-TestPassword "Account B password"

    Write-Host "Running one real two-account authorization test against DEVELOPMENT only..."
    & npm run test:integration:authz
    $exitCode = $LASTEXITCODE
}
finally {
    foreach ($name in $namesToClear) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
}
exit $exitCode
