# Simulator / FPGA Exact-Image Parity — Review Plan and Code Estimates

Date: 2026-11-09  
Status: proposed for review; not implementation or hardware authorization.

## 1. Recommendation

Yes: first make the simulator load and execute the FPGA's exact prepared image
at the same architectural addresses. Then qualify instruction and Thread
behavior, followed by the shared SYSTEM/IDE Lazy Load workflow.

Do not begin by writing another simulator-only Lazy loader. That would allow
simulation to succeed using different code, different placement or host-side
services that the FPGA does not have.

**First deliverable:** one frozen prepared image, identical initial payload
bytes and placement, explicit target profile, real boot execution, and a
repeatable report of the first architectural divergence.

This is architectural equivalence, not cycle-accurate browser simulation.
Physical hardware remains the acceptance authority for the installed build.
Simulator success is not evidence of successful flashing, UART operation or
installed-memory identity.

## 2. Existing-code assessment

These observations were checked against the workspace on the date above.
Paths and symbols are navigation aids, not promises that line numbers will
remain stable.

| Area | Existing implementation | Reuse and identified gap |
|---|---|---|
| Simulator core | `simulator/simulator.js`, approximately 13,351 lines | Reuse the core; do not rewrite it. Extract new profile, comparison and image-validation helpers into focused modules. |
| Image loading | `loadBootImage`, `_loadBootImageCore`, `bindSimulationConfiguration`, `resetPreparedSimulation` | Already checks image size and Namespace Header V2, retains exact loaded bytes and supports bound simulation configuration. Audit all subsequent boot/reset writes and reject incompatible FPGA profiles explicitly. |
| Address/format handling | `_loadBootImageCore` uses `Uint32Array`; header validation derives Namespace table geometry | Explicit endian decoding and profile-specific address semantics need qualification. The current loader must not be assumed compatible with every FPGA image merely because both use 32-bit words. |
| Prepared development build | `server/development_image_prepare.py`, 133 lines | Reuse latest-source compilation, private binding, trace rows and emitted memory-map evidence. Preserve the distinction between source artifact hashes and localized image bytes. |
| Development Image endpoint | `server/development_image_view.py`, 307 lines | `/api/development-image/prepare` currently builds `_raw` in memory and returns prepared metadata; its comment explicitly says no persisted artifact is written. Exact-byte retention/retrieval is therefore a concrete prerequisite, not existing end-to-end functionality. |
| Hardware installation | `server/uart_profile_install.py` | Existing profile-specific validation requires a 65,536-byte image and identifies required BIT evidence. Reuse authority/target checks; do not generalize these constants without an approved profile. |
| IDE image controls | `artifacts/development-image/src/DevelopmentImage.tsx`, 579 lines; `src/image-api.ts`, 119 lines | Existing Prepare/Inspect/Send and hash checks are useful. Add explicit simulation activation from the frozen artifact. Current `prepareExact` requests preparation again and rejects changed identity; rejection is safe but is not immutable-byte reuse. |
| Private simulation | `server/design_simulation.py`, 220 lines; `simulator/design-simulation.js`; `simulator/app-simulation-preparation.js` | Preserve isolation and explicit activation. Existing private/localized replay must not automatically be called FPGA-equivalent. Share compatible mechanisms rather than duplicating a second preparation system. |
| CALL behavior | `_execCall`, `lazyLoad`, `_fireSchedulerIRQ` in the simulator | Current CALL includes abstraction-registry activation and a `cw=0` Lazy IRQ route. These are specific parity risks; the exact-FPGA path must use the implemented protected USER-to-SYSTEM transition. |
| Thread transitions | `_execChange`, `_execChangeCore` | Reuse protected context mechanisms after comparing their commit order and fault semantics with RTL. Ordinary CHANGE is not automatically sufficient for internal unavailable-CALL admission. |
| RTL reference | `hardware/call.py`, `hardware/ordinary_change.py`, `hardware/core.py` | Defines the implemented internal LLR handoff. Source behavior is not proof it is installed in the board BIT. |
| RTL tests | `hardware/test_phase2_llr.py`, 253 lines; `hardware/test_phase2_guarded_llr.py`, 186 lines | Reuse scenario definitions and expected states. Existing positive tests manually change isolated memory to model body availability; they do not implement DELIVER. |

### Existing tests to extend

