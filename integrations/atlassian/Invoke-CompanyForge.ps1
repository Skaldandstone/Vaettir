param(
  [Parameter(Mandatory)] [ValidateSet('StoreToken','WhoAmI','Register','Environments','ProvisionDemo','Lint','DeployDevelopment','InstallDevelopmentJira','InstallDevelopmentConfluence','Installations')] [string]$Action,
  [string]$DeveloperSpaceId
)
$ErrorActionPreference = 'Stop'
$companyForgeEmail = 'james@skaldandstone.com'
$companyForgeDirectory = Split-Path -Parent $PSCommandPath
$companyForgeRepository = (Resolve-Path -LiteralPath (Join-Path $companyForgeDirectory '../..')).Path
$companyForgePrivateDirectory = Join-Path $companyForgeRepository '.local/atlassian-company'
$companyForgeTokenPath = Join-Path $companyForgePrivateDirectory 'forge-token.dpapi'

if ($Action -eq 'StoreToken') {
  # User-run only: input never appears in chat, command arguments or output.
  $Host.UI.RawUI.WindowTitle = 'Vaettir company Forge token - private input'
  $companyForgeToken = Read-Host 'Paste the Forge token for james@skaldandstone.com (hidden)' -AsSecureString
  if ($companyForgeToken.Length -lt 20) { throw 'No valid token entered. Nothing was stored.' }
  [void](New-Item -ItemType Directory -Path $companyForgePrivateDirectory -Force)
  $companyForgeSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $companyForgePrivateDirectory /inheritance:r /grant:r "*${companyForgeSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the private directory. Token not stored.' }
  $companyForgeToken | ConvertFrom-SecureString | Set-Content -LiteralPath $companyForgeTokenPath
  Write-Output 'Company token stored with Windows user-bound encryption in gitignored .local. No keychain login was changed.'
  exit 0
}
if (!(Test-Path -LiteralPath $companyForgeTokenPath -PathType Leaf)) { throw 'Run this script with -Action StoreToken yourself first. Never paste credentials in chat.' }
$companyForgeOldEmail = $env:FORGE_EMAIL
$companyForgeOldToken = $env:FORGE_API_TOKEN
$companyForgePointer = [IntPtr]::Zero
try {
  $companyForgeSecureToken = (Get-Content -LiteralPath $companyForgeTokenPath -Raw).Trim() | ConvertTo-SecureString
  $companyForgePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($companyForgeSecureToken)
  $env:FORGE_EMAIL = $companyForgeEmail
  $env:FORGE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($companyForgePointer)
  $companyForgeIdentity = & pnpm --dir $companyForgeDirectory exec forge whoami 2>&1
  if ($LASTEXITCODE -ne 0 -or ($companyForgeIdentity -join "`n") -notmatch [regex]::Escape($companyForgeEmail)) { throw 'Company identity could not be verified. No registration or deployment was attempted.' }
  switch ($Action) {
    'WhoAmI' { $companyForgeIdentity }
    'Environments' { & pnpm --dir $companyForgeDirectory exec forge environments list }
    'ProvisionDemo' { & pnpm --dir $companyForgeDirectory exec forge site provision }
    'Register' {
      if ($DeveloperSpaceId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'A verified Skald and Stone Developer Space ID is required. Personal registration is disabled.' }
      & pnpm --dir $companyForgeDirectory exec forge register --developer-space-id $DeveloperSpaceId
    }
    'Lint' { & pnpm --dir $companyForgeDirectory exec forge lint }
    'DeployDevelopment' { & pnpm --dir $companyForgeDirectory exec forge deploy --environment development }
    # Explicit owner consent is required before these actions. The allowlisted
    # company demo site is intentionally not a caller-controlled parameter.
    'InstallDevelopmentJira' { & pnpm --dir $companyForgeDirectory exec forge install --environment development --site one-atlas-mbgp.atlassian.net --product Jira --confirm-scopes --non-interactive }
    'InstallDevelopmentConfluence' { & pnpm --dir $companyForgeDirectory exec forge install --environment development --site one-atlas-mbgp.atlassian.net --product Confluence --confirm-scopes --non-interactive }
    'Installations' { & pnpm --dir $companyForgeDirectory exec forge install list }
  }
  if ($LASTEXITCODE -ne 0) { throw 'Forge command did not complete. Inspect its non-secret output before any retry.' }
} finally {
  $env:FORGE_EMAIL = $companyForgeOldEmail
  $env:FORGE_API_TOKEN = $companyForgeOldToken
  if ($companyForgePointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($companyForgePointer) }
}
