# Church Machine Instruction Set

## Navigation

- [Core execution reference](#core-execution-reference)
- [Document authority](#document-authority)
- [Approved Phase 1 contract](#approved-phase-1-contract)
- [BFEXT/BFINS bitfield contract](#bfextbfins-bitfield-contract)
- [CHANGE: one-GT Thread activation](#change-one-gt-thread-activation)
- [Uniform indexed operands](#uniform-indexed-operands)
- [LOAD NULL and capability discard](#load-null-and-capability-discard)
- [SWITCH: combined Namespace/Thread handoff](#switch-isolated-register-load)
- [Retired opcodes and reference forms](#retired-opcodes-and-directindirect-reference-forms)

## Document authority

This is the **master ISA document**. Its requirements take precedence over
`isa_reference.md`, `isa_encoding.md`, the `isa-indexed-*` proposals, derived
PDFs and implementation descriptions. Those documents support this master;
assembler, simulator or hardware behavior does not override it.

**Namespace authority:** The Namespace Table alone determines membership,
slots and descriptors. A manifest cannot allocate, select or override its
contents. Referenced LUMP bytes and validation evidence remain required;
they are not competing inventories.

**Current work authorization:** See the [Phase 1 entry point](../README.md#current-work).
Statements below that an individual approval did not authorize implementation
describe that decision's original scope, not the current work authorization.

The previously approved retirement of **ELOADCALL (opcode 8)** and
**XLOADLAMBDA (opcode 9)** remains in force. Descriptions of those encodings
below are historical only; they do not authorize execution or automatic
translation of saved programs.

The one-GT CHANGE and indexed-operand corrections below are authoritative.
Existing encoding tables and repeated instruction descriptions elsewhere in
this document remain baseline records pending reconciliation; they do not
override these corrections or establish a new encoding layout.

## Core execution reference

Instructions are one 32-bit word. Opcode is [31:27], condition [26:23].
Ordinary register fields are A=[22:19], B=[18:15], operand=[14:0].
CALL, BRANCH and indexed formats below explicitly repurpose these fields.
Do not decode them with the ordinary-field interpretation.

### Predication

| Condition | Execute when | Condition | Execute when |
|---|---|---|---|
| 0 EQ | Z | 1 NE | not Z |
| 2 CS/HS | C | 3 CC/LO | not C |
| 4 MI | N | 5 PL | not N |
| 6 VS | V | 7 VC | not V |
| 8 HI | C and not Z | 9 LS | not C or Z |
| 10 GE | N=V | 11 LT | N≠V |
| 12 GT | not Z and N=V | 13 LE | Z or N≠V |
| 14 AL | always | 15 NV | reserved; see oracle closure below |

A false condition skips operand checks, writes and instruction-generated faults;
flags and capabilities remain unchanged. Fetch protection and watchdog expiry
are independent. Advance to the next instruction, not into an extension word.
DR0 reads zero; a destination write cannot make it nonzero.

### Ordinary data instructions

These baseline rules remain applicable; the indexed rules later in this document
replace the older memory/BRANCH/bitfield operand encodings.

| Opcode | Operation | Encoding and result |
|---|---|---|
| 20 MCMP | Compare DR[A]−DR[B], no data write | Operand field zero. NZCV records subtraction: N=result bit 31, Z=result zero, C=no unsigned borrow, V=signed overflow. |
| 21 IADD | DR[A]←DR[B]+third operand | Operand bit 14=0: third operand is DR[3:0], bits 13:4 zero. Bit 14=1: zero-extend bits 13:0 (0…16383). |
| 22 ISUB | DR[A]←DR[B]−third operand | Same two operand forms as IADD. |
| 24 SHL | DR[A]←DR[B] shifted left | Amount bits 4:0, 0…31; logical zero fill. |
| 25 SHR | DR[A]←DR[B] shifted right | Amount bits 4:0; bit 5=0 logical, bit 5=1 arithmetic sign extension. |

Arithmetic results are 32-bit. IADD/ISUB set NZCV; addition C is carry out,
subtraction C is no borrow, V is signed overflow. Capture inputs before writes,
including aliased operands and DR0 destinations. Do not substitute the checked,
non-wrapping address arithmetic for ordinary integer-result arithmetic.

IADD/ISUB immediates are **unsigned**, as explicitly selected for Phase 1.
ISUB can produce a negative result; that does not make its immediate signed.
This does not change the separately approved signed-offset/index formats.

### Capability operations and calls

| Opcode | Required effect |
|---|---|
| 0 LOAD | Load the indexed GT through the source c-list capability into the destination CR using mLoad validation. An authorized read of a NULL value succeeds and discards destination authority; see LOAD NULL below. Operand `0x4000` selects direct NULL discard without a C-list read. The CR6 execution-context exception must not become a general permission bypass. |
| 1 SAVE | Store the source GT through the destination c-list capability; require destination S and source B, with mSave validation. Abstract PassKey policy is separately specified below. |
| 2 CALL | Validate the selected E-GT and method entry. Save caller E authority and continuation; derive callee CR6/c-list and CR14/code. Never preserve transient L authority as caller E authority. |
| 3 RETURN | Revalidate saved caller E authority; reconstruct CR6/CR14 and resume the saved continuation. Empty/poison-root return faults STACK_UNDERFLOW; it is not a reset or halt. |
| 4 CHANGE | Validated outgoing save → incoming Thread activation. See the complete contract below. |
| 5 SWITCH | Outgoing save → Namespace load → incoming slot-2 activation. |
| 6 TPERM | Query/attenuation; NULL and EXACT rules below override older reserved-preset descriptions. |
| 7 LAMBDA | Execute an X-authorized code object in the caller's capability scope; do not replace its c-list. Return must validate the continuation; no unvalidated fast-path exception. |
| 8, 9 | Retired. Not executable aliases or automatic translations. |
| 16 DREAD / 17 DWRITE | Read/write a 32-bit DATA word with R/W authority using the approved indexed layout. |
| 18 BFEXT / 19 BFINS | Approved checked bitfield operation below. |
| 23 BRANCH | Approved checked PC-relative indexed branch below. |

CALL's ordinary saved frame has caller E-GT plus packed NIA/indicators, not a
hidden CR/DR snapshot. Method zero enters word 1; method n>0 reads word n
as a lump-relative word offset. Zero/private entries and header execution are
invalid. Check method-table and executable bounds before entry.

RETURN uses opcode 3, condition [26:23], zero [22:12], keep mask [11:0].
Mask bits 0–4 and 7–11 retain their corresponding CR when set, otherwise clear
it without resolving that cleared GT. Bits 5/6 do not select restoration:
CR5 descriptor stays unchanged and CR6 is reconstructed. DRs and CR12/CR15
descriptors are retained; CR13 remains untouched. The two-word frame does not
restore old values for masked CRs.

### Oracle closure

#### Approved saved-NIA convention (2026-10-24)

The user explicitly selected program-relative saved NIA for CALL, RETURN and
CHANGE. A non-poison saved NIA is a word offset from the first code word after
the executable LUMP header, identified by the saved executable capability.
Validate the offset against that executable's code word count before resuming.
The physical fetch address is the resolved code base plus four times the offset;
the internal core may continue using absolute byte addresses.

CALL saves the caller's next program-relative word offset. CHANGE saves its
issuing continuation in the same form and resumes the incoming one. RETURN
revalidates the saved executable and reconstructs its physical address from
that base. Relocation does not rewrite the relative offset. The poison-root
sentinel remains a sentinel and is never converted into an executable address.
This settles saved-NIA coordinate meaning, not other unresolved frame packing
or LAMBDA authority-policy questions below.

The review did **not** settle every baseline corner. Before claiming complete
instruction conformance, close these exact test expectations:

- NV/reserved-condition disposition and malformed reserved fields.
- SHL/SHR flag effects and treatment of unused shift bits.
- Full ordinary TPERM mode/preset/modifier packing and fault/flag precedence;
  plain NULL=15 and B-modified NULL=31 are already settled.
- Exact protected Thread-frame/indicator packing, CALL/RETURN M-bit effects
  consistent with untouched CR13, and LAMBDA continuation representation.
- Unspecified multi-fault precedence and exact numeric fault codes where only
  a named outcome is currently defined.

Do not pick an answer merely because current RTL emits it. These are explicit
oracle gaps, not permission to drop tests or label them passed. The already
approved formats and behavior in the remainder of this document remain binding.

## Approved Phase 1 contract

**Reconciled from explicit Genesis decisions, 2026-10-14.** The
resolution log
is the decision evidence. These are target requirements, not claims that the
compiler, simulator, RTL, saved images or physical board already conform.
Explicit approvals and routine FPGA choices made under delegated engineering
discretion are distinguished below; software TBDs are not implementation defaults.
No build, migration, upload or flash is authorized by this edit.

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

The watchdog uses a selectable **0.25, 0.5, 1 or 2 seconds of elapsed time to
hard fault**, initially **1 second**, except in IDE Debug or IDE Trace mode.
Every successful CHANGE/SWITCH renews a full selected interval,
including self/helper transfers. Retirement, CALL and RETURN do not renew it;
failed or condition-skipped transfers do not renew it. This bounds time between
transfers, not useful progress or return to a scheduler.

Arm on execution start after reset, including boot unless exempt. On leaving
both exempt modes, start a fresh selected interval. Expiry wins at equality: a transfer
must complete strictly before its deadline. Stalls do not extend the interval.
No automatic IRQ, CR13 action, maintenance exemption or hardware timer ABI is
introduced by this policy; exact target timing/capture needs implementation evidence.

**Watchdog exemption across reset — approved:** Hardware reset preserves the
existing Debug/Trace exemption rather than clearing it. An active exemption
therefore remains active across reset; reset does not create an exemption
when none was active. The MMIO abstraction remains in control. Leaving both
exempt modes starts a fresh selected interval under the existing rule.
This is reset retention, distinct from the Phase 1 initialization rule below;
it does not promise persistence of the previous state across power loss or
FPGA reconfiguration.

**Phase 1 bootstrap watchdog initialization — approved:** After power-on or
FPGA configuration, start with the Debug/Trace watchdog exemption **enabled**.
This is a Phase 1 bootstrap decision where **Genesis = IDE**, not a universal
default for later phases. The MMIO abstraction remains in charge; this does
not impose an IDE-only hardware-control path. Hardware reset preserves the
current exemption state. The initial timeout selection is **1 second**.
When both exempt modes are left, start a fresh selected interval under the
existing rule. Initial enabled state is not
retention of whatever state existed before power loss or reconfiguration.

**Watchdog MMIO authority — approved:** The watchdog register must exist as a
Genesis-provisioned MMIO GT; the MMIO abstraction is in charge. Do not replace
this capability-mediated control with an IDE-only hardware-control restriction.
This does not grant the GT to every Thread or authorize arbitrary watchdog
writes. Address and capability distribution remain unspecified; retain the
approved selected-duration deadline, Debug/Trace
exception and CHANGE/SWITCH renewal rules.

**Watchdog MMIO control word — approved for Phase 1:** One 32-bit word:
bit 0 is the exemption flag (1 = exempt, 0 = selected-timeout enforcement).
Bits 2:1 select among **0.25, 0.5, 1 and 2 seconds**, initially **1 second**.
Bits 31:3 are reserved, read as zero and must be zero on writes. Setting
reserved bits is not a defined control operation. Power-on/FPGA configuration
initializes bit 0 to 1 for Phase 1 bootstrap; hardware reset preserves it.
Clearing the exemption starts a fresh selected interval. This selects the
control-word layout, not a register address, Namespace slot or software API.
This supersedes the earlier fixed-one-second rule and reservation of bits 2:1.
**Timeout selector encoding — approved for Phase 1:**

| Bits 2:1 | Timeout |
|---|---|
| `00` | 0.25 seconds |
| `01` | 0.5 seconds |
| `10` | 1 second |
| `11` | 2 seconds |

With bit 0 set for exemption and reserved bits zero, power-on/FPGA
configuration initializes the control word to **`0x00000005`**.
This is the initialization value, not a hardware-reset overwrite: reset
retains the current selector and exemption under the rule below.
Exact timing/resource implementation and conformance need evidence.

**Reserved-bit write rejection — approved:** A watchdog control write with
any bit in [31:3] set hard-faults and is rejected in its entirety. Do not
partially apply bits 2:0 or mask away the invalid bits. The rejected write
does not change exemption, timeout selection, active duration or deadline,
and does not restart or extend the timer. This is absence of write effects,
not a freeze of elapsed time or a waiver of independent expiry/fault handling.
**Fault-code assignment — approved:** Report **INVALID_OP (`0x0B`)** for this
reserved-bit write rejection. **WATCHDOG (`0x1F`)** remains the timeout-expiry
code, not the malformed-control-write code. Whole-write rejection and the
existing same-cycle instruction-fault/expiry precedence remain unchanged.

**Timeout selector across reset — approved:** Hardware reset preserves the
selected timeout, just as it preserves exemption. It does not preserve elapsed
countdown time: execution start after reset begins a fresh interval using the
retained selection unless exempt. Retain the selected value, not an older
duration latched for the pre-reset interval. Power-on or FPGA reconfiguration
instead initializes the selection to 1 second and exemption to enabled under
the approved Phase 1 bootstrap rule.

**Timeout selection during an active interval — approved:** A selector change
takes effect at the next approved timer start or renewal. The active interval
keeps its original duration and deadline, whether the new selection is shorter
or longer. Writing the selector alone neither restarts nor extends that interval.
At the next start/renewal, use the then-current selection for the full new
interval. Preserve existing renewal events and expiry-at-equality precedence.

**Combined selector/exemption write — approved:** A valid control-word write
that changes the timeout and clears an existing exemption (bit 0 transitions
from 1 to 0) is one atomic update. Start the fresh interval using the new
selector in that same write, not the previous selection. For example,
`0x00000006` selects 2 seconds and clears exemption, starting a fresh 2-second
interval when leaving exemption. Writing bit 0=0 when already non-exempt is
not an exemption exit and does not grant an additional timer renewal.
Invalid writes and writes rejected under the expiry precedence rules do not
partially update either control field or start an interval.

**Exemption write at the deadline — approved:** If a valid write enabling
exemption would take effect on the same clock edge as watchdog expiry, expiry
wins. Reject the entire control write, leaving exemption and timeout selection
unchanged, and latch the watchdog fault. An exemption write must take effect
strictly before the deadline to prevent expiry; issuing a request earlier does
not itself establish that it took effect. Preserve deadline containment.
The existing same-cycle instruction-fault reporting priority remains unchanged:
if an instruction fault also occurs, report that fault rather than WATCHDOG,
without allowing the exemption write or suppressing watchdog containment.

**Watchdog implementation direction — selected under delegated FPGA-design
discretion:** Use one synchronous countdown timer, not four timers. Load its
duration from the selected timeout only at an approved start/renewal, so later
selector writes cannot change the active deadline. Derive the four count
constants from the actual fixed, ungated system-clock frequency at elaboration;
instruction retirement, pipeline stalls and bus waits must not gate counting.
Require representable integral cycle counts for all four durations rather than
silently rounding. Actual clock frequency, oscillator tolerance, counter sizing
and exact-build timing remain implementation evidence to establish.

Control readback returns the programmed selector and exemption, not the
duration captured by the running timer. Do not add a countdown/status register
or an extra software-visible timer interface merely for implementation convenience.
Use one atomic control-update enable after access and value validation. A
same-edge accepted selector update and approved timer start/renewal uses the
new selector; expiry still prevents renewal and rejects program control writes.
There is no write queue or deferred replay of a rejected write.
These are engineering selections, not claims of implemented or verified RTL,
and do not weaken any previously approved validation or fault rule.

The Phase 1 Mint exclusion of MMIO creation does not exclude this
Genesis-provisioned platform MMIO object. No new slot, register ABI, software
delivery gate or passed hardware-conformance claim is introduced here.

**Watchdog fault evidence and recovery — Phase 1.1 approved:** Retain the
first-fault evidence, but do not save the faulted Thread as a resumable
continuation. Use the responsible Namespace's trusted boot sequence under
the [Namespace recovery contract](#namespace-fault-recovery).
No M-bit grant from the faulted program is required. Evidence retention is
not an unrestricted RAM-write bypass or a new CR13 role. This supersedes
the earlier save-first recovery direction, not ordinary CHANGE/SWITCH saves.
Exact implementation and hardware evidence remain required.

**Watchdog accepted-write boundary — approved:** Latch the watchdog fault at
the deadline and stop new program-side writes. Already-accepted memory writes
must finish within a verified hardware bound before recovery uses memory.
This is not extra program execution time, cancellation of committed writes,
rollback or permission to complete unaccepted writes of a multi-write operation.
Recovery writes are a separate operation and retain their applicable validation
checks. The acceptance/completion boundary and exact bound require
hardware evidence; do not assume completion merely from elapsed time or reset.

**Write completion before watchdog recovery — selected under delegated FPGA
discretion:** Serialize program-side memory writes with at most one accepted
write awaiting completion. On expiry, stop admission of new program writes;
wait only for the previously accepted write before permitting trusted recovery
to use memory. Do not finish unaccepted writes belonging to
the interrupted instruction, replay requests, retry, or roll back committed data.

For synchronous on-chip RAM, acceptance and completion may be the same
documented write edge; do not introduce a redundant handshake. For a delayed
interface, establish completion through the actual interface protocol. A tied
completion signal is evidence only when the memory timing contract proves it,
not by itself. Determine and verify the finite worst-case completion bound from
the integrated hardware; no numeric bound is selected without evidence.
If completion is not established within that bound, remain fault-stopped and
do not begin recovery memory writes or claim successful context capture.
This is containment, not a new recovery strategy or fault-code allocation.

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

### LOAD NULL and capability discard

**2026-10-21 clarification:** Loading NULL is a valid capability-discard
operation. Rejecting NULL merely because it is the value being loaded conflicts
with this contract. Loading a NULL value and using NULL as access authority are
different operations.

The existing GT type field **bits [26:25] = `00`** denotes NULL.
`0x00000000` is a NULL GT; NULL-type recognition is not restricted to the
all-zero word. This clarification does not change the GT format.

**Ordinary indexed LOAD:**

* Validate the source capability, permissions, row calculation and bounds
  before reading the selected C-list entry.
* If the retrieved GT has NULL type, loading it into an otherwise permitted
  destination succeeds. Discard the destination's former capability and any
  cached authority that could permit its continued use.
* Do not resolve a target object or require a valid Namespace target for NULL.
  An actual NULL value must not become a lazy-resolution request merely because
  of a pet name. Unresolved symbolic references are a separate linking concern;
  they must not redefine explicit NULL-discard semantics.
* NULL does not authorize the source read. Attempting to use a NULL capability
  as access authority still faults, and all architectural destination-register
  restrictions remain in force.

**Direct NULL LOAD — encoding approved for the next build:**

The programmer must be able to discard destination capability authority
without allocating a dedicated NULL C-list row in every abstraction.
The intended source spelling is `LOAD CRd, NULL`: load the all-zero NULL GT
directly, read no C-list row and discard the destination's old cached authority.
This is a LOAD extension, not a new opcode or a new GT format.

The approved operand is **bits [14:0] = `0x4000`**: subtract=1,
magnitude=0, index=DR0 (the former redundant “negative zero” form).
Opcode [31:27] remains 0; condition [26:23] and destination [22:19] retain
their meanings. Source [18:15] is ignored; the assembler emits it as zero.
For example, unconditional `LOAD CR1, NULL` is `0x07084000`.
This deliberately repurposes the old raw negative-zero alias; it is not a
second way to fetch row zero. Ordinary `#0` and `#-0` assemble to operand
zero and retain row-zero/SELF behavior. SAVE is unchanged.

On a true condition, clear the destination descriptor, its cached authority
and M bit, and its existing Thread home. No source CR, C-list or Namespace
target is read or resolved. This ordinary programmer form permits CR0–CR11
except machine-owned CR6; it must not clear CR12–CR15. False conditions produce
no clear or destination fault; independent instruction-fetch faults remain.
Flags and DRs are unchanged. A NULL GT does not require a new type encoding.

Assembler, simulator and FPGA-source support belong to the next build.
Unit/integration simulation, generated RTL, synthesis/timing and physical
acceptance are separate evidence; approval does not imply the board has changed.

Discard is local to the destination register. It neither destroys the object
nor revokes other copies of the GT, changes Namespace versions, or grants new
authority. Ordinary NULL LOAD conformance and direct-form implementation remain
to be verified separately in the simulator and hardware.

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
BFEXT, not new TPERM presets. Within Mint, only the private same-scope
single-slot update block may acquire the configured Namespace RW view.
Its approved single-site entry and continuation use ordinary **BRANCH under
unchanged CR14**, not a separately provisioned X-GT, CR9 entry capability,
CALL frame or LAMBDA frame. This corrects the earlier description of that
block as a LAMBDA; it does not change the general LAMBDA instruction contract.
Setting GT B=true, if required, is a privileged function, not a new set-B
instruction; its authority/ABI remain TBD.

**Mint cleanup clarification:** CREATE's early CR1-result discard requirement
must not be removed merely because the current LOAD implementation rejects
NULL. Use the NULL-load contract above once its required form is implemented;
do not assume a per-abstraction NULL C-list row is the solution.
`TPERM CLEAR` is a test, not an erasure operation.
Outward FINISH cleanup follows result validation so failure evidence is retained:
clear DR2–DR4 and DR6–DR15, preserving DR1's result and DR5.
The existing CALL-frame RETURN masks retain CR1 for CREATE, MakeOutform and
MakeInform, and retain none of the mask-controlled CRs for DESTROY. Architectural
preservation/reconstruction rules still apply. A local BRANCH continuation
does not consume the enclosing CALL frame or perform RETURN cleanup; a
LAMBDA-frame RETURN is not a substitute for CALL-frame capability erasure.
These are Mint usage constraints, not new instruction encodings or evidence
that the remaining Mint operation bodies are complete.

### Standard software hard fault

`HARDFAULT reason` is an approved compiler pseudo-instruction direction:
emit **one designated non-executable word** using existing INVALID_OP.
Genesis selected **`0xF7000000`** following isolated verification, not a new executable opcode.
It must remain non-executable in future ISA revisions; HALT is not a substitute.

See verification evidence and remaining gates.
Compiler emission and saved-artifact simulator attribution are enabled.
Static sites are covered by the existing compiler attestation and re-bound
to exact final bytes at approved save. The IDE asks the server to authenticate
the captured artifact/site; missing or mismatched evidence shows the raw fault.
This software integration does not establish physical FPGA acceptance.

The compiler records an exact-artifact map:
`instruction offset → reason, method, source line, explanation`.
The IDE uses captured origin and loaded artifact identity, or shows the raw
location if no matching map exists. INVALID_OP alone does not identify an
intentional site. Start with static diagnostics only: no proof/private-authority
data, register dumps, runtime message construction, reporting CALL, execution-time
network dependency or diagnostic scratch registers. IDE reason attribution may
consult the server, but unavailable verification must leave raw diagnostics and
must never prevent, delay or reverse the machine's hard fault.
Tiny LUMPs need not carry strings.
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

**No GC in Phase 1.** Mint initializes Namespace slot G (W1 bit 30) and F
(W1 bit 31) to **0** for Phase 1, preserving the limit and sequence fields.
Hardware G-bit inversion requires a system GC setting;
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
software-inclusive release. The Mint contract
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
See the format draft.
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
October 13 completeness review
with this master and the
Design Team reconciliation.
It clarifies authority and release requirements; it does **not** approve an
unresolved instruction encoding, boot replacement, watchdog mechanism, or
implementation cutover.

### Edition identification and decision status

The two October 9 review editions are different historical proposals:

* Special operations and cooperative scheduling
  proposes cooperative scheduling and withdraws the earlier IRQRETURN proposal
  within the review series.
* Split 13-bit CHANGE magnitude
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
`BOOT_PROGRAM` in hardware/boot_rom.py:
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

### Hardware configuration and remaining evidence

**Protected bootstrap configuration — selected under delegated FPGA-design
discretion:** Encode the trusted reset-ROM bounds, authorized marker instruction
address and expected boot-version pair as immutable elaboration-time parameters
in the bitstream. Do not add runtime-writable configuration registers, an unlock
sequence or an MMIO path that changes these values. Derive the marker address
from the matching ROM build rather than maintaining an unrelated hand-entered
address. Check at elaboration that the authorized marker address is aligned and
inside the designated reset ROM and that the expected version halves are within
the approved 0–510 range. Configuration changes require the corresponding
rebuilt bitstream; ordinary machine reset does not change these parameters.

Retain the existing one-shot admission, slot-2 entry binding, CR12/CR15
destinations, absence of an extra CR12.M grant, final CALL CR0 and ROM-fetch
handoff point. Immutability does not replace runtime capability, version, type
or Thread-context checks. This selects protection of bootstrap configuration,
not a new boot authority or a new rule for when the approved guard changes.
The capability-controlled watchdog word remains separately writable under its
approved contract; immutable bootstrap parameters do not make it read-only.

The previous generic “protected configuration interface” approval blocker is
resolved by this engineering selection. Exact ROM placement, parameter values
and wiring still need implementation verification, not guessed addresses.
The fixed ungated timing-source direction is selected above; actual frequency,
counter implementation, accepted-write completion bound and exact-build evidence
remain outstanding. Watchdog MMIO address integration and provisioning must
remain explicit; software capability-distribution mechanics are not a bitstream
approval gate. Do not mistake these remaining evidence/integration needs for
new permission to implement, build or flash.

The `THREAD_CONTEXT` (`0x1D`),
`THREAD_PERMISSIONS` (`0x1E`) and `WATCHDOG` (`0x1F`) fault-code assignments
are approved, not open allocation decisions; additional trigger details and
implementation evidence remain separate.
Watchdog memory-backed capture authority is also settled: use the validated
Thread-save path, without an unrestricted RAM-write bypass. Its implementation
and verification remain outstanding, not a new authority decision.

<a id="approved-call-encodings"></a>

**Indexed C-list CALL encoding — Genesis approved for Phase 1:** Use one
32-bit word, implicit CR6, and the following fields:

| Bits | Meaning |
|---|---|
| 31:27 | CALL opcode 2 |
| 26:23 | Condition |
| 22:19 | Row-index DR selector |
| 18 | Indexed mode = 1 |
| 17:14 | Method-index DR selector |
| 13 | Row subtract flag |
| 12 | Method subtract flag |
| 11:5 | Method immediate magnitude, 0–127 |
| 4:0 | Row immediate magnitude, 0–31 |

Compute row and runtime method selector independently as the selected DR value
plus/minus its immediate magnitude. DR0 supports immediate-only indexing.
Latch both DR inputs before CALL changes registers; arithmetic must not wrap
or truncate. Retain bounds, mLoad and CALL authority/entry checks.
Bit 18 distinguishes this form from direct-immediate CALL, which retains target CR at
[22:19], required-zero [18:15] and immediate method selector at [14:0].
The old indexed A=0/B=6 encoding is not valid under this new layout; no silent
reinterpretation, migration or compatibility mode is authorized.

**Direct CALL runtime-method extension — approved for Phase 1:** Opcode 2
at [31:27], condition [26:23], target CR [22:19], mode tag `001` at [18:16],
method-index DR [15:12], subtract flag bit 11 and unsigned immediate magnitude
[10:0] (0–2047). Compute the runtime method selector as DR plus/minus magnitude;
any DR0–DR15 may be selected. Capture the target GT and DR input before CALL
changes register state. Retain checked non-wrapping arithmetic, method bounds
and CALL validation. The immediate is sign-and-magnitude, not two's complement.

The three forms are distinct: indexed C-list has bit 18=1; direct runtime has
[18:16]=001; direct-immediate retains [18:15]=0000 and its 15-bit selector.
The old indexed A=0/B=6 tag is 011 and remains invalid. See the
approved encoding record.
The direct-CALL runtime-method encoding gap is now resolved. Never use
multiword instruction proposals.
Approval does not claim implementation or simulator/RTL/physical conformance.
GT-layout completeness is a separate track; this amendment does not select
or alter a Golden Token bit layout.

## BFEXT/BFINS: bitfield contract

**Normative correction — 2026-10-04.** This supersedes the repeated baseline
bitfield descriptions below. Assembly syntax is `BFEXT DRd, DRs, #lsb, #width`
and `BFINS DRd, DRs, #lsb, #width`, preserving the existing assembler syntax.
Immediate bits 4:0 encode width directly (1–31); bits 9:5 encode lsb (0–31).
Zero width and lsb + width > 32 fault with BOUNDS, without changing registers
or condition flags. Assemblers reject out-of-range operands before masking.
The subsequent Phase 1 runtime-position extension below assigns bits 14:10;
the former zero-field interpretation is superseded for that extension.

**Runtime position indexing — approved for Phase 1:** Keep the source and
destination DR fields unchanged and use this single-word operand layout:

| Bits | Meaning |
|---|---|
| 14 | Subtract flag: 0 adds, 1 subtracts |
| 13:10 | Position-index DR0–DR15 |
| 9:5 | Unsigned position magnitude, 0–31 |
| 4:0 | Width, 1–31; zero remains invalid |

```text
position = unsigned32(DR[index]) + (S ? -magnitude : magnitude)
```

DR0 with addition preserves the existing immediate-position encodings.
Compute without wrapping or truncation. Width zero, a position outside 0–31,
or position + width > 32 faults with BOUNDS, without changing registers or
flags. Capture all inputs before any destination write, including overlapping
source, destination and index registers; BFINS retains its pre-write destination
bits outside the inserted field. No prefix or extension word is introduced.
This approval selects the format, not implementation or hardware conformance.

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
remains separate and reports `THREAD_PERMISSIONS` (`0x1E`). This fault mapping
does not change validation order or select precedence when multiple checks fail.

**Runtime C-List/CR restoration checks — approved:** No full scan of the incoming
C-List is required before Thread activation. Validate its structure and the
authority needed to resume execution; mLoad performs the runtime capability
checks. CHANGE must use mLoad to check each GT as it is loaded into CRn.
Other C-List entries are checked when loaded/used, not by an eager scan of
every occupied row. This is not permission to restore unchecked CR-held GTs or
skip applicable mLoad checks. Preserve existing NULL/Abstract semantics and
the approved Thread-context versus operand-permission fault mapping.

This is distinct from validation of the executable Enter GT in a saved
continuation frame. Do not transfer that frame's E-permission requirement to
the permissionless Thread GT supplied to CHANGE.

In Phase 1, CHANGE activates the supplied Thread into CR12. SWITCH performs
outgoing Thread save, Namespace load into CR15 and incoming Thread activation
into CR12 as one instruction. CR13 is reserved and untouched; executed
CHANGE CR13 faults INVALID_OP. Earlier isolated-register/IRQ forms are historical.

### Boot exception

**Simulator implementation boundary:** General CHANGE now consumes the GT in
the register named by the existing assembler's one-operand spelling. For
software compatibility, that word repeats the register in both legacy fields
and has zero immediate; no indexed lookup is performed. Other legacy indexed
words are rejected. This is not approval of a new hardware encoding, migration
of saved binaries, or implementation of the proposed IRQ-return trigger.
The simulator checks the incoming frame, C-List geometry, matching executable
SELF and resolvable Inform entries before publishing restored context.
This simulator implementation description is not a requirement for a complete
hardware C-List pre-scan; the approved runtime mLoad rule above governs Phase 1.
Unoccupied rows and unresolved Abstract locks retain their existing meanings.
An already active Thread is not accepted as a dormant incoming context.
The isolated regression is `node simulator/test_change_one_gt.js`.

Boot uses the **back half** of the Thread transition: the incoming Thread is
loaded into CR12. There is no outgoing programmatic Thread context to suspend.
This special initialization path does not add operands to programmatic CHANGE.

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

### Indexed arithmetic implementation direction

**Engineering choice under delegated FPGA-design discretion:** Compute checked
operands at the existing instruction-acceptance boundary. CALL resolves row and
method together and latches them before changing context; data operations latch
their index at acceptance. This uses additional read multiplexers/arithmetic
rather than adding a new stalled-instruction ownership/replay phase.
It replaces the earlier preference for one sequenced shared adder, not any ISA
rule. Resource and timing measurements remain required before build acceptance.
Capture operands before destination writes, including overlapping registers;
later internal steps must not reread changed inputs.

Retain sufficient intermediate width through offset calculation, word-to-byte
scaling and address addition to detect overflow/underflow before narrowing.
Prove widths against the input ranges; do not discard carry/sign bits and then
apply bounds to the truncated value. Each instruction retains its own units,
type/permission/bounds checks and flag effects. A negative BRANCH displacement
is allowed when its final target is valid; a negative memory index is not.
Index arithmetic must not independently commit arithmetic flags.

This is implementation machinery, not a unified operand encoding or
validation policy. All approved one-word formats and observable instruction
semantics remain unchanged. Additional internal cycles do not authorize
extension words, interruptible partial retirement, or watchdog suspension.
Actual resource use, cycle counts and timing require implementation evidence;
no synthesis improvement or RTL conformance is claimed.

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

### DREAD/DWRITE common indexed operand — approved for Phase 1

DREAD and DWRITE use the same single-word operand layout as LOAD/SAVE:
bit 14 is the add/subtract flag, bits 13:4 are the unsigned magnitude 0–1023,
and bits 3:0 select DR0–DR15. The data DR and base capability CR fields remain
unchanged. The result is a word offset:

```text
word_offset = unsigned32(DR[R]) + (S ? -M : M)
```

DR0 supplies zero for immediate-only offsets; zero magnitude gives register-only
indexing. The immediate offset range is −1023 through +1023, with a separate
sign bit, not two's complement. Effective offsets may be larger through a DR,
subject to non-wrapping arithmetic and normal type, permission and bounds checks.
Do not truncate or allow a negative/overflowing result to reach memory or MMIO.
Use the common zero-magnitude canonicalization described above.

This replaces the prior bit-14 immediate-mode selector and its 14-bit
immediate-only range 0–16383. Bit 14 now means subtraction, not immediate mode.
Existing DREAD/DWRITE binaries are not assumed compatible; no automatic
rewriting, migration or legacy decode mode is authorized. The approval selects
the encoding, not implementation or simulator/RTL/physical conformance.

Immediate-only LOAD/SAVE also uses the selected compact field with DR0;
it is not an exception to the uniform rule.
Assembler, simulator and Amaranth must follow the same reconciled encoding.
This documentation correction does not itself rewrite saved programs,
Namespace contents or boot images. Existing binaries are not compatibility
requirements for the new ISA.

### Single-word indexed BRANCH — approved for Phase 1

| Bits | Width | Meaning |
|---|---:|---|
| 31:27 | 5 | BRANCH opcode 23 |
| 26:23 | 4 | Condition |
| 22:19 | 4 | Index DR0–DR15 |
| 18 | 1 | Subtract flag: 0 adds, 1 subtracts |
| 17:0 | 18 | Unsigned immediate magnitude, 0–262143 |

```text
displacement_words = unsigned32(DR[index]) + (S ? -magnitude : magnitude)
target_byte_address = address_of_this_BRANCH + 4 * displacement_words
```

DR0 supplies zero for immediate-only relative branches. The sign is separate
from the magnitude, not a two's-complement field. All 32 bits are used; no
prefix or extension word is permitted. The reference address is this BRANCH,
not the following instruction.

Perform displacement and target-address arithmetic without wrapping or
truncation. A negative displacement is valid for a backward branch; it is not
by itself an invalid negative memory index. The resulting target must satisfy
the existing authorized executable-range and instruction-target checks before
control transfers. Preserve the ordinary condition semantics.

This replaces the former zero register fields and signed 15-bit displacement.
Existing binaries must not be silently reinterpreted; no automatic rewriting,
migration or compatibility mode is authorized. Encoding approval is not
assembler, simulator, RTL or exact-build physical conformance.

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

<a id="switch-isolated-register-load"></a>
<a id="switch-isolated-register-load-and-namespace-handoff"></a>

## SWITCH: combined Namespace and Thread handoff

**Approved Phase 1 semantics:** CHANGE is THREADSAVE → THREADLOAD. SWITCH is
the same halves with LOAD NAMESPACE(CR15) inserted between them. Ordinary CHANGE
leaves CR15 unchanged; CR13 is NULL and never touched. The earlier blanket
CR12–CR14 isolated-LOAD qualification is not reaffirmed by this approval.
The CR15 handoff below retains ordinary admission checks; this does not
claim simulator or RTL conformance, rewrite saved programs, regenerate boot
images, or approve hardware. See also SWITCH lifecycle.

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

**Phase 1.1 reconciliation — approved:** SWITCH has fixed destinations CR15
and CR12. Bits 22:19 must be zero; they do not select a destination register.
A nonzero field, including the former explicit-destination value 15, is
noncanonical. The source selector must name CR0–CR11. Malformed encodings
and prohibited source selectors fault with `INVALID_OP` when subject to the
applicable encoding and operand checks.

An otherwise well-formed, condition-true SWITCH whose latched CR15.M is clear
faults with `PERM_L`. No additional CR12.M grant is required. The source
requires explicit L permission; source M does not supply it, including for
CR6. Source capability, bounds, generation, integrity and Namespace-type
admission checks must succeed before outgoing Thread save or installation
of either incoming context begins.

After admission, the save → Namespace load → entry-Thread activation sequence
above applies, with its fixed slot-2 selection and mandatory entry validation.
**Any failure is a hard fault.** Once outgoing-save writes have begun, no
rollback is promised. Do not retry the instruction, substitute a target,
silently repair state, or continue executing a partially transitioned context.
A failed handoff must not execute the target Thread. CR13 remains untouched.

A condition-false SWITCH skips operand checks and instruction effects,
including handoff and M consumption. This does not waive independent fetch
or encoding faults. This reconciliation does not settle the remaining
malformed-encoding/predication oracle gaps or assign new multi-fault precedence.

**Namespace responsibility is directional:** Before SWITCH's Namespace-load
midpoint, the initial Namespace is at fault. From the midpoint onward, the
target Namespace is at fault. A faulting-CR lookup does not choose between
the two Namespaces. Retain the faulting capability as fault evidence.
**Hardware never changes version numbers.** Authorized software management
performs version-based blacklisting; an already-stale GT does not cause another
slot-version change.

### Namespace fault recovery

**Phase 1.1 recovery contract — approved:**

- A fault reboots only the responsible Namespace through its trusted boot
  sequence. Do not save the faulted Thread as a resumable continuation.
  No M-bit grant from the faulted program is required. Retain first-fault
  evidence; recovery is not a successful SWITCH or a retry.
- If that reboot itself faults before completing, restart **first Genesis**.
  This is a double error: a fault during recovery, not two unrelated faults.
- Reboot completes when the final boot `CALL CR0` succeeds. Reaching or issuing
  the CALL is insufficient. A fault in that CALL is still a recovery fault;
  a fault after its success starts a new Namespace-local recovery.
- First Genesis is the original power-on boot context, fixed by the machine's
  boot configuration—not the most recently active Namespace.
- Preserve applicable boot validation and the existing write-completion
  safeguards: outstanding accepted writes must complete before recovery uses
  memory. No rollback, unaccepted instruction writes or unrestricted recovery
  write bypass is authorized.

This replaces the older Boot Thread → purgatory and save-first recovery
directions. Ordinary CHANGE/SWITCH outgoing saves remain unchanged. Genesis
remains the default for unfinished or unspecified behavior.
These are architectural rules, not a claim of simulator, RTL or physical
conformance, nor authorization to build or program hardware.

