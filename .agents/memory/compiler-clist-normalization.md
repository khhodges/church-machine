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

Fix compiler compatibility defects rather than requiring programmers to rewrite valid public source syntax to internal spellings.

**Why:** The user explicitly rejected changing Alice's authored `SELF E` to `__SELF__ E` and directed that the compiler be fixed instead.

**How to apply:** Preserve source bytes and authored permissions while establishing correct compiler-owned identity metadata. Test using the original embedded source, and keep unrelated unresolved capabilities pending rather than inventing authority.

Capability declarations name the C-list PetNames. Do not conflate these with
the containing abstraction's name or an IDE-level owner PetName setting.

**Why:** The user explicitly corrected that the names in their `capabilities`
block are the PetNames under discussion; focusing on an inferred abstraction
label did not answer whether those declared names survived compilation/save.

**How to apply:** Trace the exact declared names and row order through the
complete emitted and saved binaries. Treat the containing object's identity
as a separate check. A code/C-list-only view does not establish whether
embedded declaration names were preserved.

Pre-save compilation must not depend on the current Namespace's assignments.
Capability declarations establish local C-list PetNames and row positions,
not destination Namespace slots.

**Why:** The user explicitly challenged compiler output mapping declared
PetNames to live Namespace slots. Removing those arrows alone does not
remove a compile-path dependency on destination materialization.

**How to apply:** Keep compile-time symbolic references and identity evidence
separate from destination binding. Do not require local installation, mint
destination GTs, or assert INFORM resolution merely to compile a candidate.
Use explicit referenced API/identity evidence where compilation requires it,
not the currently occupied Namespace slot.

Standalone LUMPs are a compiler-output requirement, not a console-formatting
requirement.

**Why:** The user explicitly clarified that pre-save compiler output must
create standalone LUMPs.

**How to apply:** The complete emitted artifact must preserve its declared
PetNames and immutable identity references independently of the compiling
machine's Namespace. Compile and save must not require destination slot
assignments. Destination-local resolution happens separately. Runtime access
checks are not compile-time installation requirements or an extra approval gate.
The normative contract is documented in docs/CM_LUMP_SPECIFICATION.md under
Standalone Compiler Output Contract. Verify emitted bytes and metadata, not
just the displayed text.