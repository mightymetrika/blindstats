# Store a private DEVELOPMENT Supabase service-role key in ignored .env.local.
# This key MUST NOT be used in NEXT_PUBLIC_* settings, source or browser code.
# Refuses to operate if the existing local Supabase URL is not Development.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env.local"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Missing .env.local" }
$lines = @(Get-Content -LiteralPath $envPath)
$matched = @($lines | Where-Object { $_ -match '^\s*NEXT_PUBLIC_SUPABASE_URL\s*=' })
if ($matched.Count -ne 1) { throw "Expected exactly one Supabase URL." }
$url = $matched[0].Substring($matched[0].IndexOf('=') + 1).Trim().Trim('"').Trim("'")
if ($url.TrimEnd('/') -ne "https://kfrfemqoalzxwzecyjjf.supabase.co") {
    throw "Refusing to configure: local Supabase URL is not DEVELOPMENT."
}
$existing = @($lines | Where-Object { $_ -match '^\s*SUPABASE_SERVICE_ROLE_KEY\s*=' })
if ($existing.Count -gt 1) { throw "Duplicate service-role key entries. Review .env.local privately." }
$key = Read-Host "Paste the DEVELOPMENT-only Supabase service-role key (not displayed)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
try {
    $plaintext = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if (-not $plaintext -or $plaintext.Contains([char]10) -or $plaintext.Contains([char]13)) {
        throw "Invalid key input."
    }
    $filtered = @($lines | Where-Object { $_ -notmatch '^\s*SUPABASE_SERVICE_ROLE_KEY\s*=' })
    $filtered += "SUPABASE_SERVICE_ROLE_KEY=$plaintext"
    Set-Content -LiteralPath $envPath -Value $filtered -Encoding UTF8
    Write-Host "DEVELOPMENT-only server credential updated in ignored .env.local. No key printed."
}
finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    Remove-Variable plaintext -ErrorAction SilentlyContinue
}
