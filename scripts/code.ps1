# Запуск VS Code с окружением (cargo + MSVC).
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'devshell.ps1')
Set-Location $root
code .
