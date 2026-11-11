# ISA change proposal: explicit guarded GT use

**Status: DRAFT FOR REVIEW — NOT APPROVED OR IMPLEMENTED**  
**Date: 11 November 2026**

This document proposes one bounded ISA extension. It does not amend the master
ISA, allocate an opcode, authorize implementation, or change saved programs,
Namespace images, the experimental starter, or any FPGA bitstream.

## 1. Decision requested

Approve the semantics of an explicit `.TRY` operation, initially restricted to
**DREAD from ordinary memory**. Preserve the existing ARM-style conditions and
all ordinary instructions' hard-fault behaviour. Review binary encoding
separately before implementation.

The proposed first spelling is:

```text
DREAD.TRY DRd, CRs, indexed-offset
```

This is proposed syntax, not currently accepted assembly. The offset syntax,
address units, destination-register rules and condition semantics remain those
of the approved DREAD instruction. Final condition/suffix grammar requires an
assembler review; this draft assigns no new condition code.

## 2. Problem and security objective

A service can receive a deliberately unsuitable GT as an API argument. Merely
testing non-NULL, equality, type or permission bits does not establish that the
intended operation is admissible. Conversely, a normal capability fault during
use can disrupt the service's executing Thread.

The objective is to let software reject a defined invalid argument **at its
point of use, before effects**, without weakening the normal access checks.
This is not automatic fault recovery, exception suppression, or a guarantee
that an entire API call is safe.

## 3. Proposed normative behaviour

The words MUST and MUST NOT below describe the proposed contract, not the
currently approved ISA.

### 3.1 Ordering and ARM-style conditions

1. Instruction fetch and structural encoding validation follow the governing
   ISA. `.TRY` MUST NOT suppress an invalid opcode/encoding or a fetch fault.
2. For a valid supported encoding, evaluate the existing condition against the
   incoming NZCV flags.
3. If false, skip the instruction normally. There MUST be no target-GT
   validation, data-memory/device access, destination write or flag change.
4. If true, perform the proposed guarded operation.

The condition field retains its existing meaning and width. Existing
instruction-specific exceptions, including approved TPERM rules, are unchanged.
No blanket condition-before-encoding rule is introduced.

### 3.2 One checked operation

An attempted DREAD.TRY MUST apply all authority and bounds requirements of the
approved ordinary DREAD to the exact operands used for that read. It MUST NOT
weaken a permission, type, binding, generation or other check required by that
contract. This proposal does not add a new revocation or credential-validity
model to DREAD.

Validation and the admitted access MUST be indivisible with respect to changes
that would invalidate that admission. A conflicting authority change MUST be
ordered before or after the checked access; permission granted for one binding
MUST NOT be used to access another. No particular implementation mechanism is
prescribed.

This removes a separate software check/use gap for this single access. It does
not freeze the GT for later instructions, freeze the object contents, or make
a multi-instruction service operation transactional.

### 3.3 Outcomes

| Outcome | Required architectural result |
|---|---|
| Condition false | Advance normally; preserve flags and all operand/destination state; no target access. |
| Admitted read completes | Perform the ordinary DREAD result write, respecting normal DR rules; set NZCV = **0100** (Z=1). |
| Defined admission rejection | Advance normally; set NZCV = **1000** (Z=0); preserve destination and all GTs; perform no target access or operation effects. |
| Failure outside the rejection set | Follow the existing fault rules; MUST NOT manufacture a `.TRY` rejection result. |

Flags and the completed read result constitute one architectural completion.
Normal instruction progress and result flags are the only architectural
changes on rejection. No call frame, fault entry, Namespace update, authority
grant, lazy delivery, retry or recovery is initiated by a rejected attempt.

**Rejected destination data is unchanged, not zeroed.** Software MUST inspect
the result before using it. Success is reported even when the normal
destination rule discards the read value, such as a zero/discard register.

### 3.4 Closed rejection set

Only these pre-access reasons may produce normal rejection:

| Rejection | Boundary |
|---|---|
| Architectural NULL | Includes nonzero NULL-type encodings; not merely literal word zero. |
| Unsuitable operand type or domain | The supplied GT is not an admissible ordinary-memory DREAD operand. |
| Insufficient read authority | A permission/authority requirement of ordinary DREAD is not met. |
| Invalid binding or generation | Only where the governing DREAD authority contract requires that check; no new lifetime semantics are implied. |
| Invalid effective range | Negative/overflowed indexed offset, out-of-bounds range or overflowing effective address. |
| Target outside this first profile | MMIO, device ports and special control objects are rejected before any read or other target effect. |

An absent/unresolved target MUST NOT trigger lazy loading in this first form.
It is rejected if ordinary read admission can classify it as an invalid
binding; inability to establish admission never permits a read.

Classification MUST be by the failed check and its origin, not just a numeric
fault code. For example, INVALID_OP used for an unsuitable operand type is
not permission to suppress an invalid instruction encoding.

The following remain faults: malformed instruction encoding, instruction-fetch
failure, watchdog expiry, trusted-machine state corruption, integrity/ECC or
bus failures, and any failure after target access begins. An unclassified
failure remains a fault. A damaged authority record MUST NOT be relabelled as
an ordinary caller mistake.

Device reads are deliberately excluded: even a read can acknowledge an
interrupt, consume data or change device state. Ordinary DREAD device behaviour
is not changed.

