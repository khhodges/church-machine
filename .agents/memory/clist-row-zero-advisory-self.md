---
name: C-list row zero SELF boundary
description: Compiler admission and inspection policy for a C-list owner's Golden Token.
---

`SELF` is an internal contextual role, not a replacement PetName. New compiler output and sealed/public artifact metadata must preserve the programmer's declared abstraction PetName at row zero; compiler ownership belongs only in `compiler_owned_self`/`symbolic_self` flags. Legacy `SELF` and `__SELF__` artifacts remain readable without rewriting their immutable bytes or approval hashes. Normalize ownership to one symbolic row-zero owner entry while retaining its public name. This is compiler assistance, not shared universal authority.

The compiler must fail closed if the finalized C-list does not establish `SELF` at row zero. It may insert its compiler-owned symbolic SELF row for new high-level source, but it must reject concrete layouts whose first row is another or unnamed capability. Complete assembly compilation must likewise reject an explicit capabilities block that does not begin with SELF. Every compile and recompile must rerun structural and token validation against the newly assembled candidate bytes before publishing candidate-ready state.

Existing immutable artifacts remain inspectable without rewriting their bytes; inspection and historical evidence are separate from compiler admission.

**Why:** Every abstraction must retain its programmer-chosen PetName. Exposing or persisting `__SELF__` silently renames that identity, while emitting a LUMP without a provable compiler-owned row zero would break runtime ownership assumptions.

**How to apply:** Detect symbolic ownership from row-zero flags, not the displayed or persisted name. Keep it E-only and never send it through the external Namespace/device-registry resolver. Reject invalid new compiler output before candidate publication, and never let an earlier successful candidate satisfy a later compile. Preserve invalid saved artifacts as red-X inspection evidence without rewriting their bytes.

ISA `SAVE` may never target c-list row zero through any target CR. Reject statically known row-zero saves in the assembler/compiler and fault `IMMUTABLE_SELF_CAP` before M-bit, permission, Namespace, or memory checks in simulator and hardware.