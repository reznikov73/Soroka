$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$path = Join-Path $root 'src\styles.css'
$text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
$orig = $text

# --- 1. Поздний блок светлой темы (TASK-043) ---
$lateOld = @'
html[data-theme="light"]{
  --text:#1a1e24; --text2:#66707c; --text3:#8a94a0; --text-strong:#101418;
  --stroke:#e2e6ec; --stroke2:#eef1f5; --edge:#e2e6ec;
  --hover:rgba(15,23,42,.05); --sel:rgba(47,111,216,.10);
  --field:#ffffff; --surface1:#ffffff; --surface2:#f7f8fa;
  --bg-app:#f3f4f6; --bg-card:#ffffff; --bg-elev:#ffffff; --bg-elev-solid:#ffffff;
  --accent:#2f6fd8; --accent-hover:#2a63c4; --accent-ink:#ffffff;
  --accent-weak:rgba(47,111,216,.08); --accent-weak-2:rgba(47,111,216,.14);
  --accent-line:rgba(47,111,216,.45); --ok:#1f7a3f; --danger:#b42318;
  --ai-text:#22262e;
}
'@ -replace "`r`n", "`n"
$lateNew = @'
html[data-theme="light"]{
  --text:#1a2233; --text2:#5d6b85; --text3:#6f7a8f; --text-strong:#0f1626;
  --stroke:#e3e7ee; --stroke2:#eef1f5; --edge:#e3e7ee;
  --hover:#eef1f6; --sel:#e8ebf5;
  --field:#ffffff; --surface1:#ffffff; --surface2:#f7f8fa;
  --bg-app:#f7f8fa; --bg-card:#ffffff; --bg-elev:#ffffff; --bg-elev-solid:#ffffff;
  --accent:#4f46e5; --accent-hover:#4338ca; --accent-ink:#ffffff;
  --accent-weak:rgba(79,70,229,.07); --accent-weak-2:rgba(79,70,229,.14);
  --accent-line:rgba(79,70,229,.45); --ok:#059669; --danger:#dc2626;
  --ai-text:#1a2233;
}
'@ -replace "`r`n", "`n"

if ($text.IndexOf($lateOld, [StringComparison]::Ordinal) -lt 0) { throw 'поздний блок не найден' }
$text = $text.Replace($lateOld, $lateNew)

# --- 2. Ранний блок светлой темы ---
$pairs = @(
    @('  --text: rgba(17, 19, 24, 0.92);', '  --text: #1a2233;'),
    @('  --text2: rgba(17, 19, 24, 0.64);', '  --text2: #5d6b85;'),
    @('  --text3: rgba(17, 19, 24, 0.46);', '  --text3: #6f7a8f;'),
    @('  --text-strong: rgba(0, 0, 0, 0.94);', '  --text-strong: #0f1626;'),
    @('  --hover: rgba(15, 23, 42, 0.06);', '  --hover: #eef1f6;'),
    @('  --sel: rgba(15, 23, 42, 0.09);', '  --sel: #e8ebf5;'),
    @('  --stroke: rgba(15, 23, 42, 0.15);', '  --stroke: #e3e7ee;'),
    @('  --stroke2: rgba(15, 23, 42, 0.09);', '  --stroke2: #eef1f5;'),
    @('  --bg-app: rgba(246, 247, 250, 0.8);', '  --bg-app: #f7f8fa;'),
    @('  --accent: #0f6cbd;', '  --accent: #4f46e5;'),
    @('  --accent-hover: #1b7fd4;', '  --accent-hover: #4338ca;'),
    @('  --accent-weak: rgba(15, 108, 189, 0.07);', '  --accent-weak: rgba(79, 70, 229, 0.07);'),
    @('  --accent-weak-2: rgba(15, 108, 189, 0.13);', '  --accent-weak-2: rgba(79, 70, 229, 0.14);'),
    @('  --accent-line: rgba(15, 108, 189, 0.45);', '  --accent-line: rgba(79, 70, 229, 0.45);'),
    @('  --ok: #1a7f37;', '  --ok: #059669;'),
    @('  --danger: #b42318;', '  --danger: #dc2626;')
)
foreach ($p in $pairs) {
    if ($text.IndexOf($p[0], [StringComparison]::Ordinal) -lt 0) { throw "не найдено: $($p[0])" }
    $text = $text.Replace($p[0], $p[1])
}

# --- 3. Тёмная тема ---
$dark = @(
    @('  --accent: #60cdff;', '  --accent: #8b83ff;'),
    @('  --accent-ink: #032b3d;', '  --accent-ink: #14102b;'),
    @('  --accent-hover: #74d4ff;', '  --accent-hover: #a49dff;'),
    @('  --accent-weak: rgba(96, 205, 255, 0.10);', '  --accent-weak: rgba(139, 131, 255, 0.14);'),
    @('  --accent-weak-2: rgba(96, 205, 255, 0.16);', '  --accent-weak-2: rgba(139, 131, 255, 0.24);'),
    @('  --accent-line: rgba(96, 205, 255, 0.40);', '  --accent-line: rgba(139, 131, 255, 0.50);')
)
foreach ($p in $dark) {
    if ($text.IndexOf($p[0], [StringComparison]::Ordinal) -lt 0) { throw "не найдено: $($p[0])" }
    $text = $text.Replace($p[0], $p[1])
}

# --- 4. Строки светлой темы: замена жёстких цветов ---
$map = [ordered]@{
    '#2f6fd8' = '#4f46e5'
    '#2a63c4' = '#4338ca'
    '#dbe8fb' = '#e6e8fb'
    '#d9e6fb' = '#e6e8fb'
    '#e6eefb' = '#eef0fc'
    '#e8f0fd' = '#eef0fc'
    '#eef4ff' = '#eef0fc'
    '#16345c' = '#241f5c'
    '#1b3a66' = '#241f5c'
    '#cfd6df' = '#e3e7ee'
    '#dfe3ea' = '#e3e7ee'
    '#e2e6ec' = '#e3e7ee'
    '#f3f4f6' = '#f7f8fa'
    '#1a1e24' = '#1a2233'
    '#101418' = '#0f1626'
    '#8a94a0' = '#6f7a8f'
    '#8a92a0' = '#6f7a8f'
    '#66707c' = '#5d6b85'
}

$lines = $text -split "`n"
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'data-theme="light"') {
        foreach ($k in $map.Keys) { $lines[$i] = $lines[$i].Replace($k, $map[$k]) }
    }
}
$text = $lines -join "`n"

# --- 5. Базовые правила с акцентом: на переменные ---
$text = $text.Replace('.reader-actions button.primary{background:#2f6fd8;border-color:#2a63c4;color:#fff;font-weight:600}',
    '.reader-actions button.primary{background:var(--accent);border-color:var(--accent-hover);color:var(--accent-ink);font-weight:600}')
$text = $text.Replace('.reader-actions button.primary:hover{background:#2a63c4}',
    '.reader-actions button.primary:hover{background:var(--accent-hover)}')

# --- 6. Остатки старых синих в любых правилах ---
$text = $text.Replace('#2f6fd8', 'var(--accent)')
$text = $text.Replace('#2a63c4', 'var(--accent-hover)')
$text = $text.Replace('rgba(47, 111, 216,', 'rgba(79, 70, 229,')
$text = $text.Replace('rgba(47,111,216,', 'rgba(79,70,229,')

if ($text -eq $orig) { throw 'ничего не изменилось' }
[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
Write-Output 'styles OK'
