<#
  ReliefRN website + live Foundry agents: one-command local demo (Windows).

  Double-click start-demo.cmd, or run from PowerShell:
      .\start-demo.ps1            live Foundry agents
      .\start-demo.ps1 -Check     sign in and test each agent once, then exit
      .\start-demo.ps1 -Mock      fake agent replies (no Azure), to try the UI
      .\start-demo.ps1 -NoBrowser do not open a browser tab automatically

  Needs: Python 3.10+ and Node.js 22.13+. Everything else is installed into
  this folder. See RUN-LOCALLY.md.
#>
param([switch]$Mock, [switch]$Check, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root   = $PSScriptRoot
$bridge = Join-Path $root 'agent-bridge'
$venvPy = Join-Path $bridge '.venv\Scripts\python.exe'
$health = 'http://127.0.0.1:8765/health'

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "`n$t" -ForegroundColor Red; exit 1 }
function Get-Health { try { Invoke-RestMethod $health -TimeoutSec 3 } catch { $null } }

# ---- 1. Python + bridge dependencies -------------------------------------
Step '1/4  Python'
$pyExe = $null; $pyArgs = @()
foreach ($candidate in 'py -3', 'python', 'python3') {
  $parts = $candidate -split ' '
  if (-not (Get-Command $parts[0] -ErrorAction SilentlyContinue)) { continue }
  $extra = @($parts | Select-Object -Skip 1)
  # No quotes inside -c: Windows PowerShell 5.1 strips them for native programs.
  $ver = & $parts[0] @extra -c "import sys;print(sys.version_info[0]*100+sys.version_info[1])" 2>$null
  if ($ver -and [int]$ver -ge 310) { $pyExe = $parts[0]; $pyArgs = $extra; break }
}
if (-not $pyExe) { Fail 'Python 3.10 or newer is required: https://www.python.org/downloads/  (tick "Add python.exe to PATH")' }
if (-not (Test-Path $venvPy)) {
  Write-Host 'Creating agent-bridge\.venv ...'
  & $pyExe @pyArgs -m venv (Join-Path $bridge '.venv')
  if ($LASTEXITCODE) { Fail 'Could not create the Python virtual environment.' }
}
$req  = Join-Path $bridge 'requirements.txt'
$mark = Join-Path $bridge '.venv\.requirements.sha256'
$hash = (Get-FileHash $req -Algorithm SHA256).Hash
if (-not (Test-Path $mark) -or (Get-Content $mark) -ne $hash) {
  Write-Host 'Installing the Azure SDK for the agent bridge ...'
  & $venvPy -m pip install --quiet --disable-pip-version-check -r $req
  if ($LASTEXITCODE) { Fail 'pip install failed. Check your internet connection and try again.' }
  Set-Content $mark $hash
}
Write-Host "Python OK ($(& $venvPy --version))"

if ($Check) {
  Step 'Checking the live agents (sign-in, then one test message to each)'
  Push-Location $bridge
  try { & $venvPy bridge.py --check; $code = $LASTEXITCODE } finally { Pop-Location }
  exit $code
}

# ---- 2. Node + the ReliefRN website dependencies ---------------------------------------
Step '2/4  Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js 22.13 or newer is required: https://nodejs.org  (LTS installer)' }
$nv = (node --version).TrimStart('v')
if ([version]$nv -lt [version]'22.13') { Fail "Node.js $nv is too old. Install 22.13 or newer from https://nodejs.org" }
if ((Get-Command pnpm -ErrorAction SilentlyContinue) -and ((pnpm --version) -like '11.*')) {
  $pnpmExe = 'pnpm'; $pnpmArgs = @()
} else {
  $pnpmExe = 'npx.cmd'; $pnpmArgs = @('--yes', 'pnpm@11.25.0')
}
if (-not (Test-Path (Join-Path $root 'node_modules\vinext\dist\cli.js'))) {
  Write-Host 'Installing the ReliefRN website dependencies (first run only, about a minute) ...'
  Push-Location $root
  try { & $pnpmExe @pnpmArgs install --frozen-lockfile; $code = $LASTEXITCODE } finally { Pop-Location }
  if ($code) { Fail 'pnpm install failed. Check your internet connection and try again.' }
}
Write-Host "Node OK (v$nv)"

# ---- 3. Agent bridge -----------------------------------------------------
Step '3/4  Agent bridge (connects the ReliefRN website to the Foundry agents)'
$bridgeProc = $null
$h = Get-Health
if ($h) {
  Write-Host "An agent bridge is already running (mode: $($h.mode)). Reusing it."
} else {
  $mockFlag = if ($Mock) { '--mock' } else { '' }
  $cmd = "`$host.UI.RawUI.WindowTitle='ReliefRN agent bridge'; Set-Location '$bridge'; & '$venvPy' bridge.py $mockFlag"
  $bridgeProc = Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd -PassThru
  Write-Host 'Started in a separate window. If a Microsoft sign-in page opens, sign in there.'
  Write-Host 'Waiting for sign-in to finish (up to 3 minutes) ...'
  # The bridge only starts listening once sign-in has succeeded or failed.
  for ($i = 0; $i -lt 180 -and -not $h; $i++) { Start-Sleep 1; $h = Get-Health }
}
if (-not $h) {
  Write-Host 'The bridge did not start. Look at the "ReliefRN agent bridge" window for the error.' -ForegroundColor Yellow
} elseif ($h.ok) {
  $label = if ($h.mode -eq 'mock') { 'MOCK agents (fake replies)' } else { 'Live Foundry agents' }
  Write-Host "$label ready: $($h.agents -join ', ')" -ForegroundColor Green
} else {
  Write-Host "Not signed in to Azure: $($h.detail)" -ForegroundColor Yellow
  Write-Host "the ReliefRN website will run in guided mode. See RUN-LOCALLY.md, 'Sign-in'." -ForegroundColor Yellow
}

# ---- 4. The ReliefRN website -----------------------------------------------------------
Step '4/4  ReliefRN website'
Write-Host 'Opening http://localhost:5173 when it is ready. Press Ctrl+C here to stop everything.'
if (-not $NoBrowser) { Start-Job -ScriptBlock {
  for ($i = 0; $i -lt 120; $i++) {
    try {
      Invoke-WebRequest 'http://localhost:5173/api/config' -UseBasicParsing -TimeoutSec 3 | Out-Null
      Start-Process 'http://localhost:5173'; return
    } catch { Start-Sleep 1 }
  }
} | Out-Null }
Push-Location $root
try {
  & node scripts/run-framework.mjs dev
} finally {
  Pop-Location
  Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
  if ($bridgeProc) {
    & taskkill /PID $bridgeProc.Id /T /F 2>$null | Out-Null
    Write-Host 'Agent bridge stopped.'
  }
}
