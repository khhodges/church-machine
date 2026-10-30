# Windows PowerShell 5.1+. Single-command experiment, not recovery authorization.
[CmdletBinding()]
param(
    [string]$BuildDirectory = (Join-Path $HOME "uart-packet-build-20261030-073332"),
    [string]$PortName = "COM3"
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-Hash([string]$Path, [string]$Expected) {
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw "Hash mismatch: $Path. No command authorized."
    }
}

$bitHash = "cfc5d7af86c6b3283e1d9faa185fc1ab80d2272e8a0c25e743622dafebb076cb"
$startupHash = "d2533a0e9e30a092baaf4f79f77cf3a99c5bd58d0b70a83d380e67670cf7b329"
$startup = Join-Path $BuildDirectory "startup-20261030-075322.bin"
Assert-Hash (Join-Path $BuildDirectory "candidate-EXPERIMENTAL.bit") $bitHash
Assert-Hash $startup $startupHash
$receiptPath = Join-Path $BuildDirectory "build-receipt.json"
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.files.'candidate-EXPERIMENTAL.bit' -ne $bitHash -or
    $receipt.imageSha256 -ne "e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102") {
    throw "Receipt identity mismatch. No serial port opened."
}

Write-Host "Keep Vivado idle. Stop the bridge and all other serial monitors."
Write-Host "This checks Run against the existing fault. No reboot, recovery, Halt or upload."
Write-Host "It does NOT prove the live BIT identity; the hashes identify the reviewed files."
$confirm = Read-Host "If the board has stayed unchanged since startup capture, type UNCHANGED"
if ($confirm -cne "UNCHANGED") { throw "Cancelled. No serial port opened." }

$dir = Join-Path $BuildDirectory ("fault-hold-check-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $dir | Out-Null
Copy-Item -LiteralPath $startup -Destination (Join-Path $dir "reviewed-startup.bin")
Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $dir "build-receipt.json")
$log = Join-Path $dir "events.txt"
function Record([string]$Message) {
    Add-Content -LiteralPath $log -Value ("{0} {1}" -f [DateTime]::UtcNow.ToString("o"), $Message)
}

$port = [System.IO.Ports.SerialPort]::new($PortName, 57600)
$port.Parity = [System.IO.Ports.Parity]::None
$port.DataBits = 8
$port.StopBits = [System.IO.Ports.StopBits]::One
$port.Handshake = [System.IO.Ports.Handshake]::None
$port.DtrEnable = $false
$port.RtsEnable = $false
$port.ReadTimeout = 100
$port.WriteTimeout = 1000
$stream = $null
$outcome = "INCOMPLETE"

function Capture([string]$Name, [int]$Seconds) {
    $script:stream = [System.IO.File]::Open(
        (Join-Path $dir $Name), [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write
    )
    $buffer = New-Object byte[] 4096
    $count = 0
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        while ($timer.Elapsed.TotalSeconds -lt $Seconds) {
            try {
                $n = $port.Read($buffer, 0, $buffer.Length)
                if ($n -gt 0) {
                    $script:stream.Write($buffer, 0, $n)
                    $script:stream.Flush()
                    $count += $n
                }
            } catch [System.TimeoutException] {}
        }
    } finally {
        $script:stream.Dispose()
        $script:stream = $null
    }
    Record "$Name bytes=$count durationSeconds=$Seconds"
    return $count
}

try {
    Record "Opening $PortName at 57600 8N1; DTR/RTS false; no input-buffer discard"
    $port.Open()
    Write-Host "Recording a 3-second baseline..."
    $baseline = Capture "baseline.bin" 3
    if ($baseline -ne 0) {
        throw "Unexpected baseline traffic saved. Run was NOT sent. Review required."
    }
    $confirm = Read-Host "Send Run ONCE and listen for 10 seconds? Type RUN"
    if ($confirm -cne "RUN") { throw "Cancelled. Run was NOT sent." }
    if ($port.BytesToRead -ne 0) {
        $null = Capture "unexpected-before-run.bin" 1
        throw "Traffic arrived before Run. Run was NOT sent."
    }
    Record "COMMAND_ATTEMPT hex=72 command=Run; no retry permitted"
    $port.Write([byte[]]@(0x72), 0, 1)
    Record "COMMAND_WRITE_RETURNED hex=72 (host write, NOT board acknowledgement)"
    $received = Capture "after-run.bin" 10
    if ($received -eq 0) {
        $outcome = "NO_RESPONSE_OBSERVED; fault-hold proof INCONCLUSIVE; command not acknowledged"
    } else {
        $outcome = "RESPONSE_CAPTURED; review required; no further command sent"
    }
    Record $outcome
} catch {
    $outcome = "STOPPED: " + $_.Exception.Message
    Record $outcome
    Write-Host $outcome
} finally {
    if ($null -ne $stream) { $stream.Dispose() }
    $port.Dispose()
}

@"
Outcome: $outcome
No automated pass is claimed.
Only possible UART write: one Run byte (72 hex).
No recovery authorization, reboot, Halt, Step, Skip Fault, upload or programming.
The recovery and active-trace Halt stages are NOT implemented in this script:
they require review and the established snapshot-promotion authorization path.
Leave the board unchanged and the bridge stopped.
"@ | Set-Content -LiteralPath (Join-Path $dir "READ-ME.txt")
$zip = "$dir.zip"
Compress-Archive -Path (Join-Path $dir "*") -DestinationPath $zip
Write-Host ""
Write-Host "STOP HERE. Upload this ZIP to the chat:"
Write-Host $zip
Start-Process explorer.exe -ArgumentList "/select,`"$zip`""
