---
name: CHANGE programmer access
description: CHANGE must not be blocked as a protected or microcode-only instruction.
---

CHANGE is not a protected instruction. Do not block CR13–CR15 at compilation while exempting CR12, or rewrite programmer-authored CHANGE into SWITCH.

**Why:** The user explicitly corrected the compiler's asymmetric rejection and the explanation that CHANGE was reserved for microcode. The programmer must be able to express the instruction; compilation is not the runtime authority boundary.

**How to apply:** Keep operand encoding and runtime capability enforcement distinct. Removing a compiler privilege ban neither removes runtime checks nor establishes that a particular Thread or IRQ transition is implemented correctly.