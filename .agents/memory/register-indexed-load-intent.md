---
name: Uniform indexed operand intent
description: User requires register-plus-immediate indexing across all indexed instructions, not just LOAD.
---

Static artifact-admission checks must follow each opcode's current operand
encoding, including register-plus-immediate indexing. A shared old C-list mask
must not be applied across instructions with different formats.

**Why:** Refresh reconstruction rejected a compiler-produced indexed LOAD by
interpreting the encoded immediate for row 1 as row 16, leaving an older image
unchanged despite a successful LUMP save.

**How to apply:** Include server-side admission in ISA conformance checks, not
only assembler, disassembler and execution. Runtime-dependent indices require
runtime bounds enforcement, not a guessed static row.

The user explicitly confirmed on 2026-10-02 that **Church Machine Instruction
Set** is the master ISA text; other references and implementation descriptions
must defer to it.

**Why:** Earlier indexing corrections went into a different reference that also
claimed to be definitive, leaving the user's intended master uncorrected.

**How to apply:** Change the master first when correcting ISA requirements,
then reconcile supporting references. Do not elevate existing implementation
or an earlier proposal above the user's confirmed semantics.

`LOAD CR1, CR6, DR11` is intended to load into CR1 the capability at
the index held in DR11, relative to the C-list addressed by CR6.

The requirement applies to every instruction with an index operand:
effective index = runtime data-register value + immediate offset.
Any DR may supply that value; DR11 is only an example, not a restriction.
Both addition and subtraction of the immediate must be supported:
`DRn + immediate` and `DRn - immediate`.
Containment and prevention of unauthorized data disclosure always apply,
including when index arithmetic overflows, underflows, or produces an
out-of-range result. Indexing adds no authority.
Immediate-only and register-only forms are special cases, not different
semantic models. This is a target ISA requirement, not a claim of implemented
support.

Single-word indexing is the chosen design. The user reaffirmed on
2026-10-04: "Forget the multiword IDX1, the single word is the one to use."
Treat multiword IDX1 as superseded, not as an alternative to propose,
implement, or include in a matching bitstream.

**Why:** The user explicitly rejected the packet proposal as not what was intended;
existing implementation is not authority over that requirement.

**How to apply:** Use single-word indexing in implementation and conformance
reviews. Do not revive packet fetching or a multiword compatibility profile.
This decision does not itself authorize deleting existing files, rewriting
saved artifacts, or starting a paused hardware build.

In the subsequent clarification, the user declined the proposed constraint
"exactly one 32-bit word, no extensions" and specified: "The instruction uses
a data register added to any immediate value." That initial clarification
settled semantics only. The later explicit choice below settles the
LOAD/SAVE immediate-width tradeoff and supersedes that earlier uncertainty.

The user subsequently chose "Reduce the immediate to 10 bits" after being
offered 4 DR-selection bits, 1 sign bit and 10 magnitude bits within the
existing 32-bit LOAD/SAVE instruction. Preserve this compact choice, including
addition/subtraction; do not restore the multiword proposal to retain a wider
immediate.

**Why:** This is the user's explicit tradeoff after the field-budget explanation,
not an inferred approval of the earlier packet design.

The user then said "Ignore any existing stuff" in response to compatibility
constraints. For this ISA cutover, backward compatibility must not block the
compact LOAD/SAVE layout or introduce a legacy mode/profile. Existing binaries
may require recompilation; this does not authorize deleting or rewriting saved
files automatically. This overrides older compatibility-preservation statements
in this note for this cutover.

**Why:** Repeated compatibility concerns were preventing the requested simulator
correction after the user had already selected the immediate-width tradeoff.

**Why:** The user explicitly corrected an explanation that treated a parser's
immediate-only restriction as the intended architecture.
The user subsequently expanded the requirement to all indexed instructions,
explicitly including a register value plus an immediate.
The user confirmed any DR plus or minus an immediate and explicitly required
containment and no leakage in all cases.

