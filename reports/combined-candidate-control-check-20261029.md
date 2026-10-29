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
