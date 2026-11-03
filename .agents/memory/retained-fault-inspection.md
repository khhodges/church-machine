---
name: Retained hardware fault inspection
description: Keep retained diagnostics independent of execution, publication, and newer machine state.
---

Opening retained hardware evidence is inspection only: reuse the existing fault dialog, preserve unknown values, and do not reset, step, run, flash, or publish as a prerequisite.

**Why:** The user chose immediate improved-preview inspection rather than updating the published site. Simulator startup and nullable telemetry blocked access even though complete hardware evidence was already available.

**How to apply:** Read the exact accepted incident independently of simulator boot. Do not enrich its registers with a newer machine state or infer an installed image from the current simulator catalog. Explicit reference selection remains distinct from hardware attestation.
