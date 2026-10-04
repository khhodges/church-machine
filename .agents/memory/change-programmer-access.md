---
name: CHANGE programmer access
description: One-GT CHANGE is programmer-accessible but uses microcode authority on a permissionless Thread GT.
---

CHANGE is not a protected instruction. Do not block CR13–CR15 at compilation while exempting CR12, or rewrite programmer-authored CHANGE into SWITCH.

Self-target CHANGE is valid. The user explicitly confirmed that CHANGE CR12
should work as well as CHANGE CR13, and regards self-targeting as a useful
save/restore test. Neither requires an M-bit merely to supply the operand.

**Why:** An implementation's dormant-only guard is not architectural authority.

**How to apply:** When correcting self-target handling, preserve normal validation
and verify save/restore ordering against the newly saved continuation, without
restoring stale context or accumulating frames. When CR12 identifies the active
Thread, CHANGE CR12 must resume after CHANGE following that save/restore.

The valid input Thread GT has no permissions, deliberately preventing ordinary
programmer access to protected Thread state. CHANGE performs the transition
using microcode privileges, not permissions on that GT.

**Why:** The user explicitly supplied this rule after the one-GT test exposed
the legacy indexed implementation. Programmer access to the instruction and
microcode access to Thread state are different authority boundaries.

**How to apply:** Require no permissions set on the input Thread GT; any
permission set is a hard fault. Require a valid stack frame and valid, usable
C-List, with a hard fault on any error. The user explicitly confirmed these
acceptance requirements; microcode privileges must not bypass them. Do not
silently repair the input or partially activate a rejected context. Do not treat
permissionless as NULL. Preserve identity/type/context validation. Distinguish
the saved frame's executable Enter GT from the Thread GT supplied to CHANGE.
Do not turn the proposed IRQ-return M gate into a general CHANGE prerequisite.

The user authorized implementing the general CHANGE semantics in the simulator,
not IRQ or hardware. Software compatibility with the existing one-operand
assembler word does not settle the eventual hardware encoding.

**Why:** The request was to make the simulator match the agreed permissionless
GT, valid stack/C-List and hard-fault requirements while IRQ remained deferred.

**How to apply:** Keep hardware, saved-binary migration and IRQ outside this
authorization. Do not use simulator test success as proof of RTL conformance.
When checking atomicity, distinguish Namespace access/G-bit updates from
protected Thread-context writes: ordinary instruction fetch updates access
metadata even when CHANGE subsequently faults.

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