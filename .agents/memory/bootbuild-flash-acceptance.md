---
name: BootBuild flash acceptance
description: User-required physical acceptance of the Phase 1 BootBuild.mcs image.
---

Phase 1 includes checking that `BootBuild.mcs` works on the FPGA.

**Why:** On 2026-10-31 the user explicitly added this requirement while reviewing the 21-slot Namespace fixes. Compiler, simulator, or volatile BIT-loading success does not close flash-image acceptance.

The user clarified on 2026-10-31 that BootBuild.mcs had never been created and that the compiler had already been updated. They then explicitly corrected the proposed rebuild: convert the existing .bit into .mcs; do not recompile to perform this conversion.

**Why:** Flash-image packaging is not a software or FPGA-design rebuild. Preserve the existing bitstream's identity and do not conflate Namespace/compiler changes with conversion.

**How to apply:** Identify the intended existing .bit, convert/package it as BootBuild.mcs using the correct flash configuration, and validate that the MCS payload corresponds to that bitstream. Do not recompile LUMPs, synthesize RTL, or rerun place-and-route for this conversion. Record both artifact hashes, then plan approved flash programming/verification and cold-boot tests. Distinguish initial boot-image evidence from subsequent runtime Namespace loading. This scope statement is not approval to program, reset, or power-cycle the board.
