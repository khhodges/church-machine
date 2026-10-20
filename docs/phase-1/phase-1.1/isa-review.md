# Phase 1 ISA review — Phase 2 compatibility only

Status: first-pass contract and implementation discrepancy review. This is
not a replacement ISA, full conformance report, or release approval.

Authority: [Master ISA](../01-isa/instruction-set.md).
Acceptance: [Hardware acceptance](../04-release/isa-to-fpga-alignment-plan.md).
No executable code, retained artifacts, Namespace state or hardware changed.

## Scope

Settle and verify Phase 1 instruction behavior. Keep future two-Namespace
integration in mind without making its service framework a Phase 1 prerequisite.
The new Namespace constructor, SecurityRegulator/Passkey service, resource
catalog and Ethernet integration are not built by this review.

This pass concentrates on the boundaries raised in the discussion: SWITCH,
CHANGE, authority, continuations, Namespace geometry and faults. Other ISA
corners are identified through the Master's explicit oracle-closure list,
not represented as exhaustively audited or tested.

## Approved rules to retain

- CHANGE consumes a Thread GT from the named source CR; destination CR12 is
  implicit. Ordinary CHANGE leaves CR15 unchanged.
- SWITCH performs outgoing Thread save, Namespace load into CR15, then
  destination slot-2 Thread activation into CR12, without a second instruction.
- SWITCH bits 22:19 are zero. They do not select CR0 or contain destination 15.
- SWITCH's row is DR[index] plus/minus a ten-bit magnitude, without wrapping.
  CR15.M authorizes the handoff; the source must separately satisfy the stated
  C-list authority checks.
- CR13 is reserved and never explicitly loaded, restored or cleared.
- Ordinary slot-2 entry uses the specified version-zero GT; guarded boot has
  its explicit exception. Do not infer a new GT version from a live descriptor.
- A poison-root entry starts its declared code at NIA zero; a suspended entry
  resumes its validated continuation. Namespace entry is not always reboot.
- Memory allocation extent and Namespace table extent are distinct. CR15
  describes the NST; the header describes the full allocation.
- Hardware never changes generations. Failed handoffs hard-fault, without
  retry, substitute targets or rollback after outgoing-save writes.

These rules already support a future multi-Namespace design without requiring
the full Phase 2 demonstration to close Phase 1.

## Findings

### 1. Earlier Regulator examples overstated Phase 1 SWITCH functionality

The discussion proposed generic isolated-register installation methods.
Master lines 165–173 and 1357–1376 explicitly restrict Phase 1 CHANGE/SWITCH
to their fixed destinations; SWITCH is not a general CR12–CR15 reload.

Disposition: correct the design assumptions, not the ISA to match our earlier
examples. Define future Regulator operations only around approved machine
operations. Do not add generic isolated-register methods to Phase 1.

### 2. SWITCH's fault subsection retains obsolete destination language

Master lines 1411–1422 still describe a non-isolated destination and preservation
for CR12–CR14, although the approved encoding has no selectable destination.

Disposition: reconcile this paragraph to the fixed-destination contract while
preserving malformed-encoding rejection, CR15.M admission, no-rollback behavior
and false-condition behavior. This is a document inconsistency, not a reason
to restore general-purpose SWITCH.

### 3. Browser simulator does not implement the canonical SWITCH encoding

`simulator/simulator.js::decodeInstruction` extracts the zero field as crDst=0
and applies compact index decoding only to LOAD/SAVE. Its `_execSwitch`
requires an isolated destination. `simulator/namespace-runtime-core.js`
selects combined Namespace handoff only when crDst=15.

Read-only in-memory probe:

```text
Input word: 0x2F000070
Meaning: AL SWITCH, source CR0, immediate row 7, required-zero destination field
Decoded: opcode=5, cond=14, crDst=0, crSrc=0, imm=112
Observed: SWITCH: destination CR0 is not isolated (must be CR12–CR15)
```

The probe invokes decode and the instruction handler, not a full execution
journey. It establishes the destination mismatch. Source inspection also
shows missing SWITCH compact-row decoding; it does not prove all downstream
behavior. No valid source fixture was needed to observe the earlier rejection.

Live RTL in `hardware/core.py` wires SWITCH to the computed compact index
and CR15's M latch. That is encouraging source evidence, not proof of full
RTL or board conformance.

### 4. Newer simulator Namespace handoff still changes CR13 and relaxes source L

`simulator/namespace-runtime-core.js::_execSwitch` explicitly clears CR13 after
activation. Its callClist branch accepts CR6.M with E in place of token L.
Master lines 1370–1372 explicitly require source L and say source M is not
consulted; lines 1399–1401 prohibit clearing CR13.

Disposition: align instruction implementation with the Master. If the CR6
exception is intentionally desired for SWITCH, that requires a specific ISA
reconciliation; its existence for ordinary LOAD is not sufficient authority.
These are source-level findings, not a completed physical test.

### 5. Recent recovery direction is not reconciled into the Master

Master's final fault paragraph says a Boot Thread fault leaves the CM in
purgatory rather than an automatically reachable recovery target. The latest
discussion instead establishes Namespace-local reboot, double-error recovery
to first Genesis, and Genesis as the default for unfinished behavior.

Disposition: explicitly reconcile the scope of those new recovery directions
with Phase 1's fault/Genesis contract. Keep the two-Namespace containment
demonstration in Phase 2. Do not claim either that the old paragraph implements
the new recovery policy or that this review authorizes new recovery hardware.
Precise instruction-time fault capture and no unauthorized writes remain
Phase 1 requirements.

### 6. Concrete instruction-test expectations remain unresolved

The Master's Oracle closure section (lines 117–132) explicitly lists:

- NV/reserved conditions and malformed reserved fields.
- SHL/SHR flags and unused shift bits.
- Remaining ordinary TPERM packing and precedence.
- Protected frame/indicator packing, CALL/RETURN M effects and LAMBDA
  continuation representation.
- Unspecified multi-fault precedence and numeric codes.

Genesis supplies the design default; it is not a substitute for concrete bits,
flags and expected outcomes in a conformance test. Resolve these using existing
approved Genesis rules where available, and identify only genuinely missing
decisions. Do not choose behavior merely because the current simulator or RTL
does it.

## Small next step

Review and close the SWITCH contract first: retain the approved encoding,
fixed destinations, CR13 preservation and entry semantics; reconcile its stale
fault wording; then make simulator and RTL checks use independently packed
instruction words. Existing acceptance cases H03 and H09 cover this scope.

After that, close the explicitly enumerated oracle gaps and recovery-scope
wording. Do not start a constructor framework, broad refactor or two-Namespace
integration project as a prerequisite.

## Evidence limits

Reviewed current Master sections and acceptance gates, selected simulator and
live RTL paths, and ran the single local in-memory encoding probe above.
No full assembler suite, complete ISA matrix, mapped RTL run, synthesis,
hardware programming or physical acceptance test was performed.
The copied RTL snapshot and published bitstream were not established as
identical to the live sources. No existing suite is marked passed by this review.
