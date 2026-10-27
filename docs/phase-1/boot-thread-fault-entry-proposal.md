# Boot.Thread fault entry — FPGA approval proposal

**Approved contract:** [consolidated contract and RTL change map](boot-fault-rtl-contract.md),
approved by the user on 2026-10-27.
Use that document for sequencing, shared SWITCH reuse, explicit CR15 loading
and Master ISA reconciliation. This file retains examples and review history;
where it differs, the approved consolidated contract governs. Approval requests
below describe the prior review, not outstanding contract decisions. Exact Boot
bindings, memory-failure detection and cross-root reference loading remain
engineering prerequisites to RTL implementation. No hardware operations are
authorized by this approval.

## Current Phase 1 decision — saved Thread context

**Required first action:** immediately on fault, microcode stashes the event
directly into Boot.Thread's existing DR/CR homes. No intermediate registers,
scratch event bank or separate dump object. If this Boot stash fails, enter
an indefinite catastrophic-recovery loop flashing an LED.

**Required ordering: prime Boot.Thread first, then attempt the faulting
Thread save, then enter the already-primed Boot.Thread without CHANGE save.**
Priming prepares the destination context; it must not destroy the original
live state before the save attempt. Boot readiness cannot depend on that
attempt succeeding.

**Current recovery policy:** treat the fault/save/handoff cases as catastrophic
recovery: remember the event, then restore service. Do not diagnose the old
context as a prerequisite to recovery. This supersedes diagnostic-first
dispositions in the earlier review matrix, not capability enforcement.

Useful service restoration is a programmer task, outside this FPGA mechanism.
Its successful endpoint is entry into the configured Boot.Thread with the
stashed event, not proof of an application transaction. Retain original and secondary
fault facts and mark missing/incomplete context honestly. No separate dump,
forensic reconstruction, IDE response or MTBF calculation gates recovery.
The exact safe entry/commit sequence still needs implementation definition.
Failed Boot stash means the indefinite LED-flashing catastrophic loop, not
another stash attempt, alternate target or falsely claimed successful entry.

**The separate dump design below is superseded.** Phase 1 uses the saved
Thread context as retained evidence. Do not require Boot.Thread to inspect it
before restoring service.

- Microcode first primes Boot.Thread's destination DR/CR context and entry
  state, preserving the original live registers and Namespace until saving
  has been attempted. Initially DR3=0 and DR5=0.
- Only then attempt the faulting Thread's protected context save. Do not
  introduce a second 96-word diagnostic object or duplicate fault register
  dump. Finalize Boot.Thread's save-status fields after the attempt.
- Enter the already-primed Boot.Thread in Boot Namespace. This handoff
  bypasses CHANGE's outgoing save; it must not save the same context again.
- Remember the faulting Namespace before replacing live CR15. Existing
  Thread homes must not be assumed to contain CR15 or every fault fact:
  the exact minimal retained fault/Namespace information and its placement
  still require definition.
- Any later inspection uses explicitly approved authority. A saved context
  is not permission to resume the denied instruction.
- **Agreed references:** microcode primes Boot.Thread with both the existing
  GT of the Thread executing at the fault and its existing Namespace capability.
  Preserve those references rather than minting replacements or introducing
  a separate dump capability. Pass them together; do not resolve the original
  Thread's slot against Boot.
  Boot.Thread's own CR12 remains its active Thread identity, distinct from
  the supplied reference to the original Thread.
- A fault blocking save or CHANGE is remembered as part of catastrophic
  recovery, not a reason to diagnose the past before restoring service.
  Do not retry the failed save or claim a partial save is complete.
  The matrix remains a failure-injection checklist, not separate diagnostic
  workflows. Exact safe entry after incomplete saving still requires definition.
- Preserve the original fault history, OFFLINE decisions and normal Mint/
  Amoeba template-based new-Thread initialization requirements.

The user's PP250 experience is the rationale for expecting such blocking
Thread hard faults to be few and readily diagnosed. This is an engineering
expectation, not measured FPGA evidence or permission to omit failure tests.

## Active register proposal — saved-context handoff

