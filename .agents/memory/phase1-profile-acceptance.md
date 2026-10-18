---
name: Phase 1 Namespace acceptance boundary
description: Historical Namespace save evidence is not acceptance of the approved Phase 1 design.
---

Phase 1 IDE setup means populating the Namespace LUMPs with the implemented
source so the programmer can select each LUMP in the existing code editor,
edit it, and recompile it. Do not reinterpret this as a request for a new
debugger, a limited test panel, or a sealed-runtime UI integration.

**Why:** On 2026-10-18 the user corrected the expanded scope: “all I want tou
to do is populate the Namespace LUMPS” to connect the code to the Namespace
and select and recompile each LUMP as they see fit.

**How to apply:** Use the existing Namespace and editor workflow. Distinguish
editable source/compiler compatibility from runtime acceptance; do not claim
test-harness-only artifacts are ordinary recompilable IDE LUMPs.

Conversion to CLOOMC LUMPs is programmer-reviewed in four separate steps:
source/machine separation, real first path, existing-IDE delivery, then remaining
methods and integration. Stop after each step for review.

**Why:** The user explicitly requested “1, 2, 3 and 4 as individual steps I can
check” and a reusable process for turning other Abstractions into CLOOMC LUMPs.

**How to apply:** Use `docs/reviews/cloomc-lump-process.md` as the handoff
checklist. Start with Mint; do not conflate a helper-backed scenario with
ordinary compiled source, or expand the work into a replacement debugger.

Verify Namespace persistence against the explicitly selected, approved Phase 1
profile, not the historical saved-Namespace controls or a replacement UI.
Retain exact selected revisions and unfinished Resident-intent entries.

**Why:** The user rejected historical-profile acceptance as closure for the
confirmed 256-slot design. A passing save test on a different profile does not
establish retention of this design or its selected artifacts.

**How to apply:** Use disposable copies and frozen exact identities; test
profile switching, cancellation and reload through the original controls.
Treat a discovered spelling correction as an explicit private test edit, never
permission to migrate live state. Saved designs may be absent in clean
checkouts: use a clearly identified frozen acceptance fixture, not catalog
latest-version selection.

Primary subsequent priority is fault-free simulator operation with functional
abstractions and GT coverage across all 17 approved Namespace entries.

**Why:** Genesis explicitly redirected the work from persistence/isolated probes
toward the complete working set, not merely a populated table or more checklist
closures.

**How to apply:** Prioritize real implementations, dependency GT binding and
integrated startup/workload coverage. Preserve the approved layout, exercise
Threads and simulated I/O as well as callable objects, report per-slot behavior
and zero unexpected faults, and keep intentional protection-rejection tests
separate. Do not suppress faults, substitute success stubs, or widen authority
to satisfy the metric. Defer unrelated historical migration and hardware work.

Mint must perform dynamic slot creation/registration and GT issuance during the
integrated run. The 17 entries are the initial set, not a permanent occupancy cap.

**Why:** Genesis explicitly clarified that Mint should function for “dynamic
slot/GT create etc.” Static Namespace population is not the intended acceptance.

**How to apply:** Exercise a real caller's create/register → returned CR-held GT
→ authorized use sequence, preserving the initial slots. Verify allocation and
error cleanup through the actual Mint path, not host-side fixture insertion.
Keep existing identity/lifecycle rules and protected-interface authority limits;
this requirement does not authorize invented privilege or bypassed validation.

Naming-only qualification and runtime source correction are different evidence.
Preserve both outcomes when a pinned workload needs instruction changes.

**Why:** Successful recompilation/admission did not establish runtime correctness:
the selected workload cleared its C-list access before SWITCH and named a Thread
where a Namespace root was required. A corrected private run must not be
misrepresented as success of the unchanged selected source or live adoption.

**How to apply:** Record explicit source diffs, new hashes and a separate replay;
never patch PCs/registers, widen GT grants, suppress faults or replace selected
source silently. Keep partial identity access distinct from operational coverage.
