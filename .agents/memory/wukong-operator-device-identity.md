---
name: Wukong operator device identity
description: Confirmed continuity of the physical board and its configured control-routing UID.
---

On 2026-10-29 the user confirmed the currently programmed Wukong is the same
physical board used on October 26. Reuse its previously recorded operator UID
`20250619ac5c01` for bridge/IDE target configuration.

**Why:** The bridge can monitor COM3 while reporting an empty UID. The user
confirmed physical continuity with the prior recorded board; COM3 alone would
not establish it. This is an operator-provisioned identity, not UART attestation
or proof of a silicon serial number.

**How to apply:** Keep bridge and explicit IDE target selection consistent.
Never infer a UID from a port or session, and reconfirm identity if the physical
board changes. Configuration confirmation does not authorize board commands,
reprogramming, persistent flash changes, or a new image installation.

The operator switched to a separate new XC7A100T board on 2026-11-03 and
reported successful BootBuild.mcs programming after a USB/JTAG retry.
Subsequent Vivado status after the reported power cycle showed DONE and EOS
set, no CRC/ID/security errors, and no fallback. Its reported DNA_PORT is
`058AD4112E1085C`. This establishes configuration evidence, not exact image
provenance or Church Machine runtime qualification. A new operator bridge UID
has not yet been commissioned.

**Why:** The new board's Vivado log showed the same JTAG target identifier
used during the earlier board's session. That identifier must not be treated
as proof that the physical board is unchanged.

**How to apply:** Retain the earlier operator UID for the original handoff
board. Commission a distinct UID for the second board before bridging it;
do not reuse the handoff launcher's hardcoded identity on the new board.
Programming success alone does not prove exact artifact identity or startup.
