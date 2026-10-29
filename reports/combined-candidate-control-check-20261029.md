# Combined candidate control check — 2026-10-29

## Scope

Continue the already-approved reboot/Halt investigation on the operator-confirmed
Wukong. Do not install the server's different Namespace, upload bytes, flash,
Run, Step, or Skip Fault. The later usability review is separate.

## Independent Namespace comparison

The frozen candidate-le.bin is 65,536 bytes, SHA-256
`e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102`.
Its root entry names NS21, method entry 0x4610.

The published server's existing committed image is 65,536 bytes, SHA-256
`0ff1b24d76b7010c13b8b50737f4513a771b586be73b8d0fa80a748087070a5b`.
The saved Namespace contains slots 0–7 and 10–13, with CapabilityTest at slot 10
marked boot. The normal binary endpoint returns 409 because its inputs are stale.
The documented simulator read-only option returned existing committed bytes;
no generation, installation or upload was requested.

These are different images. Neither the server Namespace nor these downloads
are physical FPGA memory readback.

## Live control evidence

The live bridge reported operator UID `20250619ac5c01`, bridge version 19,
session `940aa470bc6c4934b430c6ac3028fe0f`.
Existing authorization passed a read-only build-status request (HTTP 200).
No credential was displayed or recorded.

Exactly one explicit Reboot POST was accepted, command ID 1:

- queued: Unix timestamp 1793311076.2613184
- consumed: 1793311076.9687827
- serial-write acknowledgement: success, 1793311077.829961
- trusted boot sentinel received: 1793311080.4091485
- sentinel reports build 20, TraceUnit version 2, matching device and session
- automatic post-sentinel Halt requested nonce 1; confirmation timed out

Exactly one explicit Halt POST was then accepted, command ID 2:

- queued: 1793311101.305956
- serial-write acknowledgement: success, 1793311102.2642574
- nonce 2, state-counter baseline 0
- board_halt_confirmed remained false; confirmation timed out
- no complete current-session snapshot was available

The bridge remained polling. No active fault was reported, but absence of a
fault is not evidence of a completed program or confirmed halted state.

Newly arriving trace records include NIA 0x461C and later 0x086C, with bridge
timestamps preceding the explicit reboot's serial-write timestamp. Do not
treat their HTTP arrival order as proof of post-reboot execution. The server's
NIA labels are marked unverified and come from a different reference image.

## Remaining boundary

Reboot delivery and a correlated startup message are established. Confirmed
Halt and a complete startup/snapshot trace are not established.

The frozen source contains nonce-bearing halt-state emission; it is therefore
not justified to assume that this image lacks the confirmation protocol.
The next necessary evidence is the Windows bridge console output around this
reboot and explicit Halt, to distinguish raw serial framing, parsing, and
server-delivery failures. No additional board commands should be used merely
to replace missing evidence.

## Operator UART log and isolated arbitration reproduction

The subsequent Windows console capture starts after the same port reopen and
boot sentinel, followed by Boot's CALL to NS21, entry 0x4610, CALL into NS10,
the SelfTest path, RETURN at 0x0FD0 and CALL to WukongCallHome at 0x2868.
This provides serial-stream ordering missing from server arrival timestamps.
It establishes substantially more startup progress, but a SelfTest RETURN alone
does not establish every test's success status.

At NIA 0x1814, the bridge prints a LOAD.shadow payload of 0x000000AD with flags
N, loses frame sync, discards six bytes, and reacquires at LOAD.new for the same
NIA. It later reports trace POST timeouts and rejection of a non-fault snapshot.
The displayed "Explicit Halt" dialog lacks command/session correlation and must
not be used as permission to Step or Run.

`scripts/reproduce_halt_trace_interleaving.py` exercises the exact combinational
TX arbiter extracted from the frozen source in Amaranth. Source SHA-256:
`fbb5460cfa0db92164558c4ac2161ee5c0290db0f89834809173d9e5ee9b5c58`.

The arbiter chooses Halt response bytes over an unfinished trace packet. Injecting
the valid six-byte Halt response after byte 8 of a trace reproduces all of:

- NIA 0x1814 and LOAD.shadow unchanged;
- payload 0x000000AD;
- flags value 1;
- fault_valid false;
- six leftover bytes before the next trace packet.

Both observed request nonces (1 and 2) reproduce that corruption pattern.
Serializing the complete trace followed by the complete Halt response instead
decodes correctly using the bridge's existing parser.

This is an extracted-arbiter simulation, not a full-top simulation or capture
of the physical raw UART bytes. It establishes a packet-interleaving defect in
the frozen source and a specific matching explanation for the observed framing
loss. It does not independently prove every live byte took that path.

### Correction boundary

The appropriate correction is packet ownership in the FPGA UART transmitter,
not trusting an uncorrelated UI Halt, weakening the parser, or guessing at bytes
to delete. Validate the full mux (trace, Halt state, snapshots, sentinel, upload
ACK and console output) and producer backpressure so atomic frames do not drop
console writes or deadlock recovery.

Preserve the approved image and existing frozen artifacts. Any replacement
hardware candidate requires full-model validation, vendor build evidence and
separate approval before programming. No new hardware commands, source
replacement, image upload or programming was performed in this follow-up.
