# Auto Study Guidance · 一键启动脚本
$ErrorActionPreference = "Stop"

$Root = "D:\auto_study_guidance"
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$PythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Auto Study Guidance 智能学习资料生成系统" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

if (-not (Test-Path $PythonExe)) {
    Write-Error "未找到后端虚拟环境: $PythonExe"
    exit 1
}

Write-Host "[1/2] 正在启动 FastAPI 后端服务 (http://127.0.0.1:8000)..." -ForegroundColor Green
$backendProc = Start-Process -FilePath $PythonExe `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $BackendDir `
    -PassThru

Write-Host "[2/2] 正在启动 Vite 前端工作台 (http://localhost:5173)..." -ForegroundColor Green
$frontendProc = Start-Process -FilePath "npm.cmd" `
    -ArgumentList "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173" `
    -WorkingDirectory $FrontendDir `
    -PassThru

Start-Sleep -Seconds 2
Write-Host ""
Write-Host "服务已启动！" -ForegroundColor Yellow
Write-Host "  前端界面: http://localhost:5173"
Write-Host "  后端文档: http://127.0.0.1:8000/docs"
Write-Host ""
Write-Host "按 Ctrl+C 或关闭本窗口后，如需停止后台进程可运行: Stop-Process -Id $($backendProc.Id), $($frontendProc.Id)" -ForegroundColor Gray
