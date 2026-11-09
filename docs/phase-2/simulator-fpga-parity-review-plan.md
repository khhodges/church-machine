# Simulator / FPGA — Bounded Exact-Image Investigation

Date: 2026-11-09  
Status: revised scope; no implementation or hardware authorization.

## 1. Decision

**Minimal risk for maximum progress.** Replace the previous ten-package parity
programme with one bounded diagnostic investigation. Full simulator parity is
not a prerequisite for hardware-first acceptance.

The question is:

> Can the existing simulator load one existing FPGA image unchanged and execute
> its real boot path? If not, what is the first concrete incompatibility?

The previous milestone and line-count estimates are withdrawn as a recommended
scope. They were preliminary guesses, not demonstrated minimum work or a reliable
schedule. This investigation does not commit to the projects they described.

## 2. Smallest useful investigation

1. **Select one existing image.** Record its file, SHA-256, length, architectural
   placement, target profile and available ROM/BIT provenance. Distinguish a
   prepared FPGA image from a proven installed image. Unknown evidence stays
   unknown. Do not compile a new image or substitute current catalog artifacts.
2. **Reuse the existing loader in isolation.** Use a disposable simulator
   instance and existing test facilities, not the user's active browser session.
   Keep the input read-only. Do not add a production image store, endpoint or UI.
3. **Check initial bytes and placement.** Compare every image-backed region at
   its intended architectural address before executing instructions. Account
   explicitly for loader/reset writes. Record the first differing address,
   expected/actual word and responsible initialization path; never normalize
   away an unexplained difference.
4. **Attempt the real boot path.** Establish the ROM/reset entry boundary first.
   If it cannot be represented faithfully by existing facilities, report that as
   the blocker rather than skipping it. Run with a finite instruction limit
   fixed and recorded before execution. Do not execute registry shortcuts,
   synthetic grants or host-side services to make boot succeed.
5. **Stop at the first incompatibility or the recorded limit.** Capture enough
   state to explain the failing load or instruction: address, instruction bytes,
   relevant registers/memory, observed result and expected behavior with its
   ISA/RTL reference. If boot reaches a defined success boundary, record that
   boundary and stop; do not expand into general ISA qualification.
6. **Recommend one next action.** Identify the smallest correction, a missing
   handoff requiring separate scope, or a reason to continue hardware-first
   without investing further in simulator alignment.

If exact image bytes or required target information are unavailable, stop at
that evidence gap. The Development Image preparation endpoint's metadata is not
a substitute for retained bytes. Do not build retention infrastructure merely
to complete this investigation.

## 3. Reuse before adding anything

Navigation points from the preceding audit; confirm their current behavior
when conducting the investigation:

| Existing area | Use |
|---|---|
| `simulator/simulator.js`: `loadBootImage`, `_loadBootImageCore` | Existing image admission/loading; inspect endian, address and initialization behavior |
| `bindSimulationConfiguration`, `resetPreparedSimulation` | Existing byte binding/reset mechanisms, only where compatible with the selected image |
| `simulator/test_simulation_image_binding.js`, `simulator/test_simulation_execution_isolation.js` | Reuse isolated fixtures and assertions rather than a new comparison framework |
| `server/development_image_prepare.py`, `server/development_image_view.py` | Understand prepared-image evidence; prior audit found raw bytes built in memory but only metadata returned |
| `hardware/call.py`, `hardware/ordinary_change.py`, `hardware/core.py` | Consult only the relevant expected transition; source is not proof of installed BIT identity |
| `hardware/test_phase2_llr.py`, `hardware/test_phase2_guarded_llr.py` | Existing handoff evidence, not proof of real delivery |

The earlier audit ran the 18-case local LLR suite successfully. Those positive
tests manually changed isolated memory to model body availability; they did not
exercise actual DELIVER. No tests were rerun for this document revision.

## 4. Explicit exclusions

- No new image store, protocol, dashboard, scheduler or generalized differential
  verification framework.
- No broad simulator refactor, whole-ISA certification or legacy-test cleanup.
- No SYSTEM lifecycle implementation, delivery service or simulated transport.
- No saved-LUMP replacement, recompilation, rebinding or live Namespace changes.
- No editor replacement or activation in the user's running simulation.
- No RTL changes, board resets, uploads, flashing or hardware operations.
- No silent byte rewriting, relocation, catalog repair or synthetic completion.

Invalid authority remains a hard fault, not an unavailable-body request.
Hardware does not change capability versions. Keep ROM evidence separate from
Namespace/RAM image evidence.

## 5. Stop and decision criteria

| Finding | Next decision |
|---|---|
| Missing bytes or ambiguous target/reset evidence | Report the specific missing evidence; no infrastructure expansion |
| Localized loader or instruction discrepancy | Propose one narrow correction and one focused regression; implement only after approval, then replay the same image |
| Major execution-model differences or several coupled subsystems required | Stop; reconsider simulator investment against the hardware-first path |
| Execution reaches the missing unavailable-CALL/Lazy handoff | Report the exact boundary; scope only that handoff separately, not the entire lifecycle |
| Boot reaches the declared boundary without discrepancy | Report bounded compatibility, not general parity or physical acceptance |
| Instruction limit reached without a conclusion | Report inconclusive with the final state; no unbounded run or automatic scope expansion |

Do not chain a series of “small fixes” into an unapproved parity project.
A correction proposal must state why it is localized, what it changes and how
the same input will verify it. If that cannot be stated clearly, stop.

## 6. Deliverable and authorization

Produce one short evidence report containing:

- Selected image hash/profile and provenance limitations.
- Exact replay command, isolated setup and execution limit.
- Initial-byte comparison result.
- Boot boundary reached or first incompatibility, with observed/expected evidence.
- One smallest next action, its risk and its focused verification.
- Explicit confirmation of what was not changed.

The investigation is complete when it provides that decision-quality evidence,
not when the simulator has been made to pass.

This revision replaces the broad proposal only. It does not claim that the
investigation has run or authorize implementation. Physical hardware remains
the acceptance authority; simulator success cannot prove installation, UART
behavior or physical execution.

## 7. References

- [Unified lifecycle contracts](../lazy-lifecycle-unified.md)
- [Phase 2 acceptance checklist](test-checklist.md)
- [Local LLR entry evidence](local-llr-entry-results.md)
- [Current guarded Thread checks](current-guarded-thread-tests.md)
- [Phase 1 ISA baseline](../phase-1/01-isa/instruction-set.md)
