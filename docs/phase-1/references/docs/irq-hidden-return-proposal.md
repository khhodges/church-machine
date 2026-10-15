# M-gated hidden IRQ return — discussion draft

**Status: proposed, not agreed ISA or implemented behavior.**
Documentation only until the design is explicitly agreed. Do not modify the
compiler, simulator, RTL, saved binaries, or bitstream on the basis of this draft.

## Established distinction

General programmatic CHANGE takes one GT identifying the new Thread.
Boot uses the incoming/back half. Hidden IRQ entry and its matching return
are distinct from the general CHANGE operation.

## User proposal

- Explicitly authorize hidden IRQ return with both **CR12.M and CR13.M**.
- Set both bits before issuing the return trigger.
- Consider `CHANGE CR13, CR13` as the trigger syntax, **for example**. This
  spelling and its encoding are candidates, not approved instructions.
- CR13, described as the interrupt Thread, would never be changed and would
  always use the back half.

If the candidate spelling is adopted, it denotes a special hidden-return
operation, not two GT operands to general CHANGE and not an indexed lookup.
Do not silently reinterpret existing binaries or general CHANGE as this trigger.

## Points requiring agreement

### What stays fixed, and what swaps?

A literal exchange of CR12 and CR13 contents changes CR13. That conflicts with
a requirement that CR13's GT remain fixed. Clarify whether "CR13 never changes"
means its GT/descriptor stays fixed, the interrupt Thread's identity stays fixed,
or its saved context is not overwritten.

The eventual definition must show CR12, CR13, the active Thread and the
interrupted continuation before entry, during IRQ handling, and after return.
Do not invent hidden storage or equate a context selection with a literal
register exchange before this is settled.

### What does "back half" restore?

Specify whether each IRQ starts at a fixed entry or resumes saved IRQ context;
which CR/DR/NIA/flags state is retained or restored; and where the interrupted
continuation is preserved. Avoid assuming that immutable Thread identity means
immutable execution state.

### M-bit authorization and atomicity

Recommended for discussion, not yet approved:

- Sample both M bits when accepting the trigger; require both, not either.
- Require an active IRQ and a valid matching interrupted context. M authority
  alone must not invent a return target or permit an unmatched return.
- Validate before committing the swap-back; avoid a partially restored context.
- Decide explicitly when both M bits are consumed, including failure behavior.
  One candidate is to consume both on successful completion only.
- Define behavior for missing M bits, use outside IRQ, nested IRQ, a repeated
  trigger, and faults during return.

Under the existing M-bit I/O mapping, bits 12 and 13 form mask `0x3000`.
This is a mask calculation, not a new instruction encoding or approved return
sequence. The existing I/O word replaces all M bits on write; blindly writing
`0x3000` also clears the others. Decide which execution context is authorized
to arm the return and how that authority is retained until the trigger.

## Implementation boundary

The current Amaranth IRQ dispatcher is a Scheduler-method dispatch path, not
proof that the proposed hidden swap or return exists. This draft does not
authorize implementing either mechanism. Encoding, conformance tests and
migration remain deferred until agreement.