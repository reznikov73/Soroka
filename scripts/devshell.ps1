# Активация окружения разработки (Windows, эта машина).
# Использование (dot-source!):   . .\scripts\devshell.ps1
# Скрипт идемпотентный: повторный вызов не портит PATH и env.
$ErrorActionPreference = 'Continue'

$env:CARGO_HOME  = 'E:\dev\Rust\cargo'
$env:RUSTUP_HOME = 'E:\dev\Rust\rustup'
if ($env:Path -notlike '*E:\dev\Rust\cargo\bin*') {
    $env:Path = $env:Path + ';E:\dev\Rust\cargo\bin'
}

# MSVC x64 (линкер link.exe + LIB/INCLUDE). VSCMD_ARG_TGT_ARCH выставляется vcvars —
# используем его как маркер «уже активировано».
if ($env:VSCMD_ARG_TGT_ARCH -ne 'x64') {
    $vcvars = 'E:\dev\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat'
    if (-not (Test-Path $vcvars)) {
        Write-Warning "devshell: не найден $vcvars — MSVC не активирован"
        return
    }
    $dump = cmd /c ('"{0}" >nul 2>&1 && set' -f $vcvars)
    foreach ($line in $dump) {
        if ($line -match '^([^=]+)=(.*)$') {
            Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2] -Force
        }
    }
}

if ($env:VSCMD_ARG_TGT_ARCH -eq 'x64') {
    Write-Host 'devshell: cargo + MSVC x64 активированы' -ForegroundColor Green
} else {
    Write-Warning 'devshell: MSVC активация не подтверждена'
}
