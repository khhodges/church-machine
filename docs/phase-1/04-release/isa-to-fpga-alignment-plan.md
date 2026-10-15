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
