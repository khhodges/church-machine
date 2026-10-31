---
name: BootBuild flash acceptance
description: User-required physical acceptance of the Phase 1 BootBuild.mcs image.
---

Phase 1 includes checking that `BootBuild.mcs` works on the FPGA.

**Why:** On 2026-10-31 the user explicitly added this requirement while reviewing the 21-slot Namespace fixes. Compiler, simulator, or volatile BIT-loading success does not close flash-image acceptance.

**How to apply:** Identify the exact MCS and its provenance first; do not assume the differently named standard build output is identical. Plan approved flash programming/verification and cold-boot tests, then verify the intended boot workload and distinguish initial boot-image evidence from subsequent runtime Namespace loading. This scope statement is not approval to program, reset, or power-cycle the board.