- `tests/server/test_development_image_prepare.py`
- `tests/server/test_development_image_geometry.py`
- `tests/server/test_development_image_view.py`
- `tests/server/test_uart_profile_install.py`
- `tests/server/test_design_simulation.py`
- `tests/server/test_design_simulation_browser.py`
- `simulator/test_simulation_image_binding.js`
- `simulator/test_simulation_execution_isolation.js`
- `simulator/test_design_simulation.js`
- `simulator/test_development_image_view.js`
- `simulator/test_uart_profile_install.js`

The preceding audit freshly ran the 18-case local LLR suite successfully.
This document-writing turn did not rerun tests. Historical guarded-core results
and their limitations are recorded in `local-llr-entry-results.md`; they are not
fresh physical acceptance evidence.

## 3. Meaning of “identical LUMPs”

Compare the exact destination-localized LUMP bytes inside the prepared image,
not just matching source names, source text or catalog tokens.

Record separately:

1. Original immutable source artifact identity/hash.
2. Compiled candidate identity/hash.
3. Destination binding/localization evidence.
4. Exact emitted image bytes and per-region hashes.
5. Runtime writes after execution begins.

Localization performed once during preparation is legitimate. Re-localizing,
recompiling or reminting separately for simulation is not exact-image parity.

For Lazy entries, identical initial images contain the same absent-body
representation. Later delivered bodies must likewise come from the same
validated artifact and destination binding rules.

## 4. Invariants and scope boundaries

- Never silently rewrite an image to accommodate a simulator limitation.
- Never infer profile compatibility from byte length alone.
- Keep ROM identity separate from Namespace/RAM image identity.
- Preserve the approved image layout and Namespace identity.
- Invalid authority hard-faults; it is not treated as an unavailable body.
- Hardware does not automatically increment capability versions.
- Do not use catalog hooks, synthetic grants or host-language service execution
  to make the exact-image program pass.
- Do not replace editor drafts or active simulation state implicitly.
- Ordinary Lazy fetch selects approved artifacts; development preparation's
  latest-compilation policy does not override runtime selection.
- No RTL changes, live image changes, resets, uploads or flashing are authorized
  by approval of this document alone.
- No complete retirement implementation, non-CALL Lazy Resolve implementation
  or Namespace-type Lazy loading is included in the first milestone.

## 5. Work breakdown and estimates

### Estimation method

Ranges below are engineering sizing estimates, not measured diffs, schedules or
commitments. They reflect inspected reuse points and unresolved interfaces.

- **New implementation LOC:** estimated nonblank production/helper source lines.
- **Existing LOC touched:** existing lines requiring substantive edits; these
  are not net growth and may overlap between work packages.
- **Test LOC:** additional or substantially rewritten automated test code.
- Documentation, generated binaries, dependencies and vendor output are excluded.
- SYSTEM assembly is included as implementation code in P7.
- Test LOC includes reusable fixture/harness code, not a promised assertion count.
- Sum of touched lines is editing volume, not the number of unique existing lines.
- Low-confidence packages must be re-estimated after interface review.

| Package | New implementation LOC | Existing LOC touched | Test LOC | Confidence |
|---|---:|---:|---:|---|
| P1 Target/profile contract | 120–220 | 40–100 | 100–180 | Medium |
| P2 Frozen image retention and retrieval | 200–400 | 100–220 | 200–350 | Medium |
| P3 Exact loader, address and boot qualification | 250–500 | 200–450 | 350–650 | Medium-low |
| P4 First-milestone IDE controls | 120–220 | 80–180 | 150–250 | Medium |
| P5 Architectural comparison harness and ordinary parity | 300–600 | 150–400 | 500–900 | Medium-low |
| P6 Internal unavailable-CALL parity | 180–350 | 120–280 | 350–600 | Medium |
| P7 Real SYSTEM lifecycle software | 450–900 | 100–250 | 450–850 | Low |
| P8 Shared IDE service and simulated transport | 450–850 | 150–350 | 450–850 | Low |
| P9 Request/comparison evidence UI | 180–350 | 80–180 | 180–320 | Medium-low |
| P10 Exact-build acceptance automation | 120–250 | 50–120 | 250–450 | Medium-low |
| **Full proposed scope** | **2,370–4,640** | **1,070–2,530** | **2,980–5,400** | **Not a fixed quote** |

### Milestone subtotals

