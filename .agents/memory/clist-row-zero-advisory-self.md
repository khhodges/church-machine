---
name: C-list row zero SELF boundary
description: Compiler admission and inspection policy for a C-list owner's Golden Token.
---

`SELF E` is the one canonical row-zero owner capability. It is not the abstraction PetName. New compiler output, review UI, and sealed/public metadata must use exactly `SELF`; compiler ownership also belongs in `compiler_owned_self`/`symbolic_self` flags. Legacy `__SELF__` artifacts remain readable without rewriting immutable bytes or approval hashes, but normalize that internal alias to `SELF` in new output.

The compiler must fail closed if the finalized C-list does not establish `SELF` at row zero. It may insert its compiler-owned symbolic SELF row for new high-level source, but it must reject concrete layouts whose first row is another or unnamed capability. Complete assembly compilation must likewise reject an explicit capabilities block that does not begin with SELF. Every compile and recompile must rerun structural and token validation against the newly assembled candidate bytes before publishing candidate-ready state.

Existing immutable artifacts remain inspectable without rewriting their bytes; inspection and historical evidence are separate from compiler admission.

**Why:** `SELF` names the owner capability, while the abstraction PetName names the abstraction; substituting one for the other produces misleading C-list metadata. `__SELF__` is only a legacy/internal alias and must not surface in new saves.

**How to apply:** Require exactly one compiler-owned `SELF E` at row zero. Never replace it with the abstraction PetName, and never send it through the external Namespace/device-registry resolver. Reject duplicate or differently named owner rows before candidate publication. Preserve invalid saved artifacts as red-X inspection evidence without rewriting their bytes.

ISA `SAVE` may never target c-list row zero through any target CR. Reject statically known row-zero saves in the assembler/compiler and fault `IMMUTABLE_SELF_CAP` before M-bit, permission, Namespace, or memory checks in simulator and hardware.