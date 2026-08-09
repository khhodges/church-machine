---
name: UART magic-byte frame resync
description: Why magic-byte framed trace streams need frame validation + 1-byte rescan
---
Rule: any parser for a magic-byte-prefixed fixed-length UART frame (e.g. 12-byte 0xAA trace packets) must validate the whole candidate frame before consuming it, and on failure advance ONE byte and rescan — never consume the full frame length.

**Why:** the magic byte also appears in payloads (NIA/GT bytes). A mid-stream attach, a dropped byte on reconnect, or line noise makes the parser lock onto a payload 0xAA and emit byte-shifted garbage (e.g. an event whose NIA equals the magic byte, with a byte-shifted GT).

**How to apply:** reject candidates whose fields fail plausibility (address alignment/range, known event type, reserved bits zero, fault code within the authoritative FaultType range — derive the cap from the source of truth, not a hardcoded number). Unit test pattern: attach at every byte offset, drop each byte, payloads full of 0xAA — assert every emitted event matches a real frame.
