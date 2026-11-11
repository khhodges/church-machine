---
name: Wukong operator device identity
description: Confirmed continuity of the physical board and its configured control-routing UID.
---

The user selected “the second one the same as last time” for the combined
starter's hardware trial, after being offered volatile JTAG loading rather
than boot-flash replacement.

**Why:** The existing second-board identity already establishes the intended
target; repeatedly asking which board is unnecessary.

**How to apply:** Use the second-board identity below and verify the live
connection before programming. Preserve the first board and boot flash.
Do not infer a remote programming connection from the vendor build host.

Remember the user's selected Wukong UID across browser sessions and share that
selection between the Target panel and Connect bridge.
**Why:** The user explicitly reported the blank Target UID as unwanted forgetting.
**How to apply:** Persist edits immediately, even before focus leaves the field.
Remembered selection is not live connection evidence, and must never authorize
hardware operations without the existing live UID/session checks.

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

On 2026-11-09 the operator confirmed that the supplied Amoeba retry BIT and
matching BootBuild MCS were used on two different Artix-7 boards with the same
results. This is operator installation evidence, not current RAM readback or
qualification of the later protected Lazy-CALL transition.

**Why:** Repeated requests to identify the programmed build are unnecessary
after the uploaded pair was hash-verified and the operator confirmed both boards.

**How to apply:** Use this as the configuration baseline for the hardware-first
review; do not infer which board is currently connected, later UART contents,
or permission to rebuild, reset or flash.

**Why:** On the second board, a verified snapshot advanced while church-only
filtering caused the IDE to report no fresh retirement and keep Run locked.
The operator repeated Step without the filter and obtained both a fresh
RESULT and explicit Step confirmation.

**How to apply:** Omit `--church-only` during control-path qualification.
Distinguish missing filtered telemetry from lack of board execution; a passed
Step does not establish a complete SelfTest pass.