**Proposed assignments for approval, not implemented.** The existing Thread
and Namespace references are agreed inputs; their placement below is proposed.
These tables replace the separate-dump register table in the historical draft.

### Capability registers

| Register | Value at Boot.Thread handler entry | Source and meaning |
| --- | --- | --- |
| CR0 | Configured fault-handler E capability | Explicitly prepared Boot Namespace binding; not a replacement normal-boot application selection. |
| CR1 | Faulting Thread's existing GT/capability | Capture from original CR12 before priming. “Faulting Thread” means the Thread executing when the Abstraction fault occurred, not necessarily a defective Thread. Identifies the saved context in the Namespace supplied in CR2. No minting, refresh or conversion to a generic R capability. |
| CR2 | Existing faulting Namespace capability | Capture from original CR15 before changing the live root. Retains the Namespace association of CR1. |
| CR3–CR4 | NULL triples | All three words zero. |
| CR5 | Boot.Thread heap capability | Derive through the existing validated Thread geometry; no access to protected context or stack is added. |
| CR6 | Fault handler's C-list capability | Establish through normal executable-entry validation against Boot Namespace. |
| CR7–CR11 | NULL triples | No unrelated application authority survives priming. |
| CR12 | Boot.Thread capability | Active Thread identity, distinct from CR1. |
| CR13 | Reserved, untouched | No write, including a NULL write; preserve the Master ISA reservation. |
| CR14 | Executing fault-handler capability | Establish actual handler identity and executable bounds. |
| CR15 | Boot Namespace capability | Active Namespace/root, distinct from the faulting Namespace retained in CR2. |

CR1 and CR2 are a pair: do not interpret CR1's slot against live CR15.
Preserving the existing GT does not make a stale capability valid, expand
permissions, or authorize unrestricted access to protected Thread homes.
Any later inspection operation must respect this pair and existing protection;
it is not a prerequisite to service restoration. Capture existing references before priming; do not
manufacture fresh caches from Boot's slot table.

### Data registers

Propose carrying only the fault facts needed in addition to the saved context.
There is no separate-dump pointer, completion marker or hardware incident
sequence in this revised table.

| Register | Proposed value |
| --- | --- |
| DR0 | Architectural zero; never writable. |
| DR1 | Original fault code, zero-extended. |
| DR2 | Original faulting instruction byte address; use the latched issuer address for delayed faults. |
| DR3 | Protected Thread-save outcome: 0 = not completed/no complete save established; 1 = complete; 2 = failed or interrupted and possibly partial. |
| DR4 | Original faulting instruction word. |
| DR5 | Secondary save-failure code, zero when none. Does not replace DR1. |
| DR6–DR15 | Zero. |

Set DR3=1 only after the entire defined protected save completes. Never
interpret DR3=0 or 2 as a valid resumable context. All outcomes follow the
service-restoration policy without a diagnostic gate; safe fault entry after
failed saving still needs an exact mechanism. If handler entry itself fails, do not imply
that these registers were successfully delivered.

### Register examples — original fault versus save failure

The user agreed this clarification: **CR1 identifies the Faulting Thread**,
copied from its original CR12. The term identifies the execution context
of the Abstraction fault; it does not imply that the Thread is defective.
**DR5 is a numeric machine fault code, not a comment.** Zero means no
secondary save failure; a nonzero code describes the actual save failure
without overwriting the original fault in DR1.

These examples illustrate the proposed handoff, not completed FPGA tests.
The original BOUNDS `0x08` matches the retained Mallory C-list denial;
successful saving or a secondary stack failure is not established by that
historical evidence.

#### Example 1 — Mallory faults; Thread save succeeds

| Register | Value and meaning |
| --- | --- |
| CR1 | Faulting Thread's existing capability. |
| CR2 | Its existing Namespace capability. |
| DR1 | BOUNDS `0x08`: Mallory's original fault. |
| DR3 | `1`: protected Thread context saved completely. |
| DR5 | `0`: no secondary save failure. |

#### Example 2 — Mallory faults; Thread save also fails

Suppose the protected save detects an invalid stack position. This is an
illustrative second error, not an observed result.

