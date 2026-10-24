---
name: Church GT petname boundary
description: Defines the first-stage symbolic naming boundary between Church capability registers and Turing data registers.
---

Use petnames for every GT currently held in a Church capability register. Keep Turing data registers numeric and do not assign source-variable names to them yet.

This includes saved CR homes and GTs in protected Thread stack frames, not only
the live register dashboard. Prefer the GT target's PetName over a generic CR
role; retain raw bits and slot numbers as secondary inspection details.
The CR table Name column is empty for NULL or unresolved GTs. Architectural
roles and retained compiler aliases are not fallback PetNames.

**Why:** The user identified Result, Arg 1, Heap, C-List and other role labels
as stale names when every displayed GT was NULL.

Static-meaning comments also show PetNames. Register names describe explicitly
current GTs, not predicted values at every instruction; capture names with the
listing context so later state changes do not relabel retained annotations.

**Why:** The user reiterated the all-CR naming requirement with a saved-frame
GT still shown only as “Inform Slot=20.”
They also identified the separate GOLDEN TOKENS capability-home table showing
the legacy alias “SUCC.” Verify that rendered table, not just a shared helper.

The CR14 Code header must show four separate identities: Code (method, e.g.
Run), Abstraction, Thread (compact T.n), and Namespace/layout context.

**Why:** The user corrected a header that conflated Code and Abstraction and
looked only in the legacy slot-label map, despite known names in the loaded
private simulation.

**How to apply:** Use the current execution registers rather than editor
selection. Private images retain naming in their frozen preparation, not
necessarily the legacy slot-label map. Distinguish the NewLayout profile
from the stored Namespace SELF label (which may still be Boot.NS).
Resolve the method from the executed binary; do not hardcode Run.

Breakpoint inspection should expose machine state and CALL from/to pet names
without executing the pending instruction.

**Why:** The user requested quick register and call-context inspection when
a breakpoint is reached.

**How to apply:** Capture read-only pause evidence; closing the inspector must
leave execution paused. Indexed CALL targets are C-list entries, not the
instruction's destination register.

Retain the last 20 breakpoint snapshots for quick historical inspection.

**Why:** The user requested a separate popup trace of recent breakpoints.

**How to apply:** Reopening a historical stop must show its captured registers
and call names, not recapture live state or add another stop. History is
inspection only, never execution rollback.

**Why:** This Phase 1 architecture was explicitly approved on 2026-09-15. It preserves the Church/Turing split and gives capability-bearing state meaningful identity without requiring CLOOMC++ dataflow metadata for ordinary values.

**How to apply:** IDE register displays, traces, and disassembly should resolve CR-held GTs to petnames when identity is known. Use `Self` for the currently executing abstraction and forms such as `Self.c-list` or `Self.code` when the role needs clarification. Display DRs by register number and value only.

Compiled-output C-list rows must show their declared PetNames directly, including
when the stored numeric words are unresolved zero placeholders.

**Why:** The user reiterated that Golden Tokens always use their PetNames in
compiled output; referring readers to names elsewhere is not sufficient.

**How to apply:** Pair each row's PetName with its exact stored word and binding
status. Read names from the same candidate's embedded definition, not mutable
editor metadata. Explicitly mark missing names rather than inventing identities.

Saved-binary disassembly has the same requirement. Names and method annotations
must come from the exact inspected binary, never inferred from current source,
catalog state, or the previous compile.

**Why:** The user explicitly clarified that disassembly means disassembling the
binary LUMP exactly, not composing a best guess.

**How to apply:** Preserve raw words; decode embedded names; explicitly show
missing or malformed metadata instead of supplying guessed labels.