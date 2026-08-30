param(
  [Parameter(Mandatory=$true)][string]$DatabaseUrl
)
$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $releaseRoot
$databaseUri = [Uri]$DatabaseUrl
if ($databaseUri.Host -notin @('localhost','127.0.0.1') -or $databaseUri.AbsolutePath -notmatch '^/vaettir_[a-z0-9_]*test$') {
  throw 'Only an explicitly isolated local vaettir_*test database is allowed.'
}
if (git status --porcelain --untracked-files=no) { throw 'Commit tracked changes before collecting release evidence.' }
$revision = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve release commit.' }
$evidenceRoot = Join-Path $releaseRoot ('.local/readiness/' + $revision + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$manifest = [ordered]@{
  releaseCommit = $revision
  branch = (git branch --show-current).Trim()
  startedUtc = (Get-Date).ToUniversalTime().ToString('o')
  node = (& node --version)
  pnpm = (& pnpm --version)
  database = $databaseUri.AbsolutePath.TrimStart('/')
  lockfileSha256 = (Get-FileHash -LiteralPath (Join-Path $releaseRoot 'pnpm-lock.yaml') -Algorithm SHA256).Hash
  checks = @()
  acceptance = 'LOCAL_CHECKS_ONLY'
  productionVerified = $false
  webBuildVariant = 'Windows local production server, not standalone container packaging'
  deviceAccepted = $false
}
$oldDatabase = $env:DATABASE_URL
$oldPublishable = $env:NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
$oldApi = $env:NEXT_PUBLIC_API_URL
$oldLocalBuild = $env:VAETTIR_LOCAL_BUILD
$env:VAETTIR_LOCAL_BUILD = '1'
$env:DATABASE_URL = $DatabaseUrl
$env:NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_ZGV2LnZhZXR0aXIuZXhhbXBsZS5jb20k'
$env:NEXT_PUBLIC_API_URL = 'http://localhost:4000'
function Invoke-ReleaseCheck([string]$CheckName, [string[]]$CommandArguments) {
  $started = Get-Date
  & pnpm @CommandArguments 2>&1 | Tee-Object -FilePath (Join-Path $evidenceRoot ($CheckName + '.log'))
  $resultCode = $LASTEXITCODE
  $manifest.checks += [ordered]@{ name=$CheckName; exitCode=$resultCode; elapsedSeconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2) }
  if ($resultCode -ne 0) { throw "$CheckName failed with exit code $resultCode" }
}
try {
  Invoke-ReleaseCheck 'install' @('install','--frozen-lockfile','--prefer-offline')
  Invoke-ReleaseCheck 'generate' @('db:generate')
  Invoke-ReleaseCheck 'migrate' @('--filter','@vaettir/db','exec','prisma','migrate','deploy')
  Invoke-ReleaseCheck 'seed' @('--filter','@vaettir/db','run','seed')
  Invoke-ReleaseCheck 'migration-status' @('--filter','@vaettir/db','exec','prisma','migrate','status')
  Invoke-ReleaseCheck 'typecheck' @('typecheck')
  Invoke-ReleaseCheck 'lint' @('lint')
  Invoke-ReleaseCheck 'tests' @('test')
  Invoke-ReleaseCheck 'build' @('build')
  Invoke-ReleaseCheck 'expo-compatibility' @('--filter','@vaettir/mobile','exec','expo','install','--check')
  Invoke-ReleaseCheck 'browser-discovery' @('--filter','@vaettir/web','exec','playwright','test','--list')
  $manifest.acceptance = 'LOCAL_CHECKS_PASSED_NOT_BETA_ACCEPTANCE'
} finally {
  $manifest.finishedUtc = (Get-Date).ToUniversalTime().ToString('o')
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'manifest.json') -Encoding utf8
  $env:DATABASE_URL = $oldDatabase
  $env:NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = $oldPublishable
  $env:NEXT_PUBLIC_API_URL = $oldApi
  $env:VAETTIR_LOCAL_BUILD = $oldLocalBuild
  Write-Output ('Evidence: ' + $evidenceRoot)
}
