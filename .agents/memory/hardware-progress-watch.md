---
name: Hardware progress watch requirements
description: User wants a programmable GT-plus-offset progress monitor alongside fault recovery.
---
The user wants to watch a stash value increment each turn in free-run/recovery
mode, with the monitor programmable for any GT + offset rather than hardcoded
to that variable.

**Why:** Progress must be observable across fault capture and Boot.Thread restart,
not just inferred from repeated faults or boot messages.

**How to apply:** Treat readings as physical-board evidence, not simulator or
catalog values. Distinguish sampling from observing every update, and distinguish
retained observations from memory actually retained across reboot. This request
does not authorize flashing hardware or changing capability enforcement.
