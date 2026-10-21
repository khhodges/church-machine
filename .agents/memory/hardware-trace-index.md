---
name: Hardware trace protocols
description: Index of protocol-specific lessons; select the active packet version before applying them.
---
Use the active protocol version, not historical packet sizes.

**Why:** Multiple trace generations coexist in this project's hardware history.

**How to apply:** Read the relevant detailed notes:
- [Single-step trace](wukong-trace-arch.md)
- [Per-event trace packets](trace-unit-per-event-format.md)
- [UART frame resynchronization](uart-frame-resync.md)
- [Disassembly evidence limits](wukong-trace-disassembly.md)
- [Polling rejection containment](wukong-poll-rejection-containment.md) — contain state-update failures as well as fetch failures.
- [Hardware snapshot separation](hardware-snapshot-separation.md) — hardware and simulator execution state must remain distinct.
- [Trace row correlation](trace-row-correlation.md) — combine symbols and words only after identity validation.
- [Trace-symbol preview isolation](trace-symbol-preview-isolation.md) — invalid build inputs must not disable preview labels.
- [Saved-artifact comparisons](fault-saved-comparison.md) — a matching word alone does not prove historical identity.