| Register | Value and meaning |
| --- | --- |
| CR1 | Faulting Thread's existing capability. |
| CR2 | Its existing Namespace capability. |
| DR1 | BOUNDS `0x08`: still Mallory's original fault. |
| DR3 | `2`: save failed; context may be partial. |
| DR5 | Actual machine fault code for the invalid stack condition, as produced by the implemented save check. No new numeric code is assigned here. |

This distinguishes “Mallory attempted an invalid access” from “the Thread
context could not be saved correctly.” Whether Boot.Thread can safely be
entered after the second failure remains under review; these values do not
assert that the handoff succeeded or authorize a retry.

### Entry ordering and remaining review

The concrete sequence below is the proposal for approval. Diagnostic inspection
is not a prerequisite. Condition flags start at zero; handler entry is offset
zero in the exact prepared executable, with a fresh canonical poison root
and no return continuation into the failed application.
Boot.Thread is primed before the outgoing save attempt, not after it.
Neither these tables nor the saved-context reference authorize resuming the
denied instruction, changing Namespace versions or retrying the application.

## Proposed minimal service-restoration sequence

**Scope:** direct Boot stash, one outgoing save attempt and Boot entry, or
the catastrophic LED loop. Useful service and application recovery are
programmer responsibilities, not gates for this FPGA mechanism.
The same sequence handles complete, incomplete and failed saves; those
outcomes change the remembered status, not the choice of recovery program.
This is a proposal for approval, not RTL implementation or physical evidence.

### Prepared inputs

The approved image supplies exact Boot Namespace, Boot.Thread and recovery
handler bindings. Application capabilities are programmer-supplied, not
selected by microcode. The handler starts at
program-relative word offset **0**, not an address or executable selected
from the damaged context. No “latest revision” lookup occurs at recovery.

Boot's stash destination must be established by the admitted machine
configuration before application execution. The event is written directly
from its existing source signals/registers while execution is held; do not
copy it into newly introduced intermediate registers. The actual source
stability and bus handshake must be proven by RTL tests.

### FPGA mechanism

| Step | Required action | Completion or failure |
| --- | --- | --- |
| 1. Stash directly into Boot FIRST | On fault, hold application execution and directly write the event into Boot.Thread homes: original CR12 GT to CR1, original CR15 GT to CR2, and original fault facts to the proposed DR homes, initially DR3=0 and DR5=0. | No intermediate register store and no outgoing save first. Any failed Boot stash enters the indefinite catastrophic LED loop. Bus serialization must preserve source stability and exclude conflicting writes; it is not an earlier diagnostic/capture stage. |
| 2. Finish Boot priming | Prepare the configured entry/root state and remaining destination register values under normal authority checks. Keep original live context intact until its save attempt. | No live root change or application execution yet. Failure to complete Boot priming enters the catastrophic LED loop; no substitute GT or silent refresh. |
| 3. Attempt the protected Thread save once | Save under the original Thread/Namespace using existing homes and frame encoding; do not run CHANGE. | Finalize Boot DR3/DR5 directly: complete = 1/0; failed = 2/actual secondary code. No retry or second priming pass. If this Boot status write fails, use the catastrophic LED loop. |
| 4. Enter Boot | Activate the primed context and publish Boot Namespace/root, Boot.Thread ownership and configured handler entry as one execution boundary. | No second CHANGE save or IDE acknowledgement. Successful Boot entry completes this FPGA mechanism. Failed entry must not execute a partially primed context. |

**Catastrophic loop:** remain indefinitely in the machine-controlled failure
loop with an LED flashing. Do not depend on functioning Boot memory, a Church
program, UART, Ethernet or the IDE to sustain the indication. No repeated
stash, program restart or recovery target selection is implied by “loop.”
The board LED assignment and blink timing must be fixed for the selected
build; reset/power removal is external to this non-terminating path.

Primed destination storage and the outgoing save region must be distinct and
protected from each other's writes. Use Boot.Thread's normal destination
context/entry machinery, not a duplicate fault dump. If the faulting context
is Boot.Thread itself or overlaps that destination, this sequence must not
overwrite the source to pretend it saved it: if the direct stash cannot be
completed safely, take the catastrophic LED loop.
The detailed staging implementation must preserve these ordering invariants.

