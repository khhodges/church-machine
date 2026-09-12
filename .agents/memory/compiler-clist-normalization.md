---
name: Compiler C-list normalization boundary
description: Generated operand mapping must share the final metadata order; concrete uploads are existing layouts.
---
Normalize symbolic source and upload metadata before resolving generated capability operands. Symbolic source order wins over upload order; concrete uploads instead describe an existing positional layout and must not be shifted to insert SELF. Unnamed concrete words cannot safely acquire source identities by guessing.

**Why:** Independent upload-index overrides can encode a different capability row from the returned C-list. A blanket offset fixes neither this disagreement nor concrete-layout ownership.

**How to apply:** Compare decoded instruction row bits with the returned capability entry, and test the method selector separately. Preserve the distinction between public auto compilation (implicit SELF), explicitly called language frontends (historically no implicit SELF), and assembly (explicit layout). Do not infer that a double-offset reproduction explains an observed row-zero instruction without its original compile path and source.