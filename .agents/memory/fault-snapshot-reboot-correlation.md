---
name: Fault snapshot reboot correlation
description: Automatic hardware recovery must wait for a durably promoted snapshot correlated to the exact fault event.
---

The Factory Build review must define why and how fault evidence and reliability
exposure cross reboot, including IDE updates without a direct connection and
Ethernet delivery options.

**Why:** The user explicitly added reboot information handoff and disconnected
IDE reporting to the reliability discussion.

**How to apply:** Distinguish retaining evidence from authorizing reboot or
resumption. Evaluate bridge-mediated versus board-native Ethernet delivery;
neither transport selection nor a new persistence mechanism is approved yet.
Preserve incident identity across retransmission and distinguish CPU reset,
FPGA reconfiguration, and power loss when specifying retention.

When a hardware fault triggers an automatic reboot, the bridge must not treat
an HTTP success for the snapshot transport as permission to reset. It must wait
for server confirmation that the complete snapshot was promoted as Last Fault
for the exact accepted fault event, scoped to the current server generation.
Pending correlation is single-use and must be cleared on any later fault
attempt or terminal snapshot that does not reboot.

Automatic fault recovery authorization must remain distinct from explicit
manual reboot. The board holds execution through the fault frame, waits for a
dedicated post-promotion authorization, and re-announces identity only after
trace and snapshot traffic has drained. Manual reboot may intentionally
override a fault hold, but it must use that same frame-safe UART boundary.

**Why:** A compact trace has only partial state. Rebooting after an
uncorrelated or stale snapshot can permanently associate complete register
state with the wrong fault, especially when other events arrive, a request
fails, or the server restarts and event numbering is reused.

**How to apply:** For any future fault-triggered reset protocol, return a
server-generation identifier plus event ID with the accepted fault event,
include both with the full snapshot, and reboot only after an explicit
promotion acknowledgement. Treat rejected, clean, and competing events as
disarming conditions. Never use the ordinary manual-reboot command as the
automatic authorization signal, and never allow a recovered identity
announcement to preempt a trace or snapshot frame.