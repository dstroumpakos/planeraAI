param(
  [Parameter(Mandatory = $true)][string]$TargetDir,
  [Parameter(Mandatory = $true)][string]$DataFile
)

$ErrorActionPreference = "Stop"

# Inserts a `newsletter: {...}` section into each web locale .ts dictionary.
# Reads translation values from a UTF-8 JSON data file (no non-ASCII literals in
# this script, which PowerShell 5.1 would misdecode). Idempotent.

$utf8 = New-Object System.Text.UTF8Encoding($false)
$data = [System.IO.File]::ReadAllText($DataFile, $utf8) | ConvertFrom-Json

$order = @(
  "title", "subtitle", "emailPlaceholder", "subscribeButton",
  "invalidEmail", "errorGeneric", "successTitle", "successBody",
  "confirmedTitle", "confirmedBody", "getTheApp", "linkInvalidTitle",
  "linkInvalidBody", "backHome", "unsubscribedTitle", "unsubscribedBody"
)

function Escape-Ts([string]$s) {
  return $s.Replace("\", "\\").Replace('"', '\"')
}

foreach ($locale in @("en", "el", "es", "fr", "de", "ar")) {
  $path = Join-Path $TargetDir "$locale.ts"
  if (-not (Test-Path $path)) { Write-Host "MISS $locale (no file)"; continue }

  $raw = [System.IO.File]::ReadAllText($path, $utf8)

  # Strip any prior newsletter block for idempotency (values contain no braces).
  $raw = [regex]::Replace($raw, '(?s)[ \t]*newsletter:\s*\{[^{}]*\},\r?\n', "")

  $vals = $data.$locale
  if ($null -eq $vals) { Write-Host "MISS $locale (no data)"; continue }

  $lines = @()
  foreach ($key in $order) {
    $val = Escape-Ts ([string]$vals.$key)
    $lines += "    $key`: `"$val`","
  }
  $block = "  newsletter: {`n" + ($lines -join "`n") + "`n  },`n"

  # Insert before the object's closing brace (the `};` preceding `export default`).
  $idx = $raw.LastIndexOf("};")
  if ($idx -lt 0) { throw "Could not find closing brace in $path" }
  $before = $raw.Substring(0, $idx)
  $after = $raw.Substring($idx)
  if (-not $before.EndsWith("`n")) { $before = $before + "`n" }
  $newRaw = $before + $block + $after

  [System.IO.File]::WriteAllText($path, $newRaw, $utf8)
  Write-Host "OK   $locale"
}
