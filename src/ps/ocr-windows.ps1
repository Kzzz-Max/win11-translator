param(
  [string]$Mode = 'ocr',
  [string]$Path = '',
  [string]$OutFile = '',
  [string]$LangTag = ''
)

# Windows.Media.Ocr 本地识别（零依赖、离线）。
# -Mode list : 输出本机已安装的 OCR 识别器语言标签，逗号分隔
# -Mode ocr  : 识别 $Path 图片，逐行写入 $OutFile（UTF-8 无 BOM）
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

if ($Mode -eq 'list') {
  $tags = @()
  foreach ($l in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) { $tags += $l.LanguageTag }
  [Console]::Out.WriteLine(($tags -join ','))
  exit 0
}

if (-not (Test-Path -LiteralPath $Path)) {
  [Console]::Error.WriteLine("IMAGE_NOT_FOUND")
  exit 2
}

$engine = $null
if ($LangTag -ne '') {
  try {
    $lang = New-Object Windows.Globalization.Language $LangTag
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
  } catch { $engine = $null }
}
if ($null -eq $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if ($null -eq $engine) {
  [Console]::Error.WriteLine("NO_OCR_ENGINE")
  exit 3
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$lines = @()
foreach ($line in $result.Lines) { $lines += $line.Text }
$text = ($lines -join "`n")

$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $text, $enc)

[Console]::Out.WriteLine("LINES:" + $lines.Count)
