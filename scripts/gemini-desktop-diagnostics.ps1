param(
    [ValidateRange(0, 60)]
    [int]$ObserveSeconds = 0,
    [string[]]$Roots = @(
        (Join-Path $env:LOCALAPPDATA 'Google\Gemini'),
        (Join-Path $env:APPDATA 'Google\Gemini'),
        (Join-Path $env:APPDATA 'Gemini')
    )
)

function Get-GeminiFiles {
    param([string[]]$Directories)

    $files = @{}
    foreach ($directory in $Directories) {
        Get-ChildItem -LiteralPath $directory -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -notin '.exe', '.dll', '.pak', '.asar', '.bin', '.pdb' } |
            ForEach-Object {
                $files[$_.FullName] = [pscustomobject]@{
                    Path = $_.FullName
                    ModifiedUtc = $_.LastWriteTimeUtc
                    Bytes = $_.Length
                }
            }
    }
    return $files
}

$installedRoots = @($Roots | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
if ($installedRoots.Count -eq 0) {
    Write-Output 'Gemini desktop app data folders were not found.'
    return
}

$before = Get-GeminiFiles -Directories $installedRoots
$results = $before.Values
if ($ObserveSeconds -gt 0) {
    Write-Host "Send a test message in the Gemini Windows app within $ObserveSeconds seconds."
    Start-Sleep -Seconds $ObserveSeconds
    $after = Get-GeminiFiles -Directories $installedRoots
    $results = foreach ($file in $after.Values) {
        $previous = $before[$file.Path]
        if ($null -eq $previous -or $file.ModifiedUtc -ne $previous.ModifiedUtc -or $file.Bytes -ne $previous.Bytes) {
            $file
        }
    }
}

if (!$results) {
    if ($ObserveSeconds -gt 0) {
        Write-Output 'No matching files changed during the observation window.'
    } else {
        Write-Output 'No matching files were found.'
    }
    return
}

# Report metadata only. The changed files can contain private app data.
$results | Sort-Object ModifiedUtc -Descending | Select-Object -First 40