**How to apply:** Distinguish implementation gaps from intended semantics.
Never replace the register with its compile-time value or invent an encoding.
Implementation status must be reported separately for assembler, simulator,
hardware, and audits. The later direct compact LOAD/SAVE cutover intentionally
does not preserve old binary meanings.
Specify encoding, immediate signedness, addition overflow, index units, and
out-of-range behavior before implementation. Preserve capability checks and
do not narrow a computed index in a way that wraps it into authorized bounds.

Historical, superseded by the 10-bit LOAD/SAVE choice: the prior direction was
two words for one indexed operand, three for two; any 32-bit DR plus/minus
a 20-bit unsigned magnitude. Existing supported literal instructions retain
their meanings. This approves a design direction, not a released encoding or
permission to rebuild/flash user artifacts.

The user subsequently approved the coordinated detailed specification,
including the versioned execution envelope, and authorized implementation.
This does not authorize rebuilding user artifacts or flashing hardware.

**Why:** Explicit approval followed a separate explanation of the envelope
and the distinction between documentation and working implementation.

**How to apply:** Implement the approved contracts without asking for the same
design approval again; report tested implementation separately from support
that remains gated or unavailable.

**Why:** The explicit encoding review selected compact packets rather than
the larger full-32-bit-immediate proposal.

**How to apply:** Complete the version, boundary, per-opcode, and containment
contracts before implementing. Keep proposal/specification status distinct
from implemented and verified support.

Report indexed-instruction support separately for compilation, simulator
execution, saved artifacts, and physical hardware. An isolated simulator
fixture is not proof that the current IDE session can execute the program.

**Why:** The IDE can compile a valid indexed candidate while an independently
invalid committed boot image prevents establishing its execution context.
This must not be misreported as successful browser execution or repaired by
bypassing boot authority.

**How to apply:** Preserve the committed-image guard and use disposable
canonical fixtures for execution tests when live boot state is invalid.
State the browser verification boundary explicitly; never modify the user's
Namespace or boot image merely to demonstrate the ISA feature.

Runtime-selected indices also constrain destructive C-list optimization.
Unknown runtime DR values must conservatively preserve all possible rows;
the current paused DR value is not evidence that other rows are unused.

**Why:** Execution and disassembly can be correct while a stale static
reference analysis still deletes capabilities needed by the new instructions.

**How to apply:** Include zero-unreferenced, compaction, and row-rewrite paths
in any indexed-encoding change; block destructive transformations when their
reachable rows cannot be established.

ISA compatibility reviews must compare both simulator and Amaranth against
the master ISA, not treat either implementation as the oracle.

**Why:** The user approved an evidence-based, full-ISA audit before RTL
correction rather than assuming the LOAD/SAVE discrepancy was the only issue.
Shared implementation behavior and passing regressions do not establish
conformance to the authoritative specification.

**How to apply:** Separate measured mismatches, source-level findings,
specification ambiguities, and untested cases. Do not silently resolve
contradictory requirements by copying one implementation into the other.

The acceptance rule is instruction-by-instruction functional agreement across
the ISA, assembler/compiler, simulator, Amaranth, and generated RTL.

**Why:** The user explicitly requires all layers to match each instruction's
function, not just pass independent regression suites.

**How to apply:** Compare encoding, outputs, flags, control flow, permissions,
faults, and architecturally visible side effects from equivalent initial states.
Internal cycle counts may differ unless the ISA specifies timing. Generated
RTL and released hardware require their own evidence, not source-level inference.

Conformance observations must distinguish code fetch, operand validation,
actual operand access, and retirement; an intermediate decode value is not
an executed effective index.

**Why:** Fetch legitimately precedes an indexed arithmetic fault. Counting
fetch validation as a forbidden operand read produces false containment
failures; treating decode-only evidence as execution produces false confidence.

**How to apply:** Label the observation stage and coverage explicitly. Require
an actual changed destination in successful transfer fixtures, and keep
unexecuted layers untested rather than inferring their verdict from another layer.