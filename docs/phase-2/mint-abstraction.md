# Mint abstraction — Genesis-approved Phase 2 contract

## Authority and implementation status

Genesis explicitly approved updating Mint to match the GTMint, dedicated GT.M,
decomposed diagnostic authority and Namespace-qualified caller-identity
decisions. This is the current Phase 2 Mint contract for those subjects.
It supersedes conflicting older design descriptions, not historical evidence.

The executable Phase 1 source and saved artifacts are not implementations of
this contract. Missing machine interfaces must be specified before a runnable
rewrite; do not replace authorization checks with unconditional success or
invent instructions. Old Mint qualification is deferred, not a prerequisite.
No live installation, board operation or bitstream change is authorized here.

## Responsibilities

Mint retains object-lifecycle work: validate the requested operation and its
authority, allocate or update the applicable Namespace/object state, construct
the intended full GT value, and return only the authorized result.
GTMint simplifies materialization of that value as a capability; it does not
perform allocation, choose permissions, establish caller authorization or
increment versions automatically.

This revision does not rename/reorder the existing CREATE, DESTROY,
MakeOutform and MakeInform entry surface, assign new operands, or declare
previously unsupported methods complete. DESTROY does not need to manufacture
a non-NULL result just because the construction port exists.

## Private construction authority

- GTMint is the dedicated port at **`0xFFFFFF14`**, the first example of
  decomposed Diagnostic Abstractions with individually scoped GTs.
- W authority permits writing the pending 32-bit GT DATA value.
- **GT.M is a dedicated seventeenth M bit belonging to GTMint**, separate
  from the sixteen CR-associated M bits. It is not a new bit in the 32-bit GT.
- The security monitor controls setting GT.M true and owns the low-level
  trusted construction sequence. Ordinary callers receive neither the port
  authority nor raw M-control authority.
- WDT remains at `0xFFFFFF18` under SecurityRegulator custody. General
  diagnostic reach does not confer GTMint or WDT control.

### Construction sequence

Semantic pseudocode, not assembler syntax or an assigned service ABI:

```text
validate and prepare the authorized Mint operation
construct the intended GT bits
enter the security monitor's trusted construction sequence
    record CallerIdentity = (Namespace ID, full caller E-GT)
    DWRITE the intended GT bits through the authorized GTMint view
    explicitly set GTMint.GT.M = true
    LOAD and validate the pending capability
        on success: deliver the capability,
                    consume GTMint.GT.M and the pending result
return only the intended result to the authorized caller
```

Capture the actual caller identity in association with setting M; do not accept
an unverified caller-supplied label as identity. The Namespace ID is mandatory.
This record is not another authority-bearing GT, an extra Namespace slot, or
a change to the encoded GT layout. Its storage and capture interface remain open.
Immediate caller and originating caller are not automatically interchangeable
through nested calls.

Successful validated LOAD consumes GT.M and the pending result. DWRITE does not
restore M. The pending result is also cleared on successful CHANGE/SWITCH or
completed internal LLR handoff, including self-transfers, fault or reset.
An empty-result LOAD hard-faults. No pending-result save or automatic replay.
Dedicated GT.M initialization and handoff/fault/reset handling remain to be
specified separately from the pending result.

## Passcodes, Pass Bit and identity

The approved simplification addresses proliferation of slots and C-list
entries in general internal Passcode machinery. It must not force additional
Passcode objects and proof-forwarding abstractions into the revised design
merely to reproduce the older implementation.

Programs remain free to use passcodes privately in exceptional circumstances.
Passcodes are not prohibited or inherently unworkable.

The Pass Bit direction and Namespace-qualified identity tracing are part of
this revision, but Genesis approval does not supply unspecified bit scope,
grant/consumption semantics or storage layout. Do not silently equate a
general Pass Bit with the dedicated GTMint GT.M, or assume recording identity
alone authorizes an operation. A complete replacement for the old runtime
authorization path depends on these missing details.

Audit must retain the Namespace-qualified identity associated with the actual
authorization and the operation outcome. Existing non-conflicting transaction
and Home IDE audit requirements are not removed. Originator propagation and
its relation to the previous Passcode audit association require reconciliation,
not substitution of a service's identity for its caller without a decision.

## Changes required for the executable abstraction

| Older mechanism | Phase 2 replacement contract |
|---|---|
| Private writable result memory and capability-load alias | Dedicated GTMint port with transient result |
| Reuse of source CR.M suggested during discussion | Dedicated GTMint GT.M, explicitly set and consumed |
| General Passcode/proof machinery as the default internal approach | Approved simpler authorization direction, with Pass Bit details still required |
| Identity represented by a local E-GT alone | Namespace ID plus full caller E-GT |
| One broadly privileged diagnostic view | Decomposed abstractions with separately scoped GTs |

Do not delete the old checks or result path from runnable code before the
replacement has an actual machine interface. Preserve historical source and
saved evidence; do not present old test results as evidence for this contract.

## Remaining implementation inputs

1. GT.M control mapping, initial state and interruption behavior. Bit 16 of
   the M-control word is not assigned by the seventeenth-bit decision.
2. Exact GTMint address-unit translation, LOAD integration and failure rules.
   Duplicate-write replacement was recommended after withdrawing the earlier
   hard-fault recommendation; it has not been independently settled.
3. Protected Namespace-qualified caller capture/storage and monitor call ABI.
4. Pass Bit placement, scope, lifetime and its relationship to the audit record.

These are the outstanding inputs for a runnable update, not reasons to reopen
the decisions Genesis has approved. Continue one issue at a time.

## Related specifications

- [GTMint and GT.M](gt-construction-port.md)
- [Hardware map and decomposed diagnostic MMIO](hardware-address-map-and-diagnostic-mmio.md)
- [Pass Bit and caller identity](pass-bit-and-caller-identity.md)
- [Historical Phase 1 Mint review](../reviews/mint-phase1/README.md)