**Save layout, not a new format:** for Thread body size L words, DR homes
are body words 1–16, protected STO/indicator is word 17, and CR0–CR11 GT
homes are words L−12 through L−1, as defined by `shared/thread_design.json`.
The saved executable/NIA use the existing two-word CHURCH frame; there is
no extra executable-identity word. Derive stack limits from the actual header.
For this fault capture, the saved relative NIA names the faulting instruction,
not its successor; it is evidence and is never selected for service restart.
Original CR12/CR15 GTs are stashed directly into Boot.Thread's CR1/CR2 homes
because they are not among those twelve outgoing serialized CR homes.

DR3=0 is reserved for no complete save being established before an attempt
can be made; it is not success. A rejected save setup uses DR3=2 when an
actual save error is available. Do not invent a secondary numeric fault code.
The normal CHANGE path and its continuation semantics remain unchanged.

Boot's stack uses the existing poison-root encoding and geometry, not a
second stack convention. Reinitializing this control context does not imply
that the faulting Thread was defective or that the whole Namespace was reset.
Do not recursively enter fault priming when the stash/priming mechanism fails;
take the catastrophic LED loop. Application behavior after successful Boot
entry is outside this FPGA proposal.

### Programmer responsibilities — outside this FPGA mechanism

The following software outline is context only, not a required implementation
or acceptance gate for this fault-entry mechanism. Useful service is the
programmer's responsibility. Phase 1's separately agreed Mint/template and
reporting goals remain separate work; they must not delay defining this path.

1. **Remember the event:** preserve the CR1/CR2 association, DR1–DR5, selected
   revision/session attribution and available exposure checkpoint through the
   approved local journal path. Mark absent information explicitly. No saved-
   context inspection, forensic analysis or MTBF calculation is required.
   Reporting to the IDE is asynchronous; network delivery is not a prerequisite.
2. **Select the configured clean transaction:** use the already selected,
   eligible template and application revision. Respect OFFLINE and caller
   stop-polling decisions. Restoring service does not mean executing the
   unchanged Mallory attack again.
3. **Mint a fresh Thread:** Mint primes it with Amoeba; Amoeba initializes
   the selected application transaction from its template and admitted inputs.
   Do not copy a damaged continuation or mutable old stack into the new Thread.
4. **Hand over through normal validated execution:** use the approved
   Thread/Namespace mechanisms appropriate to the prepared target. Do not
   resolve foreign Thread GTs against Boot's Namespace or assume that CHANGE
   alone changes Namespace. The exact cross-Namespace return-to-service
   sequence must be bound to the selected templates before RTL integration.
5. **Confirm useful service:** completion of the template's defined useful
   transaction is restoration evidence. A handler entry, successful Mint,
   running badge or lack of another fault is not sufficient.

Local retention failure must be reported as an evidence gap, not trigger a
diagnostic loop or falsely claim the incident was durably saved. It must not
be converted into a requirement to wait for the IDE. The persistence mechanism
and its reset/power-loss guarantees remain part of the journal contract.
Old contexts must not be silently freed or reused while referenced as evidence;
their eventual release follows the approved lifecycle, not a new hardware
garbage collector.

A fresh Thread does not undo prior data writes or external effects. Each
transaction template must declare a safe restart point and admitted persistent
state; do not replay irreversible operations merely to demonstrate recovery.
If an eligible template cannot initialize or the recovery path cannot run,
service is unavailable. That result is not permission to bypass authority.

### Acceptance for this sequence

- Prove Boot priming completes before any outgoing Thread-save write.
  Prove the first event storage is Boot.Thread itself, with no intermediate
  event registers or scratch snapshot bank. Exercise source stability during
  memory stalls and delayed-instruction faults.
  Check the original live context remains unchanged by priming and that a
  save error cannot overwrite or invalidate the prepared Boot context.
  Only outcome fields are finalized after saving; no second priming pass.
