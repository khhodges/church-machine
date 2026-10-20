# Phase 1 — hardware acceptance

**Contract:** [Master ISA](../01-isa/instruction-set.md).
**Authorization:** [current work](../README.md#current-work).
Software delivery is a separate track, not a bitstream gate.

## Hardware-only acceptance reconciliation

Use independently checked instruction words and controlled fixtures. A shared
bug in two implementations is not agreement with the ISA.

| Area | Required checks |
|---|---|
| Instructions | All approved CALL forms; LOAD/SAVE, SWITCH, DREAD/DWRITE, BRANCH and BFEXT/BFINS indexing; ordinary CHANGE, RETURN, LAMBDA and remaining release-scope instructions; malformed/retired encodings, predication, flags, overlapping operands and arithmetic bounds. |
| Authority | Capability type, permission, generation, integrity and bounds; TPERM NULL/EXACT including skips; Thread frames/roots and runtime mLoad validation; Namespace geometry; CR13 untouched; no hardware version mutation. |
| Boot/handoff | Immutable configuration, boot-pair checks, reset marker and replay rejection, slot-2 activation, final CALL CR0, end of ROM-fetch authority; failed admission and repeated reset. |
| Watchdog | All four durations; initial control 0x5; reset retention; deferred selection; atomic writes; reserved-bit rejection; renewal and expiry ties; instruction-fault priority; elapsed time through stalls. |
| Faults/writes | Correct fault codes and origin; HARDFAULT word remains non-executable; no unauthorized side effects; at most one accepted program write awaiting completion; proven completion bound before validated recovery writes; no retry or rollback. |
| Exact artifact | Source/ROM/configuration identity, initialization, mapped behavior, pins/clocks, resource/timing reports, bundle hashes and physical observations of those exact bytes. |

## Verification sequence

### Executable acceptance cases

Each row requires deterministic fixtures, expected effects **and forbidden
effects**, a bounded timeout and retained raw evidence. Default status is
**not run**. A test counts only after reaching the intended execution path.

| ID | Exercise | Required observation |
|---|---|---|
| H01 | Every ordinary opcode, all register positions, DR0 and aliased inputs; ALU 0, ±1, signed extrema, carry/borrow; shifts 0/1/31. | Exact result, NZCV and preserved state against the core reference; close its oracle gaps before declaring full coverage. |
| H02 | All 16 NZCV combinations × every defined condition; false-condition invalid operands, CR13, NULL/EXACT and malformed encodings. | Skip has no operand effect/fault; only next fetch and independent watchdog behavior remain. Reserved NV is not silently assumed. |
| H03 | Each approved CALL form; both signs; row magnitudes 0/31, method 0/127 or 0/2047; LOAD/SAVE/DREAD/DWRITE ±1023, BRANCH ±262143. | Hand-checked packed word and latched operands; correct byte/word conversion; no wrap/truncation. Zero, last-valid and first-invalid effective indices. |
| H04 | BFEXT/BFINS width 1/31 and invalid 0; positions 0/31, crossing bit 31, DR underflow/overflow, shared source/destination. | Exact result and flags or fault before destination mutation; preserve unaffected insertion bits. |
| H05 | Direct/indexed CALL methods 0, first/last public, private zero and outside table/code; nested calls, RETURN mask 0/all/each bit, root/empty/corrupt continuation; LAMBDA. | Correct E authority, c-list/code reconstruction, continuation and mask; no hidden snapshot or unchecked fast return. |
| H06 | GT classes, permissions, domains, bounds, stale generation; mutate each integrity-covered bit and F/G separately; denied/allowed MMIO. | Required access fails before unauthorized effects; full 9-bit equality, unchanged versions and exact integrity formula. No inferred permission from slot membership. |
| H07 | NULL literal/nonzero/B variants; EXACT equal/unequal non-NULL, one/both NULL; raw NULL modifier 31; condition skips. | Exact approved NZCV or pre-mutation fault at the TPERM instruction. Equality never proves validity. |
| H08 | Valid, malformed and suspended/root Thread contexts; permission-bearing operand GT; unused invalid c-list row then use it. | Context failures 0x1D, separate operand permission failure 0x1E; no eager entire-c-list scan; each restored CR GT passes mLoad. |
| H09 | CHANGE self/helper/other; SWITCH both legal spellings, both signs, CR15.M absent; invalid Namespace/entry; CR13 operands. | Save/load order, unchanged ordinary CR15, shared SWITCH authority, fixed slot-2 entry, no CR13 writes; no target execution on failure. |
| H10 | Cold configuration, warm reset, authorized marker, same word at wrong PC/from RAM, replay after acceptance/fault, malformed final CALL CR0. | One-shot 0x27000001 only at immutable ROM site; no extra CR12.M; ROM fetch authority ends only on successful final CALL. |
| H11 | Boot pair match, slot-1 mismatch, slot-2 mismatch after CR15 load, pair equal to itself but not bitstream; ordinary versus guarded handoff. | VERSION with correct slot; no target activation, retry or rollback; ordinary entry version 0 versus guarded expected version. |
| H12 | Default and configured Namespace capacity, first/last/outside slot and word, all fixed service slots, maximum intended allocation. | Ascending four-word entries; 256-slot default/limit 1023; slots 0/1/2/8/9/14/15; whole Phase 1 footprint fits half actual FPGA memory. |
| H13 | All eight valid watchdog controls; power-on then warm reset with exemption on/off; each selector change while running. | Initial 0x5; controls retained across reset, elapsed count not retained; selector alone never extends current interval; readback is programmed selection. |
| H14 | Every duration; instruction retirement, CALL/RETURN loops, stalls, self/helper CHANGE and SWITCH; completion before/at/after deadline. | Ungated elapsed time; only successful pre-deadline transfer renews; expiry wins equality, code 0x1F; no CR13/IRQ action. |
| H15 | Exemption enter/exit, combined selector+exit (including 0x6), repeated non-exempt writes; every reserved control bit. | Fresh same-write duration on exit; repeated 0 does not renew; reserved bits read zero, writes wholly reject with 0x0B without stopping time. |
| H16 | Exemption/selector update at expiry; instruction fault at expiry; incoming mLoad failure at renewal. | Whole control rejection at expiry; instruction fault wins reporting but not containment; failed transfer never renews. |
| H17 | Expiry before/on/after program-write acceptance, delayed completion, partial multiwrite instruction and failed outgoing save. | Stop admission immediately; at most one accepted write completes within measured bound; no remaining instruction writes, retry, rollback or recovery write before completion. Failed validated save is not reported successful. |
| H18 | HARDFAULT 0xF7000000, retired opcodes, wrong-context reset marker, bad fetch/entry; recovery that changes visible PC. | First fault code/location and pre-recovery state captured; no HALT substitution, speculative retirement or proof/private-state leakage. |
| H19 | Behavioral, emitted RTL, mapped model and board replay of the same fixture. | Compare committed registers/flags/memory/faults, not internal cycle counts except deadline/completion bounds. No forced X values or stale model accepted. |
| H20 | Exact build cold/warm reboot, repeated handoffs and fault/recovery trials; memory/ROM initialization and retained controls. | Repeatable outcomes tied to bundle/input hashes, board identity, clock, logs and observed completion; no prior-run telemetry counted as new evidence. |

For H03/H04 use DR inputs 0, 1, 0x7FFFFFFF, 0x80000000 and 0xFFFFFFFF;
exercise negative intermediate values and carry beyond 32 bits. For H06/H08
inject one defect at a time, then combine defects only where precedence is
defined. Use nonzero sentinels in every supposedly unchanged register/word.

### Phase 1.1 SWITCH and recovery acceptance

These requirements incorporate the approved
[Namespace recovery contract](../01-isa/instruction-set.md#namespace-fault-recovery).
They extend the cases above; status remains **not run**.

- **H03/H09 — canonical SWITCH:** Independently pack required-zero bits 22:19,
  source CR0–CR11 and the compact signed row operand. Include immediate row 7
  (`0x0070`), both signs and effective-index boundaries. Reject the former
  explicit-destination field 15 under the applicable encoding rules.
  Check CR15.M (not CR0.M), no extra CR12.M grant, explicit source L including
  CR6, and no source-M substitute. CR13 must not be written.
- **H09/H18 — directional responsibility:** Inject faults before, at and after
  the Namespace-load midpoint. Before the midpoint, only the initial Namespace
  is responsible; from the midpoint onward, only the target is responsible.
  Distinct initial/target fixtures must expose a wrong selection. Retain fault
  evidence; failed handoffs must not execute the target or roll back accepted
  outgoing-save writes.
- **H17/H18 — trusted recovery:** Reboot only the responsible Namespace through
  trusted boot with no resumable faulted-Thread save and no M-bit grant from the
  faulted program. Preserve boot validation and first-fault evidence. Complete
  the outstanding accepted write before recovery uses memory; admit no remaining
  writes from the interrupted instruction. Ordinary CHANGE/SWITCH saves remain
  required; failed outgoing saves must never be reported as successful.
- **H10/H18/H20 — double error and completion:** Fault during recovery, including
  in the final boot `CALL CR0`, and observe restart of the original power-on
  boot context fixed by boot configuration. Do not select the most recently
  active Namespace. Reaching/issuing the CALL must not mark recovery complete;
  its successful transfer must. A later fault starts a new Namespace-local
  recovery, not a double error merely because an earlier fault occurred.

The two-Namespace networking/integration demonstration remains Phase 2.
Controlled instruction fixtures do not claim that demonstration or physical
acceptance. Do not infer new fault precedence or close remaining oracle gaps
from these requirements.

### Keep software acceptance separate

| ID | Required release work; not a hardware-bitstream gate |
|---|---|
| S01 | One IDE/several CMs; network T/local GT binding and virtual objects. Direct CM-to-CM, multiple IDEs and the two-Namespaces-on-one-FPGA networking test remain Phase 2. |
| S02 | Explicit loading; working Mint, pkverify and controlled nstab. Create/Replace/Destroy for application Abstractions, Threads, LS c-lists and RW data; no Mint MMIO/Namespace creation; growth estimates are not measured allocations. |
| S03 | Per-operation/target PassKey GT plus separate 128-bit proof; validate before EXACT; Genesis-only setup, sharing and revokers; reusable-until-revoked; pair-only revocation. Negative cases include missing proof, NULL/equal invalid GTs, stale/revoked and insufficient authority. SAVE identifies the GT-side detection point, not a completed proof mechanism. |
| S04 | Single-scope LAMBDA alone references NSRW-GT; one exclusive non-yielding slot update; verify/prepare before writes, publish only after confirmed writes. Reject resident/active Thread/code/c-list replacement or destruction before mutation. |
| S05 | First issue 0; release advances without wrap; reuse retained version; 510→511 permanently retires; stale issued GTs fault; full block zeroed before reuse; size-class pool tracking. Software enforces allocation policy; hardware never increments. |
| S06 | Retained boot-pair values 0…510 per half; unchanged builds retain them; explicitly changed configuration provisions matching bitstream/GTs. CR0-only policy defaults retain, saved per configuration; alternate new-guard choice does not bypass validation. |
| S07 | Exact-artifact static HARDFAULT attribution; otherwise raw origin. No private proof logging. Full release evidence includes simulator/RTL/exact board; any Genesis override records scope explicitly and is never a pass. |

### Before a fixture can pass

Record: case ID, exact instruction/image bytes, Namespace descriptors, initial
CR/DR/NZCV and Thread frames, reset/guard/watchdog configuration, expected final
state/fault and prohibited writes, cycle/time limit, checker version and raw
trace. Do not generate the expected result with the decoder under test.

Ordinary-instruction fixtures must leave the reset microcode window. Fault
fixtures must observe the fault **before recovery** overwrites its location.
For physical runs, correlate each command with that run's execution/retirement
and captured output; stale serial/server telemetry is not completion.
Record the repeat count and every failure; never erase a failed trial with a
successful retry.

### Explicit blockers to complete FPGA qualification

| Blocker | Closure evidence |
|---|---|
| Missing exact instruction oracle | Resolve the Master's **Oracle closure** items against approved decisions; independently encode expected words, flags, frames and faults. Do not infer approval from RTL. |
| Board configuration | Freeze actual ungated clock/tolerance, timer counts/width, physical half-memory range, MMIO address/decode/authority, reset-ROM bounds/site and expected boot versions. No placeholder constants. |
| Write completion | Demonstrate the actual RAM/MMIO completion protocol and worst-case bound, including failure behavior. Tied “done” or an arbitrary timeout is not proof. |
| Source-to-bitstream conformance | Implement/test approved decoder, transitions and watchdog; pass generated/mapped replay, initialization and build timing before exact-board evidence. Old source inspection is not current conformance. |

These blockers prevent a **complete pass claim**, not independent RTL work or
tests with already-defined expectations. Software TBDs do not become hardware
gates. No history file is needed to run a completed, frozen fixture.

### Execution stages

1. **Freeze test inputs:** record the contract, sources, configurations, fixture
   bytes and expected registers, flags, memory effects and faults. Use the
   Namespace Table for membership. Do not infer authority from a catalog.
2. **Implement and simulate:** compare committed effects against independent
   expectations. Capture the first divergence, including unexpected writes.
   Include exact generated RTL and the appropriate synthesized model; label
   behavioral, word-level, mapped-module and full-mapped evidence separately.
   Preserve commands, hashes and logs. No forced unknown bits, partial replay,
   timeout or stale generated RTL counts as a pass.
3. **Qualify a build — separate authorization required:** use frozen inputs and
   a clean pinned build directory. One vendor build at a time, two workers.
   Require completed synthesis/implementation, correct pins/clocks, no blocking
   DRC violations and nonnegative setup/hold timing. Produce .bit and .mcs with
   tool versions, input/output hashes and timing reports.
4. **Qualify the board — separate authorization required:** program the selected
   exact bundle; record its identity. Test cold/warm reset, execution, handoffs,
   boundary faults and recovery. Correlate trace/readback with immutable
   instruction occurrences. A version label or post-stop snapshot is insufficient.

New input bytes invalidate affected evidence. Internal latency may differ where
the ISA permits it; effects, authority and faults may not.

## Report honestly

Use **not run / failed / passed / explicitly overridden** for each check.
Retain the previously scoped Genesis override as a recorded exception, never
as a pass. This document exercises no override.

Implemented ≠ simulation-verified ≠ built ≠ physically verified.
Documentation checks and field-packing arithmetic prove none of the later states.
Clock tolerance, MMIO placement, write-completion bounds and physical results
still need measured/integrated evidence.

Compiler, simulator-feature, IDE attribution, Mint and service delivery proceed
separately. Their incompleteness does not block hardware work or excuse a hardware
mismatch.