| Milestone | Packages | New implementation LOC | Existing LOC touched | Test LOC |
|---|---|---:|---:|---:|
| M1 Exact-image loading and boot comparison | P1–P4 | 690–1,340 | 420–950 | 800–1,430 |
| M2 Architectural and LLR parity | P5–P6 | 480–950 | 270–680 | 850–1,500 |
| M3 Shared SYSTEM/IDE Lazy workflow | P7–P9 | 1,080–2,100 | 330–780 | 1,080–2,020 |
| M4 Acceptance automation and board campaign | P10 | 120–250 | 50–120 | 250–450 |

**Recommended initial approval:** M1 only, followed by review of actual
compatibility findings. M1 does not promise unrestricted execution parity.
Basic boot discrepancies discovered there must be classified; large ISA changes
must not be concealed inside a loader task.

### P1 — Pin the target/profile contract

Extend existing prepared-image evidence with a versioned, validated target
contract. Reuse existing fields rather than inventing a parallel identity system.

Specify:

- Profile, image hash/length/load address and memory capacity.
- RTL provenance and, where known, required BIT and ROM hashes.
- Endian format and units for each architectural address field.
- Descriptor layout, Thread layout, boot entry and MMIO ranges.
- Exact artifact/binding inventory, including absent Lazy entries.
- Evidence state: prepared, locally simulated, RTL-compared, installed, verified.

Proposed helper boundary: a small Python profile/evidence module plus a
JavaScript validator, with shared machine-readable fixtures.

**Gate:** malformed or incompatible contracts are rejected before state changes;
unknown installed BIT identity remains explicitly unknown.

### P2 — Freeze prepared bytes and retrieve them without rebuilding

Modify Development Image preparation to retain the exact `_raw` bytes and
their evidence under an immutable content-addressed build identity.

Provide an authenticated retrieval path for that exact identity. Select the
storage mechanism using existing retained-artifact facilities where suitable;
do not place generated binary copies in Git.

Simulation and hardware transfer must refer to the retained build, not rerun
latest-source compilation on activation or send. Preserve existing authorization,
explicit consent and physical-target checks.

Handle expiration/missing artifacts explicitly: “prepare again” is acceptable;
quietly returning newly compiled bytes under an old selection is not.

**Gate:** compile newer sources after preparation and prove that loading or
sending the selected build still retrieves its original bytes and hash.

### P3 — Qualify loader, addresses, initial memory and boot

Extend the existing loader with explicit profile admission, endian decoding,
validated geometry and atomic activation. Use the existing candidate-instance
validation approach where compatible.

Audit all image-backed regions: Namespace descriptors, callable headers,
method tables, C-lists, Thread contexts, stack/heap and reserved memory.
Compare payload bytes before any boot instruction executes.

Audit `_loadBootImageCore`, reset, boot and registry hooks for synthetic writes,
relocation or overwritten CR0/entry state. Distinguish genuine instruction
writes from host initialization. Treat external-to-payload RAM and MMIO according
to the selected FPGA profile, not a blanket zero-fill assumption.

Maintain internal word arrays if useful, with explicit field-level conversion
to architectural byte/word addresses.

**Gate:** exact initial per-region hashes; mismatch includes first address,
expected/actual word and owning region. Malformed input leaves the previous
simulation unchanged. Reset reuses the frozen input, not mutable editor/catalog
selection.

### P4 — Add exact-build simulation activation to the existing IDE

Add “Load this prepared image into Simulator” to Development Image using the
same retained artifact displayed for FPGA transfer.

Display profile, build/image identity and local-versus-installed evidence.
Keep explicit execution replacement consent and dirty-editor protection.
Navigation, selection and inspection must not compile, activate or send.

Do not duplicate the main IDE menu or create another independent Namespace
selection. Preserve shared selection while keeping the running image immutable.

**Gate:** a user can inspect a prepared build, activate it explicitly and see
which bytes run. Switching selection cannot alter an active execution.

### P5 — Build architectural differential checks

Create focused harness modules rather than adding comparison machinery to the
13,351-line simulator core.

Run common exact-byte fixtures through simulator and RTL, collecting:

- Accepted instruction identity and committed NIA.
- Thread GT, CRs, DRs and flags.
- Memory writes and protected frame effects.
- Retirement, CALL/RETURN/CHANGE and fault outcome.

Compare at architectural commit boundaries, not raw cycle counts.
Normalize only documented representation differences, never differing authority
or program behavior.