- Inject the same original fault with successful save, rejected save setup
  and interrupted save. Where Boot inputs remain valid, all reach the same
  configured handler with truthful DR3/DR5.
- Assert original CR12/CR15 survive as CR1/CR2, live CR12/CR15 identify Boot,
  and no second outgoing save occurs. Check every register assignment.
- Use distinct Boot/faulting Namespace roots with colliding slot numbers;
  prove validation and later service handoff use the correct root.
- Verify original Thread homes use canonical geometry, save failure never
  publishes success, and ordinary CHANGE behavior is unchanged.
- Inject Boot validation/priming and nested recovery failures: no partial
  handler execution, recursive restart, substitute GT or false service claim.
- Inject each Boot-stash write failure and failure to complete: prove entry
  into the indefinite catastrophic loop, continuous LED flashing, no dependence
  on a running application/IDE and no repeated stash or application execution.
- Verify successful Boot entry with UART/IDE disconnected. Useful application
  service is not an acceptance gate for this FPGA mechanism.

**Approval boundary:** approve this sequence and active register table before
implementation. Exact prepared Boot identities, direct-store source stability,
bus failure/timeout detection and LED mapping/timing must be resolved for the
chosen build. Journal and application service design are not prerequisites
for this mechanism. None may be silently inferred
from the withdrawn separate-dump design below.

The 96-word layout, COMPLETE-only entry rule, diagnostic-object authority,
FAULT_RELEASE interface, single-slot capture policy and watchdog selection
below are withdrawn from the active Phase 1 proposal. They are retained only
to explain the earlier review, not as implementation requirements.
No RTL change, hardware programming or activation is authorized.

## Superseded draft — historical review only

**Everything below describes the superseded separate-dump proposal.**
Its references to “approval requested” and register assignments are historical,
not a current request to approve that design.

**Status: proposed for design approval, not implemented.** The user has agreed
that microcode primes Boot.Thread's DRs/CRs, bypassing CHANGE's outgoing save
under the KISS rule. The concrete assignments below are new proposals.
Approval of this document is not permission to flash, activate or publish.

**Register-review correction:** Boot.Thread executes in the **Boot Namespace**.
The faulting Namespace must be remembered independently before CR15 is replaced.
This correction is agreed; the rest of the proposed register table remains
under review, including DR3 and the complete-dump-only policy.

## 1. Scope and observed implementation

Implement one dedicated fault-entry state machine, not a new executable
instruction and not a mode of ordinary CHANGE.

Source observations, not physical acceptance:

- `hardware/core.py` latches fault instruction/stage; its fault GT and CR14
  telemetry outputs are currently zero placeholders. They cannot supply the
  proposed full dump unchanged.
- `FaultRecoveryControl` in `hardware/wukong_top.py` currently holds on a fault
  pending snapshot drainage and bridge-authorized reboot/skip. That is not
  the local standalone handoff proposed here.
- `hardware/boot_thread_activation.py` is incoming-only reset activation.
  It does not write CR13/CR14; it is not a complete fault-entry implementation.
- `hardware/change.py` implements ordinary save/restore. Its save path must
  not run during this handoff.
- `shared/thread_design.json` defines Thread homes and protected geometry.
  Use that geometry, not a second Thread layout.

This proposal applies to validated, resident Phase 1 Namespace contexts.
Fault entry activates the configured Boot Namespace, which need not be the
Namespace in which the fault occurred. This dedicated transition is not a
general-purpose SWITCH instruction or approval of broader networking tests.
Faults during reset admission, installation hold, an uncommitted context
transition, or Boot.Thread execution remain terminal. No speculative attempt
to reconstruct a partially switched context is permitted.

## 2. Explicit configured inputs

During separately authorized image preparation, select and retain:

1. Exact Boot.Thread binding and geometry within the Boot Namespace.
2. Exact fault-handler executable binding in the Boot Namespace and
   program-relative entry offset.
3. One resident 96-word diagnostic data object, with a read-only capability
   explicitly granted to the handler and machine-only write ownership.
4. The trusted Boot Namespace authority and root used for destination
   validation and CR15 priming. Capture the faulting Namespace's original
   CR15 separately as incident evidence, not as the destination root.

