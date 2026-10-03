---
name: CHANGE programmer access
description: CHANGE must not be blocked as a protected or microcode-only instruction.
---

CHANGE is not a protected instruction. Do not block CR13–CR15 at compilation while exempting CR12, or rewrite programmer-authored CHANGE into SWITCH.

The user's architectural definition is: “CHANGE needs one GT to the new Thread.” In `CHANGE CR13`, CR13 holds the input GT identifying the Thread to activate; it is not a destination register or a C-list to index. There is no second register operand or implicit `[0]` lookup.

**Why:** The user supplied this definition to resolve the contradictory local references after rejecting the emitted two-register/index form.

**How to apply:** Treat the one-GT operation as authoritative across compiler, disassembler, simulator, and hardware. Keep loading the GT with SWITCH distinct from activating its Thread with CHANGE. Do not infer a correct binary encoding from legacy implementation round trips.

The general programmatic case has two distinct hardware exceptions: boot is
only the incoming/back half loaded into CR12; IRQ entry swaps CR12/CR13 and
IRQ return performs the matching hidden swap back. Neither is CHANGE. The
return trigger/encoding has not been specified.

**Why:** The user explicitly corrected their earlier `CHANGE CR12` IRQ-return
statement: a hidden-swap entry requires the same mechanism on return, not the
general CHANGE path. Boot initialization is also distinct from the general
programmatic case.

**How to apply:** Follow the master one-GT correction in `docs/instruction-set.md`.
Do not infer a complete encoding migration or hardware implementation from the
semantic clarification alone.

IRQ-return design discussion is documentation-only until explicit agreement.
The user proposed both CR12.M and CR13.M plus a candidate
`CHANGE CR13, CR13` trigger, with CR13 unchanged and back-half-only behavior.
These details are proposals, not approved general CHANGE semantics.

**Why:** The user explicitly required careful agreement before implementation;
the unchanged-CR13 requirement still needs reconciliation with "hidden swap."

**How to apply:** Use `docs/irq-hidden-return-proposal.md` to separate proposals,
recommendations and open questions. Do not implement or promote the candidate
syntax, encoding or M-bit consumption rules without agreement.

**Why:** The user explicitly corrected the compiler's asymmetric rejection and the explanation that CHANGE was reserved for microcode. The programmer must be able to express the instruction; compilation is not the runtime authority boundary.

**How to apply:** Keep operand encoding and runtime capability enforcement distinct. Removing a compiler privilege ban neither removes runtime checks nor establishes that a particular Thread or IRQ transition is implemented correctly.

Do not claim that expanding `CHANGE CR13` into `CHANGE CR13, CR13[0]` conforms to the ISA merely because the assembler and disassembler round-trip it.

**Why:** The user explicitly rejected this emitted form as not the ISA after the privilege-ban fix. Existing local CHANGE references disagree; implementation-derived tests cannot resolve the architectural definition.

**How to apply:** Apply the user-confirmed one-GT semantics above, with an explicit consistent bit-field mapping across backends. Do not conceal an encoding discrepancy by changing only the displayed disassembly.