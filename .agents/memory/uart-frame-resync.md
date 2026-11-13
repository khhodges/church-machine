---
name: UART magic-byte frame resync
description: Why magic-byte framed trace streams need frame validation + 1-byte rescan
---
Rule: any parser for a magic-byte-prefixed fixed-length UART frame (e.g. 12-byte 0xAA trace packets) must validate the whole candidate frame before consuming it, and on failure advance ONE byte and rescan — never consume the full frame length.

**Why:** the magic byte also appears in payloads (NIA/GT bytes). A mid-stream attach, a dropped byte on reconnect, or line noise makes the parser lock onto a payload 0xAA and emit byte-shifted garbage (e.g. an event whose NIA equals the magic byte, with a byte-shifted GT).

**How to apply:** reject candidates whose fields fail plausibility (address alignment/range, known event type, reserved bits zero, fault code within the authoritative FaultType range — derive the cap from the source of truth, not a hardcoded number). Unit test pattern: attach at every byte offset, drop each byte, payloads full of 0xAA — assert every emitted event matches a real frame.

Boot-sentinel decoding in an unsynchronized stream is not reliable proof of
installed firmware or a hardware fault, especially when the standalone bridge
cannot validate N_INIT. Do not let uncertain framing justify automatic control.

**Why:** A connected bridge reported changing TU/build identifiers amid repeated
frame loss and sent automatic Halt/snapshot requests after those apparent
sentinels. HTTP acceptance and successful pairing did not validate serial data.

**How to apply:** If identifiers change without established reprogramming,
withdraw firmware-identity conclusions and stop active decoding/control before
passive capture. Preserve protected pairing credentials. Identify baud/protocol
from evidence; do not reset, reflash, or call the reported fault a Lazy Load
failure merely to obtain a cleaner trace.

An apparent legacy-trace framing failure may be a different, valid wire
protocol rather than UART corruption or the wrong baud.

**Why:** Passive capture at unchanged baud produced CRC-valid combined observer
packets with advancing application counters and no sticky fault. The legacy
bridge had interpreted their payload bytes as boot sentinels and fault traces.

**How to apply:** Identify complete frames and verify their native CRC before
changing baud or interpreting legacy fault reports. Detect incompatible
protocols before any automatic UART writes. A reported application digest is
not attestation of the exact programmed FPGA bitstream.

Read-only combined-runtime observation must not establish a legacy control
session merely because saved bridge authentication succeeds.

**Why:** Pairing authenticates the PC bridge to the IDE; it does not establish
wire-protocol compatibility or authorize interpreting observer bytes as
instruction/fault evidence.

**How to apply:** Keep passive observation separate from command polling and
legacy trace ingestion. Any future IDE observer display must preserve that
separation and must not imply that Boot2 transfer has been validated.
