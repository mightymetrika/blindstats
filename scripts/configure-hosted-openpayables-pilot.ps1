# BlindStats v45: configure the existing TEST-only read pilot for hosted Supabase.
# Windows PowerShell 5.1. No PostgreSQL writes; no OpenPayables source changes.
# Reads an existing ignored .env.local and preserves its BlindStats credentials.
$ErrorActionPreference = "Stop"

$repo = Join-Path $HOME "Documents\blindstats"
Set-Location -LiteralPath $repo
if ((git branch --show-current) -ne "development") { throw "Expected development branch." }
if ((git rev-parse --short HEAD) -ne "a84edcd") { throw "Unexpected v44 baseline; stop." }
if (-not (Test-Path -LiteralPath "src\lib\openpayables\hosted-connection.ts")) {
  throw "Apply the v45 BlindStats patch first."
}
$envFile = Join-Path $repo ".env.local"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Existing .env.local missing." }
& git check-ignore -q -- .env.local
if ($LASTEXITCODE -ne 0) { throw "STOP: .env.local is not ignored by Git." }

$installed = Join-Path $repo "node_modules\openpayables\package.json"
if (-not (Test-Path -LiteralPath $installed)) { throw "Install the pinned alpha.3 package first." }
$installedVersion = (Get-Content -LiteralPath $installed -Raw | ConvertFrom-Json).version
if ($installedVersion -ne "0.2.0-alpha.3") { throw "Expected installed OpenPayables alpha.3." }

$existingLines = @(Get-Content -LiteralPath $envFile)
$mappingLines = @($existingLines | Where-Object { $_ -match '^\s*OPENPAYABLES_PILOT_ACCESS_JSON\s*=' })
if ($mappingLines.Count -ne 1) { throw "Expected exactly one existing v44 pilot access mapping." }
$oldMapping = ($mappingLines[0] -replace '^\s*OPENPAYABLES_PILOT_ACCESS_JSON\s*=\s*', '').Trim()
try { $config = ConvertFrom-Json -InputObject $oldMapping } catch { throw "Invalid existing pilot mapping." }
if ($config.projectId -notin @("openpayables-funding-3f1bfa8a", "supabase-smoke-4496fd4f")) {
  throw "Unexpected pilot project; refusing to change identity assignments."
}
$managers = @($config.managerUserIds)
$contributors = @($config.contributorUserIds.PSObject.Properties)
if ($managers.Count -ne 1 -or $contributors.Count -ne 1 -or
    $contributors[0].Value -notin @("alice-3f1bfa8a", "smoke-alice-4496fd4f")) {
  throw "Expected existing v44 manager and synthetic Alice mappings."
}

# The CA is a public certificate downloaded from the OpenPayables Supabase
# project. Use precisely that project's certificate; do not disable TLS checks.
$caInput = (Read-Host "Full path to the downloaded Supabase CA PEM certificate").Trim().Trim('"')
if (-not (Test-Path -LiteralPath $caInput -PathType Leaf)) { throw "CA file does not exist." }
$caBytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $caInput).Path)
$caText = [System.Text.Encoding]::UTF8.GetString($caBytes)
if ($caBytes.Length -lt 100 -or $caBytes.Length -gt 65536 -or
    -not $caText.Contains('-----BEGIN CERTIFICATE-----') -or
    -not $caText.Contains('-----END CERTIFICATE-----') -or
    $caText.Contains('PRIVATE KEY')) {
  throw "Invalid Supabase CA PEM file."
}
$caEncoded = [Convert]::ToBase64String($caBytes)

Write-Host "Enter the HOSTED Supabase openpayables_app_ro password (hidden)."
$secure = Read-Host "Hosted read-only PostgreSQL password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if (-not $password) { throw "Empty read-only password." }
  $encodedPassword = [Uri]::EscapeDataString($password)
  $databaseUrl = "postgresql://openpayables_app_ro.aadqozgamybbksrvoivu:$encodedPassword@aws-1-us-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full"
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secure.Dispose()
  Remove-Variable password, encodedPassword -ErrorAction SilentlyContinue
}

$newContributors = @{}
$newContributors[$contributors[0].Name] = "smoke-alice-4496fd4f"
$newMapping = [ordered]@{
  projectId = "supabase-smoke-4496fd4f"
  managerUserIds = @($managers)
  contributorUserIds = $newContributors
}
$mappingJson = ConvertTo-Json -InputObject $newMapping -Compress -Depth 6
$excluded = '^\s*OPENPAYABLES_(DATABASE_URL|PILOT_ACCESS_JSON|POOL_MAX|TLS_CA_BASE64)\s*='
$preserved = @($existingLines | Where-Object { $_ -notmatch $excluded })
$newLines = @($preserved) + @(
  "OPENPAYABLES_DATABASE_URL=$databaseUrl",
  "OPENPAYABLES_PILOT_ACCESS_JSON=$mappingJson",
  "OPENPAYABLES_POOL_MAX=1",
  "OPENPAYABLES_TLS_CA_BASE64=$caEncoded"
)
[System.IO.File]::WriteAllLines($envFile, [string[]]$newLines, ([System.Text.UTF8Encoding]::new($false)))
Remove-Variable databaseUrl, mappingJson, caEncoded, newLines -ErrorAction SilentlyContinue
Write-Host "Hosted read-only configuration updated in ignored .env.local. No secret values were printed."
Write-Host "Restart Next.js if it is running, then verify the local hosted-data GUI."