Begin with ordinary boot, resident CALL/RETURN, LOAD/SAVE, CHANGE and relevant
fault controls. Separate timing-sensitive MMIO/watchdog model work.

The existing RTL test evidence notes that `retire_instr` can follow an inactive
poisoned fetch bus. Do not use that field alone as an accepted-instruction oracle.

**Gate:** reports the first divergence reproducibly. Legacy test failures are
classified as existing failures or new regressions; neither is hidden by changing
expected results wholesale.

### P6 — Match the implemented unavailable-CALL handoff

Replace the legacy Lazy IRQ/registry activation behavior for the exact-FPGA
execution path. Preserve unrelated historical teaching modes only when they are
clearly separate and cannot be selected implicitly.

Implement the RTL transaction ordering:

1. Validate target and caller without premature callee-state publication.
2. Preserve the unexecuted CALL and outgoing USER context.
3. Validate pinned slot-2 SYSTEM identity and continuation.
4. Save USER, restore SYSTEM and inject metadata in DR1–DR4.
5. Inject target slot in DR5 and full unchanged USER GT in DR6.
6. Preserve DR0, set Z and retain the required N/C/V state.
7. Do not retire the CALL, synthesize completion or automatically resume USER.

Cover guarded and unguarded profiles only if both are selected scope.
Otherwise pin one target and reject the other.

**Gate:** reuse both existing RTL test families, including nonzero generations
and negative controls. Add a real prepared-image case proving its absence
encoding triggers this path.

### P7 — Execute real SYSTEM lifecycle LUMPs

Inventory existing SYSTEM/service sources before writing new code. The estimate
assumes substantial reuse of CALL/CHANGE, allocation and existing assembly
infrastructure, but not an already completed end-to-end service.

Implement the required bounded software slice:

- Private pending record per configured USER.
- Sequential request registration and FIFO dispatch.
- Cooperative eligibility/round-robin selection.
- Continued SYSTEM work when all USERs are blocked.
- Matched delivery validation, allocation/binding/install and completion.
- Original CALL retry through ordinary USER restoration.

SYSTEM state and scheduling remain machine software. JavaScript must not own
completion or implement the service by direct memory patching.

**Gate:** exact same service LUMPs execute on both targets. No elapsed-time resume,
duplicate request or privileged host callback.

**Estimate risk:** final pending-record, transport, provisioning and safe-install
contracts are not all settled. Re-estimate after these decisions; do not infer
additional grants or interfaces from this plan.

### P8 — Implement shared IDE service and transport model

Settle the minimum request/delivery contract before implementation: framing,
byte order, capacity/backpressure, session/request identity, reset boundary,
artifact policy and rejection disposition.

Connect simulator device registers to a simulated transport, then to the same
IDE service contract used for hardware. Reuse bridge transport infrastructure
where applicable without treating existing command acknowledgements as LLR
completion.

Keep simulation and physical-device routing separate. Authentication remains
automatic enforcement, not an optional user gate.

Test immediate, delayed, unavailable, duplicate, corrupted, wrong-target,
out-of-order and old-session delivery. Preserve ordinary approved-artifact
selection; plus-marked later-version tests remain a separate explicit policy.

**Gate:** one real request produces a validated delivery and software installation.
Unready requests remain pending without blocking unrelated USER work.

### P9 — Expose comparison and request evidence

Add compact views within the existing IDE:

- First architectural divergence with expected/actual state.
- Per-request USER, Namespace, target, selected artifact and waiting reason.
- Received, validated, installed, USER eligible, resumed and CALL-completed
  evidence as distinct events.
- Transport disconnection and rejected delivery distinguished from ordinary wait.

Use bounded logs and retained diagnostic summaries; do not keep unbounded
instruction histories in the browser.

**Gate:** visible status derives from actual service/device evidence, not a UI
timer or assumption that transfer acknowledgment means execution success.

### P10 — Qualify and automate the exact-build campaign

Register focused isolated checks in the project's release-check system. Avoid
adding tests to ordinary IDE startup and do not run the full parallel launcher
against live artifact storage.

Freeze the image, SYSTEM/USER bodies, target profile and test expectations.
Automate local replay and evidence reconciliation. Physical operations remain
an explicit later campaign with separate authorization.

