---
name: Fault snapshot reboot correlation
description: Automatic hardware recovery must wait for a durably promoted snapshot correlated to the exact fault event.
---

When a hardware fault triggers an automatic reboot, the bridge must not treat
an HTTP success for the snapshot transport as permission to reset. It must wait
for server confirmation that the complete snapshot was promoted as Last Fault
for the exact accepted fault event, scoped to the current server generation.
Pending correlation is single-use and must be cleared on any later fault
attempt or terminal snapshot that does not reboot.

**Why:** A compact trace has only partial state. Rebooting after an
uncorrelated or stale snapshot can permanently associate complete register
state with the wrong fault, especially when other events arrive, a request
fails, or the server restarts and event numbering is reused.

**How to apply:** For any future fault-triggered reset protocol, return a
server-generation identifier plus event ID with the accepted fault event,
include both with the full snapshot, and reboot only after an explicit
promotion acknowledgement. Treat rejected, clean, and competing events as
disarming conditions.