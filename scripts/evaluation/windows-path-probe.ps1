param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
)

$ErrorActionPreference = "Stop"
$fullPath = [System.IO.Path]::GetFullPath($LiteralPath)
$exists = [System.IO.File]::Exists($fullPath) -or [System.IO.Directory]::Exists($fullPath)
$attributes = @()
$isContainer = $false

if ($exists) {
    $item = Get-Item -LiteralPath $fullPath -Force
    $fullPath = $item.FullName
    $isContainer = [bool]$item.PSIsContainer
    $attributes = @(
        $item.Attributes.ToString().Split(",") |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -ne "" } |
            Sort-Object
    )
}

$driveRoot = [System.IO.Path]::GetPathRoot($fullPath)
$drive = [System.IO.DriveInfo]::new($driveRoot)
$result = [ordered]@{
    schemaVersion = 1
    exists = $exists
    fullPath = $fullPath
    isContainer = $isContainer
    attributes = $attributes
    drive = [ordered]@{
        root = $drive.RootDirectory.FullName
        driveType = $drive.DriveType.ToString()
    }
}

$result | ConvertTo-Json -Compress -Depth 4