The configuration is machine-protected after admission. Revalidate live
slot versions, type, seal, bounds and entry identity on every use; do not
refresh GTs. Hold Namespace mutation and conflicting memory writers from
validation through commit, excluding a validation/use race. Resolve the
handler, Boot.Thread and diagnostic-object bindings against the configured
Boot Namespace, never by applying their slot numbers to the faulting root.
The diagnostic object belongs to the Boot Namespace.

The new machine-write diagnostic object is an explicit authority addition
requiring approval: it is not inferred from a user-supplied address. Its
allocation must not overlap any Thread, executable or unrelated object.
Only the exact admitted region is writable by this fault mechanism.
The handler's R-only grant does not authorize writes or inspection of other
Threads. Unrelated applications must not receive this grant.

Addresses and tokens are exact image inputs, not hardcoded NS slot numbers.
No fallback handler, inferred catalog selection or additional M authority.

## 3. Diagnostic record — proposed 96-word format

All offsets are 32-bit words from the admitted diagnostic object base.

| Words | Value |
| --- | --- |
| 0 | Format marker `0x464C5431` (FLT1). |
| 1 | State: 0 EMPTY, 1 CAPTURED, 2 COMPLETE, 3 FAILED. COMPLETE is written last. |
| 2 | Nonzero incident sequence within the admitted execution session. Never wrap; exhaustion is terminal. |
| 3 | Original machine fault code, zero-extended. |
| 4 | Original fault stage, zero-extended. |
| 5 | Faulting instruction word. |
| 6 | Faulting instruction byte address, from the latched issuer for delayed faults. |
| 7 | Original architectural condition flags in bits 3:0; remaining bits zero. |
| 8 | Original protected STO/indicator word. |
| 9 | Secondary failure stage: 0 none, 1 dump, 2 validation, 3 priming, 4 nested. |
| 10 | Secondary machine fault code; zero when no secondary failure. |
| 11 | Validity mask: bit 0 original metadata, bit 1 DR bank, bit 2 CR bank, bit 3 STO; other bits zero. |
| 12–15 | Reserved, zero. |
| 16–31 | DR0–DR15, including architectural DR0=0. |
| 32–79 | CR0–CR15, three words each: GT, location, cached authority/limit in the current architectural encoding. |
| 80–95 | Reserved, zero. |

**Remember the faulting Namespace:** words **77–79** are the original
CR15 triple (GT, location, cached authority/limit), captured before any root
or register changes. Retain it with the original CR12 and CR14 triples so
Thread and executable identities are interpreted in the correct Namespace.
A slot number or GT alone is not sufficient cross-Namespace identity.
The dump contains evidence, not a live grant of the captured authority.
Software must retain the incident's exact image/session association and must
not reinterpret it using Boot's slots or silently refresh old GTs.

Latch original metadata and both register banks into machine-private capture
storage before any priming writes. Publish the record from that latch, not
from registers as they are being overwritten. This is a diagnostic save:
no outgoing Thread homes, stack or return frame are written.

On a dump write failure, stop writing that object; retain original and secondary
evidence in the private latch and go terminal. Do not attempt to repair the
record or mark it complete. A partial record is never a continuation.
The private latch remains available through the privileged diagnostic path;
that readout must be implemented and tested, not assumed from existing telemetry.

The record does not itself contain trustworthy operating exposure or a
globally unique boot identifier. Software/transport must attach the admitted
session and exact build/image identity, plus independently measured exposure.
Do not derive MTBF from incident sequence or reporting arrival times.

## 4. Exact live register assignments on successful entry

Validate and stage all values before publishing any live register.

