Add-Type -AssemblyName System.Drawing

function New-RoundedPath([int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc(0, 0, $d, $d, 180, 90)
  $p.AddArc($w - $d, 0, $d, $d, 270, 90)
  $p.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
  $p.AddArc(0, $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icon([int]$size, [string]$out) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $inset = 0
  $r = [Math]::Max(3, [int]($size * 0.24))
  $path = New-RoundedPath ($size - $inset) ($size - $inset) $r

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point $size, $size),
    [System.Drawing.Color]::FromArgb(255, 96, 205, 255),
    [System.Drawing.Color]::FromArgb(255, 0, 120, 212))
  $g.FillPath($brush, $path)

  # 两支相对箭头 → 翻译符号
  $penW = [Math]::Max(1.4, $size * 0.095)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), $penW
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $s = $size
  # 上箭头：向右
  $g.DrawLine($pen, ($s * 0.24), ($s * 0.38), ($s * 0.72), ($s * 0.38))
  $g.DrawLine($pen, ($s * 0.58), ($s * 0.25), ($s * 0.73), ($s * 0.38))
  $g.DrawLine($pen, ($s * 0.58), ($s * 0.51), ($s * 0.73), ($s * 0.38))
  # 下箭头：向左
  $g.DrawLine($pen, ($s * 0.76), ($s * 0.64), ($s * 0.28), ($s * 0.64))
  $g.DrawLine($pen, ($s * 0.42), ($s * 0.51), ($s * 0.27), ($s * 0.64))
  $g.DrawLine($pen, ($s * 0.42), ($s * 0.77), ($s * 0.27), ($s * 0.64))

  $g.Dispose()
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$dir = Join-Path $PSScriptRoot "."
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
New-Icon 16 (Join-Path $dir "tray-16.png")
New-Icon 32 (Join-Path $dir "tray.png")
New-Icon 64 (Join-Path $dir "icon-64.png")
New-Icon 256 (Join-Path $dir "icon.png")
Write-Output "icons done"
