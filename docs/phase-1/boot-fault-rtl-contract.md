# Boot fault entry — consolidated contract and RTL change map

**Status: for approval before RTL implementation.** This is the current review
document for the new fault path. It consolidates the agreed direction and
labels engineering selections still needing approval. No tests, synthesis,
programming, activation or publication are claimed or authorized by this file.

## 1. Agreed scope

Immediately on fault, microcode stashes the event directly into Boot.Thread,
with no intermediate event registers or separate dump. Prime Boot.Thread
before attempting to save the faulting Thread. Save once; whether that save
completes or fails, enter the already-primed Boot context without another save.

The transition explicitly **loads Boot Namespace into CR15**, then activates
Boot.Thread in CR12. Reuse the Namespace-load and Thread-load machinery used
by SWITCH rather than adding a parallel activation engine. This is not
execution of an ordinary SWITCH instruction.

If the Boot stash fails, loop indefinitely flashing an LED. Do not repeatedly
stash, restart application code, select an alternate target or wait for the IDE.
Useful-service restoration is the programmer's responsibility, outside this
FPGA mechanism. The broader Phase 1 Mint/template and Ethernet goals remain.

## 2. Sequence and write boundaries

Boot Namespace, its slot-2 Boot.Thread and its configured entry must be
established in trusted machine configuration before application execution.
Do not discover the destination through the faulting application's C-list.

| Phase | Action | Invariant |
| --- | --- | --- |
| Direct stash | Freeze program execution. Write original Thread GT and Namespace GT directly to Boot.Thread CR1/CR2 homes; write fault facts to its DR homes. | First event storage is Boot.Thread, not scratch registers. No outgoing Thread-save write yet. |
| Finish priming | Prepare remaining Boot homes and canonical root/entry state under existing checks. | Original live context remains intact for the save. Boot stash failure takes the LED loop. |
| Save once | Validate outgoing Thread geometry and stream its context to its own existing homes/frame. | No CHANGE instruction and no intermediate fault-register dump. Failure ends the save attempt, not a retry. |
| Finalize status | Write save result directly into Boot DR3/DR5. | Failure of this Boot write is also a failed stash: LED loop. |
| LOAD NAMESPACE | Use shared Namespace-load logic to establish Boot in CR15 and all associated root state. | No outgoing save is re-entered. All destination checks remain. |
| THREADLOAD | Activate the primed Boot.Thread with the remembered original Thread/Namespace pair. | Boot is CR12/CR15; original references are CR1/CR2. Do not resolve the original Thread in Boot's slot table. |
| Enter | Release instruction fetch at the validated configured Boot handler entry. | This completes the FPGA mechanism; no service/MTBF/IDE acknowledgement gate. |

“Immediately” specifies the first recovery action and destination of the
evidence; it does not mean multiple memory words are written in one clock.
Already-accepted writes must settle before a conflicting stash write uses
the bus. Hold the original source state stable through that interval. No
new application writes or retirement are allowed; no rollback is claimed.
The existing instruction issuer/fault signals must remain stable until their
direct stores complete. If source stability cannot be achieved without an
extra event register bank, stop for design review rather than adding one.

Boot destination and outgoing save writes must not overlap. A fault already
in Boot.Thread must not overwrite its source context and claim a complete
save. Proposed conservative disposition: if safe direct stash cannot be
performed, use the same catastrophic LED loop.

## 3. Register contract proposed for approval

Boot's saved homes use the normative Thread geometry: DRn at word 1+n,
CR0–CR11 GT homes at L−12+n for Thread body size L. These homes store GT words,
not invented serialized three-word capability records.

