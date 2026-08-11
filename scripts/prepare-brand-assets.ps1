param(
  [string]$HeroSource = "C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-965daeb4-bbf6-43fe-8719-41997938d208.png",
  [string]$ClosingSource = "C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-a777f798-4acc-484c-ac85-436864855274.jpg"
)

Add-Type -AssemblyName System.Drawing

function Export-BrandImage {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][int]$MaxWidth,
    [int]$Quality = 88
  )

  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  try {
    $targetWidth = [Math]::Min($MaxWidth, $sourceImage.Width)
    $targetHeight = [Math]::Round($sourceImage.Height * ($targetWidth / $sourceImage.Width))
    $bitmap = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
    try {
      $bitmap.SetResolution(96, 96)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($sourceImage, 0, 0, $targetWidth, $targetHeight)
      }
      finally {
        $graphics.Dispose()
      }

      $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq "image/jpeg" }
      $encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
      $encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
        [System.Drawing.Imaging.Encoder]::Quality,
        [long]$Quality
      )
      try {
        $bitmap.Save($Destination, $jpegCodec, $encoderParameters)
      }
      finally {
        $encoderParameters.Dispose()
      }
    }
    finally {
      $bitmap.Dispose()
    }
  }
  finally {
    $sourceImage.Dispose()
  }
}

$assets = Join-Path $PSScriptRoot "..\assets"
New-Item -ItemType Directory -Path $assets -Force | Out-Null

Export-BrandImage -Source $HeroSource -Destination (Join-Path $assets "hero-orchard.jpg") -MaxWidth 1400
Export-BrandImage -Source $ClosingSource -Destination (Join-Path $assets "closing-path.jpg") -MaxWidth 1800

Get-Item (Join-Path $assets "hero-orchard.jpg"), (Join-Path $assets "closing-path.jpg") |
  Select-Object Name, Length, LastWriteTime
