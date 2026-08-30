param(
  [Parameter(Mandatory=$true)][string]$DatabaseUrl,
  [ValidateSet('local-server','standalone')][string]$WebBuild = 'local-server'
)
$ErrorActionPreference = 'Stop'
$previousDatabase = $env:DATABASE_URL
try {
  $env:DATABASE_URL = $DatabaseUrl
  & node (Join-Path $PSScriptRoot 'collect-release-evidence.mjs') --web-build $WebBuild
  if ($LASTEXITCODE -ne 0) { throw 'Candidate validation failed. See the evidence manifest and sanitized logs.' }
} finally {
  $env:DATABASE_URL = $previousDatabase
}
