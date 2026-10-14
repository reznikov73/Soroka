# Обёртка задач VS Code: активирует окружение (cargo + MSVC) и выполняет cargo-команду.
# Пример: powershell -File scripts\vsc-task.ps1 -Cmd "tauri dev"
param(
    [string]$Dir = '.',
    [string]$Cmd = 'build'
)

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'devshell.ps1')
Set-Location (Join-Path $root $Dir)

# ВАЖНО: @( ... ) — чтобы одиночный элемент остался массивом.
$argv = @($Cmd.Split(' ') | Where-Object { $_ -ne '' })
& cargo @argv
exit $LASTEXITCODE
