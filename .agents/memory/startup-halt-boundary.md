---
name: Startup halt boundary
description: Post-sentinel host Halt cannot prove a pause before entry execution.
---

Treat a post-sentinel Halt as best-effort, not a pre-entry pause. Report a
program fault-stop separately from successful startup halt confirmation.

**Why:** The FPGA releases instruction fetch at sentinel transmission, before
the host can receive it and reply. Faster host reads cannot remove that race.

**How to apply:** Preserve nonce/session checks and correlate fault evidence
against the boot's bridge counter boundary, not HTTP arrival order (priority
fault delivery can overtake initial bridge registration, boot-info and older
ordinary traces). Retain authenticated faults by session before registration,
then correlate against trusted boot evidence at display time. Keep them
independently of latest trace until recovery or a new boot boundary. A guaranteed pre-entry hold requires
separate approval for its protocol/reset semantics and hardware acceptance.
