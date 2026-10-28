---
name: Mixed binding replay evidence
description: Avoid false downstream faults in diagnostic replays of mixed portable binding formats.
---

A diagnostic bound-image replay must account for both symbolic and legacy
portable contracts across all resident artifacts. Replacing only the caller's
rows, or only one binding format, is not evidence of a complete prepared image.

**Why:** A symbolic-only diagnostic reached SelfTest with its legacy portable
SELF still unresolved and produced a misleading downstream fault. Including
the existing binding derivatives for both formats removed that diagnostic
artifact.

**How to apply:** Preserve residency, validate snapshot bytes and geometry, and
label manually assembled in-memory probes as hypotheses—not service-generated,
approved images or complete browser acceptance. Do not promote intermediate
probe faults into product regression claims.
