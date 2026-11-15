' 用脚本自身所在目录定位 start.ps1，避免写死盘符
Dim fso, here, target
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
target = fso.BuildPath(here, "start.ps1")
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & target & """", 0, False