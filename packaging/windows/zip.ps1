# Write the portable zip with the entry names a reader will ask for.
#
# **`Compress-Archive` cannot be used here.** Windows PowerShell 5.1 writes entry names with a
# backslash — `mixengine\mix.exe` — where the ZIP specification says the separator is a forward
# slash (APPNOTE 4.4.17.1). `packaging/feed.sh` matches `mixengine/`, so the first tagged release
# stopped at "holds no binaries under mixengine/" with five perfectly good build legs behind it;
# and the same names are what `mix self-update` reads back out of this artifact.
#
# .NET's own `ZipFile` is in the box on every Windows, so naming each entry by hand keeps the
# property the portable artifact was written for: nothing has to be installed to build it.

param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

# `Create` refuses to open a file that is already there, and a stale zip from an earlier build is
# not something to append this one to.
if (Test-Path -LiteralPath $Destination) {
    Remove-Item -Force -LiteralPath $Destination
}

# The one directory the archive holds, so unzipping into Downloads does not scatter four binaries
# there. Taken from $Source rather than written out, so the name has one origin.
$prefix = Split-Path -Leaf $Source

$zip = [System.IO.Compression.ZipFile]::Open($Destination, "Create")
try {
    foreach ($file in Get-ChildItem -File -LiteralPath $Source) {
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $file.FullName, "$prefix/$($file.Name)")
    }
}
finally {
    $zip.Dispose()
}
