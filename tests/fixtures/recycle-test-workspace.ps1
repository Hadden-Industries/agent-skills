# Called only by temporary-workspace.mjs for its freshly allocated test root.
# Input is data on stdin, never interpolated into executable PowerShell text.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($request.root)
$parent = [IO.Path]::GetFullPath($request.parent)
if ([IO.Path]::GetDirectoryName($root) -ne $parent) {
    throw 'Fixture root is not an immediate child of its recorded temporary parent'
}
$rootItem = Get-Item -LiteralPath $root -Force
$parentItem = Get-Item -LiteralPath $parent -Force
foreach ($item in @($rootItem, $parentItem)) {
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Fixture directory or parent is a reparse point'
    }
}
if ($rootItem.CreationTimeUtc.ToFileTimeUtc() -ne [Int64]$request.rootFileTime -or
    $parentItem.CreationTimeUtc.ToFileTimeUtc() -ne [Int64]$request.parentFileTime) {
    throw 'Fixture directory identity changed before native disposal'
}
$markerPath = Join-Path $root '.test-workspace-owner.json'
$markerItem = Get-Item -LiteralPath $markerPath -Force
if ($markerItem.PSIsContainer -or ($markerItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Fixture ownership marker is not an ordinary file'
}
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $actualHash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($markerPath))).Replace('-', '').ToLowerInvariant()
} finally {
    $sha.Dispose()
}
if ($actualHash -ne $request.ownerSha256) { throw 'Fixture ownership changed before native disposal' }
if (Get-ChildItem -LiteralPath $root -Recurse -Force -Attributes ReparsePoint) {
    throw 'Fixture contains a reparse point'
}
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
    $root,
    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,
    [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
)
