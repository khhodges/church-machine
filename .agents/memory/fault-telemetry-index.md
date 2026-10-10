---
name: Fault telemetry and transport
description: Delivery, correlation and incident constraints for hardware fault evidence.
---

- [Snapshot before reboot](fault-snapshot-reboot-correlation.md): exact complete snapshot must be durably promoted.
- [Actionable incidents](actionable-transport-incidents.md): latch failures until proven recovery.
- [Trace delivery](fault-trace-delivery-blocking.md): waiting on trace acceptance can hide fault reporting.
- [Telemetry isolation](fault-telemetry-delivery-isolation.md): decouple serial parsing and reject stale completions.
