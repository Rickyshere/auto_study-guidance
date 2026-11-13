# 停止由 start.ps1 静默启动的前后端服务
$PidFile = "D:\auto_study_guidance\backend\data\logs\service_pids.json"
if (Test-Path $PidFile) {
    $pids = Get-Content $PidFile -Raw | ConvertFrom-Json
    foreach ($p in @($pids.backend_pid, $pids.frontend_pid)) {
        if ($p) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
