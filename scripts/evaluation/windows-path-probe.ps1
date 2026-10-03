$ErrorActionPreference = "Stop"

# Resolve the worker's OS dependencies directly. First-use cmdlet discovery can
# scan ambient module locations under a fresh isolated home before parsing the
# first request. PSHOME belongs to the absolute Windows PowerShell executable
# selected by the caller; module names alone would still search PSModulePath.
Import-Module -Name "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
Import-Module -Name "$PSHOME/Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1" -ErrorAction Stop

function Get-WindowsPathMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath
    )

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
    return [ordered]@{
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
}

# Keep one PowerShell runtime alive for the complete manager operation. Each
# input and output line is an independent closed request so the Node client can
# bind a response to the path check that authorized the next filesystem step.
while (($line = [Console]::In.ReadLine()) -ne $null) {
    try {
        $request = $line | ConvertFrom-Json
        if (
            $null -eq $request -or
            $request.schemaVersion -ne 1 -or
            $request.id -isnot [int] -or
            $request.id -lt 1 -or
            $request.path -isnot [string] -or
            $request.path.Length -eq 0
        ) {
            throw "Invalid Windows path probe request."
        }

        $response = [ordered]@{
            schemaVersion = 1
            id = $request.id
            result = Get-WindowsPathMetadata -LiteralPath $request.path
        }
        [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 6))
        [Console]::Out.Flush()
    }
    catch {
        [Console]::Error.WriteLine("Windows path probe request failed.")
        exit 1
    }
}