**Gate:** the board campaign records BIT/image identity and proves delayed
absent-body CALL completion once, another USER progressing, all-USER wait,
and negative delivery controls. A matching simulator result alone cannot close
physical acceptance.

## 6. Dependency order

```text
P1 Target contract
  -> P2 Frozen bytes
  -> P3 Loader/map/boot qualification
  -> P4 Explicit IDE activation                  [M1 review gate]
  -> P5 Architectural comparison
  -> P6 Unavailable-CALL parity                  [M2 review gate]
  -> P7 SYSTEM software + P8 shared transport/service
  -> P9 request/comparison evidence              [M3 review gate]
  -> P10 exact-build physical campaign           [M4 acceptance]
```

P5 harness design can begin after P1; P7/P8 contract work can proceed alongside
P6. Their implementation is coupled and must share one protocol contract.
Do not block M1 on finishing Retirement, networking or storage objectives.

## 7. Required acceptance matrix

| Case | Required evidence |
|---|---|
| Prepared bytes unchanged by later compilation | Original retained hash still loads/transfers |
| Input corrupted, misaligned, wrong size/profile | Rejected before replacing active simulator |
| Initial image map | All image-backed regions match at their architectural addresses |
| Boot/reset | Real instructions; frozen image reused; no catalog-derived repair |
| Resident CALL/RETURN | Same committed state and frame effects in simulator and RTL |
| Ordinary CHANGE | Same Thread identities, context preservation and continuation |
| Absent valid target | USER saved at unexecuted CALL; correct SYSTEM entry and DR1–DR6 |
| Invalid authority | Matching hard fault; no request substituted for failure |
| Immediate delivery | No interleaving into incomplete request registration |
| Delayed delivery | USER remains blocked; another eligible USER progresses |
| All USERs waiting | SYSTEM continues with approved watchdog behavior |
| Successful installation | Validation/publication precedes eligibility; CALL executes once |
| Two USERs, same target | Independent pending associations; no broadcast completion |
| Duplicate/stale/wrong-target/corrupt delivery | No inappropriate install, signal or wake |
| SYSTEM/FPGA reset boundary | Old-session delivery cannot complete a new operation |
| Installed-build comparison | Recorded BIT/image provenance, not inferred from selected files |

## 8. Review decisions and estimate risks

1. **Which execution profile is first?** Recommend one exact next-build profile;
   installed-board parity and next-RTL parity must not be conflated.
2. **Which boot boundary is compared?** Record reset ROM and entry state. Do not
   silently start simulation after hardware-only admission work.
3. **How are frozen images retained?** Reuse a suitable artifact store, define
   access/retention and handle expired identities explicitly.
4. **How broad is ordinary ISA parity?** Initial scope is instructions and
   devices reachable by the selected image and acceptance fixtures. General
   whole-ISA certification is additional scope.
5. **What closes the first delivery contract?** Capacity/framing, reset identity,
   pending ownership and safe installation must be specified for P7/P8.
6. **How are baseline failures handled?** Preserve separate baseline reporting;
   do not expand this work into repairing every unrelated historical test.

The largest uncertainty is not the IDE button or binary download. It is the
semantic gap between current simulator shortcuts and real SYSTEM execution,
plus the still-open end-to-end delivery/install contracts.

The LOC ranges assume no new ISA, hardware allocator, generic memory-system
rewrite or broad RTL correction. Discovery of any of those requires a revised
scope and estimate before implementation.

## 9. Deliverables for review and implementation

- This plan and a reviewed target/profile contract.
- Frozen image retrieval with exact artifact/binding evidence.
- Qualified simulator loading and explicit IDE activation.
- Differential harness with shared simulator/RTL fixtures.
- Implemented internal LLR transition parity.
- Real shared SYSTEM/IDE Lazy workflow, separately approved.
- Focused isolated regression registration and final evidence report.

**Approval boundary:** reviewing or approving this plan does not itself authorize
live Namespace changes, automatic LUMP replacement, hardware upload or flashing.
The recommended first implementation authorization is M1.

## 10. References

- [Unified lifecycle contracts](../lazy-lifecycle-unified.md)
- [Phase 2 acceptance checklist](test-checklist.md)
- [Local LLR entry evidence](local-llr-entry-results.md)
- [Current guarded Thread checks](current-guarded-thread-tests.md)
- [Phase 1 ISA baseline](../phase-1/01-isa/instruction-set.md)
