---
name: Fault telemetry and transport
description: Delivery, correlation and incident constraints for hardware fault evidence.
---

- [Snapshot before reboot](fault-snapshot-reboot-correlation.md): exact complete snapshot must be durably promoted.
- [Actionable incidents](actionable-transport-incidents.md): latch failures until proven recovery.
- [Trace delivery](fault-trace-delivery-blocking.md): waiting on trace acceptance can hide fault reporting.
- [Telemetry isolation](fault-telemetry-delivery-isolation.md): decouple serial parsing and reject stale completions.
- [Startup halt boundary](startup-halt-boundary.md): post-sentinel Halt is best-effort, not a pre-entry pause.
- [Board acknowledgement correlation](board-state-ack-correlation.md): nonce and bridge session must bind stopped-state evidence to the exact command.
- [Bridge-causal retirement gates](bridge-causal-retirement-gates.md): use bridge-side counters, not server receive order.
- [UART transfer ownership](uart-raw-transfer-ownership.md): defer control bytes throughout framed payloads.
- [One-shot Skip Fault](wukong-skip-fault-protocol.md): authenticated FPGA-sequence proof is required; lost correlation requires reboot.
- [Command locking](single-slot-delivery-watch-lock.md): hold busy through terminal delivery state.
- [Command correlation](single-slot-cmd-ack-correlation.md): correlate by monotonic command ID, never letter or time-window heuristics.
