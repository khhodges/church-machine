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
provenance or Church Machine runtime qualification. The operator subsequently
started the second board's bridge with distinct UID `058ad4112e1085c`, derived
from that DNA value. The published IDE reported this UID in both bridge and
boot evidence, BUILD v20 / TU_VERSION 2, with session-matched halt confirmation.
Keep this operator-assigned identity distinct from the original handoff board;
it is not cryptographic hardware attestation or exact BIT-hash verification.

**Why:** The new board's Vivado log showed the same JTAG target identifier
used during the earlier board's session. That identifier must not be treated
as proof that the physical board is unchanged.

**How to apply:** Retain the earlier operator UID for the original handoff
board. Use the distinct commissioned UID above for the second board;
do not reuse the handoff launcher's hardcoded identity on the new board.
Programming success alone does not prove exact artifact identity or startup.

Use unfiltered bridge telemetry for physical Step qualification.

**Why:** On the second board, a verified snapshot advanced while church-only
filtering caused the IDE to report no fresh retirement and keep Run locked.
The operator repeated Step without the filter and obtained both a fresh
RESULT and explicit Step confirmation.

**How to apply:** Omit `--church-only` during control-path qualification.
Distinguish missing filtered telemetry from lack of board execution; a passed
Step does not establish a complete SelfTest pass.