## 4. Software use

Illustrative proposed assembly:

```asm
; Unconditional attempt; other service state has not yet been changed.
DREAD.TRY DR2, CR3, 0
BRANCHNE reject_argument
; This access succeeded. DR2 is usable under its ordinary register semantics.
```

The first implementation should encourage unconditional attempts followed
immediately by a result branch. Conditional attempts remain legal, but a
condition-skipped attempt leaves incoming flags unchanged: those flags are
**not a result from this instruction**. Software must distinguish "not
attempted" through its existing control flow.

A service should use the actually read value rather than repeat the read after
a successful probe. A later ordinary operation through the same GT can still
fault. Earlier service writes are not rolled back by rejection.

## 5. Explicit exclusions

- No universal SAFE-GT predicate or lasting safety certificate.
- No new `is R`, `is E`, `is Inform`, `is Abstract`, or TESTB predicates.
- No change to TPERM's NULL, EXACT or exact-permission semantics.
- No TRY modifier on CALL, RETURN, LOAD, SAVE, DWRITE, CHANGE, SWITCH or LAMBDA.
- No suppression of callee faults, timeout, watchdog or machine failures.
- No detailed rejection-code register; only the defined NZCV result.
- No automatic retry, allocation, migration, download or authority repair.

The first form protects only the selected read path. Services consuming
capabilities through other operations still need their existing containment
and fault handling. A CALL.TRY would require a separate proposal; safe entry
cannot promise safe subsequent execution.

## 6. Encoding and compatibility

**Recommended approach:** a separately assigned single-word opcode for the
first DREAD.TRY form, preserving DREAD's condition, register and indexed-offset
fields. `.TRY` is a source-level modifier, not a claim that a universal modifier
bit already exists.

The inspected decoder uses all 32 bits: opcode [31:27], condition [26:23],
destination [22:19], source [18:15], immediate [14:0]. The approved indexed
operand uses the immediate field; borrowing a condition or immediate bit would
change existing semantics.

**No numeric opcode is assigned here.** Selection requires an audit of the
master ISA, approved amendments, compiler encoders, simulator and target
profiles. Historical reserved-opcode comments are not allocation authority.
If no suitable encoding is available, return the encoding choice for review;
do not silently introduce a prefix or multiword instruction.

Existing instruction words retain their meanings. A compiler MUST NOT lower
the proposed form to TPERM followed by ordinary DREAD: that is not equivalent.
Unsupported compiler/target profiles MUST reject the form rather than discard
`.TRY`. Unknown encodings on older targets remain governed by their existing
invalid-instruction rules; deployment must not rely solely on that fault.

## 7. Acceptance criteria before claiming implementation

1. Round-trip approved encodings and indexed operands; preserve every existing
   instruction/condition meaning; reject unsupported `.TRY` combinations.
2. Exercise all ARM conditions with representative incoming flag combinations.
   False conditions preserve destination and flags and cause no target access.
3. Verify successful reads, including boundary offsets and the discard
   destination, with exact NZCV and ordinary DREAD-equivalent data.
4. Exercise each rejection independently: NULL including nonzero encodings,
   wrong type/domain, permission denial, applicable binding/generation failure,
   range underflow/overflow and profile exclusions.
5. On each rejection, observe no memory/device access, destination write,
   authority mutation, call-stack change, fault entry or delivery initiation.
6. Observe no MMIO side effects, including read-to-clear and consuming reads.
7. Change operands/authority during an attempted access. Prove that no read
   uses authority from one binding and an address from another.
8. Demonstrate that invalid encoding, watchdog, integrity, bus and post-access
   failures retain normal fault behaviour, including simultaneous rejection
   and an independent fault. No success/rejection completion may mask the fault.
9. Show ordinary DREAD still hard-faults in corresponding invalid-operand cases.
10. Demonstrate an API read rejecting a hostile argument and returning normally,
    while a subsequent valid request succeeds. No claim about other API paths.

Simulator, RTL and physical results must be identified separately. Passing
local tests is not physical acceptance.

## 8. Review decisions and implementation gates

| Item | Recommended disposition |
|---|---|
| Initial scope | Ordinary-memory DREAD.TRY only. |
| Result | Z=1 success, Z=0 rejection; N=!Z, C=V=0 on attempted completion. |
| Conditional skip | Preserve flags; do not validate/access target. |
| Rejection boundary | Closed pre-access set in section 3.4; everything else retains faults. |
| Encoding | Separate single-word opcode preferred; exact value unassigned. |
| Expansion | Separate approval for every additional operation or device profile. |
| Current authorization | Review document only; no implementation or release change. |

Before implementation, reconcile ordinary DREAD's authority contract with its
implementations and assign the exact rejection origin for each required check.
The current RTL uses resolved CR metadata and is not evidence of a fresh
Namespace-generation check on every DREAD. Any mismatch with the governing ISA
must be identified explicitly, not hidden by this proposal or replaced with a
new ISA rule.

Semantic acceptance does not select binary encoding, approve a bitstream build,
or add this feature to the current starter release.

## References

- [Master ISA](instruction-set.md): approved Phase 1 contract, TPERM NULL/EXACT,
  and DREAD/DWRITE indexed operands.
- [Current DREAD RTL](../hardware/dread.py): implementation evidence, not
  architectural authority.
- [Current decoder](../hardware/decoder.py): field layout and condition logic.

