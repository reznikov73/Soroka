$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$conf = [IO.File]::ReadAllText("$root\src-tauri\tauri.conf.json") | ConvertFrom-Json
$v = $conf.version
if (-not $v) { throw "version not found in tauri.conf.json" }

# Замена ожидает, что version пакета — первая строка 'version = ...' в Cargo.toml ([package] сверху)
$cargoPath = "$root\src-tauri\Cargo.toml"
$cargo = [IO.File]::ReadAllText($cargoPath)
$cargoNew = $cargo -replace '(?m)^version\s*=\s*"[^"]*"', "version = `"$v`""
if ($cargoNew -ne $cargo) { [IO.File]::WriteAllText($cargoPath, $cargoNew); Write-Host "Cargo.toml -> $v" } else { Write-Host "Cargo.toml: ok ($v)" }

$pkgPath = "$root\package.json"
$pkg = [IO.File]::ReadAllText($pkgPath)
$pkgNew = $pkg -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$v`""
if ($pkgNew -ne $pkg) { [IO.File]::WriteAllText($pkgPath, $pkgNew); Write-Host "package.json -> $v" } else { Write-Host "package.json: ok ($v)" }

Write-Host "All synced to $v"