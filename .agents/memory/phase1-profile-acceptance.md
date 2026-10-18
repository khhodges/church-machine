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

The top-level Lambda Calculus Abstraction definition must come first in
Step 1, before the source/machine audit, helper translation or register ABI.

**Why:** The user rejected the initial Step 1 because “The most important top
level definition as a Lambda Calculus Abstraction must come first. It is
totally missing.”

**How to apply:** Define the term, captured environment, parameters,
application semantics, results and state effects for programmer review.
Derive CLOOMC and LUMP structure from that definition, not from host helpers.
Distinguish the mathematical lambda binder from the machine LAMBDA instruction.

Mint's tangible product is a Golden Token and must be front and center in its
top-level Abstraction definition; allocation and bookkeeping support that product.

**Why:** The user explicitly corrected the generic operation/state presentation:
“The tangable comodaty of Mint is a Golden Token it should be front and center.”

**How to apply:** Lead with GT production and delivery, show the GT explicitly
in successful issuance outcomes, and distinguish lifecycle operations that do
not issue a GT. Do not infer what the programmer's GT must mean or protect.

CREATE's primary definition: returns an immutable Golden Token to access a
new digital object with defined usage permission for Data Read, Write or
Execute use, an Enter-only Abstraction, Load or Save Capability Lists, a
Thread, or a Namespace.

**Why:** The user supplied this definition after rejecting the longer generic
explanation. Immutability, new-object access and the complete object/use list
are explicit requirements.

**How to apply:** Put this definition first and retain its scope without
inventing permission combinations for Threads or Namespaces.

CREATE must issue Abstract GTs and be the entry path to their issuance through
a hierarchy of Abstractions. Credentials are not the entire Abstract category.

**Why:** The user corrected the definition's omission: CREATE should be the
entry path to Abstract GTs “as a hierarchy of Abstractions.”

**How to apply:** Include this in the primary definition, not only a request
table. Distinguish Abstract GTs from Enter GTs for executable Abstractions.
Do not reduce hierarchical issuance to raw Owner/payload packing or invent
hierarchy routing/bit encodings without specification.

For Phase 1 (V1.1), Mint's only primary public functions are CREATE and
DESTROY. REPLACE is outside this phase. Credential creation/destruction
are cases of these functions, not extra Forge/Revoke public verbs.

**Why:** The user narrowed the scope explicitly: “For Phase 1.1 we dont need
REPLACE, just CREATE and DESTROY.”

**How to apply:** Use the two-function definition, lambda selectors and
implementation scope for V1.1. Preserve historical evidence as history,
not the current design; do not silently migrate compiled selectors or infer
object-specific effects.

DESTROY means destruction of the selected object, not a menu of hide, detach,
disable or unspecified lifecycle alternatives.

**Why:** The user challenged the unresolved-semantics disclaimer: “Destroy
means DESTROY??”

**How to apply:** State destruction directly. Keep implementation questions
separate from that meaning; preserve immutable GT words, the slot-release
generation rule, and the distinction between a credential and its target.

Mint must work hand in hand with garbage collection.

**Why:** The user explicitly required their API to be designed together, not
as unrelated allocation and collection services, and requested that their
interworking be included in the Mint definition.

**How to apply:** Coordinate creation, destruction and binding transitions
with collection. Keep explicit destruction distinct from unreachable-object
collection; do not treat proposed GC interfaces or concurrency rules as approved.

Mint must acknowledge and own every bit of every immutable GT case and be
identified up front as the version master, with the complete bit format shown.

**Why:** The user explicitly requested this ownership statement and bit-format
presentation before further Mint definition detail.

**How to apply:** Cover NULL, Inform, Outform and Abstract interpretations,
not just the reference layout. Keep issued GTs immutable, software version
ownership distinct from hardware runtime comparison, and Abstract payload
identity distinct from the Inform/Outform generation field.

Label Domain bit 27 explicitly as **DATA (0) vs CAPABILITY (1)** in the
GT Field/Case list, not only in the bit diagram or permission descriptions.

**Why:** The user corrected its omission from the Field/Case presentation and
specified these domain names.

**How to apply:** Include a dedicated Domain row for Inform/Outform; retain
Abstract's separate Owner-field interpretation.

Keep the Mint V1.1 definition focused on the current definition, without
earlier thoughts, superseded alternatives or implementation-history commentary.

**Why:** The user explicitly requested removing text about earlier thoughts
to keep the definition simple.

**How to apply:** Preserve current requirements and clearly undefined details;
do not turn historical discussions into additional definition clauses.

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