| Register/state | Proposed value |
| --- | --- |
| DR0 | Architectural zero; never writable. |
| DR1 | Original fault code (record word 3). |
| DR2 | Incident sequence (word 2). |
| DR3 | COMPLETE = 2. No partial-dump execution in this first implementation. |
| DR4–DR15 | Zero. |
| CR0 | Validated E capability for the configured fault handler. |
| CR1 | Validated R-only capability for the 96-word diagnostic object. |
| CR2–CR4 | NULL triple, all three words zero. |
| CR5 | Boot.Thread heap capability derived through the existing checked geometry rule; excludes protected context and stack. No expanded permissions. |
| CR6 | Handler's validated C-list capability, derived exactly as for normal executable entry. |
| CR7–CR11 | NULL triples. |
| CR12 | Validated Boot.Thread capability. |
| CR13 | NULL triple, preserving the Phase 1 reservation. |
| CR14 | Validated handler executable capability, with normal executable bounds. |
| CR15 | The validated, explicitly configured **Boot Namespace** capability. The faulting Namespace remains in dump words 77–79, not in live CR15. No additional privilege is inferred. |
| Condition flags | All zero. |
| Private stack/STO | Fresh canonical poison-root state for the admitted Boot.Thread geometry, using the existing frame encoding. No saved application return address. |
| NIA | Handler code origin plus the validated configured entry offset, converted to byte address under the current ISA. |
| Execution ownership | Boot Namespace and Boot.Thread become the active root/owner at the commit boundary; outgoing context is inactive, not marked as a faulted Thread. |

The handler obtains any other management authority through its explicitly
declared C-list. No arbitrary application CR/DR survives into its live context.
No CALL frame is manufactured for returning to the failed instruction:
a top-level RETURN reaches the normal poison-root hard fault.

This is direct validated executable entry, not the three-instruction normal
boot path. Normal prepared boot CR0 homes and selected application bindings
are not rewritten. Boot.Thread's old execution continuation is intentionally
discarded only when it is inactive and designated for this fault-entry role.
Ordinary heap contents are not zeroed or represented as rolled back.

## 5. State machine and commit boundary

1. **CAPTURE:** before writing the first-incident latch, reject an occupied
   latch, active Boot.Thread or uncertain ownership to TERMINAL; retain only
   the secondary failure without overwriting the original. Otherwise accept
   the first eligible fault; block new instruction fetch and retirement.
   Latch original evidence. Suppress new requests from the
   failed instruction; do not claim rollback of already committed effects.
2. **QUIESCE:** require all accepted memory operations to complete or report
   failure. Freeze other writers. No diagnostic operation may race an earlier
   application write. An undrainable bus is terminal.
3. **CHECK_CONFIG:** validate the protected configured bindings and the dump
   region. If Boot.Thread is the current owner, a prior incident is pending,
   or context ownership is uncertain, go terminal.
4. **DUMP:** write the latched diagnostic record, zero reserved words, and
   write COMPLETE last. On failure, stop; do not retry.
5. **STAGE:** validate and buffer the Boot Namespace root, entire incoming
   register set and fresh Thread root-frame geometry, retaining the mutation
   exclusion through commit. Destination validation uses the staged Boot
   root without changing the live faulting root during validation.
6. **PRIME:** write only Boot.Thread's required root/STO state and the staged
   live registers. Keep fetch disabled for the entire sequence.
7. **COMMIT:** publish the Boot Namespace root/CR15, Boot.Thread ownership
   and handler NIA as one execution-visible transition; latch
   `fault_entry_active=1`; release fetch only when all writes completed.
8. **HANDLER:** software inspects, journals and disposes of the incident.
   Mint/Amoeba perform separately authorized template-based recovery.
9. **TERMINAL:** fetch remains disabled; preserve original and secondary
   evidence. No reboot, retry, alternate handler or version mutation.

Every wait has a build-time finite watchdog, proposed as 65,536 core cycles
per request/drain phase. Timeout is terminal secondary failure, not a retry.
Record the configured value in exact-build evidence; it is not an MTBF unit
or a scheduling quantum. This value is part of the approval request.

No CHANGE start, save, or restore request is asserted by these states.
No hardware Namespace version write occurs. A failure after partial PRIME
cannot release execution; it does not promise rollback of those writes.

## 6. Single outstanding incident and release

KISS proposal: one outstanding record, no hardware queue. Any second fault
while `fault_entry_active=1` is terminal; it cannot overwrite the first latch
or re-prime Boot.Thread. This deliberately selects a strict outcome for the
matrix's nested/busy cases instead of inventing queue recovery.

