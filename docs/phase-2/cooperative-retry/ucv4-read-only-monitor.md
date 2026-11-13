# Read-only UCV4 monitoring

Use the current downloadable `wukong_bridge.py` (v28 or later) for console
monitoring of the combined observer. Stop any other program using the serial
port first. This does not authorize application upload or FPGA programming.

On Windows, reuse the existing IDE URL and device UID from the saved connection
command, without its consumed pairing code:

```powershell
py -3.13 .\wukong_bridge.py --protocol ucv4 --port COM4 --baud 57600 --ide https://YOUR-IDE --device-uid YOUR-DEVICE-UID
```

Saved Windows authorization is reused through the existing protected storage.
Authorization is checked before opening serial. A failed check does not open
the port. Do not paste credentials or pairing codes into logs.

This mode prints decoded CRC-verified packets in PowerShell, **not in the IDE
hardware trace panel**. It never polls the command queue, registers a live
control session, writes UART commands, reconnects automatically, or changes
application RAM. DTR and RTS are requested deasserted before opening the port.
Ctrl+C closes the port. Serial errors stop the monitor rather than retrying.

Output includes image/input hashes, epoch, sequence, publication/results, progress,
watchdog renewals, sticky fault and remaining ticks. Unknown identities remain
explicitly unknown. CRC proves packet integrity, not device authentication or
the exact programmed bitstream. Identity/epoch changes break continuity;
sequence gaps are reported. Five seconds without a valid packet produces STALE,
not a successful or fault-free current state.

Default `--protocol auto` passively probes for UCV4 for three seconds. It routes
UCV4 to the same read-only monitor. Without a recognized header it stops without
sending commands; it never interprets arbitrary bytes as legacy boot sentinels.
Legacy control requires explicit `--protocol legacy` and an independently
confirmed compatible FPGA configuration. Do not use that switch to bypass an
unreadable or quiet stream.

The previously displayed legacy fault and boot labels are not UCV4 evidence.
This observer does not prove Boot2 admission or authorize sending Boot2 through
either upload protocol.
