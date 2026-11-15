# 停止由 start.ps1 静默启动的前后端服务（路径由脚本位置推导，不写死盘符）
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root "backend\data\logs\service_pids.json"
if (Test-Path $PidFile) {
    $pids = Get-Content $PidFile -Raw | ConvertFrom-Json
    foreach ($p in @($pids.backend_pid, $pids.frontend_pid)) {
        if ($p) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}