| Register at Boot entry | Proposed value |
| --- | --- |
| CR0 | Configured handler E capability in Boot Namespace. |
| CR1 | Existing faulting Thread GT, originally in CR12; belongs to CR2's Namespace. |
| CR2 | Existing faulting Namespace capability, originally in CR15. |
| CR3–CR4 | NULL triples. |
| CR5 | Boot.Thread heap under existing checked geometry. |
| CR6 | Configured handler's C-list. |
| CR7–CR11 | NULL triples. |
| CR12 | Boot.Thread, selected through Boot Namespace slot 2. |
| CR13 | Reserved; **do not write it**, including a NULL write. |
| CR14 | Validated executing handler identity/bounds. |
| CR15 | Boot Namespace/root. |
| DR0 | Architectural zero. |
| DR1 | Original fault code. |
| DR2 | Original faulting instruction byte address, including delayed issuer attribution. |
| DR3 | Initially 0; finalize to 1 on complete save or 2 on failed/partial save. |
| DR4 | Original faulting instruction word. |
| DR5 | Initially 0; actual secondary save-failure code if present. |
| DR6–DR15 | Zero. |

Propose zero condition flags and the configured handler's word-offset-0
entry with canonical poison root, not a return frame into the failed program.
These entry choices remain part of the approval request.

**Foreign-reference load requirement:** do not route saved CR1/CR2 through a
generic Boot-root lookup. Preserve/reconstruct the Namespace capability through
the existing authorized Namespace mechanism and validate the Thread under that
original root, without GT refresh or added permissions. Incomplete or invalid
references remain evidence, not newly granted authority. The actual RTL path
for this special pair must be demonstrated before implementation acceptance.
Do not add raw cached-capability words to Thread storage to avoid this issue.

The failed Thread's saved context is evidence, never an implicit resumable
continuation. Keep the existing two-word frame format and relative NIA rules;
do not add an executable-identity field or resume the denied instruction.

## 4. Master ISA reconciliation — explicit changes to approve

The current Master ISA is not silently edited by this proposal.

| Existing rule | New contract / disposition |
| --- | --- |
| Namespace fault recovery reboots the responsible Namespace. | New path stashes into configured Boot.Thread and enters Boot Namespace, retaining responsible Namespace separately. **Replacement requires approval.** |
| Watchdog recovery refers to the Namespace-local recovery contract. | Route covered watchdog faults through this same new contract, preserving first-fault attribution and accepted-write safeguards. **Replacement requires approval.** |
| Recovery failure restarts first Genesis. | Boot-stash failure enters the indefinite LED loop; no implicit first-Genesis restart. Other failure points must have explicit outcomes. |
| Recovery completes on final boot CALL CR0 success. | Proposed endpoint is successful configured Boot handler entry using shared load machinery. This differs from the existing boot-CALL endpoint and requires approval. |
| Do not save a faulted Thread as a resumable continuation. | Preserve this restriction: the one save is evidence, not permission to resume. |
| Ordinary CHANGE saves then loads; SWITCH saves, loads Namespace, then Thread. | Unchanged. Only a machine-owned fault entry bypasses their outgoing-save phase after its own attempt. |
| CR13 is reserved and never touched. | Preserve it. Earlier proposal's “write NULL” is corrected to “do not write.” |
| Accepted writes complete before recovery uses memory; hardware never changes versions. | Preserve both rules. No unrestricted recovery write bypass or GT refresh. |

Relevant Master sections: “Execution and watchdog,” “Watchdog fault evidence
and recovery,” and “Namespace fault recovery” in `01-isa/instruction-set.md`.
On approval, update those normative passages together; do not leave two
competing active recovery contracts.

## 5. RTL change map from current source inspection