Propose one protected `FAULT_RELEASE(sequence)` management operation, not a
new ISA instruction: expose it through the existing authorized device-access
mechanism with an exact register mapping to be assigned during integration.
Only the configured Boot.Thread handler with an explicit control capability
may invoke it. It clears the pending latch only for the matching sequence,
after software durably journals the record. It does not clear OFFLINE state,
resume the failed instruction, change versions, or start another Thread.
Software must transfer to eligible work through ordinary approved mechanisms.

The control register's numeric address, authentication/binding and durable
journal implementation are **integration blockers**, not permission to use
a placeholder MMIO address. The FPGA cannot independently prove durable
journaling; that is the authorized handler's obligation.

Before release, another fault is terminal even if the handler has scheduled
other work. After release, a future incident may reuse the record; retained
history belongs in the journal, not this single capture slot.

## 7. Matrix disposition selected by this proposal

| Case | Proposed first-implementation outcome |
| --- | --- |
| Save and inspection succeed | Software disposition; continue eligible work and authorized Mint/template recovery. |
| Save succeeds; handler inspection faults | Terminal secondary fault, original record retained. |
| Save fails; some evidence readable | Terminal; privileged diagnostics may inspect the private latch. No partial-dump handler execution. |
| Save and inspection unavailable | Terminal; no fabricated evidence or recovery. |
| Boot.Thread active / another incident pending | Terminal; no overwrite or queue. |
| Boot.Thread faults | Existing purgatory/terminal semantics, no recursive priming. |
| Stale incident/reference | Handler rejects it; no FAULT_RELEASE for mismatched sequence. |
| Prior external effects uncertain | Software transaction policy decides; no implied rollback. |
| Network unavailable | Local durable journal owns retention; reporting can occur later. No network acknowledgement gates initial fault entry. |
| Mint/template initialization fails | Hard fault under the approved contract; no fallback template or continuation retry. |

Power loss, FPGA reconfiguration and manual reset are separate retention
boundaries. This volatile capture slot alone does not survive them. Do not
authorize reset from a report-delivery acknowledgement or claim durable
history until the journal contract is implemented.

## 8. Required verification and release evidence

- Full-core injected fault reaches the exact configured handler with every
  DR/CR/flag/NIA/root value matching section 4.
- Original instruction, issuer address and register values survive priming;
  delayed-instruction and denied-write cases retain correct attribution.
- Use distinct Boot and faulting Namespace fixtures, including colliding
  slot numbers. Prove live CR15/root become Boot while dump words 77–79 retain
  the original Namespace triple; handler, dump and Thread validation must
  never consult the wrong root. Also test a fault already within Boot.
- Assert zero outgoing CHANGE-save requests and zero outgoing Thread-home
  writes; ordinary CHANGE regression tests retain their save behavior.
- Inject dump, validation and priming errors at each boundary; prove no
  handler fetch before complete commit, no second save and no recursion.
- NULL, stale, forged, out-of-bounds and overlapping configured objects fail
  closed. Mutation during validation/commit is excluded.
- Nested faults, Boot.Thread faults, sequence exhaustion and timeout are
  terminal and preserve the first incident.
- Test protected release: matching/mismatched sequence, absent authority,
  replay, and no side effects on execution or Namespace versions.
- Confirm no snapshot mixes pre-fault and handler registers; update the
  existing snapshot/bridge hold integration to consume the retained latch.
- Prove installation hold still excludes this handler from executing while
  replacement/readback is in progress.
- Separately authorize exact-build UART and standalone Ethernet physical
  acceptance. No current test or installed build is claimed to implement this.

## 9. Approval requested

Approve or amend the explicit design choices: dedicated no-CHANGE-save entry;
single complete dump; register table; direct handler entry with poison root;
terminal partial/nested failures; one outstanding incident; protected release;
and the finite watchdog.

Before coding, bind the exact prepared handler/Thread/dump identities and
resolve the protected release register mapping and journal ABI. Those are
listed blockers, not hidden implementation discretion. Approval must not be
interpreted as permission to program the FPGA.
