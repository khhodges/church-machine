---
name: Compiler C-list normalization boundary
description: Generated operand mapping must share the final metadata order; concrete uploads are existing layouts.
---
Normalize symbolic source and upload metadata before resolving generated capability operands. Symbolic source order wins over upload order; concrete uploads instead describe an existing positional layout and must not be shifted to insert SELF. Unnamed concrete words cannot safely acquire source identities by guessing.

**Why:** Independent upload-index overrides can encode a different capability row from the returned C-list. A blanket offset fixes neither this disagreement nor concrete-layout ownership.

**How to apply:** Compare decoded instruction row bits with the returned capability entry, and test the method selector separately. Preserve the distinction between public auto compilation (implicit SELF), explicitly called language frontends (historically no implicit SELF), and assembly (explicit layout). Do not infer that a double-offset reproduction explains an observed row-zero instruction without its original compile path and source.

Instruction-by-instruction assembly must retain the enclosing method's declared
C-list authority without adding names to a global registry.

**Why:** A supported named operand can look unsupported when the nested assembler
never receives the enclosing capability declarations. ISA operand documentation
alone does not describe all supported source-level shorthand.

**How to apply:** Check the live assembler's name-resolution interfaces before
recommending numeric operands. Compare named and numeric encodings using the
same finalized row map, including dotted names and SELF.

An explicitly supplied local C-list mapping must outrank the global Namespace
registry during named operand resolution.

**Why:** Supplying the right local map is insufficient if a later resolver
selects the same name's Namespace index first. High Namespace indexes then
appear as invalid CALL rows despite a small, valid local C-list.

**How to apply:** Include a regression where the same name has different local
and Namespace indexes, with the Namespace index above CALL's row range. Keep
the real instruction-width check intact.