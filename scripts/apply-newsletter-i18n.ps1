# Applies the "newsletter" i18n block to every locale file. Reads translation
# values from a UTF-8 JSON data file so no non-ASCII literals live in this
# script (Windows PowerShell 5.1 would otherwise misdecode them).
#
# Usage:
#   powershell -File apply-newsletter-i18n.ps1 -TargetDir <lib/i18n dir> -DataFile <data json>

param(
  [Parameter(Mandatory = $true)][string]$TargetDir,
  [Parameter(Mandatory = $true)][string]$DataFile
)

$ErrorActionPreference = "Stop"

$utf8 = New-Object System.Text.UTF8Encoding($false)
$data = [System.IO.File]::ReadAllText($DataFile, $utf8) | ConvertFrom-Json

$order = @(
  "title", "subtitle", "emailPlaceholder", "subscribeButton",
  "invalidEmail", "errorGeneric", "successTitle", "successBody",
  "confirmedTitle", "confirmedBody", "getTheApp", "linkInvalidTitle",
  "linkInvalidBody", "backHome", "unsubscribedTitle", "unsubscribedBody"
)

function Escape-Json([string]$s) {
  return $s.Replace("\", "\\").Replace('"', '\"')
}

foreach ($locale in @("en", "el", "es", "fr", "de", "ar")) {
  $path = Join-Path $TargetDir "$locale.json"
  if (-not (Test-Path $path)) { Write-Host "MISS $locale (no file)"; continue }

  $raw = [System.IO.File]::ReadAllText($path, $utf8)

  # Remove any previously-inserted (possibly corrupted) newsletter block, so
  # this script is idempotent and repairs bad prior runs.
  $raw = [regex]::Replace($raw, '(?s),\s*"newsletter"\s*:.*$', "`n}`n")

  $vals = $data.$locale
  if ($null -eq $vals) { Write-Host "MISS $locale (no data)"; continue }

  $lines = @()
  for ($i = 0; $i -lt $order.Count; $i++) {
    $key = $order[$i]
    $val = Escape-Json ([string]$vals.$key)
    $comma = if ($i -lt $order.Count - 1) { "," } else { "" }
    $lines += "    `"$key`": `"$val`"$comma"
  }
  $block = "  `"newsletter`": {`n" + ($lines -join "`n") + "`n  }"

  $trimmed = $raw.TrimEnd()
  if (-not $trimmed.EndsWith("}")) { throw "Unexpected end of $path" }
  $body = $trimmed.Substring(0, $trimmed.Length - 1).TrimEnd()
  $newContent = $body + ",`n" + $block + "`n}`n"

  [System.IO.File]::WriteAllText($path, $newContent, $utf8)
  Write-Host "OK   $locale"
}
