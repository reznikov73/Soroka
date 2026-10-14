# Подготовка к отладке (задача VS Code): запускает dev-сервер интерфейса и собирает программу (debug).
# Когда всё готово, печатает маркер "SOROKA DEBUG READY" — по нему VS Code понимает, что можно запускать отладку.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. (Join-Path $PSScriptRoot 'devshell.ps1')

Write-Host '== [debug-prep] запуск dev-сервера интерфейса =='
$vite = $null
$busy = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if (-not $busy) {
    $vite = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -NoNewWindow -PassThru
} else {
    Write-Host '== [debug-prep] порт 1420 уже занят — используем уже запущенный сервер =='
}

Write-Host '== [debug-prep] сборка (debug) =='
& cargo build --no-default-features --manifest-path (Join-Path $root 'src-tauri\Cargo.toml')
if ($LASTEXITCODE -ne 0) {
    Write-Host '== [debug-prep] ОШИБКА СБОРКИ — отмена, отладка не начнётся =='
    if ($vite) { Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

Write-Host '== [debug-prep] ждём готовности сервера на localhost:1420 =='
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
    if (Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) {
    Write-Host '== [debug-prep] сервер не поднялся за 120 секунд =='
    if ($vite) { Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}
Write-Host 'SOROKA DEBUG READY'

if ($vite) { Wait-Process -Id $vite.Id } else { while ($true) { Start-Sleep -Seconds 10 } }