param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$manager = Join-Path $PSScriptRoot 'my-blog-manager'
$runtime = Join-Path $PSScriptRoot '.local-runtime'
$python = Join-Path $runtime 'venv\Scripts\python.exe'
$requirements = Join-Path $manager 'requirements.txt'
$next = Join-Path $manager 'node_modules\next\dist\bin\next'
function Initialize-Python {
    if (!(Test-Path -LiteralPath $python)) {
        Write-Host 'Preparing the local Python environment...'
        $pythonLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
        $systemPython = Get-Command python.exe -ErrorAction SilentlyContinue
        if ($pythonLauncher) {
            & $pythonLauncher.Source -3 -m venv (Join-Path $runtime 'venv')
        } elseif ($systemPython) {
            & $systemPython.Source -m venv (Join-Path $runtime 'venv')
        } else {
            throw 'Python 3 is required. Install Python, then open the manager again.'
        }
        if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $python)) {
            throw "Could not create the Python environment in $runtime"
        }
    }
    & $python -X utf8 -c "import importlib.util, sys; modules = ['fastapi', 'uvicorn', 'multipart', 'requests', 'yaml', 'markdown', 'markdownify', 'httpx']; sys.exit(any(importlib.util.find_spec(name) is None for name in modules))"
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Installing the manager dependencies. This is only needed on the first launch...'
        & $python -X utf8 -m pip install --disable-pip-version-check -r $requirements
        if ($LASTEXITCODE -ne 0) {
            throw 'Python dependency installation failed. Check the messages above, then try opening the manager again.'
        }
    }
}
function Test-OurPort([int]$Port, [string]$Marker) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if (!$listeners.Count) { return $false }
    foreach ($listener in $listeners) {
        $processId = $listener.OwningProcess
        $ours = $false
        for ($i = 0; $i -lt 6 -and $processId -gt 0; $i++) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
            if (!$proc) { break }
            if ($proc.CommandLine -and $proc.CommandLine.IndexOf($Marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $ours = $true; break }
            $processId = $proc.ParentProcessId
        }
        if (!$ours) { throw "Port $Port is used by another service. No process was stopped." }
    }
    return $true
}
function Wait-Page([string]$Url) {
    for ($i = 0; $i -lt 90; $i++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Seconds 1
    }
    throw "Service did not become ready: $Url . Check logs in $runtime"
}
try {
    if (!(Test-Path -LiteralPath $next)) { throw "Manager dependencies missing. Run npm ci in: $manager" }
    $node = (Get-Command node -ErrorAction Stop).Source
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    Initialize-Python
    $backendReady = Test-OurPort 8765 $manager
    $frontendReady = Test-OurPort 3010 $next
    [IO.File]::WriteAllText((Join-Path $manager 'public\backend_config.json'), '{"api_port":8765}', (New-Object Text.UTF8Encoding($false)))
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:NODE_TLS_REJECT_UNAUTHORIZED = '1'
    if (!$backendReady) {
        Start-Process -FilePath $python -ArgumentList @('-X', 'utf8', '-m', 'uvicorn', 'cms_core.main:app', '--app-dir', ('"' + $manager + '"'), '--host', '127.0.0.1', '--port', '8765') -WorkingDirectory $manager -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'manager-backend.log') -RedirectStandardError (Join-Path $runtime 'manager-backend-error.log') | Out-Null
    }
    Wait-Page 'http://127.0.0.1:8765/openapi.json'
    if (!$frontendReady) {
        Start-Process -FilePath $node -ArgumentList @(('"' + $next + '"'), 'dev', '--hostname', '127.0.0.1', '--port', '3010') -WorkingDirectory $manager -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'manager-frontend.log') -RedirectStandardError (Join-Path $runtime 'manager-frontend-error.log') | Out-Null
    }
    Write-Host 'Starting the local blog manager. The first launch can take a little time...'
    Wait-Page 'http://127.0.0.1:3010/settings'
    Write-Host 'Manager: http://127.0.0.1:3010/settings'
    Write-Host 'Backend: http://127.0.0.1:8765'
    Write-Host "Logs: $runtime"
    Write-Host 'You can close this window; the local manager will keep running.'
    if (!$NoBrowser) { Start-Process 'http://127.0.0.1:3010/settings' }
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
