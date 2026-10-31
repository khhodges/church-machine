---
name: BootBuild flash acceptance
description: User-required physical acceptance of the Phase 1 BootBuild.mcs image.
---

Phase 1 includes checking that `BootBuild.mcs` works on the FPGA.

**Why:** On 2026-10-31 the user explicitly added this requirement while reviewing the 21-slot Namespace fixes. Compiler, simulator, or volatile BIT-loading success does not close flash-image acceptance.

The user clarified on 2026-10-31 that BootBuild.mcs had never been created and that the compiler had already been updated.

**Why:** Do not frame the pending build as a lost existing artifact or diagnose current compiler behavior from historical compiled LUMPs.

**How to apply:** Prepare a new candidate using the updated compiler and verify its exact output before creating the MCS through the FPGA build/packaging flow. Preserve historical LUMPs rather than silently replacing them. Record the resulting MCS provenance, then plan approved flash programming/verification and cold-boot tests. Distinguish initial boot-image evidence from subsequent runtime Namespace loading. This scope statement is not approval to program, reset, or power-cycle the board.