| File / existing component | Reuse and required change |
| --- | --- |
| `hardware/core.py` | Own the fault-entry control and exclusive memory/register access. Prevent current fault-reset/clear logic from destroying source state before direct stash. Add only sequencing/state control, not an intermediate event bank. Preserve issuer signals through stalls. |
| `hardware/ordinary_change.py` | Actual shared ordinary transition FSM. Reuse checked Thread geometry and incoming activation. Existing `SNAPSHOT` buffers outgoing DR/CR values; fault save must not use that event-copy approach. Stream direct save with failure termination. Expose a narrow machine-owned entry that bypasses OUT/SAVE states after the separate fault save. |
| `hardware/ordinary_change.py`, `NAMESPACE` and incoming commit phases | Explicitly reuse Namespace load into CR15 and Thread activation. The existing incoming load checks homes before the normal Namespace commit; fault integration must retain that validation discipline while treating CR1/CR2 under their original root. No partial instruction execution during publication. |
| `hardware/change.py` | Facade instantiates `OrdinaryChange`. Wire the internal fault-entry control through it; do not fake `active_thread_owned=false` to suppress saving and corrupt ownership accounting. |
| `hardware/switch.py` | Keep public SWITCH decoding, C-list lookup and CR15.M rules unchanged. Fault entry uses trusted machine configuration, not a forged ordinary SWITCH operand. Its handoff connection identifies where shared machinery can be reused. |
| `hardware/wukong_top.py`, `FaultRecoveryControl` and fetch/step gates | Current fault path holds execution for snapshot/bridge authorization and sets step-halted. Separate new local fault entry from those holds so they cannot deadlock Boot activation. Keep explicit installation hold and unrelated debug stops authoritative. |
| `hardware/wukong_top.py`, LED mux | Give catastrophic state priority over normal LED/MMIO indications. Existing `hb_ctr`/`hb_blink` runs independently; propose reuse of its one-second toggle on active-low LED[1], meaning a two-second full blink cycle. No additional blink counter unless required by implementation. |
| `shared/thread_design.json`, `hardware/thread_design.py` | Reuse existing layout; no new dump format or Thread-body field. |

The incoming pipeline already uses internal working registers. Reusing those
after Boot stash is not approval to introduce a pre-stash event copy. The
no-intermediate-register requirement applies to the fault-event stash path.
Any broader register-removal refactor requires separate agreement.

### Hardware failure signaling gap

Existing memory interfaces predominantly expose completion/valid signals;
this inspection does not establish a complete negative-acknowledgement or
bounded-timeout contract for every stash write. Before implementation, specify
how the selected on-chip memory path detects an uncompleted write. Test
injection alone must not be mistaken for deployed failure detection.
Do not silently adopt the withdrawn 65,536-cycle watchdog proposal.

For approval, propose all failures that prevent completing Boot priming or
activation also converge on the same LED loop. No recursive fault entry,
repeated memory access or alternate recovery engine. The loop continues
without application, bridge or network cooperation until external reset/power
action; existing authorization for external controls is not changed.

## 6. Isolated validation and build sequence

1. Approve the replacement rules, register table, Boot entry form and internal
   shared-FSM approach. Bind exact trusted Boot inputs and failure detection.
2. Implement direct stash and catastrophic indication, then connect one-save
   and shared Namespace/Thread activation. Keep ordinary instruction semantics.
3. Unit/full-core tests: first store is Boot; no event scratch bank; original
   live state survives until save; forced save error still reaches valid Boot;
   status-store failure loops; CR15 loads Boot before execution; no second save.
4. Cross-root tests with colliding slot numbers prove correct CR1/CR2 handling.
   Delayed issuer faults retain original address/word. Test accepted-write
   stalls, stash failure, Boot failure and CR13 write-enable remaining zero.
5. Top-level tests prove the legacy bridge/step hold cannot block local entry,
   installation hold still prevents execution, and LED flashing continues
   with UART disconnected and unavailable Boot memory. No useful-service test
   is required for this FPGA mechanism.
6. Run ordinary CHANGE/SWITCH regressions. Synthesize only after approval for
   that stage; compare resources and timing, not assumed sharing savings.
7. Retain exact input/build/test identities; obtain separate physical-test
   authorization. No existing workflow result proves this new path.

## 7. Approval requested

Approve this consolidated direction as the replacement recovery contract,
including the explicit CR15 load through shared SWITCH internals. The finite
stash-failure detection and foreign-reference capability loading are concrete
engineering items to resolve against the selected profile—not reasons to
invent more diagnostic or service-recovery machinery.

This document supersedes the active sequencing discussion in
`boot-thread-fault-entry-proposal.md`; that file retains register examples
and review history. Its withdrawn snapshot/FAULT_RELEASE draft is not authority.
