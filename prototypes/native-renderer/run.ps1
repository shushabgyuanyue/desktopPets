$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$outputDirectory = Join-Path $PSScriptRoot 'bin'
$output = Join-Path $outputDirectory 'AntsDirect2DPreview.exe'
$packageRoot = Join-Path $env:LOCALAPPDATA 'deskants-native-preview-packages'
$packages = @('sharpdx', 'sharpdx.dxgi', 'sharpdx.direct3d11', 'sharpdx.direct2d1', 'sharpdx.directcomposition')

if (-not (Test-Path $compiler)) {
    throw "The .NET Framework C# compiler was not found: $compiler"
}
New-Item -ItemType Directory -Force -Path $outputDirectory, $packageRoot | Out-Null
foreach ($id in $packages) {
    $archive = Join-Path $packageRoot "$id.4.2.0.zip"
    $destination = Join-Path $packageRoot $id
    if (-not (Test-Path $archive)) {
        Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$id/4.2.0/$id.4.2.0.nupkg" -OutFile $archive
    }
    if (-not (Test-Path $destination)) {
        Expand-Archive -LiteralPath $archive -DestinationPath $destination
    }
}

$runtimeLibraries = @(
    (Join-Path $packageRoot 'sharpdx\lib\net45\SharpDX.dll'),
    (Join-Path $packageRoot 'sharpdx.dxgi\lib\net45\SharpDX.DXGI.dll'),
    (Join-Path $packageRoot 'sharpdx.direct3d11\lib\net45\SharpDX.Direct3D11.dll'),
    (Join-Path $packageRoot 'sharpdx.direct2d1\lib\net45\SharpDX.Direct2D1.dll'),
    (Join-Path $packageRoot 'sharpdx.directcomposition\lib\net45\SharpDX.DirectComposition.dll')
)
$references = $runtimeLibraries + @(
    (Join-Path $framework 'System.Drawing.dll'),
    (Join-Path $framework 'System.Web.Extensions.dll')
) | ForEach-Object { "/reference:$_" }
foreach ($library in $runtimeLibraries) {
    Copy-Item -LiteralPath $library -Destination $outputDirectory -Force
}

& $compiler /nologo /utf8output /target:winexe "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')" `
    "/out:$output" @references (Join-Path $PSScriptRoot 'Direct2DPreview.cs')
if ($LASTEXITCODE -ne 0) { throw "Direct2D preview compilation failed with exit code $LASTEXITCODE" }
Start-Process -FilePath $output -WorkingDirectory $sourceRoot
