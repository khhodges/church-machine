---
name: BootBuild flash acceptance
description: User-required physical acceptance of the Phase 1 BootBuild.mcs image.
---

Phase 1 includes checking that `BootBuild.mcs` works on the FPGA.

The user explicitly designated the uploaded `amoeba-retry-a4acb0ef_1793472697960.bit`
as the golden copy on 2026-10-31. Its SHA-256 is
`a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`.

**Why:** Other workspace and archived bitstreams are not interchangeable with
the user-selected golden source. A filename or build number alone is insufficient.

**How to apply:** Match that full hash when packaging this golden copy. The
designation is source-selection authority, not evidence that flash boot has
passed or permission to program the board.

**Why:** On 2026-10-31 the user explicitly added this requirement while reviewing the 21-slot Namespace fixes. Compiler, simulator, or volatile BIT-loading success does not close flash-image acceptance.

The user clarified on 2026-10-31 that BootBuild.mcs had never been created and that the compiler had already been updated. They then explicitly corrected the proposed rebuild: convert the existing .bit into .mcs; do not recompile to perform this conversion.

**Why:** Flash-image packaging is not a software or FPGA-design rebuild. Preserve the existing bitstream's identity and do not conflate Namespace/compiler changes with conversion.

**How to apply:** Identify the intended existing .bit, convert/package it as BootBuild.mcs using the correct flash configuration, and validate that the MCS payload corresponds to that bitstream. Do not recompile LUMPs, synthesize RTL, or rerun place-and-route for this conversion. Record both artifact hashes, then plan approved flash programming/verification and cold-boot tests. Distinguish initial boot-image evidence from subsequent runtime Namespace loading. This scope statement is not approval to program, reset, or power-cycle the board.
