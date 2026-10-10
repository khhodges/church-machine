---
name: FPGA liftoff compatibility policy
description: No legacy compatibility before the first FPGA release; case-by-case decisions afterward.
---

The user states there is no need for legacy compatibility until liftoff,
defined as the first FPGA release, and then only on a case-by-case basis.

**Why:** Pre-release design should not be constrained by supporting earlier
encodings, ABIs or behavior. First release does not imply a blanket compatibility
guarantee afterward.

**How to apply:** Do not add legacy modes, adapters or migration requirements
solely to preserve pre-release behavior. Keep required historical evidence
immutable without treating it as an executable compatibility contract. This
policy does not independently authorize implementation or board actions.
