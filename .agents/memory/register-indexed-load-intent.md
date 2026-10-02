---
name: Uniform indexed operand intent
description: User requires register-plus-immediate indexing across all indexed instructions, not just LOAD.
---

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

On 2026-10-02, when presented with the multiword IDX1 packet-fetching
proposal, the user corrected it: "one instruction only for idx instructions."
Do not treat the existing multiword IDX1 software/specification as approval
of the intended hardware encoding. Reconcile the single-instruction encoding
constraint before implementing packet fetching or extending that design.

**Why:** The user explicitly rejected the packet proposal as not what was intended;
existing implementation is not authority over that requirement.

**Why:** The user explicitly corrected an explanation that treated a parser's
immediate-only restriction as the intended architecture.
The user subsequently expanded the requirement to all indexed instructions,
explicitly including a register value plus an immediate.
The user confirmed any DR plus or minus an immediate and explicitly required
containment and no leakage in all cases.

**How to apply:** Distinguish implementation gaps from intended semantics.
Never replace the register with its compile-time value or invent an encoding.
Any implementation must keep assembler, simulator, hardware, and audits
consistent and preserve existing binary meanings.
Specify encoding, immediate signedness, addition overflow, index units, and
out-of-range behavior before implementation. Preserve capability checks and
do not narrow a computed index in a way that wraps it into authorized bounds.

The user approved the compact encoding direction for detailed specification:
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