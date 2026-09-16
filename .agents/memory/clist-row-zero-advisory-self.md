---
name: C-list row zero SELF boundary
description: Compiler admission and inspection policy for a C-list owner's Golden Token.
---

`SELF` is a universal, case-insensitive contextual pet name. `SELF`, mixed-case spellings, and the internal `__SELF__` spelling all resolve to the current abstraction's Golden Token. Normalize them to exactly one symbolic row-zero owner entry once identity is known. `__SELF__` is internal provenance syntax only; every programmer-facing source, C-list, disassembly, and metadata view must display `SELF`. This is compiler assistance, not shared universal authority.

The compiler must fail closed if the finalized C-list does not establish `SELF` at row zero. It may insert its compiler-owned symbolic SELF row for new high-level source, but it must reject concrete layouts whose first row is another or unnamed capability. Complete assembly compilation must likewise reject an explicit capabilities block that does not begin with SELF. Every compile and recompile must rerun structural and token validation against the newly assembled candidate bytes before publishing candidate-ready state.

Existing immutable artifacts remain inspectable without rewriting their bytes; inspection and historical evidence are separate from compiler admission.

**Why:** Programmers need one stable name analogous to `self` or `this`, while every abstraction must retain a distinct identity. Emitting a new LUMP without provable row-zero SELF would break owner identity and make later runtime assumptions unsafe.

**How to apply:** Normalize symbolic SELF aliases in compiler, viewer, Run, Audit, and save-validation paths; never send SELF through the external Namespace/device-registry resolver. Restrict it to row zero and E-only. Reject invalid new compiler output before candidate publication, and never let an earlier successful candidate satisfy a later compile. Preserve invalid saved artifacts as red-X inspection evidence without rewriting their bytes.

ISA `SAVE` may never target c-list row zero through any target CR. Reject statically known row-zero saves in the assembler/compiler and fault `IMMUTABLE_SELF_CAP` before M-bit, permission, Namespace, or memory checks in simulator and hardware.