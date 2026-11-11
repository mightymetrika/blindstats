# blindstats Researcher Preview - Windows PowerShell 5.1+
# Offline synthetic data generation and blinded-only descriptive analysis.
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\researcher-preview-windows.ps1 -Action Generate
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\researcher-preview-windows.ps1 -Action Analyze -InputCsv "C:\path\synthetic_study_blinded.csv"
[CmdletBinding()]
param(
    [ValidateSet('Generate', 'Analyze')]
    [string]$Action = 'Generate',
    [string]$InputCsv,
    [string]$OutputDir = (Join-Path $HOME 'blindstats-preview-files')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$invariant = [System.Globalization.CultureInfo]::InvariantCulture
$utf8 = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$OutputDir = (Resolve-Path -LiteralPath $OutputDir).Path

if ($Action -eq 'Generate') {
    $lines = New-Object 'System.Collections.Generic.List[string]'
    [void]$lines.Add('participant_id,group,baseline_score,outcome_score')
    for ($i = 1; $i -le 48; $i++) {
        $group = if (($i % 2) -eq 0) { 'Program' } else { 'Reference' }
        $baseline = 42 + (($i * 11) % 24)
        $improvement = 4 + (($i * 7) % 9)
        if (($i % 2) -eq 0) { $improvement += 3 }
        $outcome = $baseline + $improvement
        [void]$lines.Add(('P{0:D3},{1},{2},{3}' -f $i, $group, $baseline, $outcome))
    }
    $out = Join-Path $OutputDir 'synthetic_study.csv'
    [System.IO.File]::WriteAllText($out, [string]::Join("`n", $lines) + "`n", $utf8)
    Write-Host "Created synthetic dataset: $out"
    Write-Host 'In blindstats, select the group column; download the blinded CSV.'
    Write-Host 'Keep the unblinding secret separate from the blinded analyst.'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($InputCsv)) {
    throw 'For -Action Analyze, provide -InputCsv with the blinded CSV downloaded from blindstats.'
}
$inputPath = (Resolve-Path -LiteralPath $InputCsv -ErrorAction Stop).Path
$inputName = [System.IO.Path]::GetFileName($inputPath)
if (-not $inputName.EndsWith('_blinded.csv', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Analysis input must be the *_blinded.csv file downloaded from blindstats (not the source CSV).'
}
$rows = @(Import-Csv -LiteralPath $inputPath -Encoding UTF8)
if ($rows.Count -eq 0) { throw 'The blinded CSV has no data rows.' }
$cols = @($rows[0].PSObject.Properties | ForEach-Object { $_.Name })
$expected = @('participant_id','group','baseline_score','outcome_score')
if (($cols -join ',') -cne ($expected -join ',')) {
    throw 'Unexpected columns. Use the supplied synthetic source CSV and blind the group column.'
}
$groups = @{}
foreach ($row in $rows) {
    if ($row.participant_id -cnotmatch '^P[0-9]{3}$' -or
        $row.group -cnotmatch '^Group_[A-Z]+$' -or
        $row.baseline_score -cnotmatch '^[0-9]+([.][0-9]+)?$' -or
        $row.outcome_score -cnotmatch '^[0-9]+([.][0-9]+)?$') {
        throw 'Unexpected CSV value. Confirm you used the synthetic data and the blinded group column.'
    }
    $score = [double]::Parse($row.outcome_score, $invariant)
    if (-not $groups.ContainsKey($row.group)) {
        $groups[$row.group] = @{ N=0; Sum=0.0; SumSq=0.0 }
    }
    $g = $groups[$row.group]
    $g.N++
    $g.Sum += $score
    $g.SumSq += $score * $score
}
$names = @($groups.Keys | Sort-Object)
if ($names.Count -ne 2 -or $rows.Count -ne 48) {
    throw 'Expected exactly 48 rows across 2 blinded groups.'
}
$lines = New-Object 'System.Collections.Generic.List[string]'
[void]$lines.Add('blindstats synthetic blinded analysis (descriptive only)')
[void]$lines.Add('Input: synthetic blinded CSV; original group identities intentionally unknown')
[void]$lines.Add(('Rows: {0}' -f $rows.Count))
[void]$lines.Add('Outcome: outcome_score')
[void]$lines.Add('')
$means = @{}
foreach ($name in $names) {
    $g = $groups[$name]
    $mean = $g.Sum / $g.N
    $means[$name] = $mean
    $variance = if ($g.N -gt 1) { [math]::Max(0, ($g.SumSq - ($g.Sum * $g.Sum / $g.N)) / ($g.N-1)) } else { 0 }
    $sd = [math]::Sqrt($variance)
    [void]$lines.Add(('{0}: n={1}, mean={2}, sample SD={3}' -f $name, $g.N,
        $mean.ToString('F2',$invariant), $sd.ToString('F2',$invariant)))
}
$diff = $means[$names[1]] - $means[$names[0]]
[void]$lines.Add(('Difference in means ({0} minus {1}): {2}' -f $names[1], $names[0], $diff.ToString('F2',$invariant)))
[void]$lines.Add('Exploratory synthetic example only; no real participants and no inferential claims.')
$out = Join-Path $OutputDir 'analysis_artifact.txt'
[System.IO.File]::WriteAllText($out, [string]::Join("`n", $lines) + "`n", $utf8)
Write-Host "Created blinded analysis artifact: $out"
Write-Host 'Use THIS file for Analysis lock in blindstats.'
