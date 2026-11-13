$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SrcFile = Join-Path $RootDir "desktop\AutoStudyGuidanceApp.cs"
$IconFile = Join-Path $RootDir "desktop\app_logo.ico"
$OutExe = Join-Path $RootDir "AutoStudyGuidance.exe"

# Stop running standalone desktop instance if locked before recompiling
Get-Process -Name "AutoStudyGuidance" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

$CscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $CscPath)) {
    throw "未找到 .NET Framework 4.x csc.exe: $CscPath"
}

$WebView2Dir = @(
    "C:\Program Files\Microsoft OfficePLUS\4.2.0.8924\addin",
    "C:\Program Files\Microsoft Office\root\Office16\ADDINS\Microsoft Power Query for Excel Integrated\bin"
) | Where-Object { Test-Path (Join-Path $_ "Microsoft.Web.WebView2.WinForms.dll") } | Select-Object -First 1

if (-not $WebView2Dir) {
    throw "未在本机找到 Microsoft.Web.WebView2.WinForms.dll"
}

$CoreDll = Join-Path $WebView2Dir "Microsoft.Web.WebView2.Core.dll"
$WinFormsDll = Join-Path $WebView2Dir "Microsoft.Web.WebView2.WinForms.dll"
$LoaderDll = Join-Path $WebView2Dir "runtimes\win-x64\native\WebView2Loader.dll"

Copy-Item $CoreDll -Destination (Join-Path $RootDir "Microsoft.Web.WebView2.Core.dll") -Force
Copy-Item $WinFormsDll -Destination (Join-Path $RootDir "Microsoft.Web.WebView2.WinForms.dll") -Force
if (Test-Path $LoaderDll) {
    Copy-Item $LoaderDll -Destination (Join-Path $RootDir "WebView2Loader.dll") -Force
}

Write-Host "Using WebView2 SDK assemblies from: $WebView2Dir"
$cscArgs = @(
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    "/out:$OutExe",
    "/reference:System.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll",
    "/reference:$(Join-Path $RootDir 'Microsoft.Web.WebView2.Core.dll')",
    "/reference:$(Join-Path $RootDir 'Microsoft.Web.WebView2.WinForms.dll')"
)
if (Test-Path $IconFile) {
    Write-Host "Embedding application icon: $IconFile"
    $cscArgs += "/win32icon:$IconFile"
}
$cscArgs += "$SrcFile"

& $CscPath @cscArgs

if ($LASTEXITCODE -ne 0 -or -not (Test-Path $OutExe)) {
    throw "csc.exe 编译 AutoStudyGuidance.exe 失败"
}

Write-Host "Built desktop executable: $OutExe"
Get-Item $OutExe | Select-Object Name, Length, LastWriteTime
