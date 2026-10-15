# Church Machine Instruction Set

## Navigation

- [Document authority](#document-authority)
- [Approved Phase 1 contract](#approved-phase-1-contract)
- [October 2026 amendment reconciliation](#october-2026-amendment-reconciliation)
- [BFEXT/BFINS bitfield contract](#bfextbfins-bitfield-contract)
- [CHANGE: one-GT Thread activation](#change-one-gt-thread-activation)
- [Uniform indexed operands](#uniform-indexed-operands)
- [SWITCH: isolated-register LOAD](#switch-isolated-register-load)
- [Retired opcodes and reference forms](#retired-opcodes-and-directindirect-reference-forms)
- [Historical evidence and inventory](instruction-set-history.md)
- [Legacy section links](#historical-section-links)

## Document authority

This is the **master ISA document**. Its requirements take precedence over
`isa_reference.md`, `isa_encoding.md`, the `isa-indexed-*` proposals, derived
PDFs and implementation descriptions. Those documents support this master;
assembler, simulator or hardware behavior does not override it.

The previously approved retirement of **ELOADCALL (opcode 8)** and
**XLOADLAMBDA (opcode 9)** remains in force. Descriptions of those encodings
below are historical only; they do not authorize execution or automatic
translation of saved programs.

The one-GT CHANGE and indexed-operand corrections below are authoritative.
Existing encoding tables and repeated instruction descriptions elsewhere in
this document remain baseline records pending reconciliation; they do not
override these corrections or establish a new encoding layout.

## Approved Phase 1 contract

**Reconciled from explicit Genesis decisions, 2026-10-14.** The
[resolution log](phase-1/REVIEW-2026-10-14.md#resolution-log--guided-review)
is the decision evidence. These are target requirements, not claims that the
compiler, simulator, RTL, saved images or physical board already conform.
Only approved decisions are incorporated; software TBDs are not implementation
defaults. No build, migration, upload or flash is authorized by this edit.

**Software/bitstream boundary — approved:** Software cannot block the Phase 1
bitstream. Abstract PassKey Owner-ID/payload format and remaining software
contracts are software work, not bitstream prerequisites. Keep required software
delivery and its acceptance separate from hardware readiness; do not turn
unresolved software details or reload-path validation into a bitstream gate.
This does not waive hardware ISA/conformance requirements, claim tests passed,
or authorize a build or flash.

### Execution and watchdog

```text
CHANGE: THREADSAVE → THREADLOAD
SWITCH: THREADSAVE → LOAD NAMESPACE(CR15) → THREADLOAD
```

These are internal phases, not separately issued instructions. Ordinary CHANGE
remains and leaves CR15 unchanged. SWITCH saves under the outgoing Namespace
and loads the Thread under the incoming Namespace; no following CHANGE is
required. CR13 is reserved NULL and **never touched** in Phase 1: no IRQ role,
load, restore or explicit clearing, including on SWITCH.

**Phase 1 fixed destinations — approved:** `CHANGE CRn` takes the incoming
Thread GT from the selected source CRn and activates it into **CR12**; CRn
is not a destination selector. Ordinary CHANGE leaves CR15 unchanged.
SWITCH has fixed Namespace destination **CR15**, then fixed Thread destination
**CR12** using the incoming Namespace's slot-2 entry. Neither instruction is
a general-purpose isolated-register LOAD in Phase 1. Thread save/load still
updates the associated execution context, not just these GT registers.
The CR13 reservation continues to apply. Ordinary CHANGE now uses the approved
direct layout below; SWITCH's destination field is also settled below.
The SWITCH row encoding and reset-only marker are now selected below;
the remaining reset authority and entry-sequencing decisions stay separate.

**Shared Namespace/entry-Thread authority — approved:** If CR15 is reloaded,
the incoming Namespace's slot-2 Thread must also be activated into CR12 by
the **same authority**. There is no independently requested Thread-activation
grant or extra CR12.M requirement. For SWITCH, CR15.M authorizes the combined
Namespace/Thread handoff; during reset, authorized bootstrap context covers
Namespace establishment and the reset marker's incoming Thread activation.
The approved reset instruction sequence and one-shot admission remain intact;
this rule does not silently collapse reset into one instruction.
Thread type, version, capability and frame validation still apply; any failure
hard-faults rather than accepting a Namespace-only handoff. No rollback is
promised. The subsequent 18-bit boot-pair guard decision below selects the
guarded reset entry GT's version independently of this authority rule.

**SWITCH source — approved:** Retain the authorized C-List row lookup.
CRs in CR0–CR11 supplies an L-capable C-List capability; the selected row
supplies the incoming Namespace GT after ordinary bounds, generation,
integrity and type validation. SWITCH does not directly consume a Namespace GT
already held in CRs. Current CR15.M authorization remains required; source M
does not authorize the operation. Fixed destinations do not waive these checks.
**SWITCH destination encoding — approved:** Bits **22:19 must be zero**.
The opcode implies Namespace destination CR15 and entry-Thread activation into
CR12; zero does not select CR0. Authorization latches **CR15.M**, never the
M bit indexed by the zero field. The C-List source and row lookup remain;
the subsequent row-format decision is recorded below.
Do not emit the old explicit-destination value 15 as the new canonical form.

#### SWITCH row encoding — approved

Reuse the selected LOAD/SAVE index format for bits 14:0:

| Bits | Meaning |
|---|---|
| 14 | Sign: 0 adds the magnitude; 1 subtracts it |
| 13:4 | Unsigned offset magnitude, 0–1023 |
| 3:0 | DR index selector |

The C-List row is `DR[index] ± magnitude`, calculated without wraparound and
checked against the source capability's bounds. The 1023 limit applies to the
offset, not the total row number. DR0 supplies zero for immediate-only rows;
row 7 has operand **0x0070**, not 0x0007 (DR7 with offset zero).
Reject out-of-range source magnitudes rather than truncating them.
Retain opcode 5, ordinary condition bits, source CRs in bits 18:15, and the
approved required-zero bits 22:19. CR15.M still authorizes the handoff.
This is indexed row selection for SWITCH, not approval of indexed CHANGE.
Compiler/simulator/RTL agreement and exact-build physical evidence remain
downstream requirements, not consequences of this documentation approval.

#### Ordinary CHANGE encoding — approved

| Bits | Meaning |
|---|---|
| 31:27 | Opcode 4 (`00100`) |
| 26:23 | Ordinary condition code |
| 22:19 | Reserved, required zero; destination CR12 is implicit |
| 18:15 | Source CRn holding the incoming Thread GT |
| 14:0 | Reserved, required zero |

For condition AL (`1110`), `CHANGE CR12` is **0x27060000**:
`00100 | 1110 | 0000 | 1100 | 000000000000000`.
Zero in the unused destination field does not select CR0.
This selects direct CHANGE only, not an IDX flag, C-list lookup or indexed form.
The former repeated-register word 0x27660000 is not a canonical ordinary CHANGE
under this layout. Do not silently reinterpret it as an indexed operation.
The reset-only marker is the explicit exception defined below; no saved artifact migration,
assembler/RTL modification or bitstream build is authorized by this selection.
Consumer agreement, noncanonical-word rejection and exact-build FPGA evidence
remain downstream release requirements.

#### Reset-only activation marker — approved

Reserve exact word **0x27000001** for incoming-only Thread activation at the
designated instruction in trusted reset ROM. Admission is **one-shot per reset**,
not a privilege conferred by a programmer-set M bit. Activate the initial
Thread from **Namespace slot 2 into CR12**, with no outgoing Thread save.
CR13 remains untouched. The marker outside its authorized reset context
hard-faults **INVALID_OP**; neither copying the word into ordinary code nor
replaying it grants reset authority.

**One-shot consumption — approved:** Consume authorization when a valid marker
invocation is accepted in its authorized reset-ROM context, **before Thread
activation begins**. An activation fault does not restore authorization.
Only a fresh reset re-arms it; replay cannot retry the operation. This defines
observable admission behavior, not a particular hardware latch or control ABI.

**No additional CR12.M grant — approved:** The authorized reset context and
one-shot marker authorize incoming Thread activation through internal microcode
authority. Do not require or issue an additional CR12.M grant solely to execute
the marker. Retain Thread and capability validation. This does not change
initial Namespace authority, ordinary M-bit rules or SWITCH's CR15.M requirement;
it does not prescribe clearing/restoring M state outside existing context rules.

This is an explicit reset exception to ordinary CHANGE's required-zero low
bits, not indexed CHANGE or a general capability-check bypass. The marker and
its restricted purpose are selected. Reset-ROM fetch authority is bounded as
specified below. The final ROM CALL, marker consumption timing and absence of
an additional CR12.M grant are settled. Remaining detailed entry binding still
needs definition and conformance evidence.
No ROM rebuild, binary migration or hardware operation is authorized.
Downstream tests must distinguish legitimate reset admission, replay, ordinary
code containing the same word, software M manipulation, invalid slot-2 state,
post-acceptance faults that must not re-arm admission, fresh-reset re-arming,
and wrong entry context, using simulator, RTL and exact-build FPGA evidence.

#### Boot-image matching guard — approved contract; provisioning details TBD

For the proposed IDE-generated hardware guards associated with Namespace
slot 1 and entry-Thread slot 2, the user selected protection against
**accidentally loading the wrong boot image**. Treat this as a non-secret
build/image matching guard, not authentication against deliberate substitution.
A matching identifier alone does not authenticate slot contents.

**Binding scope — approved:** Identify the approved boot configuration for
**slots 1 and 2**, not every complete boot-image revision. Changing that
approved Namespace/entry-Thread configuration requires a new matching guard
value in the bitstream and boot metadata. Unrelated application LUMP changes
and normal runtime Namespace updates do not themselves change this value.
The guard is not a hash of all mutable Namespace contents and does not certify
the entire image. Ordinary object validation remains required. Detailed
configuration identity/canonicalization still needs definition.

**18-bit version-pair guard — approved special case:**

```text
guard18 = (slot1_version << 9) | slot2_version
```

The IDE independently chooses each boot version uniformly from **0–510**,
excluding reserved value 511, and packs the pair into 18 bits:
upper half in slot 1's existing version field, lower
half in slot 2's. Embed the expected pair in the bitstream. This replaces the
earlier proposal to store identical full guard copies in separate boot metadata;
no additional Namespace-entry guard fields are needed. Do not repeat the same
nine-bit value in both halves as the generation rule.

**Guard lifetime — approved:** Generate the pair once when a new boot
configuration is approved, and retain it with that approved configuration.
Reuse it for unchanged rebuilds, exports, uploads and machine resets, and
for unrelated application LUMP changes. Generate a new pair only upon explicit
approval of a changed boot configuration, not automatically on every bitstream
build. The matching bitstream, slot versions and referring GTs must use the
retained pair. This selects the value's lifetime, not a storage schema.

**CR0-only startup selection — approved IDE option:** The IDE must offer a
setting choosing whether changing only the boot Thread's CR0 startup selection
retains the existing guard or requires a new guard and matching bitstream.
This option concerns selecting the first abstraction, not replacing the boot
Namespace or entry Thread. In retain mode, normal final `CALL CR0` validation
still applies. In new-guard mode, treat the selection change as a changed boot
configuration requiring explicit approval before generating the new pair;
propagate that pair consistently to the bitstream, slot versions and referring
GTs. Neither mode bypasses ordinary validation or disables guard checks.
**Default — approved: retain the existing guard.** The new-guard mode remains
an explicit IDE option. **Setting scope — approved:** Save the selected policy
with each boot configuration, not as an IDE-wide preference. Preserve it when
the configuration is shared or reopened; different configurations may select
different policies. New configurations default to retaining the existing guard.
The concrete storage schema remains TBD. This is an IDE policy choice, not
authorization for hardware to change versions.

All GTs referencing these boot objects must use their corresponding assigned
versions. For this guarded boot pair only, reset and any handoff into the pair
use the bitstream's expected entry-Thread version rather than assuming zero.
Expected versions must never be copied from live descriptors to make validation
pass. Hardware compares; it does not change versions. Changing either assigned
version requires a matching approved boot configuration and bitstream.
Ordinary allocatable-slot initial/release/reuse rules are unchanged. Other
Namespace handoffs retain their approved fixed version-0 rule.

There are **511 × 511 = 261,121** permitted pairs. For independently generated
unrelated pairs the accidental match probability is **1/261,121**; when only
one half is independently regenerated and the other is fixed, it is **1/511**.
Packing remains 18 bits, but not every 18-bit pattern is a valid guard.
This is not authentication or a content check. Retain all ordinary capability,
integrity, version, type and frame checks. GT width, integrity32 and T meanings
are unchanged.

**Two-stage checking — approved:** Check slot 1's expected version during
Namespace admission, then slot 2's expected version during Thread admission
before activation. Both checks must succeed for the handoff to complete.
CR15 may already have changed when the second check fails: hard-fault without
rollback and never activate/run the target Thread. No extra preflight pass
checking both objects before changing CR15 is required by this guard.
**Mismatch reporting — approved:** Use the existing `VERSION` fault for either
boot-guard mismatch, with diagnostics identifying the failing slot: slot 1
(Namespace) or slot 2 (Thread). No separate boot-guard fault category is added.
Preserve the two-stage checks and hard-fault-without-rollback behavior above.
Existing admission checks remain mandatory. Detailed configuration identity,
storage schema and provisioning mechanics remain TBD. No random value, artifact, bitstream or
implementation is generated by this approval.

#### Reset-ROM instruction-fetch authority — approved

Hardware permits instruction fetch only from the designated **immutable reset
ROM during bootstrap**, independently of ordinary Thread fetch authority.
Application code and programmer-set M bits cannot enable this authority.
It grants no additional data-memory or Namespace-table permissions and is not
a general validation bypass. End this fetch authority at the defined boot
handoff; ordinary execution thereafter uses normal capability checks.
The approved handoff point is the successful execution transfer by the final
ROM **CALL CR0**. Retain that CALL after slot-2 Thread activation; it enters
the prepared programmer-selected first abstraction under normal CALL validation.
End reset-ROM fetch authority on that successful transfer, before fetching
ordinary target instructions. Failure hard-faults, not a successful handoff or
a retry path. This does not add a ROM CALL to ordinary CHANGE or SWITCH.
This requirement does not select an implementation latch, reset grant ABI or
new capability encoding.

Downstream simulator, RTL and exact-build FPGA evidence must show bounded ROM
fetch, rejection outside the permitted bootstrap context, no software/M-based
re-enablement, no extra data/table access and normal fetch checks after handoff.

An executed `CHANGE CR13` or `SWITCH` targeting CR13 hard-faults through
existing **INVALID_OP**, before any instruction effects (including Thread
save, register/M changes or Namespace writes). A condition-false instruction
is skipped, with no CR13 operand checks or instruction effects. This is the
approved reserved-operand disposition, not permission to execute CR13 operations
or a waiver of independent fetch/encoding faults.

The watchdog is **one second of elapsed time to hard fault**, except in IDE
Debug or IDE Trace mode. Every successful CHANGE/SWITCH renews a full second,
including self/helper transfers. Retirement, CALL and RETURN do not renew it;
failed or condition-skipped transfers do not renew it. This bounds time between
transfers, not useful progress or return to a scheduler.

Arm on execution start after reset, including boot unless exempt. On leaving
both exempt modes, start a fresh second. Expiry wins at equality: a transfer
must complete strictly before its deadline. Stalls do not extend the interval.
No automatic IRQ, CR13 action, maintenance exemption or hardware timer ABI is
introduced by this policy; exact target timing/capture needs implementation evidence.

**Watchdog exemption across reset — approved:** Hardware reset preserves the
existing Debug/Trace exemption rather than clearing it. An active exemption
therefore remains active across reset; reset does not create an exemption
when none was active. The MMIO abstraction remains in control. Leaving both
exempt modes starts a fresh one-second interval under the existing rule.
This is reset retention, distinct from the Phase 1 initialization rule below;
it does not promise persistence of the previous state across power loss or
FPGA reconfiguration.

**Phase 1 bootstrap watchdog initialization — approved:** After power-on or
FPGA configuration, start with the Debug/Trace watchdog exemption **enabled**.
This is a Phase 1 bootstrap decision where **Genesis = IDE**, not a universal
default for later phases. The MMIO abstraction remains in charge; this does
not impose an IDE-only hardware-control path. Hardware reset preserves the
current exemption state. When both exempt modes are left, start a fresh
one-second interval under the existing rule. Initial enabled state is not
retention of whatever state existed before power loss or reconfiguration.

**Watchdog MMIO authority — approved:** The watchdog register must exist as a
Genesis-provisioned MMIO GT; the MMIO abstraction is in charge. Do not replace
this capability-mediated control with an IDE-only hardware-control restriction.
This does not grant the GT to every Thread or authorize arbitrary watchdog
writes. Address, register fields, permitted writes and capability distribution
remain unspecified; retain the approved one-second deadline, Debug/Trace
exception and CHANGE/SWITCH renewal rules.

The Phase 1 Mint exclusion of MMIO creation does not exclude this
Genesis-provisioned platform MMIO object. No new slot, register ABI, software
delivery gate or passed hardware-conformance claim is introduced here.

**Watchdog context-capture authority — approved:** Use the existing validated
Thread-save path to save the faulting Thread's context. Retain its validation
checks; do not give the watchdog a separate unrestricted RAM-write bypass.
If outgoing context cannot be saved, it remains a failed save, not permission
to bypass validation or claim capture succeeded. This selects capture authority,
not a new recovery handler or CR13 role; preserve the existing save-first
recovery direction. Exact implementation and hardware evidence remain required.

**Watchdog accepted-write boundary — approved:** Latch the watchdog fault at
the deadline and stop new program-side writes. Already-accepted memory writes
must finish within a verified hardware bound before recovery uses memory.
This is not extra program execution time, cancellation of committed writes,
rollback or permission to complete unaccepted writes of a multi-write operation.
Recovery's validated Thread-save writes are a separate operation and retain
their checks. The acceptance/completion boundary and exact bound require
hardware evidence; do not assume completion merely from elapsed time or reset.

**Same-cycle fault priority — approved:** If an instruction fault and watchdog
expiry occur on the same clock edge, report the instruction fault code rather
than WATCHDOG. Execution still stops immediately; watchdog deadline containment,
the prohibition on new program writes and bounded completion of accepted writes
remain mandatory. This reporting priority does not allow execution to continue
or let a deadline-equal CHANGE/SWITCH renew the interval. It selects only this
same-cycle tie, not a general priority order or permission to replace an earlier
latched fault.

### Phase 1 hardware fault-code assignments — approved

| Fault code | Name |
|---|---|
| `0x1D` | `THREAD_CONTEXT` |
| `0x1E` | `THREAD_PERMISSIONS` |
| `0x1F` | `WATCHDOG` |

These assignments occupy the existing five-bit fault-code field; they are not
instruction opcodes or TPERM operand encodings. Approval selects the numbers,
not additional trigger conditions, precedence rules or implementation details.
Retain already approved fault behavior. Simulator, RTL, telemetry and exact-build
physical conformance remain to be verified; no runtime change is made here.

**Thread permission-check mapping — approved:** Failure of the supplied Thread
GT's mandatory no-permissions check reports `THREAD_PERMISSIONS` (`0x1E`) as a
hard fault. This maps the existing check; it does not relax it or replace
the context-validation mapping below. Priority when multiple checks fail is
not selected by this mapping.

**Thread context-validation mapping — approved:** All Thread-context validation
failures report `THREAD_CONTEXT` (`0x1D`), not only structural failures lacking
a more-specific code. Within context validation, this reporting rule replaces
more-specific failure codes; the underlying checks remain mandatory.
The supplied Thread GT's no-permissions check is a separate operand check and
continues to report `THREAD_PERMISSIONS` (`0x1E`). This does not remap ordinary
instruction faults outside Thread-context validation, change validation order
or select priority when distinct checks fail together.

### TPERM NULL and EXACT

| Form | Phase 1 behavior |
|---|---|
| `TPERM CRn, NULL` | Preset 15 (`0x0F`), unchanged TPERM opcode. Test architectural NULL type, not literal zero. NULL: NZCV=0100; non-NULL: NZCV=1000. Never modifies the GT or faults merely for its type. |
| B-modified NULL encoding 31 (`0x1F`) | Reserved: assembler rejects; executed raw form hard-faults. The operand GT's B bit is ignored by the NULL-type test, not the instruction modifier. |
| `TPERM CRd, EXACT, CRs` | If either or both operands are NULL, hard-fault **before changing flags or operands**, attributed to EXACT itself. For two non-NULL operands, retain bit equality and the existing Z=match, N=not-match, C=0, V=0 convention. Equality is not credential validity. |
| Condition-skipped TPERM | No operand checks, no TPERM fault, no flag/capability changes, including the reserved B-modified NULL form. Independent fetch faults and watchdog expiry remain possible. |

NULL includes nonzero encodings of the architectural NULL type. Preserve the
originating EXACT fault location through subsequent fault handling. Validate
PassKey issuance, type, generation, binding and proof separately; equal malformed
or stale GTs must not authorize an operation. No read-only TESTB is approved.

Implementation evidence is limited to assembler/simulator tests and RTL
simulation. Physical FPGA verification remains outstanding; this change does
not authorize a bitstream build, flash, or saved-image migration.

F/G are Namespace Word-1 bits 31/30, inspected through authorized reads and
BFEXT, not new TPERM presets. Within Mint, only the same-scope single-slot
LAMBDA references NSRW-GT. Setting GT B=true, if required, is a privileged
function, not a new set-B instruction; its authority/ABI remain TBD.

### Standard software hard fault

`HARDFAULT reason` is an approved compiler pseudo-instruction direction:
emit **one designated non-executable word** using existing INVALID_OP.
Genesis selected **`0xF7000000`** following isolated verification, not a new executable opcode.
It must remain non-executable in future ISA revisions; HALT is not a substitute.

See [verification evidence and remaining gates](phase-1/HARDFAULT-CANDIDATE-VERIFICATION.md).
Compiler emission remains disabled; physical behavior is not verified.

The compiler records an exact-artifact map:
`instruction offset → reason, method, source line, explanation`.
The IDE uses captured origin and loaded artifact identity, or shows the raw
location if no matching map exists. INVALID_OP alone does not identify an
intentional site. Start with static diagnostics only: no proof/private-authority
data, register dumps, runtime message construction, reporting CALL, network
dependency or diagnostic scratch registers. Tiny LUMPs need not carry strings.
Verify state preservation and pre-recovery location capture before use.

### Namespace identity and software lifecycle

See [active geometry](#active-namespace-geometry) for the approved ascending
256-slot starting table, slot map and half-FPGA-memory budget.
GT and entry generations are **9 bits, 0–511**. Hardware checks equality and
faults on mismatch; software alone manages versions. Never add a hardware
increment, wrap/exhaustion policy or wrap-rate timer.

For genuinely never-used Mint slots, initial version is 0. Before authorized
pool release, software increments before freeing; no wrap. Ordinary issued
versions are **0–510** (511 values). **511 is permanently retired**, never an
ordinary issued GT version. Destroy at 510 advances to 511 and retires the
slot rather than preventing destruction. Never reallocate a retired slot or
reset its version. Retain usable release versions 1–510 with the Namespace
slot, not the memory block; reallocation uses them without a second increment.
Backing-memory reclamation remains subject to safe-release checks and is
distinct from retiring the slot. Boot-pair generation also excludes 511:
choose each half from 0–510. This does not change existing boot artifacts here.
Empty does not mean never-used. **Direct replacement's slot/version policy is
software TBD**, not inferred from release. Track used/free blocks per LUMP
size separately from slot/version availability; ownership, bookkeeping and
remaining safe-release mechanics are TBD.

**No GC in Phase 1.** Hardware G-bit inversion requires a system GC setting;
its location/control is Phase 2 TBD. No garbage-to-NULL automation is approved.

Retain the existing integrity formula, excluding both F/G and no other fields:
`ROL32(W0,7) XOR ROL32(W1 & 0x3FFFFFFF,13) XOR 0xDEADBEEF`.
Masking for calculation grants no write authority.

T identifies networked objects: a networked Golden Token. Without a network,
**T === GT**; do not narrow this to frozen bootstrap or automatically define T
as a content hash. The IDE may use T values greater than slot count as
**virtualGT** IDs for non-memory objects when resident+lazy+new objects exceed
table capacity. This is not a hardware slot or access grant. Representation,
network/local binding and virtual/resident transitions remain TBD.
One IDE managing several CMs is Phase 1; direct CM-to-CM and multiple IDEs are
deferred. Two Namespaces on one FPGA for networking tests are Phase 2.

### Services and evidence

**Loading scope — approved:** Defer automatic IDE-assisted lazy loading to
Phase 2. Phase 1 uses explicit IDE-controlled loading before execution, not
an execution-triggered request/install/continue path for nonresident LUMPs.
This does not remove the required services or the separately validated
service-reload delivery option below, and does not waive admission checks.

Working Mint, pkverify and controlled nstab remain software-delivery requirements.
Their completion and the validated reloadable-LUMP delivery path do not block
the Phase 1 bitstream; do not confuse bitstream readiness with completion of the
software-inclusive release. The [Mint contract](ide-mint-forge-contract.md)
governs the approved scope, single-slot LAMBDA, proof and publication boundaries.

**Mint object scope — approved:** Phase 1 supports application Abstractions,
Threads, **LS C-list objects and RW data objects** within an existing Namespace.
The LS and RW permissions apply to their respective object classes, not a
combined permission grant. **MMIO objects are excluded from Mint's Phase 1
scope**; this does not remove existing platform hardware I/O.
Creating Namespace LUMPs through Mint is deferred to Phase 2.
PassKey forging remains required. Existing
replacement restrictions remain unchanged; this is not authorization to
replace RESIDENT LUMPs or an active Thread.

**Replace active-use exclusions — approved:** Reject replacement of the active
Thread and objects supplying currently executing code or the active C-list,
even with valid operation-authorized credentials. Hard-fault before changing
the target Namespace entry (including its version) or target memory. The
RESIDENT exclusion remains mandatory. Active-use detection and direct
replacement's slot/version policy remain software TBD.

**Explicit Destroy — required:** Include an explicit authorized object-destruction
operation in Phase 1. This is neither GC nor simply revoking a PassKey pair.
Preserve the approved software slot-version and pool-release rules. Destroy's
detailed authority, remaining per-type eligibility, active-use detection,
reclamation, interruption behavior and ABI still need definition.

**Destroy exclusions — approved:** Refuse RESIDENT objects, the active Thread,
and objects supplying currently executing code or the active C-list. Even a
valid operation-authorized PassKey cannot override these exclusions. Hard-fault
before changing the target slot version or modifying/reclaiming target memory.
This defines the safety requirement, not how active use is detected.

**Reclaimed memory — approved:** Zero the entire reclaimed memory block before
another object can use it, including unused capacity, not only the former payload.
Whether Destroy or allocation performs the clearing, its mechanism and
interruption handling remain software TBD. Incomplete clearing must not permit
reuse. This does not waive Destroy exclusions or change slot-version rules.

**Destroy with outstanding GTs — approved:** Authorized Destroy may invalidate
outstanding GTs without locating every copy or proving no references remain.
Subsequent stale-GT accesses must fault. Apply the approved software
increment-before-free/no-wrap/retained-slot-version rules: 510→511 destroys
and permanently retires the slot; never issue or reuse ordinary version 511.
This does not authorize destroying active or
protected objects or settle safe reclamation and interruption mechanisms.

**PassKey required in each Mint case — approved:** Require the valid PassKey
GT plus its separate 128-bit proof for each supported Create, authorized
Replace and explicit Destroy request, covering application Abstractions,
Threads, LS C-list objects and RW data objects. Validate authorization for the
specific operation and target; one valid pair is not blanket authority.
Missing, invalid, revoked or insufficiently authorized credentials hard-fault
before protected changes. This does not select credential allocation per type,
resolve bootstrap mechanics or add PassKey checks to ordinary ISA LS/RW accesses.

**Initial PassKey issuance — approved:** Use a separate Genesis-authorized setup
procedure in which Mint creates the initial GT/separate-128-bit-proof pairs for
explicitly approved recipients and permissions. No unauthenticated first-caller
shortcut is permitted. Ordinary Create, Replace and Destroy still require valid,
operation/target-authorized PassKeys. The setup mechanism, authorization
representation and protected delivery remain software TBD.

**PassKey lifetime — approved:** The issued PassKey GT and separate 128-bit
proof are reusable until revoked. Successful use does not consume the pair.
Every operation still requires current credential validation and authorization;
revoked or otherwise invalid credentials hard-fault. This does not provide
one-time-use replay protection or select proof storage, transfer, ABI or
concrete revocation mechanics.

**PassKey onward sharing — approved:** A holder may share its GT/proof pair
onward only with explicit Genesis authorization. Possession of a valid pair
does not confer delegation rights. Unauthorized onward-sharing attempts must
hard-fault. **SAVE GT detects Abstract PassKeys**; this is the identified
GT-side detection point, not an entirely unspecified copy detector.
Representation of Genesis-authorized sharing, recipient identification and
protection/transfer of the separate 128-bit proof remain TBD. SAVE's GT check
must not be presented as detection of arbitrary proof-byte copying. Exact
simulator, RTL and physical FPGA conformance remains to be verified.

**PassKey format review — not approved:** The proposed bit format remains an
unapproved draft. The user's correction makes bits 30:27 free for reuse as
defined by the Owner, not fixed `perm=000, dom=1`. The user further clarified
that an Owner is an abstraction hierarchy with an A-GT-id, proposing four bits
for Phase 1. The revised draft uses [30:27] for that ID, retains B as Bind and
leaves [24:0] Owner-defined without a required generation/ID split.
Do not adopt `0x0E000000` as
a universal PassKey prefix or reserve that combination as its subtype marker.
See the [format draft](phase-1/MINT-CODE-DRAFT.md#abstract-passkey-format--unapproved-draft).
This does not change the approved separate-proof or sharing requirements.

**PassKey revocation scope — approved:** Revocation invalidates the PassKey
GT/proof pair, not object GTs previously issued under its authority. No automatic
cascading revocation is required or implied. Previously issued object GTs
remain subject to their own validity and separately authorized revocation
rules; this does not make them permanently valid.

**PassKey revocation authority — approved:** Only an explicitly
Genesis-authorized revoker may revoke the pair. A holder does not gain
revocation authority merely by possessing it. Unauthorized revocation attempts
hard-fault. The concrete authorization representation, ABI and revocation
mechanics remain unresolved.

Require simulator, RTL and exact-release-build physical FPGA evidence for
TPERM NULL/EXACT, HARDFAULT/IDE attribution and Mint's exclusive update/publication,
**with Genesis override authority**. Identify exercised overrides separately
from passed tests; preserve failed, missing and unobservable evidence honestly.
No override is exercised by this specification.

## October 2026 amendment reconciliation

The subsequent [approved Phase 1 contract](#approved-phase-1-contract) below
supersedes the earlier pending status wherever an explicit decision now exists.
Historical proposals remain evidence, not additional approvals.

**Documentation correction — 2026-10-14.** This section reconciles the
[October 13 completeness review](../attached_assets/Pasted-ISA-Amendments-2026-10-09-Completeness-Review-Oct-13-20_1791978480955.txt)
with this master and the
[Design Team reconciliation](../reports/isa-amendment-reconciliation-2026-10-13.md).
It clarifies authority and release requirements; it does **not** approve an
unresolved instruction encoding, boot replacement, watchdog mechanism, or
implementation cutover.

### Edition identification and decision status

The two October 9 review editions are different historical proposals:

* [Special operations and cooperative scheduling](../reports/isa-review-cooperative-round-robin-hard-faults.html)
  proposes cooperative scheduling and withdraws the earlier IRQRETURN proposal
  within the review series.
* [Split 13-bit CHANGE magnitude](../reports/isa-review-change-split13-magnitude.html)
  contains the earlier IRQ exchange/IRQRETURN alternative.

Keep both editions and their manifests unchanged. Neither their dates, their
embedded copies of the master, nor withdrawal within a proposal series amend
this master by themselves. The revised completeness review retracts its earlier
claim that two reported October 12 decisions already superseded this document.
No independent decision record establishing the reported Phase-1 INDEX deferral
or the replacement reset-boot contract was identified in the reconciliation.
These remain requests for confirmation, not established supersessions.

| Subject | Controlling interpretation |
|---|---|
| Ordinary CHANGE | The one permissionless Thread GT already held in CRn is authoritative. No implicit C-List lookup, extra operand, or general operand-M requirement is introduced. |
| Indexed CHANGE | Remains a proposal, not an enabled form under the one-GT correction. A reported INDEX deferral needs its decision record and exact scope; it must not be inferred to cancel the selected compact indexed LOAD/SAVE rules. |
| Direct CHANGE encoding | Approved: opcode 4, ordinary condition, bits 22:19 zero, source CRn in 18:15, bits 14:0 zero; destination CR12 implicit. AL CHANGE CR12 = `0x27060000`. No IDX field or migration policy is approved. |
| Reset boot | Approved marker `0x27000001`: trusted reset ROM only, incoming-only activation of NS[2] into CR12; no additional CR12.M grant. Consume admission on valid acceptance, before activation; only fresh reset re-arms it. ROM fetch authority ends on successful final CALL CR0 transfer. Initial Namespace authority and ordinary M rules are unchanged. |
| CR13 | Reserved NULL and never touched in Phase 1. Executed CHANGE CR13 or SWITCH targeting CR13 faults INVALID_OP before instruction effects; condition-false instructions skip the CR13 check. Earlier IRQ-swap proposals are superseded. |
| Other amendment items | Keep their individual proposed/baseline/user-decided status. The three Phase 1 fault-code assignments are explicitly approved above; no blanket approval is implied for additional trigger conditions, watchdog capture, protected configuration, budgets, derived views, or the complete post-CHANGE register table. |

Namespace handoff and reset entry remain distinct contracts, but both now
explicitly use slot 2. Neither operation touches CR13, including clearing it.

### CHANGE binary disposition — direct form and reset marker approved

The direct form and restricted reset marker are selected; other words below remain evidence or candidates.
No collision or current execution defect is claimed by this inventory.

| Word | Provenance / meaning in its source | Disposition before cutover |
|---|---|---|
| `0x27660000` | Earlier repeated-register direct `CHANGE CR12` word; legacy fields repeat CR12 and immediate is zero. | Noncanonical under the approved ordinary CHANGE layout; do not reinterpret as indexed CHANGE. Existing binaries remain unchanged pending an authorized release rebuild. |
| `0x27060000` | Approved AL direct `CHANGE CR12`. | CR12 destination implicit; source in bits 18:15; unused fields zero. Implementation and exact-build conformance remain unverified by this selection. |
| `0x27678001` | Source-derived legacy reset-ROM CHANGE, encoded with destination CR12, source CR15, immediate 1. | Existing ROM evidence, not either proposed direct word or the proposed boot marker. Verify the exact release image and decoder before changing its meaning. |
| `0x27000001` | Approved one-shot reset-ROM marker, incoming-only activation from NS[2] into CR12. | INVALID_OP outside authorized reset context. Consume at valid acceptance before activation; faults never re-arm it, fresh reset does. No additional CR12.M grant; ROM fetch authority ends at successful final CALL CR0 transfer. |
| `0x276E8000` | Repeated-register `CHANGE CR13` word also discussed as a hidden-return trigger in a separate proposal. | Not approved as an IRQ-return trigger by a successful round trip. Any retained ordinary meaning and any proposed special meaning must be distinguished explicitly. |
| `0x276E8001` | Earlier IRQ-return trigger candidate, withdrawn in the review series; later candidate indexed space can overlap it. | No current IRQ-return authorization. Approve an explicit disposition and test against accidental reauthorization. |
| `0x27000002` | Earlier `IRQRETURN` candidate in the split-magnitude review, subsequently withdrawn within the review series. | No executable IRQRETURN allocation is approved here; include this exact word in negative/disposition checks. |

The source observation for `0x27678001` is the three-instruction
`BOOT_PROGRAM` in [hardware/boot_rom.py](../hardware/boot_rom.py):
LOAD, CHANGE, CALL. Its legacy encoder computes
`(4 << 27) | (14 << 23) | (12 << 19) | (15 << 15) | 1`.
This is not verification of generated ROM bytes, FPGA decoding, flashed
hardware, or successful execution.

### Required evidence for an approved encoding cutover

Before releasing a separately approved encoding or boot change:

1. Record the approved field layout, legal selectors, reserved fields,
   predicates, direct/indexed scope and any distinct boot operation. Record
   unresolved alternatives as pending, not as implementation defaults.
2. Require identical golden words **and architectural meaning** across the
   assembler, disassembler, simulator, RTL decoder and exact release ROM image.
   Bind the evidence to source revisions and image bytes/hash. Textual
   assembler/disassembler round trips alone do not establish conformance.
3. Include every word in the disposition table above, plus malformed and
   unsupported variants. Check direct activation and self-target continuation,
   approved boot entry, wrong phase/replay, and conditional variants. Retired
   trigger candidates must not silently become authorized special operations.
4. Verify encoding-before-condition behavior to the extent explicitly adopted
   by the controlling instruction contract. The amendment's broader generic
   ordering remains proposed; the already approved retired-opcode checks stay
   in force. If indexed forms are approved, independently verify full magnitude
   reconstruction, overflow/underflow and non-wrapping bounds before access.
5. Check applicable permissionless Thread-GT, incoming frame and C-List rules
   before context publication. No encoding decision waives authority checks.
6. Preserve historical LUMPs unchanged. Migration, recompilation, ROM rebuild
   and hardware release need their own authorization. Record every unexecuted
   consumer check as **NOT RUN**; source inspection is not execution evidence.

**Evidence status for this documentation reconciliation:** all five consumer
conformance checks and exact-image/board acceptance are **NOT RUN**. No new
encoding, saved-image migration, ROM build, or hardware operation is certified.

### Open authority and platform decisions

The following remain visible approval blockers rather than implied defaults:
remaining detailed boot-entry binding (slot 2, consume-on-acceptance marker,
no additional CR12.M grant, retained final CALL CR0 and ROM-fetch handoff point
are settled);
protected configuration interface;
target timing-source implementation. The `THREAD_CONTEXT` (`0x1D`),
`THREAD_PERMISSIONS` (`0x1E`) and `WATCHDOG` (`0x1F`) fault-code assignments
are approved, not open allocation decisions; additional trigger details and
implementation evidence remain separate.
Watchdog memory-backed capture authority is also settled: use the validated
Thread-save path, without an unrestricted RAM-write bypass. Its implementation
and verification remain outstanding, not a new authority decision.

Indexed CALL's exact binary-field transcription must be reconciled separately:
do not copy CHANGE's candidate layout. This is a missing encoding record, not
evidence that the already agreed indexed-CALL feature was rejected or deferred.
GT-layout completeness is a separate track; this amendment does not select
or alter a Golden Token bit layout.

## BFEXT/BFINS: bitfield contract

**Normative correction — 2026-10-04.** This supersedes the repeated baseline
bitfield descriptions below. Assembly syntax is `BFEXT DRd, DRs, #lsb, #width`
and `BFINS DRd, DRs, #lsb, #width`, preserving the existing assembler syntax.
Immediate bits 4:0 encode width directly (1–31); bits 9:5 encode lsb (0–31).
Zero width and lsb + width > 32 fault with BOUNDS, without changing registers
or condition flags. Assemblers reject out-of-range operands before masking.
No new interpretation of immediate bits 14:10 is introduced here.

BFEXT zero-extends the selected source field. BFINS replaces only the selected
destination field with the low width bits of the pre-write source. Both set
N/Z from the computed result and clear C/V; DR0 writes remain discarded.
The usual condition predicate applies; a false predicate has no effects.

## CHANGE: one-GT Thread activation

**Normative correction — 2026-10-03.** This section supersedes the indexed
CHANGE descriptions, privileged-register-write variants, and encoding tables
elsewhere in this document and in derived references.

### General programmatic case

CHANGE takes **one GT identifying the new Thread**:

```asm
CHANGE CRn
```

CRn supplies the GT already held in that register. It is not a destination
register or a C-list to index. CHANGE suspends the current Thread and activates
the Thread identified by that GT. There is no second register operand,
Namespace-slot operand, or implicit `[0]` lookup. CHANGE is not a protected
instruction; there is no general operand-M requirement. Its activation
destination is fixed at CR12, independently of the source CRn. The Phase 1
CR13 reservation is an explicit exception: executed CHANGE CR13 faults
INVALID_OP before instruction effects. Other capability and Thread-context
validation remains an execution concern.

Self-target CHANGE is valid, including `CHANGE CR12` when CR12 identifies the
running Thread. Save and restore the newly captured continuation and resume
after CHANGE; do not restore an older dormant snapshot or accumulate frames.
CR12.M is not required merely to supply the operand GT. CR13 is reserved,
not an alternative permitted by granting its M bit.

**Thread GT permissions and microcode authority:** The GT supplied for a valid
CHANGE has **no permissions**. This deliberately prevents programmer access to
the protected Thread state through that GT. CHANGE performs its save/restore
work using **microcode privileges**, not permissions granted by the operand GT.
It must not require R, W, X, L, S, or E on that GT to perform the transition.
A permissionless GT is not a NULL GT: identity, validity and the target Thread
context still require validation. Internal access must not grant those
microcode privileges to subsequent programmer instructions.

**Mandatory acceptance checks:** Microcode must check that the supplied Thread
GT has **no permissions set**, not merely accept zero permissions as optional.
A GT with any permission set fails this requirement; report
`THREAD_PERMISSIONS` (`0x1E`) for this check's failure. It must also validate the
incoming stack frame and a valid C-List usable by the restored context.
**Any error is a hard fault.** Do not ignore errors, strip permissions to make
the GT acceptable, substitute another frame/C-List, or continue with a partial
transition. Microcode privileges enable access for the transition; they do not
waive these checks. All Thread-context validation failures report
`THREAD_CONTEXT` (`0x1D`), including failures that otherwise have a more-specific
code within that validation. The supplied Thread GT no-permissions check
remains separate and reports `THREAD_PERMISSIONS` (`0x1E`). The detailed C-List
validation algorithm remains unspecified here; this fault mapping does not
change validation order or select precedence when multiple checks fail.

This is distinct from validation of the executable Enter GT in a saved
continuation frame. Do not transfer that frame's E-permission requirement to
the permissionless Thread GT supplied to CHANGE. The proposed M-gated hidden
IRQ return is also a separate operation, not an added prerequisite for general
programmatic CHANGE.

Loading a GT into CR12–CR14 with SWITCH and activating its Thread with CHANGE
are distinct operations. The Namespace-targeting `SWITCH CR15` defined below
is the explicit exception: its outgoing save and incoming activation are part
of that single instruction. `CHANGE CR13` is a programmatic use of the GT in
CR13; it must not be interpreted as installing an interrupt-handler GT into CR13.

### Boot exception

**Simulator implementation boundary:** General CHANGE now consumes the GT in
the register named by the existing assembler's one-operand spelling. For
software compatibility, that word repeats the register in both legacy fields
and has zero immediate; no indexed lookup is performed. Other legacy indexed
words are rejected. This is not approval of a new hardware encoding, migration
of saved binaries, or implementation of the proposed IRQ-return trigger.
The simulator checks the incoming frame, C-List geometry, matching executable
SELF and resolvable Inform entries before publishing restored context.
Unoccupied rows and unresolved Abstract locks retain their existing meanings.
An already active Thread is not accepted as a dormant incoming context.
The isolated regression is `node simulator/test_change_one_gt.js`.

Boot uses the **back half** of the Thread transition: the incoming Thread is
loaded into CR12. There is no outgoing programmatic Thread context to suspend.
This special initialization path does not add operands to programmatic CHANGE.

### Earlier IRQ hardware exception — superseded for Phase 1

**Historical status — 2026-10-14:** The following paragraphs retain the
earlier semantic correction and its distinction between CHANGE and IRQ return.
The approved Phase 1 contract reserves CR13 NULL and never touched.
The older IRQ exchange below is not Phase 1 behavior. Do not treat it as approval
to implement IRQ swapping, add an IRQRETURN opcode, or repurpose ordinary
`CHANGE CR13`. See the
[reconciliation status](#october-2026-amendment-reconciliation).

IRQ entry is **not a CHANGE instruction**. Hardware can swap CR12 and CR13
directly, without the additional work of the general programmatic CHANGE path.
IRQ return must perform the **matching hidden swap back**, not CHANGE. The
entry and return operations are paired hardware exceptions; neither uses the
general programmatic Thread-transition path. The earlier statement that IRQ
return uses `CHANGE CR12` is withdrawn. The trigger or instruction encoding
for the return operation is not specified by this correction.

An [M-gated hidden-return proposal](irq-hidden-return-proposal.md) explores
requiring both CR12.M and CR13.M and a candidate `CHANGE CR13, CR13` trigger.
It is **discussion only**, not an approved extension to general CHANGE.
The meaning of a hidden swap with an unchanged CR13, the back-half behavior,
and the return authorization/consumption rules remain to be agreed.

### Encoding and implementation status

The approved ordinary CHANGE layout is specified above. It does not change the
compiler/simulator/RTL, regenerate saved LUMPs, or approve a bitstream.
The legacy `CRd, CRs, idx` implementation is not ISA authority.
In particular, expanding `CHANGE CR13` to `CHANGE CR13, CR13[0x0000]` and emitting
`0x276E8000` is not established as a conforming encoding by assembler/disassembler
round-trip tests. CR13 remains reserved. A binary migration policy is not
specified here; implementation conformance remains separate work.

## Uniform indexed operands

Every instruction operand that denotes an index uses the selected data register's
runtime value added to the immediate, within the indexed instruction itself:

```text
effective_index = DR[r] + immediate
```

* Any data register may supply the runtime value. Use its contents, not its
  register number.
* The instruction performs the calculation itself; no separate ADD instruction
  is required.
* Register-only indexing uses immediate zero. Immediate-only indexing uses DR0,
  whose value is zero.
* Subtractive offsets use `DR[r] - magnitude`, the negative-offset form.
* For example, DR11 containing 7 plus immediate 3 selects index 10—not 14 and
  not 3.
* The operand retains its defined units and meaning (for example, a c-list row
  or data-word offset). Non-index immediates are not changed by this rule.

Indexing grants no additional authority. Existing permission, type and bounds
checks apply to the resulting access or target. Arithmetic overflow, underflow
and out-of-range indices must not wrap into a permitted access. Reject before
an unauthorized read, write or control transfer.

### Compact indexed LOAD/SAVE operand

The selected LOAD/SAVE encoding keeps one 32-bit instruction and reduces the
index immediate to a **10-bit unsigned magnitude**, with a separate sign bit
and a four-bit data-register selector in the existing 15-bit operand field:

| Instruction bits | Field | Meaning |
|---|---|---|
| 14 | S | 0 adds the magnitude; 1 subtracts it |
| 13:4 | M | Immediate magnitude, 0–1023 |
| 3:0 | R | Index register, DR0–DR15 |

```text
operand15 = (S << 14) | (M << 4) | R
effective_index = unsigned32(DR[R]) + (S ? -M : M)
```

The immediate offset range is **−1023 through +1023**, not a signed 10-bit
two's-complement range. M=0 uses S=0 canonically; assemblers normalize `DRr - 0`
to `DRr`. The effective index is not restricted to ten bits: the selected DR
supplies a full 32-bit value. Perform the calculation without wraparound and
apply the access checks above. Reject source magnitudes greater than 1023,
rather than truncating or emitting a separate arithmetic instruction.

Examples of the operand field (not complete instruction words):

| Index expression | Operand field |
|---|---|
| `DR11 + 3` | `0x003B` |
| `DR11 - 3` | `0x403B` |
| `DR15 + 1023` | `0x3FFF` |
| `DR15 - 1023` | `0x7FFF` |
| `DR0 + 3` (immediate-only) | `0x0030` |

No prefix or extension word is required for this operand. The earlier multiword
IDX1/20-bit-magnitude proposal is not the selected LOAD/SAVE encoding.
This decision does not narrow non-index immediates such as IADD's arithmetic
immediate. Other indexed operand roles still require their explicit field mapping.

**Direct ISA cutover:** backward compatibility does not constrain this layout.
Use it directly for LOAD/SAVE; do not add a legacy decoding mode, packet format
or compatibility profile merely to preserve earlier encodings. For example,
operand `0x0003` now means DR3 with immediate zero, not immediate 3.
Previously compiled binaries are not assumed compatible and may require
recompilation. This is not permission to delete or automatically rewrite saved
files. Focused assembler, simulator and Amaranth compact LOAD/SAVE tests now
pass; this does not certify every instruction or the currently flashed FPGA.

The ordinary DREAD/DWRITE indexed forms already implement register-plus-immediate
addition within their existing field limits. Immediate-only LOAD/SAVE now uses
the selected compact field with DR0; it is not an exception to the uniform rule.
Assembler, simulator and Amaranth must follow the same reconciled encoding.
This documentation correction does not itself rewrite saved programs,
Namespace contents or boot images. Existing binaries are not compatibility
requirements for the new ISA.

## Retired opcodes and direct/indirect reference forms

**Current ISA guidance — 2026-10-10.** ELOADCALL (8) and XLOADLAMBDA
(9) are reserved, retired encodings: compilation rejects their mnemonics and
execution must fault. Neither is a callable instruction, a shorthand, nor an
automatic replacement target. Correct old source explicitly and recompile;
do not translate or rewrite stored binaries. A description of a historical IRQ
as “hidden ELOADCALL” does not authorize executing opcode 8.

| Form | Authority/reference used |
|---|---|
| `CALL CRn` | The E-GT already held in CRn; no implicit C-List lookup |
| `CALL CR6[PetName], Method` | Select the declared PetName's GT from the caller's C-List, then the method |
| `LOAD CRd, CRs, #n` / `SAVE CRd, CRs, #n` | Index n, encoded with DR0 and the signed magnitude |
| `LOAD CRd, CRs, DRr + n` / `SAVE CRd, CRs, DRr - n` | Runtime unsigned DR value plus/minus magnitude, with non-wrapping arithmetic and access checks |
| `CHANGE CRn` | The permissionless Thread GT in CRn, not `CRn[0]` |

For LOAD/SAVE, the magnitude is 10 unsigned bits plus a separate sign bit
(±1023). Immediate 7 encodes as operand `0x0070`; operand `0x0007` instead
selects DR7 with zero offset. Do not apply this layout to CALL's C-List-row
or method-selector fields. See the normative sections above for full rules.

The explicit experimental IDX1 packet implementation has separate layout
tests. Its continued existence is **not** authority to change the selected
ordinary LOAD/SAVE encoding or a claim that FPGA execution supports IDX1.

## Active Namespace geometry

**Approved layout correction.** A Namespace allocation starts at its assigned
base, with Boot.Namespace starting at zero and following Namespace allocations
using the next free address under the header rules. Its header determines the
full memory allocation size. The Namespace table (NST) starts at the allocation's
low end and grows upward in four-word slots.

Slot 0 is the **four-word physical Namespace header/metadata**, not a capability
target. It replaces the older separate sixteen-word physical Namespace header:

| Offset from Namespace base | Meaning |
|---|---|
| 0..3 | Slot 0 metadata: W0 Namespace header, W1 memory base, W2 following-member count, W3 reserved |
| 4..7 | Slot 1: Namespace self-entry |
| 8..11 | Slot 2: designated Boot/entry Thread descriptor |
| 32..35 | Slot 8: UART |
| 36..39 | Slot 9: ide.Mint (requested E capability) |
| 56..59 | Slot 14: nstab (requested RW capability) |
| 60..63 | Slot 15: pkverify (requested E capability) |
| `4*i`..`4*i+3` | Subsequent slot `i` |

The header's table count N includes metadata slot 0. Member count is not table
capacity. CR15 describes the **NST only**, with its location at the table base
and a word-offset limit of **`4*N - 1`**. The full memory allocation extent is
derived from metadata, not from CR15's table-only limit. No separate physical
header precedes the NST; resident bodies must not overlap its slots.

Slot 2 serves both reset boot and Namespace handoff. The starting/default
capacity is **256 total slots (0–255)**, configurable rather than an ISA maximum:
1,024 words / 4 KiB of table and CR15 word-offset limit **1023**.
Preserve slot identities and recalculate body placement; do not blindly shift
all addresses. Phase 1 is budgeted to **half the FPGA memory**; exact target
bytes and placement require evidence. Two Phase 1 Namespaces sharing one FPGA
memory for CM networking tests are Phase 2, not Phase 1 acceptance.

Runtime lookup derives slot addresses and bounds from the active CR15 and
that Namespace's metadata, never the IDE's inspected Namespace, saved
configuration, or a host-updated table-base variable. Different Namespaces
are isolated: matching slot numbers, generations, names, or contents do not
establish shared authority. No hidden Namespace lookup cache or automatic
rebinding is part of this contract. Invalid authority or geometry hard-faults.

This is the new architectural layout, not an in-place migration of saved
Namespace images, catalogs, resident LUMPs, or deployment approvals.

## SWITCH: isolated-register LOAD and Namespace handoff

**Approved Phase 1 semantics:** CHANGE is THREADSAVE → THREADLOAD. SWITCH is
the same halves with LOAD NAMESPACE(CR15) inserted between them. Ordinary CHANGE
leaves CR15 unchanged; CR13 is NULL and never touched. The earlier blanket
CR12–CR14 isolated-LOAD qualification is not reaffirmed by this approval.
The CR15 handoff below retains ordinary admission checks; this does not
claim simulator or RTL conformance, rewrite saved programs, regenerate boot
images, or approve hardware. See also [SWITCH lifecycle](switch-lifecycle.md).

In the descriptive notation `SWITCH CR15, CRs, #row`, CR15 denotes the fixed
destination, not bits to encode as 15. Machine bits 22:19 are required zero.
CR15.M is latched at instruction acceptance; the zero field never selects CR0.M.
CRs must be CR0–CR11 and hold a valid ordinary c-list capability with L
permission. Source M is not consulted. The selected `CRs[row]` passes normal
LOAD bounds, version, integrity, and type checks; reserved encoding bits
must be zero.

M is register state, not a GT permission. This reconciliation does not approve
other SWITCH destinations; CR13 operations are excluded from Phase 1.

### Namespace destination: CR15

`SWITCH CR15, CRs, #row` retains the source checks and authorized row lookup.
The fixed-destination field is zero; bits 14:0 use the approved sign,
10-bit magnitude and DR-selector row format above.
The selected capability must identify the destination Namespace. The current
CR15.M authorizes the operation; ordinary CHANGE does not acquire an M requirement.

The single instruction:

1. Performs CHANGE's outgoing Thread save under the outgoing Namespace.
2. Loads the validated destination Namespace capability into CR15 at the
   microcode midpoint.
3. Performs incoming Thread activation under the destination Namespace using
   the **hardwired permissionless Inform GT for slot 2, version 0**, except
   that the guarded boot pair uses its bitstream-assigned slot-2 version.

There is no programmer-visible instruction boundary between these phases and
no additional Thread operand or following CHANGE instruction is required.
Successful handoff consumes CR15.M. CR13 remains NULL and is never loaded,
restored or explicitly cleared. No interrupt Thread is installed in Phase 1.

Fixed entry selection does not waive
Thread type, GT version, saved-frame, or C-List checks. Never construct an
entry GT using the descriptor's current version or remember a last-active
Thread as a substitute. Namespace and Thread management are explicit software
responsibilities, not hidden execution caches.

As with boot entry, the destination entry Thread may begin from its canonical
poison-root sentinel; this starts its declared entry at NIA 0. A suspended
entry Thread instead resumes its validated saved continuation. Ordinary CHANGE
still rejects a poison-root sentinel as a suspended continuation.

### Fault behavior

A non-isolated destination, isolated source, or malformed operand encoding
faults with `INVALID_OP`. An otherwise well-formed SWITCH whose latched
destination M is clear faults with `PERM_L`. Invalid sources, bounds,
version, integrity, and type failures during source admission fault before
beginning the handoff.

For CR12–CR14, failure leaves capability registers, M bits, Namespace entries,
memory words, and the source capability unchanged. For CR15, this is not a
promise of rollback after outgoing-save writes have begun. **Any failure is a
hard fault:** do not retry, substitute a Thread, silently repair state, or
continue executing a partially transitioned context. A false condition skips
the instruction without consuming M authorization.

Fault attribution follows the GT in the faulting CR, not a blanket choice of
source Namespace, destination Namespace, or current Thread. **Hardware never
changes version numbers.** Authorized software management performs version-based
blacklisting; an already-stale GT does not cause another slot-version change.
A Boot Thread fault leaves the CM in purgatory, not an automatically reachable
management or fallback Thread.

# Historical baseline — not current instruction guidance

The repeated baseline has moved to the [Historical ISA baseline reference](instruction-set-history.md).
It is evidence only, not current instruction guidance. No saved program has
been changed. Both distinct RETURN versions and all other historical text
are preserved; the reference explains the exact-copy inventory.

## Historical section links

Old section anchors below lead to the preserved historical text. For current
rules, use the normative sections above. Numbered duplicate anchors are also
retained for links made by Markdown viewers that numbered repeated headings.

## Encoding Format

<a id="encoding-format-1"></a><a id="encoding-format-2"></a><a id="encoding-format-3"></a><a id="encoding-format-4"></a><a id="encoding-format-5"></a><a id="encoding-format-6"></a><a id="encoding-format-7"></a><a id="encoding-format-8"></a><a id="encoding-format-9"></a><a id="encoding-format-10"></a><a id="encoding-format-11"></a><a id="encoding-format-12"></a><a id="encoding-format-13"></a><a id="encoding-format-14"></a><a id="encoding-format-15"></a><a id="encoding-format-16"></a><a id="encoding-format-17"></a><a id="encoding-format-18"></a><a id="encoding-format-19"></a><a id="encoding-format-20"></a><a id="encoding-format-21"></a><a id="encoding-format-22"></a><a id="encoding-format-23"></a><a id="encoding-format-24"></a><a id="encoding-format-25"></a><a id="encoding-format-26"></a><a id="encoding-format-27"></a><a id="encoding-format-28"></a><a id="encoding-format-29"></a><a id="encoding-format-30"></a><a id="encoding-format-31"></a>

Historical only: [Encoding Format](instruction-set-history.md#encoding-format).

## Condition Codes

<a id="condition-codes-1"></a><a id="condition-codes-2"></a><a id="condition-codes-3"></a><a id="condition-codes-4"></a><a id="condition-codes-5"></a><a id="condition-codes-6"></a><a id="condition-codes-7"></a><a id="condition-codes-8"></a><a id="condition-codes-9"></a><a id="condition-codes-10"></a><a id="condition-codes-11"></a><a id="condition-codes-12"></a><a id="condition-codes-13"></a><a id="condition-codes-14"></a><a id="condition-codes-15"></a><a id="condition-codes-16"></a><a id="condition-codes-17"></a><a id="condition-codes-18"></a><a id="condition-codes-19"></a><a id="condition-codes-20"></a><a id="condition-codes-21"></a><a id="condition-codes-22"></a><a id="condition-codes-23"></a><a id="condition-codes-24"></a><a id="condition-codes-25"></a><a id="condition-codes-26"></a><a id="condition-codes-27"></a><a id="condition-codes-28"></a><a id="condition-codes-29"></a><a id="condition-codes-30"></a><a id="condition-codes-31"></a>

Historical only: [Condition Codes](instruction-set-history.md#condition-codes).

## Church Domain (10 Instructions)

<a id="church-domain-10-instructions-1"></a><a id="church-domain-10-instructions-2"></a><a id="church-domain-10-instructions-3"></a><a id="church-domain-10-instructions-4"></a><a id="church-domain-10-instructions-5"></a><a id="church-domain-10-instructions-6"></a><a id="church-domain-10-instructions-7"></a><a id="church-domain-10-instructions-8"></a><a id="church-domain-10-instructions-9"></a><a id="church-domain-10-instructions-10"></a><a id="church-domain-10-instructions-11"></a><a id="church-domain-10-instructions-12"></a><a id="church-domain-10-instructions-13"></a><a id="church-domain-10-instructions-14"></a><a id="church-domain-10-instructions-15"></a><a id="church-domain-10-instructions-16"></a><a id="church-domain-10-instructions-17"></a><a id="church-domain-10-instructions-18"></a><a id="church-domain-10-instructions-19"></a><a id="church-domain-10-instructions-20"></a><a id="church-domain-10-instructions-21"></a><a id="church-domain-10-instructions-22"></a><a id="church-domain-10-instructions-23"></a><a id="church-domain-10-instructions-24"></a><a id="church-domain-10-instructions-25"></a><a id="church-domain-10-instructions-26"></a><a id="church-domain-10-instructions-27"></a><a id="church-domain-10-instructions-28"></a><a id="church-domain-10-instructions-29"></a><a id="church-domain-10-instructions-30"></a><a id="church-domain-10-instructions-31"></a>

Historical only: [Church Domain (10 Instructions)](instruction-set-history.md#church-domain-10-instructions).

### LOAD (opcode 0)

<a id="load-opcode-0-1"></a><a id="load-opcode-0-2"></a><a id="load-opcode-0-3"></a><a id="load-opcode-0-4"></a><a id="load-opcode-0-5"></a><a id="load-opcode-0-6"></a><a id="load-opcode-0-7"></a><a id="load-opcode-0-8"></a><a id="load-opcode-0-9"></a><a id="load-opcode-0-10"></a><a id="load-opcode-0-11"></a><a id="load-opcode-0-12"></a><a id="load-opcode-0-13"></a><a id="load-opcode-0-14"></a><a id="load-opcode-0-15"></a><a id="load-opcode-0-16"></a><a id="load-opcode-0-17"></a><a id="load-opcode-0-18"></a><a id="load-opcode-0-19"></a><a id="load-opcode-0-20"></a><a id="load-opcode-0-21"></a><a id="load-opcode-0-22"></a><a id="load-opcode-0-23"></a><a id="load-opcode-0-24"></a><a id="load-opcode-0-25"></a><a id="load-opcode-0-26"></a><a id="load-opcode-0-27"></a><a id="load-opcode-0-28"></a><a id="load-opcode-0-29"></a><a id="load-opcode-0-30"></a><a id="load-opcode-0-31"></a>

Historical only: [LOAD (opcode 0)](instruction-set-history.md#load-opcode-0).

### SAVE (opcode 1)

<a id="save-opcode-1-1"></a><a id="save-opcode-1-2"></a><a id="save-opcode-1-3"></a><a id="save-opcode-1-4"></a><a id="save-opcode-1-5"></a><a id="save-opcode-1-6"></a><a id="save-opcode-1-7"></a><a id="save-opcode-1-8"></a><a id="save-opcode-1-9"></a><a id="save-opcode-1-10"></a><a id="save-opcode-1-11"></a><a id="save-opcode-1-12"></a><a id="save-opcode-1-13"></a><a id="save-opcode-1-14"></a><a id="save-opcode-1-15"></a><a id="save-opcode-1-16"></a><a id="save-opcode-1-17"></a><a id="save-opcode-1-18"></a><a id="save-opcode-1-19"></a><a id="save-opcode-1-20"></a><a id="save-opcode-1-21"></a><a id="save-opcode-1-22"></a><a id="save-opcode-1-23"></a><a id="save-opcode-1-24"></a><a id="save-opcode-1-25"></a><a id="save-opcode-1-26"></a><a id="save-opcode-1-27"></a><a id="save-opcode-1-28"></a><a id="save-opcode-1-29"></a><a id="save-opcode-1-30"></a><a id="save-opcode-1-31"></a>

Historical only: [SAVE (opcode 1)](instruction-set-history.md#save-opcode-1).

### CALL (opcode 2)

<a id="call-opcode-2-1"></a><a id="call-opcode-2-2"></a><a id="call-opcode-2-3"></a><a id="call-opcode-2-4"></a><a id="call-opcode-2-5"></a><a id="call-opcode-2-6"></a><a id="call-opcode-2-7"></a><a id="call-opcode-2-8"></a><a id="call-opcode-2-9"></a><a id="call-opcode-2-10"></a><a id="call-opcode-2-11"></a><a id="call-opcode-2-12"></a><a id="call-opcode-2-13"></a><a id="call-opcode-2-14"></a><a id="call-opcode-2-15"></a><a id="call-opcode-2-16"></a><a id="call-opcode-2-17"></a><a id="call-opcode-2-18"></a><a id="call-opcode-2-19"></a><a id="call-opcode-2-20"></a><a id="call-opcode-2-21"></a><a id="call-opcode-2-22"></a><a id="call-opcode-2-23"></a><a id="call-opcode-2-24"></a><a id="call-opcode-2-25"></a><a id="call-opcode-2-26"></a><a id="call-opcode-2-27"></a><a id="call-opcode-2-28"></a><a id="call-opcode-2-29"></a><a id="call-opcode-2-30"></a><a id="call-opcode-2-31"></a>

Historical only: [CALL (opcode 2)](instruction-set-history.md#call-opcode-2).

### RETURN (opcode 3)

Historical only: [RETURN (opcode 3), first baseline](instruction-set-history.md#return-opcode-3).

<a id="return-opcode-3-1"></a><a id="return-opcode-3-2"></a><a id="return-opcode-3-3"></a><a id="return-opcode-3-4"></a><a id="return-opcode-3-5"></a><a id="return-opcode-3-6"></a><a id="return-opcode-3-7"></a><a id="return-opcode-3-8"></a><a id="return-opcode-3-9"></a><a id="return-opcode-3-10"></a><a id="return-opcode-3-11"></a><a id="return-opcode-3-12"></a><a id="return-opcode-3-13"></a><a id="return-opcode-3-14"></a><a id="return-opcode-3-15"></a><a id="return-opcode-3-16"></a><a id="return-opcode-3-17"></a><a id="return-opcode-3-18"></a><a id="return-opcode-3-19"></a><a id="return-opcode-3-20"></a><a id="return-opcode-3-21"></a><a id="return-opcode-3-22"></a><a id="return-opcode-3-23"></a><a id="return-opcode-3-24"></a><a id="return-opcode-3-25"></a><a id="return-opcode-3-26"></a><a id="return-opcode-3-27"></a><a id="return-opcode-3-28"></a><a id="return-opcode-3-29"></a><a id="return-opcode-3-30"></a><a id="return-opcode-3-31"></a>

Historical copies 2–32: [earlier RETURN variant](instruction-set-history.md#earlier-return-variant).

### CHANGE (opcode 4)

<a id="change-opcode-4-1"></a><a id="change-opcode-4-2"></a><a id="change-opcode-4-3"></a><a id="change-opcode-4-4"></a><a id="change-opcode-4-5"></a><a id="change-opcode-4-6"></a><a id="change-opcode-4-7"></a><a id="change-opcode-4-8"></a><a id="change-opcode-4-9"></a><a id="change-opcode-4-10"></a><a id="change-opcode-4-11"></a><a id="change-opcode-4-12"></a><a id="change-opcode-4-13"></a><a id="change-opcode-4-14"></a><a id="change-opcode-4-15"></a><a id="change-opcode-4-16"></a><a id="change-opcode-4-17"></a><a id="change-opcode-4-18"></a><a id="change-opcode-4-19"></a><a id="change-opcode-4-20"></a><a id="change-opcode-4-21"></a><a id="change-opcode-4-22"></a><a id="change-opcode-4-23"></a><a id="change-opcode-4-24"></a><a id="change-opcode-4-25"></a><a id="change-opcode-4-26"></a><a id="change-opcode-4-27"></a><a id="change-opcode-4-28"></a><a id="change-opcode-4-29"></a><a id="change-opcode-4-30"></a><a id="change-opcode-4-31"></a>

Historical only: [CHANGE (opcode 4)](instruction-set-history.md#change-opcode-4).

### SWITCH (opcode 5)

<a id="switch-opcode-5-1"></a><a id="switch-opcode-5-2"></a><a id="switch-opcode-5-3"></a><a id="switch-opcode-5-4"></a><a id="switch-opcode-5-5"></a><a id="switch-opcode-5-6"></a><a id="switch-opcode-5-7"></a><a id="switch-opcode-5-8"></a><a id="switch-opcode-5-9"></a><a id="switch-opcode-5-10"></a><a id="switch-opcode-5-11"></a><a id="switch-opcode-5-12"></a><a id="switch-opcode-5-13"></a><a id="switch-opcode-5-14"></a><a id="switch-opcode-5-15"></a><a id="switch-opcode-5-16"></a><a id="switch-opcode-5-17"></a><a id="switch-opcode-5-18"></a><a id="switch-opcode-5-19"></a><a id="switch-opcode-5-20"></a><a id="switch-opcode-5-21"></a><a id="switch-opcode-5-22"></a><a id="switch-opcode-5-23"></a><a id="switch-opcode-5-24"></a><a id="switch-opcode-5-25"></a><a id="switch-opcode-5-26"></a><a id="switch-opcode-5-27"></a><a id="switch-opcode-5-28"></a><a id="switch-opcode-5-29"></a><a id="switch-opcode-5-30"></a><a id="switch-opcode-5-31"></a>

Historical only: [SWITCH (opcode 5)](instruction-set-history.md#switch-opcode-5).

### TPERM (opcode 6)

<a id="tperm-opcode-6-1"></a><a id="tperm-opcode-6-2"></a><a id="tperm-opcode-6-3"></a><a id="tperm-opcode-6-4"></a><a id="tperm-opcode-6-5"></a><a id="tperm-opcode-6-6"></a><a id="tperm-opcode-6-7"></a><a id="tperm-opcode-6-8"></a><a id="tperm-opcode-6-9"></a><a id="tperm-opcode-6-10"></a><a id="tperm-opcode-6-11"></a><a id="tperm-opcode-6-12"></a><a id="tperm-opcode-6-13"></a><a id="tperm-opcode-6-14"></a><a id="tperm-opcode-6-15"></a><a id="tperm-opcode-6-16"></a><a id="tperm-opcode-6-17"></a><a id="tperm-opcode-6-18"></a><a id="tperm-opcode-6-19"></a><a id="tperm-opcode-6-20"></a><a id="tperm-opcode-6-21"></a><a id="tperm-opcode-6-22"></a><a id="tperm-opcode-6-23"></a><a id="tperm-opcode-6-24"></a><a id="tperm-opcode-6-25"></a><a id="tperm-opcode-6-26"></a><a id="tperm-opcode-6-27"></a><a id="tperm-opcode-6-28"></a><a id="tperm-opcode-6-29"></a><a id="tperm-opcode-6-30"></a><a id="tperm-opcode-6-31"></a>

Historical only: [TPERM (opcode 6)](instruction-set-history.md#tperm-opcode-6).

#### Encoding

<a id="encoding-1"></a><a id="encoding-2"></a><a id="encoding-3"></a><a id="encoding-4"></a><a id="encoding-5"></a><a id="encoding-6"></a><a id="encoding-7"></a><a id="encoding-8"></a><a id="encoding-9"></a><a id="encoding-10"></a><a id="encoding-11"></a><a id="encoding-12"></a><a id="encoding-13"></a><a id="encoding-14"></a><a id="encoding-15"></a><a id="encoding-16"></a><a id="encoding-17"></a><a id="encoding-18"></a><a id="encoding-19"></a><a id="encoding-20"></a><a id="encoding-21"></a><a id="encoding-22"></a><a id="encoding-23"></a><a id="encoding-24"></a><a id="encoding-25"></a><a id="encoding-26"></a><a id="encoding-27"></a><a id="encoding-28"></a><a id="encoding-29"></a><a id="encoding-30"></a><a id="encoding-31"></a>

Historical only: [Encoding](instruction-set-history.md#encoding).

#### Mode 1 — Health Check (flag-setting)

<a id="mode-1--health-check-flag-setting"></a>

<a id="mode-1--health-check-flag-setting-1"></a><a id="mode-1--health-check-flag-setting-2"></a><a id="mode-1--health-check-flag-setting-3"></a><a id="mode-1--health-check-flag-setting-4"></a><a id="mode-1--health-check-flag-setting-5"></a><a id="mode-1--health-check-flag-setting-6"></a><a id="mode-1--health-check-flag-setting-7"></a><a id="mode-1--health-check-flag-setting-8"></a><a id="mode-1--health-check-flag-setting-9"></a><a id="mode-1--health-check-flag-setting-10"></a><a id="mode-1--health-check-flag-setting-11"></a><a id="mode-1--health-check-flag-setting-12"></a><a id="mode-1--health-check-flag-setting-13"></a><a id="mode-1--health-check-flag-setting-14"></a><a id="mode-1--health-check-flag-setting-15"></a><a id="mode-1--health-check-flag-setting-16"></a><a id="mode-1--health-check-flag-setting-17"></a><a id="mode-1--health-check-flag-setting-18"></a><a id="mode-1--health-check-flag-setting-19"></a><a id="mode-1--health-check-flag-setting-20"></a><a id="mode-1--health-check-flag-setting-21"></a><a id="mode-1--health-check-flag-setting-22"></a><a id="mode-1--health-check-flag-setting-23"></a><a id="mode-1--health-check-flag-setting-24"></a><a id="mode-1--health-check-flag-setting-25"></a><a id="mode-1--health-check-flag-setting-26"></a><a id="mode-1--health-check-flag-setting-27"></a><a id="mode-1--health-check-flag-setting-28"></a><a id="mode-1--health-check-flag-setting-29"></a><a id="mode-1--health-check-flag-setting-30"></a><a id="mode-1--health-check-flag-setting-31"></a><a id="mode-1-health-check-flag-setting-1"></a><a id="mode-1-health-check-flag-setting-2"></a><a id="mode-1-health-check-flag-setting-3"></a><a id="mode-1-health-check-flag-setting-4"></a><a id="mode-1-health-check-flag-setting-5"></a><a id="mode-1-health-check-flag-setting-6"></a><a id="mode-1-health-check-flag-setting-7"></a><a id="mode-1-health-check-flag-setting-8"></a><a id="mode-1-health-check-flag-setting-9"></a><a id="mode-1-health-check-flag-setting-10"></a><a id="mode-1-health-check-flag-setting-11"></a><a id="mode-1-health-check-flag-setting-12"></a><a id="mode-1-health-check-flag-setting-13"></a><a id="mode-1-health-check-flag-setting-14"></a><a id="mode-1-health-check-flag-setting-15"></a><a id="mode-1-health-check-flag-setting-16"></a><a id="mode-1-health-check-flag-setting-17"></a><a id="mode-1-health-check-flag-setting-18"></a><a id="mode-1-health-check-flag-setting-19"></a><a id="mode-1-health-check-flag-setting-20"></a><a id="mode-1-health-check-flag-setting-21"></a><a id="mode-1-health-check-flag-setting-22"></a><a id="mode-1-health-check-flag-setting-23"></a><a id="mode-1-health-check-flag-setting-24"></a><a id="mode-1-health-check-flag-setting-25"></a><a id="mode-1-health-check-flag-setting-26"></a><a id="mode-1-health-check-flag-setting-27"></a><a id="mode-1-health-check-flag-setting-28"></a><a id="mode-1-health-check-flag-setting-29"></a><a id="mode-1-health-check-flag-setting-30"></a><a id="mode-1-health-check-flag-setting-31"></a>

Historical only: [Mode 1 — Health Check (flag-setting)](instruction-set-history.md#mode-1-health-check-flag-setting).

##### Conditional Execution: Zero-Cost Try-Catch

<a id="conditional-execution-zero-cost-try-catch-1"></a><a id="conditional-execution-zero-cost-try-catch-2"></a><a id="conditional-execution-zero-cost-try-catch-3"></a><a id="conditional-execution-zero-cost-try-catch-4"></a><a id="conditional-execution-zero-cost-try-catch-5"></a><a id="conditional-execution-zero-cost-try-catch-6"></a><a id="conditional-execution-zero-cost-try-catch-7"></a><a id="conditional-execution-zero-cost-try-catch-8"></a><a id="conditional-execution-zero-cost-try-catch-9"></a><a id="conditional-execution-zero-cost-try-catch-10"></a><a id="conditional-execution-zero-cost-try-catch-11"></a><a id="conditional-execution-zero-cost-try-catch-12"></a><a id="conditional-execution-zero-cost-try-catch-13"></a><a id="conditional-execution-zero-cost-try-catch-14"></a><a id="conditional-execution-zero-cost-try-catch-15"></a><a id="conditional-execution-zero-cost-try-catch-16"></a><a id="conditional-execution-zero-cost-try-catch-17"></a><a id="conditional-execution-zero-cost-try-catch-18"></a><a id="conditional-execution-zero-cost-try-catch-19"></a><a id="conditional-execution-zero-cost-try-catch-20"></a><a id="conditional-execution-zero-cost-try-catch-21"></a><a id="conditional-execution-zero-cost-try-catch-22"></a><a id="conditional-execution-zero-cost-try-catch-23"></a><a id="conditional-execution-zero-cost-try-catch-24"></a><a id="conditional-execution-zero-cost-try-catch-25"></a><a id="conditional-execution-zero-cost-try-catch-26"></a><a id="conditional-execution-zero-cost-try-catch-27"></a><a id="conditional-execution-zero-cost-try-catch-28"></a><a id="conditional-execution-zero-cost-try-catch-29"></a><a id="conditional-execution-zero-cost-try-catch-30"></a><a id="conditional-execution-zero-cost-try-catch-31"></a>

Historical only: [Conditional Execution: Zero-Cost Try-Catch](instruction-set-history.md#conditional-execution-zero-cost-try-catch).

#### Mode 2 — Permission Restriction (monotonic attenuation)

<a id="mode-2--permission-restriction-monotonic-attenuation"></a>

<a id="mode-2--permission-restriction-monotonic-attenuation-1"></a><a id="mode-2--permission-restriction-monotonic-attenuation-2"></a><a id="mode-2--permission-restriction-monotonic-attenuation-3"></a><a id="mode-2--permission-restriction-monotonic-attenuation-4"></a><a id="mode-2--permission-restriction-monotonic-attenuation-5"></a><a id="mode-2--permission-restriction-monotonic-attenuation-6"></a><a id="mode-2--permission-restriction-monotonic-attenuation-7"></a><a id="mode-2--permission-restriction-monotonic-attenuation-8"></a><a id="mode-2--permission-restriction-monotonic-attenuation-9"></a><a id="mode-2--permission-restriction-monotonic-attenuation-10"></a><a id="mode-2--permission-restriction-monotonic-attenuation-11"></a><a id="mode-2--permission-restriction-monotonic-attenuation-12"></a><a id="mode-2--permission-restriction-monotonic-attenuation-13"></a><a id="mode-2--permission-restriction-monotonic-attenuation-14"></a><a id="mode-2--permission-restriction-monotonic-attenuation-15"></a><a id="mode-2--permission-restriction-monotonic-attenuation-16"></a><a id="mode-2--permission-restriction-monotonic-attenuation-17"></a><a id="mode-2--permission-restriction-monotonic-attenuation-18"></a><a id="mode-2--permission-restriction-monotonic-attenuation-19"></a><a id="mode-2--permission-restriction-monotonic-attenuation-20"></a><a id="mode-2--permission-restriction-monotonic-attenuation-21"></a><a id="mode-2--permission-restriction-monotonic-attenuation-22"></a><a id="mode-2--permission-restriction-monotonic-attenuation-23"></a><a id="mode-2--permission-restriction-monotonic-attenuation-24"></a><a id="mode-2--permission-restriction-monotonic-attenuation-25"></a><a id="mode-2--permission-restriction-monotonic-attenuation-26"></a><a id="mode-2--permission-restriction-monotonic-attenuation-27"></a><a id="mode-2--permission-restriction-monotonic-attenuation-28"></a><a id="mode-2--permission-restriction-monotonic-attenuation-29"></a><a id="mode-2--permission-restriction-monotonic-attenuation-30"></a><a id="mode-2--permission-restriction-monotonic-attenuation-31"></a><a id="mode-2-permission-restriction-monotonic-attenuation-1"></a><a id="mode-2-permission-restriction-monotonic-attenuation-2"></a><a id="mode-2-permission-restriction-monotonic-attenuation-3"></a><a id="mode-2-permission-restriction-monotonic-attenuation-4"></a><a id="mode-2-permission-restriction-monotonic-attenuation-5"></a><a id="mode-2-permission-restriction-monotonic-attenuation-6"></a><a id="mode-2-permission-restriction-monotonic-attenuation-7"></a><a id="mode-2-permission-restriction-monotonic-attenuation-8"></a><a id="mode-2-permission-restriction-monotonic-attenuation-9"></a><a id="mode-2-permission-restriction-monotonic-attenuation-10"></a><a id="mode-2-permission-restriction-monotonic-attenuation-11"></a><a id="mode-2-permission-restriction-monotonic-attenuation-12"></a><a id="mode-2-permission-restriction-monotonic-attenuation-13"></a><a id="mode-2-permission-restriction-monotonic-attenuation-14"></a><a id="mode-2-permission-restriction-monotonic-attenuation-15"></a><a id="mode-2-permission-restriction-monotonic-attenuation-16"></a><a id="mode-2-permission-restriction-monotonic-attenuation-17"></a><a id="mode-2-permission-restriction-monotonic-attenuation-18"></a><a id="mode-2-permission-restriction-monotonic-attenuation-19"></a><a id="mode-2-permission-restriction-monotonic-attenuation-20"></a><a id="mode-2-permission-restriction-monotonic-attenuation-21"></a><a id="mode-2-permission-restriction-monotonic-attenuation-22"></a><a id="mode-2-permission-restriction-monotonic-attenuation-23"></a><a id="mode-2-permission-restriction-monotonic-attenuation-24"></a><a id="mode-2-permission-restriction-monotonic-attenuation-25"></a><a id="mode-2-permission-restriction-monotonic-attenuation-26"></a><a id="mode-2-permission-restriction-monotonic-attenuation-27"></a><a id="mode-2-permission-restriction-monotonic-attenuation-28"></a><a id="mode-2-permission-restriction-monotonic-attenuation-29"></a><a id="mode-2-permission-restriction-monotonic-attenuation-30"></a><a id="mode-2-permission-restriction-monotonic-attenuation-31"></a>

Historical only: [Mode 2 — Permission Restriction (monotonic attenuation)](instruction-set-history.md#mode-2-permission-restriction-monotonic-attenuation).

#### Preset Table

<a id="preset-table-1"></a><a id="preset-table-2"></a><a id="preset-table-3"></a><a id="preset-table-4"></a><a id="preset-table-5"></a><a id="preset-table-6"></a><a id="preset-table-7"></a><a id="preset-table-8"></a><a id="preset-table-9"></a><a id="preset-table-10"></a><a id="preset-table-11"></a><a id="preset-table-12"></a><a id="preset-table-13"></a><a id="preset-table-14"></a><a id="preset-table-15"></a><a id="preset-table-16"></a><a id="preset-table-17"></a><a id="preset-table-18"></a><a id="preset-table-19"></a><a id="preset-table-20"></a><a id="preset-table-21"></a><a id="preset-table-22"></a><a id="preset-table-23"></a><a id="preset-table-24"></a><a id="preset-table-25"></a><a id="preset-table-26"></a><a id="preset-table-27"></a><a id="preset-table-28"></a><a id="preset-table-29"></a><a id="preset-table-30"></a><a id="preset-table-31"></a>

Historical only: [Preset Table](instruction-set-history.md#preset-table).

#### Design Rationale

<a id="design-rationale-1"></a><a id="design-rationale-2"></a><a id="design-rationale-3"></a><a id="design-rationale-4"></a><a id="design-rationale-5"></a><a id="design-rationale-6"></a><a id="design-rationale-7"></a><a id="design-rationale-8"></a><a id="design-rationale-9"></a><a id="design-rationale-10"></a><a id="design-rationale-11"></a><a id="design-rationale-12"></a><a id="design-rationale-13"></a><a id="design-rationale-14"></a><a id="design-rationale-15"></a><a id="design-rationale-16"></a><a id="design-rationale-17"></a><a id="design-rationale-18"></a><a id="design-rationale-19"></a><a id="design-rationale-20"></a><a id="design-rationale-21"></a><a id="design-rationale-22"></a><a id="design-rationale-23"></a><a id="design-rationale-24"></a><a id="design-rationale-25"></a><a id="design-rationale-26"></a><a id="design-rationale-27"></a><a id="design-rationale-28"></a><a id="design-rationale-29"></a><a id="design-rationale-30"></a><a id="design-rationale-31"></a>

Historical only: [Design Rationale](instruction-set-history.md#design-rationale).

### LAMBDA (opcode 7)

<a id="lambda-opcode-7-1"></a><a id="lambda-opcode-7-2"></a><a id="lambda-opcode-7-3"></a><a id="lambda-opcode-7-4"></a><a id="lambda-opcode-7-5"></a><a id="lambda-opcode-7-6"></a><a id="lambda-opcode-7-7"></a><a id="lambda-opcode-7-8"></a><a id="lambda-opcode-7-9"></a><a id="lambda-opcode-7-10"></a><a id="lambda-opcode-7-11"></a><a id="lambda-opcode-7-12"></a><a id="lambda-opcode-7-13"></a><a id="lambda-opcode-7-14"></a><a id="lambda-opcode-7-15"></a><a id="lambda-opcode-7-16"></a><a id="lambda-opcode-7-17"></a><a id="lambda-opcode-7-18"></a><a id="lambda-opcode-7-19"></a><a id="lambda-opcode-7-20"></a><a id="lambda-opcode-7-21"></a><a id="lambda-opcode-7-22"></a><a id="lambda-opcode-7-23"></a><a id="lambda-opcode-7-24"></a><a id="lambda-opcode-7-25"></a><a id="lambda-opcode-7-26"></a><a id="lambda-opcode-7-27"></a><a id="lambda-opcode-7-28"></a><a id="lambda-opcode-7-29"></a><a id="lambda-opcode-7-30"></a><a id="lambda-opcode-7-31"></a>

Historical only: [LAMBDA (opcode 7)](instruction-set-history.md#lambda-opcode-7).

### ELOADCALL (opcode 8)

<a id="eloadcall-opcode-8-1"></a><a id="eloadcall-opcode-8-2"></a><a id="eloadcall-opcode-8-3"></a><a id="eloadcall-opcode-8-4"></a><a id="eloadcall-opcode-8-5"></a><a id="eloadcall-opcode-8-6"></a><a id="eloadcall-opcode-8-7"></a><a id="eloadcall-opcode-8-8"></a><a id="eloadcall-opcode-8-9"></a><a id="eloadcall-opcode-8-10"></a><a id="eloadcall-opcode-8-11"></a><a id="eloadcall-opcode-8-12"></a><a id="eloadcall-opcode-8-13"></a><a id="eloadcall-opcode-8-14"></a><a id="eloadcall-opcode-8-15"></a><a id="eloadcall-opcode-8-16"></a><a id="eloadcall-opcode-8-17"></a><a id="eloadcall-opcode-8-18"></a><a id="eloadcall-opcode-8-19"></a><a id="eloadcall-opcode-8-20"></a><a id="eloadcall-opcode-8-21"></a><a id="eloadcall-opcode-8-22"></a><a id="eloadcall-opcode-8-23"></a><a id="eloadcall-opcode-8-24"></a><a id="eloadcall-opcode-8-25"></a><a id="eloadcall-opcode-8-26"></a><a id="eloadcall-opcode-8-27"></a><a id="eloadcall-opcode-8-28"></a><a id="eloadcall-opcode-8-29"></a><a id="eloadcall-opcode-8-30"></a><a id="eloadcall-opcode-8-31"></a>

Historical only: [ELOADCALL (opcode 8)](instruction-set-history.md#eloadcall-opcode-8).

### XLOADLAMBDA (opcode 9)

<a id="xloadlambda-opcode-9-1"></a><a id="xloadlambda-opcode-9-2"></a><a id="xloadlambda-opcode-9-3"></a><a id="xloadlambda-opcode-9-4"></a><a id="xloadlambda-opcode-9-5"></a><a id="xloadlambda-opcode-9-6"></a><a id="xloadlambda-opcode-9-7"></a><a id="xloadlambda-opcode-9-8"></a><a id="xloadlambda-opcode-9-9"></a><a id="xloadlambda-opcode-9-10"></a><a id="xloadlambda-opcode-9-11"></a><a id="xloadlambda-opcode-9-12"></a><a id="xloadlambda-opcode-9-13"></a><a id="xloadlambda-opcode-9-14"></a><a id="xloadlambda-opcode-9-15"></a><a id="xloadlambda-opcode-9-16"></a><a id="xloadlambda-opcode-9-17"></a><a id="xloadlambda-opcode-9-18"></a><a id="xloadlambda-opcode-9-19"></a><a id="xloadlambda-opcode-9-20"></a><a id="xloadlambda-opcode-9-21"></a><a id="xloadlambda-opcode-9-22"></a><a id="xloadlambda-opcode-9-23"></a><a id="xloadlambda-opcode-9-24"></a><a id="xloadlambda-opcode-9-25"></a><a id="xloadlambda-opcode-9-26"></a><a id="xloadlambda-opcode-9-27"></a><a id="xloadlambda-opcode-9-28"></a><a id="xloadlambda-opcode-9-29"></a><a id="xloadlambda-opcode-9-30"></a><a id="xloadlambda-opcode-9-31"></a>

Historical only: [XLOADLAMBDA (opcode 9)](instruction-set-history.md#xloadlambda-opcode-9).

## Turing Domain (10 Instructions + shared RETURN)

<a id="turing-domain-10-instructions--shared-return"></a>

<a id="turing-domain-10-instructions--shared-return-1"></a><a id="turing-domain-10-instructions--shared-return-2"></a><a id="turing-domain-10-instructions--shared-return-3"></a><a id="turing-domain-10-instructions--shared-return-4"></a><a id="turing-domain-10-instructions--shared-return-5"></a><a id="turing-domain-10-instructions--shared-return-6"></a><a id="turing-domain-10-instructions--shared-return-7"></a><a id="turing-domain-10-instructions--shared-return-8"></a><a id="turing-domain-10-instructions--shared-return-9"></a><a id="turing-domain-10-instructions--shared-return-10"></a><a id="turing-domain-10-instructions--shared-return-11"></a><a id="turing-domain-10-instructions--shared-return-12"></a><a id="turing-domain-10-instructions--shared-return-13"></a><a id="turing-domain-10-instructions--shared-return-14"></a><a id="turing-domain-10-instructions--shared-return-15"></a><a id="turing-domain-10-instructions--shared-return-16"></a><a id="turing-domain-10-instructions--shared-return-17"></a><a id="turing-domain-10-instructions--shared-return-18"></a><a id="turing-domain-10-instructions--shared-return-19"></a><a id="turing-domain-10-instructions--shared-return-20"></a><a id="turing-domain-10-instructions--shared-return-21"></a><a id="turing-domain-10-instructions--shared-return-22"></a><a id="turing-domain-10-instructions--shared-return-23"></a><a id="turing-domain-10-instructions--shared-return-24"></a><a id="turing-domain-10-instructions--shared-return-25"></a><a id="turing-domain-10-instructions--shared-return-26"></a><a id="turing-domain-10-instructions--shared-return-27"></a><a id="turing-domain-10-instructions--shared-return-28"></a><a id="turing-domain-10-instructions--shared-return-29"></a><a id="turing-domain-10-instructions--shared-return-30"></a><a id="turing-domain-10-instructions--shared-return-31"></a><a id="turing-domain-10-instructions-shared-return-1"></a><a id="turing-domain-10-instructions-shared-return-2"></a><a id="turing-domain-10-instructions-shared-return-3"></a><a id="turing-domain-10-instructions-shared-return-4"></a><a id="turing-domain-10-instructions-shared-return-5"></a><a id="turing-domain-10-instructions-shared-return-6"></a><a id="turing-domain-10-instructions-shared-return-7"></a><a id="turing-domain-10-instructions-shared-return-8"></a><a id="turing-domain-10-instructions-shared-return-9"></a><a id="turing-domain-10-instructions-shared-return-10"></a><a id="turing-domain-10-instructions-shared-return-11"></a><a id="turing-domain-10-instructions-shared-return-12"></a><a id="turing-domain-10-instructions-shared-return-13"></a><a id="turing-domain-10-instructions-shared-return-14"></a><a id="turing-domain-10-instructions-shared-return-15"></a><a id="turing-domain-10-instructions-shared-return-16"></a><a id="turing-domain-10-instructions-shared-return-17"></a><a id="turing-domain-10-instructions-shared-return-18"></a><a id="turing-domain-10-instructions-shared-return-19"></a><a id="turing-domain-10-instructions-shared-return-20"></a><a id="turing-domain-10-instructions-shared-return-21"></a><a id="turing-domain-10-instructions-shared-return-22"></a><a id="turing-domain-10-instructions-shared-return-23"></a><a id="turing-domain-10-instructions-shared-return-24"></a><a id="turing-domain-10-instructions-shared-return-25"></a><a id="turing-domain-10-instructions-shared-return-26"></a><a id="turing-domain-10-instructions-shared-return-27"></a><a id="turing-domain-10-instructions-shared-return-28"></a><a id="turing-domain-10-instructions-shared-return-29"></a><a id="turing-domain-10-instructions-shared-return-30"></a><a id="turing-domain-10-instructions-shared-return-31"></a>

Historical only: [Turing Domain (10 Instructions + shared RETURN)](instruction-set-history.md#turing-domain-10-instructions-shared-return).

### DREAD (opcode 16)

<a id="dread-opcode-16-1"></a><a id="dread-opcode-16-2"></a><a id="dread-opcode-16-3"></a><a id="dread-opcode-16-4"></a><a id="dread-opcode-16-5"></a><a id="dread-opcode-16-6"></a><a id="dread-opcode-16-7"></a><a id="dread-opcode-16-8"></a><a id="dread-opcode-16-9"></a><a id="dread-opcode-16-10"></a><a id="dread-opcode-16-11"></a><a id="dread-opcode-16-12"></a><a id="dread-opcode-16-13"></a><a id="dread-opcode-16-14"></a><a id="dread-opcode-16-15"></a><a id="dread-opcode-16-16"></a><a id="dread-opcode-16-17"></a><a id="dread-opcode-16-18"></a><a id="dread-opcode-16-19"></a><a id="dread-opcode-16-20"></a><a id="dread-opcode-16-21"></a><a id="dread-opcode-16-22"></a><a id="dread-opcode-16-23"></a><a id="dread-opcode-16-24"></a><a id="dread-opcode-16-25"></a><a id="dread-opcode-16-26"></a><a id="dread-opcode-16-27"></a><a id="dread-opcode-16-28"></a><a id="dread-opcode-16-29"></a><a id="dread-opcode-16-30"></a><a id="dread-opcode-16-31"></a>

Historical only: [DREAD (opcode 16)](instruction-set-history.md#dread-opcode-16).

### DWRITE (opcode 17)

<a id="dwrite-opcode-17-1"></a><a id="dwrite-opcode-17-2"></a><a id="dwrite-opcode-17-3"></a><a id="dwrite-opcode-17-4"></a><a id="dwrite-opcode-17-5"></a><a id="dwrite-opcode-17-6"></a><a id="dwrite-opcode-17-7"></a><a id="dwrite-opcode-17-8"></a><a id="dwrite-opcode-17-9"></a><a id="dwrite-opcode-17-10"></a><a id="dwrite-opcode-17-11"></a><a id="dwrite-opcode-17-12"></a><a id="dwrite-opcode-17-13"></a><a id="dwrite-opcode-17-14"></a><a id="dwrite-opcode-17-15"></a><a id="dwrite-opcode-17-16"></a><a id="dwrite-opcode-17-17"></a><a id="dwrite-opcode-17-18"></a><a id="dwrite-opcode-17-19"></a><a id="dwrite-opcode-17-20"></a><a id="dwrite-opcode-17-21"></a><a id="dwrite-opcode-17-22"></a><a id="dwrite-opcode-17-23"></a><a id="dwrite-opcode-17-24"></a><a id="dwrite-opcode-17-25"></a><a id="dwrite-opcode-17-26"></a><a id="dwrite-opcode-17-27"></a><a id="dwrite-opcode-17-28"></a><a id="dwrite-opcode-17-29"></a><a id="dwrite-opcode-17-30"></a><a id="dwrite-opcode-17-31"></a>

Historical only: [DWRITE (opcode 17)](instruction-set-history.md#dwrite-opcode-17).

### BFEXT (opcode 18)

<a id="bfext-opcode-18-1"></a><a id="bfext-opcode-18-2"></a><a id="bfext-opcode-18-3"></a><a id="bfext-opcode-18-4"></a><a id="bfext-opcode-18-5"></a><a id="bfext-opcode-18-6"></a><a id="bfext-opcode-18-7"></a><a id="bfext-opcode-18-8"></a><a id="bfext-opcode-18-9"></a><a id="bfext-opcode-18-10"></a><a id="bfext-opcode-18-11"></a><a id="bfext-opcode-18-12"></a><a id="bfext-opcode-18-13"></a><a id="bfext-opcode-18-14"></a><a id="bfext-opcode-18-15"></a><a id="bfext-opcode-18-16"></a><a id="bfext-opcode-18-17"></a><a id="bfext-opcode-18-18"></a><a id="bfext-opcode-18-19"></a><a id="bfext-opcode-18-20"></a><a id="bfext-opcode-18-21"></a><a id="bfext-opcode-18-22"></a><a id="bfext-opcode-18-23"></a><a id="bfext-opcode-18-24"></a><a id="bfext-opcode-18-25"></a><a id="bfext-opcode-18-26"></a><a id="bfext-opcode-18-27"></a><a id="bfext-opcode-18-28"></a><a id="bfext-opcode-18-29"></a><a id="bfext-opcode-18-30"></a><a id="bfext-opcode-18-31"></a>

Historical only: [BFEXT (opcode 18)](instruction-set-history.md#bfext-opcode-18).

### BFINS (opcode 19)

<a id="bfins-opcode-19-1"></a><a id="bfins-opcode-19-2"></a><a id="bfins-opcode-19-3"></a><a id="bfins-opcode-19-4"></a><a id="bfins-opcode-19-5"></a><a id="bfins-opcode-19-6"></a><a id="bfins-opcode-19-7"></a><a id="bfins-opcode-19-8"></a><a id="bfins-opcode-19-9"></a><a id="bfins-opcode-19-10"></a><a id="bfins-opcode-19-11"></a><a id="bfins-opcode-19-12"></a><a id="bfins-opcode-19-13"></a><a id="bfins-opcode-19-14"></a><a id="bfins-opcode-19-15"></a><a id="bfins-opcode-19-16"></a><a id="bfins-opcode-19-17"></a><a id="bfins-opcode-19-18"></a><a id="bfins-opcode-19-19"></a><a id="bfins-opcode-19-20"></a><a id="bfins-opcode-19-21"></a><a id="bfins-opcode-19-22"></a><a id="bfins-opcode-19-23"></a><a id="bfins-opcode-19-24"></a><a id="bfins-opcode-19-25"></a><a id="bfins-opcode-19-26"></a><a id="bfins-opcode-19-27"></a><a id="bfins-opcode-19-28"></a><a id="bfins-opcode-19-29"></a><a id="bfins-opcode-19-30"></a><a id="bfins-opcode-19-31"></a>

Historical only: [BFINS (opcode 19)](instruction-set-history.md#bfins-opcode-19).

### MCMP (opcode 20)

<a id="mcmp-opcode-20-1"></a><a id="mcmp-opcode-20-2"></a><a id="mcmp-opcode-20-3"></a><a id="mcmp-opcode-20-4"></a><a id="mcmp-opcode-20-5"></a><a id="mcmp-opcode-20-6"></a><a id="mcmp-opcode-20-7"></a><a id="mcmp-opcode-20-8"></a><a id="mcmp-opcode-20-9"></a><a id="mcmp-opcode-20-10"></a><a id="mcmp-opcode-20-11"></a><a id="mcmp-opcode-20-12"></a><a id="mcmp-opcode-20-13"></a><a id="mcmp-opcode-20-14"></a><a id="mcmp-opcode-20-15"></a><a id="mcmp-opcode-20-16"></a><a id="mcmp-opcode-20-17"></a><a id="mcmp-opcode-20-18"></a><a id="mcmp-opcode-20-19"></a><a id="mcmp-opcode-20-20"></a><a id="mcmp-opcode-20-21"></a><a id="mcmp-opcode-20-22"></a><a id="mcmp-opcode-20-23"></a><a id="mcmp-opcode-20-24"></a><a id="mcmp-opcode-20-25"></a><a id="mcmp-opcode-20-26"></a><a id="mcmp-opcode-20-27"></a><a id="mcmp-opcode-20-28"></a><a id="mcmp-opcode-20-29"></a><a id="mcmp-opcode-20-30"></a><a id="mcmp-opcode-20-31"></a>

Historical only: [MCMP (opcode 20)](instruction-set-history.md#mcmp-opcode-20).

### IADD (opcode 21)

<a id="iadd-opcode-21-1"></a><a id="iadd-opcode-21-2"></a><a id="iadd-opcode-21-3"></a><a id="iadd-opcode-21-4"></a><a id="iadd-opcode-21-5"></a><a id="iadd-opcode-21-6"></a><a id="iadd-opcode-21-7"></a><a id="iadd-opcode-21-8"></a><a id="iadd-opcode-21-9"></a><a id="iadd-opcode-21-10"></a><a id="iadd-opcode-21-11"></a><a id="iadd-opcode-21-12"></a><a id="iadd-opcode-21-13"></a><a id="iadd-opcode-21-14"></a><a id="iadd-opcode-21-15"></a><a id="iadd-opcode-21-16"></a><a id="iadd-opcode-21-17"></a><a id="iadd-opcode-21-18"></a><a id="iadd-opcode-21-19"></a><a id="iadd-opcode-21-20"></a><a id="iadd-opcode-21-21"></a><a id="iadd-opcode-21-22"></a><a id="iadd-opcode-21-23"></a><a id="iadd-opcode-21-24"></a><a id="iadd-opcode-21-25"></a><a id="iadd-opcode-21-26"></a><a id="iadd-opcode-21-27"></a><a id="iadd-opcode-21-28"></a><a id="iadd-opcode-21-29"></a><a id="iadd-opcode-21-30"></a><a id="iadd-opcode-21-31"></a>

Historical only: [IADD (opcode 21)](instruction-set-history.md#iadd-opcode-21).

### ISUB (opcode 22)

<a id="isub-opcode-22-1"></a><a id="isub-opcode-22-2"></a><a id="isub-opcode-22-3"></a><a id="isub-opcode-22-4"></a><a id="isub-opcode-22-5"></a><a id="isub-opcode-22-6"></a><a id="isub-opcode-22-7"></a><a id="isub-opcode-22-8"></a><a id="isub-opcode-22-9"></a><a id="isub-opcode-22-10"></a><a id="isub-opcode-22-11"></a><a id="isub-opcode-22-12"></a><a id="isub-opcode-22-13"></a><a id="isub-opcode-22-14"></a><a id="isub-opcode-22-15"></a><a id="isub-opcode-22-16"></a><a id="isub-opcode-22-17"></a><a id="isub-opcode-22-18"></a><a id="isub-opcode-22-19"></a><a id="isub-opcode-22-20"></a><a id="isub-opcode-22-21"></a><a id="isub-opcode-22-22"></a><a id="isub-opcode-22-23"></a><a id="isub-opcode-22-24"></a><a id="isub-opcode-22-25"></a><a id="isub-opcode-22-26"></a><a id="isub-opcode-22-27"></a><a id="isub-opcode-22-28"></a><a id="isub-opcode-22-29"></a><a id="isub-opcode-22-30"></a><a id="isub-opcode-22-31"></a>

Historical only: [ISUB (opcode 22)](instruction-set-history.md#isub-opcode-22).

### BRANCH (opcode 23)

<a id="branch-opcode-23-1"></a><a id="branch-opcode-23-2"></a><a id="branch-opcode-23-3"></a><a id="branch-opcode-23-4"></a><a id="branch-opcode-23-5"></a><a id="branch-opcode-23-6"></a><a id="branch-opcode-23-7"></a><a id="branch-opcode-23-8"></a><a id="branch-opcode-23-9"></a><a id="branch-opcode-23-10"></a><a id="branch-opcode-23-11"></a><a id="branch-opcode-23-12"></a><a id="branch-opcode-23-13"></a><a id="branch-opcode-23-14"></a><a id="branch-opcode-23-15"></a><a id="branch-opcode-23-16"></a><a id="branch-opcode-23-17"></a><a id="branch-opcode-23-18"></a><a id="branch-opcode-23-19"></a><a id="branch-opcode-23-20"></a><a id="branch-opcode-23-21"></a><a id="branch-opcode-23-22"></a><a id="branch-opcode-23-23"></a><a id="branch-opcode-23-24"></a><a id="branch-opcode-23-25"></a><a id="branch-opcode-23-26"></a><a id="branch-opcode-23-27"></a><a id="branch-opcode-23-28"></a><a id="branch-opcode-23-29"></a><a id="branch-opcode-23-30"></a><a id="branch-opcode-23-31"></a>

Historical only: [BRANCH (opcode 23)](instruction-set-history.md#branch-opcode-23).

### SHL (opcode 24)

<a id="shl-opcode-24-1"></a><a id="shl-opcode-24-2"></a><a id="shl-opcode-24-3"></a><a id="shl-opcode-24-4"></a><a id="shl-opcode-24-5"></a><a id="shl-opcode-24-6"></a><a id="shl-opcode-24-7"></a><a id="shl-opcode-24-8"></a><a id="shl-opcode-24-9"></a><a id="shl-opcode-24-10"></a><a id="shl-opcode-24-11"></a><a id="shl-opcode-24-12"></a><a id="shl-opcode-24-13"></a><a id="shl-opcode-24-14"></a><a id="shl-opcode-24-15"></a><a id="shl-opcode-24-16"></a><a id="shl-opcode-24-17"></a><a id="shl-opcode-24-18"></a><a id="shl-opcode-24-19"></a><a id="shl-opcode-24-20"></a><a id="shl-opcode-24-21"></a><a id="shl-opcode-24-22"></a><a id="shl-opcode-24-23"></a><a id="shl-opcode-24-24"></a><a id="shl-opcode-24-25"></a><a id="shl-opcode-24-26"></a><a id="shl-opcode-24-27"></a><a id="shl-opcode-24-28"></a><a id="shl-opcode-24-29"></a><a id="shl-opcode-24-30"></a><a id="shl-opcode-24-31"></a>

Historical only: [SHL (opcode 24)](instruction-set-history.md#shl-opcode-24).

### SHR (opcode 25)

<a id="shr-opcode-25-1"></a><a id="shr-opcode-25-2"></a><a id="shr-opcode-25-3"></a><a id="shr-opcode-25-4"></a><a id="shr-opcode-25-5"></a><a id="shr-opcode-25-6"></a><a id="shr-opcode-25-7"></a><a id="shr-opcode-25-8"></a><a id="shr-opcode-25-9"></a><a id="shr-opcode-25-10"></a><a id="shr-opcode-25-11"></a><a id="shr-opcode-25-12"></a><a id="shr-opcode-25-13"></a><a id="shr-opcode-25-14"></a><a id="shr-opcode-25-15"></a><a id="shr-opcode-25-16"></a><a id="shr-opcode-25-17"></a><a id="shr-opcode-25-18"></a><a id="shr-opcode-25-19"></a><a id="shr-opcode-25-20"></a><a id="shr-opcode-25-21"></a><a id="shr-opcode-25-22"></a><a id="shr-opcode-25-23"></a><a id="shr-opcode-25-24"></a><a id="shr-opcode-25-25"></a><a id="shr-opcode-25-26"></a><a id="shr-opcode-25-27"></a><a id="shr-opcode-25-28"></a><a id="shr-opcode-25-29"></a><a id="shr-opcode-25-30"></a><a id="shr-opcode-25-31"></a>

Historical only: [SHR (opcode 25)](instruction-set-history.md#shr-opcode-25).

## Assembly Syntax

<a id="assembly-syntax-1"></a><a id="assembly-syntax-2"></a><a id="assembly-syntax-3"></a><a id="assembly-syntax-4"></a><a id="assembly-syntax-5"></a><a id="assembly-syntax-6"></a><a id="assembly-syntax-7"></a><a id="assembly-syntax-8"></a><a id="assembly-syntax-9"></a><a id="assembly-syntax-10"></a><a id="assembly-syntax-11"></a><a id="assembly-syntax-12"></a><a id="assembly-syntax-13"></a><a id="assembly-syntax-14"></a><a id="assembly-syntax-15"></a><a id="assembly-syntax-16"></a><a id="assembly-syntax-17"></a><a id="assembly-syntax-18"></a><a id="assembly-syntax-19"></a><a id="assembly-syntax-20"></a><a id="assembly-syntax-21"></a><a id="assembly-syntax-22"></a><a id="assembly-syntax-23"></a><a id="assembly-syntax-24"></a><a id="assembly-syntax-25"></a><a id="assembly-syntax-26"></a><a id="assembly-syntax-27"></a><a id="assembly-syntax-28"></a><a id="assembly-syntax-29"></a><a id="assembly-syntax-30"></a><a id="assembly-syntax-31"></a>

Historical only: [Assembly Syntax](instruction-set-history.md#assembly-syntax).

### Labels

<a id="labels-1"></a><a id="labels-2"></a><a id="labels-3"></a><a id="labels-4"></a><a id="labels-5"></a><a id="labels-6"></a><a id="labels-7"></a><a id="labels-8"></a><a id="labels-9"></a><a id="labels-10"></a><a id="labels-11"></a><a id="labels-12"></a><a id="labels-13"></a><a id="labels-14"></a><a id="labels-15"></a><a id="labels-16"></a><a id="labels-17"></a><a id="labels-18"></a><a id="labels-19"></a><a id="labels-20"></a><a id="labels-21"></a><a id="labels-22"></a><a id="labels-23"></a><a id="labels-24"></a><a id="labels-25"></a><a id="labels-26"></a><a id="labels-27"></a><a id="labels-28"></a><a id="labels-29"></a><a id="labels-30"></a><a id="labels-31"></a>

Historical only: [Labels](instruction-set-history.md#labels).

### Comments

<a id="comments-1"></a><a id="comments-2"></a><a id="comments-3"></a><a id="comments-4"></a><a id="comments-5"></a><a id="comments-6"></a><a id="comments-7"></a><a id="comments-8"></a><a id="comments-9"></a><a id="comments-10"></a><a id="comments-11"></a><a id="comments-12"></a><a id="comments-13"></a><a id="comments-14"></a><a id="comments-15"></a><a id="comments-16"></a><a id="comments-17"></a><a id="comments-18"></a><a id="comments-19"></a><a id="comments-20"></a><a id="comments-21"></a><a id="comments-22"></a><a id="comments-23"></a><a id="comments-24"></a><a id="comments-25"></a><a id="comments-26"></a><a id="comments-27"></a><a id="comments-28"></a><a id="comments-29"></a><a id="comments-30"></a><a id="comments-31"></a>

Historical only: [Comments](instruction-set-history.md#comments).

### Register Names

<a id="register-names-1"></a><a id="register-names-2"></a><a id="register-names-3"></a><a id="register-names-4"></a><a id="register-names-5"></a><a id="register-names-6"></a><a id="register-names-7"></a><a id="register-names-8"></a><a id="register-names-9"></a><a id="register-names-10"></a><a id="register-names-11"></a><a id="register-names-12"></a><a id="register-names-13"></a><a id="register-names-14"></a><a id="register-names-15"></a><a id="register-names-16"></a><a id="register-names-17"></a><a id="register-names-18"></a><a id="register-names-19"></a><a id="register-names-20"></a><a id="register-names-21"></a><a id="register-names-22"></a><a id="register-names-23"></a><a id="register-names-24"></a><a id="register-names-25"></a><a id="register-names-26"></a><a id="register-names-27"></a><a id="register-names-28"></a><a id="register-names-29"></a><a id="register-names-30"></a><a id="register-names-31"></a>

Historical only: [Register Names](instruction-set-history.md#register-names).

### Immediate Values

<a id="immediate-values-1"></a><a id="immediate-values-2"></a><a id="immediate-values-3"></a><a id="immediate-values-4"></a><a id="immediate-values-5"></a><a id="immediate-values-6"></a><a id="immediate-values-7"></a><a id="immediate-values-8"></a><a id="immediate-values-9"></a><a id="immediate-values-10"></a><a id="immediate-values-11"></a><a id="immediate-values-12"></a><a id="immediate-values-13"></a><a id="immediate-values-14"></a><a id="immediate-values-15"></a><a id="immediate-values-16"></a><a id="immediate-values-17"></a><a id="immediate-values-18"></a><a id="immediate-values-19"></a><a id="immediate-values-20"></a><a id="immediate-values-21"></a><a id="immediate-values-22"></a><a id="immediate-values-23"></a><a id="immediate-values-24"></a><a id="immediate-values-25"></a><a id="immediate-values-26"></a><a id="immediate-values-27"></a><a id="immediate-values-28"></a><a id="immediate-values-29"></a><a id="immediate-values-30"></a><a id="immediate-values-31"></a>

Historical only: [Immediate Values](instruction-set-history.md#immediate-values).

## Three-Tier Fault Recovery (Task #1077)

<a id="three-tier-fault-recovery-task-1077-1"></a><a id="three-tier-fault-recovery-task-1077-2"></a><a id="three-tier-fault-recovery-task-1077-3"></a><a id="three-tier-fault-recovery-task-1077-4"></a><a id="three-tier-fault-recovery-task-1077-5"></a><a id="three-tier-fault-recovery-task-1077-6"></a><a id="three-tier-fault-recovery-task-1077-7"></a><a id="three-tier-fault-recovery-task-1077-8"></a><a id="three-tier-fault-recovery-task-1077-9"></a><a id="three-tier-fault-recovery-task-1077-10"></a><a id="three-tier-fault-recovery-task-1077-11"></a><a id="three-tier-fault-recovery-task-1077-12"></a><a id="three-tier-fault-recovery-task-1077-13"></a><a id="three-tier-fault-recovery-task-1077-14"></a><a id="three-tier-fault-recovery-task-1077-15"></a><a id="three-tier-fault-recovery-task-1077-16"></a><a id="three-tier-fault-recovery-task-1077-17"></a><a id="three-tier-fault-recovery-task-1077-18"></a><a id="three-tier-fault-recovery-task-1077-19"></a><a id="three-tier-fault-recovery-task-1077-20"></a><a id="three-tier-fault-recovery-task-1077-21"></a><a id="three-tier-fault-recovery-task-1077-22"></a><a id="three-tier-fault-recovery-task-1077-23"></a><a id="three-tier-fault-recovery-task-1077-24"></a><a id="three-tier-fault-recovery-task-1077-25"></a><a id="three-tier-fault-recovery-task-1077-26"></a><a id="three-tier-fault-recovery-task-1077-27"></a><a id="three-tier-fault-recovery-task-1077-28"></a><a id="three-tier-fault-recovery-task-1077-29"></a><a id="three-tier-fault-recovery-task-1077-30"></a><a id="three-tier-fault-recovery-task-1077-31"></a>

Historical only: [Three-Tier Fault Recovery (Task #1077)](instruction-set-history.md#three-tier-fault-recovery-task-1077).

### Tier 1 — `.catch` Method on the Faulting Abstraction

<a id="tier-1-catch-method-on-the-faulting-abstraction"></a><a id="tier-1--catch-method-on-the-faulting-abstraction"></a>

<a id="tier-1--catch-method-on-the-faulting-abstraction-1"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-2"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-3"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-4"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-5"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-6"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-7"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-8"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-9"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-10"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-11"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-12"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-13"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-14"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-15"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-16"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-17"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-18"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-19"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-20"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-21"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-22"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-23"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-24"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-25"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-26"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-27"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-28"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-29"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-30"></a><a id="tier-1--catch-method-on-the-faulting-abstraction-31"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-1"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-2"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-3"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-4"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-5"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-6"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-7"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-8"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-9"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-10"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-11"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-12"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-13"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-14"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-15"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-16"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-17"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-18"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-19"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-20"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-21"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-22"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-23"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-24"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-25"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-26"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-27"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-28"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-29"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-30"></a><a id="tier-1-codecatchcode-method-on-the-faulting-abstraction-31"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-1"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-2"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-3"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-4"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-5"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-6"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-7"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-8"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-9"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-10"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-11"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-12"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-13"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-14"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-15"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-16"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-17"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-18"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-19"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-20"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-21"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-22"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-23"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-24"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-25"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-26"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-27"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-28"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-29"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-30"></a><a id="tier-1-catch-method-on-the-faulting-abstraction-31"></a>

Historical only: [Tier 1 — `.catch` Method on the Faulting Abstraction](instruction-set-history.md#tier-1-catch-method-on-the-faulting-abstraction).

### Tier 2 — Scheduler.IRQ (Hidden ELOADCALL)

<a id="tier-2--schedulerirq-hidden-eloadcall"></a>

<a id="tier-2--schedulerirq-hidden-eloadcall-1"></a><a id="tier-2--schedulerirq-hidden-eloadcall-2"></a><a id="tier-2--schedulerirq-hidden-eloadcall-3"></a><a id="tier-2--schedulerirq-hidden-eloadcall-4"></a><a id="tier-2--schedulerirq-hidden-eloadcall-5"></a><a id="tier-2--schedulerirq-hidden-eloadcall-6"></a><a id="tier-2--schedulerirq-hidden-eloadcall-7"></a><a id="tier-2--schedulerirq-hidden-eloadcall-8"></a><a id="tier-2--schedulerirq-hidden-eloadcall-9"></a><a id="tier-2--schedulerirq-hidden-eloadcall-10"></a><a id="tier-2--schedulerirq-hidden-eloadcall-11"></a><a id="tier-2--schedulerirq-hidden-eloadcall-12"></a><a id="tier-2--schedulerirq-hidden-eloadcall-13"></a><a id="tier-2--schedulerirq-hidden-eloadcall-14"></a><a id="tier-2--schedulerirq-hidden-eloadcall-15"></a><a id="tier-2--schedulerirq-hidden-eloadcall-16"></a><a id="tier-2--schedulerirq-hidden-eloadcall-17"></a><a id="tier-2--schedulerirq-hidden-eloadcall-18"></a><a id="tier-2--schedulerirq-hidden-eloadcall-19"></a><a id="tier-2--schedulerirq-hidden-eloadcall-20"></a><a id="tier-2--schedulerirq-hidden-eloadcall-21"></a><a id="tier-2--schedulerirq-hidden-eloadcall-22"></a><a id="tier-2--schedulerirq-hidden-eloadcall-23"></a><a id="tier-2--schedulerirq-hidden-eloadcall-24"></a><a id="tier-2--schedulerirq-hidden-eloadcall-25"></a><a id="tier-2--schedulerirq-hidden-eloadcall-26"></a><a id="tier-2--schedulerirq-hidden-eloadcall-27"></a><a id="tier-2--schedulerirq-hidden-eloadcall-28"></a><a id="tier-2--schedulerirq-hidden-eloadcall-29"></a><a id="tier-2--schedulerirq-hidden-eloadcall-30"></a><a id="tier-2--schedulerirq-hidden-eloadcall-31"></a><a id="tier-2-schedulerirq-hidden-eloadcall-1"></a><a id="tier-2-schedulerirq-hidden-eloadcall-2"></a><a id="tier-2-schedulerirq-hidden-eloadcall-3"></a><a id="tier-2-schedulerirq-hidden-eloadcall-4"></a><a id="tier-2-schedulerirq-hidden-eloadcall-5"></a><a id="tier-2-schedulerirq-hidden-eloadcall-6"></a><a id="tier-2-schedulerirq-hidden-eloadcall-7"></a><a id="tier-2-schedulerirq-hidden-eloadcall-8"></a><a id="tier-2-schedulerirq-hidden-eloadcall-9"></a><a id="tier-2-schedulerirq-hidden-eloadcall-10"></a><a id="tier-2-schedulerirq-hidden-eloadcall-11"></a><a id="tier-2-schedulerirq-hidden-eloadcall-12"></a><a id="tier-2-schedulerirq-hidden-eloadcall-13"></a><a id="tier-2-schedulerirq-hidden-eloadcall-14"></a><a id="tier-2-schedulerirq-hidden-eloadcall-15"></a><a id="tier-2-schedulerirq-hidden-eloadcall-16"></a><a id="tier-2-schedulerirq-hidden-eloadcall-17"></a><a id="tier-2-schedulerirq-hidden-eloadcall-18"></a><a id="tier-2-schedulerirq-hidden-eloadcall-19"></a><a id="tier-2-schedulerirq-hidden-eloadcall-20"></a><a id="tier-2-schedulerirq-hidden-eloadcall-21"></a><a id="tier-2-schedulerirq-hidden-eloadcall-22"></a><a id="tier-2-schedulerirq-hidden-eloadcall-23"></a><a id="tier-2-schedulerirq-hidden-eloadcall-24"></a><a id="tier-2-schedulerirq-hidden-eloadcall-25"></a><a id="tier-2-schedulerirq-hidden-eloadcall-26"></a><a id="tier-2-schedulerirq-hidden-eloadcall-27"></a><a id="tier-2-schedulerirq-hidden-eloadcall-28"></a><a id="tier-2-schedulerirq-hidden-eloadcall-29"></a><a id="tier-2-schedulerirq-hidden-eloadcall-30"></a><a id="tier-2-schedulerirq-hidden-eloadcall-31"></a>

Historical only: [Tier 2 — Scheduler.IRQ (Hidden ELOADCALL)](instruction-set-history.md#tier-2-schedulerirq-hidden-eloadcall).

### Tier 3 — Double-Fault (CHANGE to CR13)

<a id="tier-3--double-fault-change-to-cr13"></a>

<a id="tier-3--double-fault-change-to-cr13-1"></a><a id="tier-3--double-fault-change-to-cr13-2"></a><a id="tier-3--double-fault-change-to-cr13-3"></a><a id="tier-3--double-fault-change-to-cr13-4"></a><a id="tier-3--double-fault-change-to-cr13-5"></a><a id="tier-3--double-fault-change-to-cr13-6"></a><a id="tier-3--double-fault-change-to-cr13-7"></a><a id="tier-3--double-fault-change-to-cr13-8"></a><a id="tier-3--double-fault-change-to-cr13-9"></a><a id="tier-3--double-fault-change-to-cr13-10"></a><a id="tier-3--double-fault-change-to-cr13-11"></a><a id="tier-3--double-fault-change-to-cr13-12"></a><a id="tier-3--double-fault-change-to-cr13-13"></a><a id="tier-3--double-fault-change-to-cr13-14"></a><a id="tier-3--double-fault-change-to-cr13-15"></a><a id="tier-3--double-fault-change-to-cr13-16"></a><a id="tier-3--double-fault-change-to-cr13-17"></a><a id="tier-3--double-fault-change-to-cr13-18"></a><a id="tier-3--double-fault-change-to-cr13-19"></a><a id="tier-3--double-fault-change-to-cr13-20"></a><a id="tier-3--double-fault-change-to-cr13-21"></a><a id="tier-3--double-fault-change-to-cr13-22"></a><a id="tier-3--double-fault-change-to-cr13-23"></a><a id="tier-3--double-fault-change-to-cr13-24"></a><a id="tier-3--double-fault-change-to-cr13-25"></a><a id="tier-3--double-fault-change-to-cr13-26"></a><a id="tier-3--double-fault-change-to-cr13-27"></a><a id="tier-3--double-fault-change-to-cr13-28"></a><a id="tier-3--double-fault-change-to-cr13-29"></a><a id="tier-3--double-fault-change-to-cr13-30"></a><a id="tier-3--double-fault-change-to-cr13-31"></a><a id="tier-3-double-fault-change-to-cr13-1"></a><a id="tier-3-double-fault-change-to-cr13-2"></a><a id="tier-3-double-fault-change-to-cr13-3"></a><a id="tier-3-double-fault-change-to-cr13-4"></a><a id="tier-3-double-fault-change-to-cr13-5"></a><a id="tier-3-double-fault-change-to-cr13-6"></a><a id="tier-3-double-fault-change-to-cr13-7"></a><a id="tier-3-double-fault-change-to-cr13-8"></a><a id="tier-3-double-fault-change-to-cr13-9"></a><a id="tier-3-double-fault-change-to-cr13-10"></a><a id="tier-3-double-fault-change-to-cr13-11"></a><a id="tier-3-double-fault-change-to-cr13-12"></a><a id="tier-3-double-fault-change-to-cr13-13"></a><a id="tier-3-double-fault-change-to-cr13-14"></a><a id="tier-3-double-fault-change-to-cr13-15"></a><a id="tier-3-double-fault-change-to-cr13-16"></a><a id="tier-3-double-fault-change-to-cr13-17"></a><a id="tier-3-double-fault-change-to-cr13-18"></a><a id="tier-3-double-fault-change-to-cr13-19"></a><a id="tier-3-double-fault-change-to-cr13-20"></a><a id="tier-3-double-fault-change-to-cr13-21"></a><a id="tier-3-double-fault-change-to-cr13-22"></a><a id="tier-3-double-fault-change-to-cr13-23"></a><a id="tier-3-double-fault-change-to-cr13-24"></a><a id="tier-3-double-fault-change-to-cr13-25"></a><a id="tier-3-double-fault-change-to-cr13-26"></a><a id="tier-3-double-fault-change-to-cr13-27"></a><a id="tier-3-double-fault-change-to-cr13-28"></a><a id="tier-3-double-fault-change-to-cr13-29"></a><a id="tier-3-double-fault-change-to-cr13-30"></a><a id="tier-3-double-fault-change-to-cr13-31"></a>

Historical only: [Tier 3 — Double-Fault (CHANGE to CR13)](instruction-set-history.md#tier-3-double-fault-change-to-cr13).

### Scheduler.pause and Timer Interrupts

<a id="schedulerpause-and-timer-interrupts-1"></a><a id="schedulerpause-and-timer-interrupts-2"></a><a id="schedulerpause-and-timer-interrupts-3"></a><a id="schedulerpause-and-timer-interrupts-4"></a><a id="schedulerpause-and-timer-interrupts-5"></a><a id="schedulerpause-and-timer-interrupts-6"></a><a id="schedulerpause-and-timer-interrupts-7"></a><a id="schedulerpause-and-timer-interrupts-8"></a><a id="schedulerpause-and-timer-interrupts-9"></a><a id="schedulerpause-and-timer-interrupts-10"></a><a id="schedulerpause-and-timer-interrupts-11"></a><a id="schedulerpause-and-timer-interrupts-12"></a><a id="schedulerpause-and-timer-interrupts-13"></a><a id="schedulerpause-and-timer-interrupts-14"></a><a id="schedulerpause-and-timer-interrupts-15"></a><a id="schedulerpause-and-timer-interrupts-16"></a><a id="schedulerpause-and-timer-interrupts-17"></a><a id="schedulerpause-and-timer-interrupts-18"></a><a id="schedulerpause-and-timer-interrupts-19"></a><a id="schedulerpause-and-timer-interrupts-20"></a><a id="schedulerpause-and-timer-interrupts-21"></a><a id="schedulerpause-and-timer-interrupts-22"></a><a id="schedulerpause-and-timer-interrupts-23"></a><a id="schedulerpause-and-timer-interrupts-24"></a><a id="schedulerpause-and-timer-interrupts-25"></a><a id="schedulerpause-and-timer-interrupts-26"></a><a id="schedulerpause-and-timer-interrupts-27"></a><a id="schedulerpause-and-timer-interrupts-28"></a><a id="schedulerpause-and-timer-interrupts-29"></a><a id="schedulerpause-and-timer-interrupts-30"></a><a id="schedulerpause-and-timer-interrupts-31"></a>

Historical only: [Scheduler.pause and Timer Interrupts](instruction-set-history.md#schedulerpause-and-timer-interrupts).

<a id="church-machine-instruction-set-1"></a><a id="church-machine-instruction-set-2"></a><a id="church-machine-instruction-set-3"></a><a id="church-machine-instruction-set-4"></a><a id="church-machine-instruction-set-5"></a><a id="church-machine-instruction-set-6"></a><a id="church-machine-instruction-set-7"></a><a id="church-machine-instruction-set-8"></a><a id="church-machine-instruction-set-9"></a><a id="church-machine-instruction-set-10"></a><a id="church-machine-instruction-set-11"></a><a id="church-machine-instruction-set-12"></a><a id="church-machine-instruction-set-13"></a><a id="church-machine-instruction-set-14"></a><a id="church-machine-instruction-set-15"></a><a id="church-machine-instruction-set-16"></a><a id="church-machine-instruction-set-17"></a><a id="church-machine-instruction-set-18"></a><a id="church-machine-instruction-set-19"></a><a id="church-machine-instruction-set-20"></a><a id="church-machine-instruction-set-21"></a><a id="church-machine-instruction-set-22"></a><a id="church-machine-instruction-set-23"></a><a id="church-machine-instruction-set-24"></a><a id="church-machine-instruction-set-25"></a><a id="church-machine-instruction-set-26"></a><a id="church-machine-instruction-set-27"></a><a id="church-machine-instruction-set-28"></a><a id="church-machine-instruction-set-29"></a><a id="church-machine-instruction-set-30"></a><a id="church-machine-instruction-set-31"></a>

[Historical baseline copies](instruction-set-history.md#preservation-inventory).
