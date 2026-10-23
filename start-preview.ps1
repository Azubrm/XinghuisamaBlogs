param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$blog = Join-Path $PSScriptRoot 'XHBlogs'
$runtime = Join-Path $env:LOCALAPPDATA 'XinghuiBlogsPreview'
$next = Join-Path $blog 'node_modules\next\dist\bin\next'
try {
    if (!(Test-Path -LiteralPath $next)) { throw "Blog dependencies missing. Run npm ci in: $blog" }
    $node = (Get-Command node -ErrorAction Stop).Source
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 3020 -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $processId = $listener.OwningProcess
        $ours = $false
        for ($i = 0; $i -lt 6 -and $processId -gt 0; $i++) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
            if (!$proc) { break }
            if ($proc.CommandLine -and $proc.CommandLine.IndexOf($blog, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $ours = $true; break }
            $processId = $proc.ParentProcessId
        }
        if (!$ours) { throw 'Port 3020 is used by another service. No process was stopped.' }
    }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    if (!$listeners.Count) {
        Start-Process -FilePath $node -ArgumentList @(('"' + $next + '"'), 'dev', '--hostname', '127.0.0.1', '--port', '3020') -WorkingDirectory $blog -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'blog-preview.log') -RedirectStandardError (Join-Path $runtime 'blog-preview-error.log') | Out-Null
    }
    Write-Host 'Starting your personal blog preview. The first launch can take a little time...'
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3020' -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw "Preview did not become ready. Check logs in $runtime" }
    Write-Host 'Preview: http://127.0.0.1:3020'
    Write-Host "Blog directory: $blog"
    Write-Host "Logs: $runtime"
    Write-Host 'You can close this window; the local preview will keep running.'
    if (!$NoBrowser) { Start-Process 'http://127.0.0.1:3020' }
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
