---
name: Resident image binding validation
description: How to detect stale resident artifacts without rejecting legitimate image-time capability localization.
---

Validate a resident boot-image binding with the selected artifact hash, Namespace slot and sequence, allocation size, and immutable header/code-or-data payload. Do not byte-compare localized c-list rows.

**Why:** SelfTest continuation capabilities and portable capability rows are rewritten for the destination image, so a full disk-artifact byte comparison rejects correctly generated images. The executable/data payload remains immutable and catches an older saved program.

**How to apply:** Use this rule on hardware upload gates and other checks that compare a committed Namespace selection with a generated image. Treat a missing selected filename or mismatched selected artifact hash as a fail-closed condition.