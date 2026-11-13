# Auto Study Guidance · 静默启动脚本 (隐藏全部终端窗口)
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$Root = "D:\auto_study_guidance"
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$PythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
$LogDir = Join-Path $BackendDir "data\logs"
$PidFile = Join-Path $LogDir "service_pids.json"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $PythonExe)) {
    throw "未找到后端虚拟环境: $PythonExe"
}

# 1. 静默启动 FastAPI 后端服务 (无窗口)
$backendOutLog = Join-Path $LogDir "backend_stdout.log"
$backendErrLog = Join-Path $LogDir "backend_stderr.log"
$backendProc = Start-Process -FilePath $PythonExe `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $backendOutLog `
    -RedirectStandardError $backendErrLog `
    -PassThru

# 2. 静默启动 Vite 前端工作台 (无窗口)
$frontendOutLog = Join-Path $LogDir "frontend_stdout.log"
$frontendErrLog = Join-Path $LogDir "frontend_stderr.log"
$frontendProc = Start-Process -FilePath "npm.cmd" `
    -ArgumentList "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173" `
    -WorkingDirectory $FrontendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $frontendOutLog `
    -RedirectStandardError $frontendErrLog `
    -PassThru

# 记录后台 PID，便于后续无感停止
@{
    backend_pid  = $backendProc.Id
    frontend_pid = $frontendProc.Id
    started_at   = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8

# 3. 等待服务端口就绪后静默打开浏览器界面
for ($i = 0; $i -lt 25; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 1
        if ($resp.StatusCode -eq 200) { break }
    } catch {
        Start-Sleep -Milliseconds 400
    }
}

if (-not $NoBrowser) {
    Start-Process "http://localhost:5173"
}
