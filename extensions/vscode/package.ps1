param(
    [string]$OutputDir = "."
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$VsixName = "asn1-highlight.vsix"
$BuildDir = Join-Path $ScriptDir "_vsix_build"
$ExtDir = Join-Path $BuildDir "extension"

Write-Host "=== ASN.1 Highlight VSIX Packager ===" -ForegroundColor Cyan
Write-Host ""

$RequiredFiles = @(
    (Join-Path $ScriptDir "package.json"),
    (Join-Path $ScriptDir "language-configuration.json"),
    (Join-Path $ScriptDir "syntaxes\asn1.tmLanguage.json")
)

foreach ($f in $RequiredFiles) {
    if (-not (Test-Path $f)) {
        Write-Host "ERROR: Missing required file: $f" -ForegroundColor Red
        exit 1
    }
}

if (Test-Path $BuildDir) {
    Remove-Item -Recurse -Force $BuildDir
}

New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null

Write-Host "[1/4] Copying files..." -ForegroundColor Yellow
Copy-Item (Join-Path $ScriptDir "package.json") $ExtDir
Copy-Item (Join-Path $ScriptDir "language-configuration.json") $ExtDir
Copy-Item -Recurse (Join-Path $ScriptDir "syntaxes") (Join-Path $ExtDir "syntaxes")

Write-Host "[2/4] Creating VSIX manifest..." -ForegroundColor Yellow
@'
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Id="asn1-highlight" Version="0.0.1" Publisher="dlt2811" Language="en-US" />
    <DisplayName>ASN.1 Syntax Highlight</DisplayName>
    <Description>Syntax highlighting for ASN.1 (Abstract Syntax Notation One) files</Description>
    <Tags>asn1;asn.1;syntax-highlighting</Tags>
    <Categories>Programming Languages</Categories>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="package.json" />
  </Assets>
</PackageManifest>
'@ | Out-File -FilePath (Join-Path $BuildDir "extension.vsixmanifest") -Encoding utf8

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
'@
$contentTypesPath = Join-Path $BuildDir "[Content_Types].xml"
Set-Content -LiteralPath $contentTypesPath -Value $contentTypes -Encoding utf8

Write-Host "[3/4] Packing VSIX..." -ForegroundColor Yellow
$ZipPath = Join-Path $ScriptDir "_tmp.zip"
$FinalPath = Join-Path $OutputDir $VsixName

Compress-Archive -Path "$BuildDir\*" -DestinationPath $ZipPath -Force

if (Test-Path $FinalPath) {
    Remove-Item -Force $FinalPath
}
Rename-Item -Path $ZipPath -NewName $VsixName -Force
Move-Item -Path (Join-Path $ScriptDir $VsixName) -Destination $FinalPath -Force

Write-Host "[4/4] Cleaning up..." -ForegroundColor Yellow
Remove-Item -Recurse -Force $BuildDir

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host "VSIX package created: $FinalPath" -ForegroundColor Green
Write-Host "Size: $([Math]::Round((Get-Item $FinalPath).Length / 1KB, 1)) KB" -ForegroundColor Green
