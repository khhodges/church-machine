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

List every Mint implementation blocker first, then review, simplify and
resolve them one at a time with the programmer.

**Why:** The user explicitly required each blocking problem to be listed
and individually reviewed, simplified and resolved before proceeding.

**How to apply:** Distinguish design decisions from ordinary source work.
Do not treat compiler diagnostic counts as separate design blockers or
assume every mechanism in a proposed interface must be retained. Do not
bundle unresolved issues into a single implementation approval.

Do not treat CREATE's proposed 12-word CR4 request as an approved interface.
Review its inputs individually with the programmer before fixing the layout.

**Why:** When asked whether that record was intended, the user answered
“No—review CREATE’s inputs first” and “One by one take me through them.”

**How to apply:** Explain one proposed input, distinguish requirements from
assumptions, and obtain its decision before moving to the next input.

After CREATE input review, develop its easiest RW Data path before moving
to another Mint method.

**Why:** The programmer explicitly rejected moving on to DESTROY and requested
writing CREATE on the RW Data path first.

**How to apply:** Keep the next implementation review focused on that path.
Do not expand into other creation cases or substitute an API-only discussion
for writing the ordinary instruction body. Missing protected service bindings
must remain explicit, not be replaced by host authority or success stubs.

CREATE's Namespace case uses an LS GT to a source C-list; under this
CREATE-specific convention originally selected Namespace creation without a
separate kind argument; the later packed-size decision below selects the case.
The contained GTs retain their individual permissions, not uniformly LS.

**Why:** On 2026-10-18 the programmer explicitly confirmed this case, including
separate allocation size, Passkey memory authority, and a NONE/B=0 result.

**How to apply:** Preserve that case decision without treating it as approval
of the whole register ABI. Apply the later packed-size rule for case selection.
The public case approval is in the CREATE reset review.

CREATE has no caller-supplied interface-version input.

**Why:** In the individual input review, the user explicitly chose to remove
the proposed version field; no multiple-request-format requirement was established.

**How to apply:** Do not reintroduce the `0x0101` request constant or its
mandatory input check when implementing the reviewed CREATE interface.

Mint creates Inform objects, never Outform objects. A credential is one case
of Abstract, not a separate category alongside Abstract.

**Why:** During CREATE's input review, the user explicitly corrected both
categories in the proposed eight-way object-kind selector.

**How to apply:** Do not retain Outform creation or a separate Credential kind
from the earlier draft. Do not equate all Abstract cases with credentials.

CREATE has no separate kind, GT-type, or Inform DATA/CAPABILITY Domain argument.
The later packed-size decision selects the creation case; the supplied definition
must agree and provides object details.

**Why:** The user selected “No—use the kind in the supplied object definition”
when reviewing object kind, then “Yes—remove the separate GT-type input”
when reviewing GT type, and “Yes—remove the separate Domain input.”

**How to apply:** Remove the redundant kind, GT-type and Domain selectors when
implementing the reviewed interface. This decision does not settle the remaining inputs or
authorize a new object-definition format.

CREATE packs the exact creation case 1–4 into the unused bits of its power-of-two
allocation-size argument: Namespace, Thread, Abstraction, Data in review order.

**Why:** On 2026-10-18 the programmer resolved the R/RW source ambiguity by
pointing out that the power-of-two size leaves space to pack the case.

**How to apply:** Use the packed case rather than inferring creation kind from
source permissions or guessing whether bytes look like a LUMP. Do not add a
separate argument. Decode size before allocation accounting. The low-three-bit
layout is an engineering proposal, not a separately approved ABI.

Abstract GT Owner is derived from its owning abstraction, not a separate
caller-supplied numeric input.

**Why:** The user selected “Yes—derive Owner from the owning abstraction.”

**How to apply:** Do not restore the old independent Owner field when defining
CREATE's reviewed interface.

Do not expose every encoded GT field as a separate CREATE argument. The
agent's raw Abstract-payload input proposal was withdrawn as unjustified.

**Why:** The user asked “Too complex where did it come from??” when presented
with the proposed raw-payload decision. Its origin was the agent's scalar
request draft, not a user requirement.

**How to apply:** Start from the supplied GT/LUMP and established allocation,
permission and Passkey requirements. Distinguish executable Abstraction LUMPs
from Abstract GT interpretation; do not infer a new payload protocol or alter
the GT encoding from withdrawal of an API proposal.

CREATE retains a separate requested-permissions input. Threads and Namespaces
always use NONE. Church choices are E, LS or L only, not S alone.
Data choices are RW, R or W only, with no Execute. Permission choices are
category-specific, not unrestricted bits.

**Why:** The user explicitly retained this input and said “Threads and Namespace
are always NONE.” Data was specified as “all or one (R or W)” and Church as
“E or LS or L or E,” then explicitly clarified to “E, LS and L only.”
The user clarified Data “all” as “Read + Write only (RW).”

**How to apply:** Preserve those restrictions; do not add S alone for Church
or Execute for Data. Do not implement the old draft's unrestricted 0..7
permission range as the approved CREATE contract.

CREATE has no caller-supplied B input. Mint sets B=1 on returned GTs except
Thread and Namespace GTs, which always use B=0 and permissions NONE.

**Why:** After selecting “Mint always sets B = 1,” the user explicitly qualified
it: “Threads and Namespace never use B=1” and must be guarded by a Passkey.

**How to apply:** Keep this issuance rule distinct from CALL boundary semantics.
The user's question about whether CALL always clears B is not approval to alter
CALL; reconcile the specification before relying on automatic clearing. B=0
does not replace Passkey authorization; see [Passkey rules](top-security-passkeys.md).

CREATE takes allocation size separately from the caller, subject to the
Passkey's remaining memory count covering it; allocation adjusts that count.
Allocation sizes are always rounded up to a power of two.

**Why:** The user retained the size input, qualified by “provided the Passkey
still has positive memory count to match, the count is adjusted accordingly.”
The user then specified “always rounded to power of 2.”

**How to apply:** Do not treat Passkey validation as an unlimited allocation
grant or accept a positive balance too small to cover the allocation. Use the
rounded allocation for both the allowance check and deduction so accounting
matches reserved memory. No new Passkey storage format or fault-recovery policy
is chosen by this rule.

CREATE initialization uses a passed GT with object-specific meaning, not a
uniform source-buffer copying contract. Namespace input identifies preformatted
slots; Thread input is the E-GT of the application abstraction Amoeba will
start, not Amoeba itself or a formatter routine. Mint always primes a Thread
with Amoeba; do not bypass that priming with a direct application entry.
For an Abstraction, the GT identifies the defining LUMP.

**Why:** The user redirected the review: “lets agree to pass GT instead,” then
specified Namespace slots and the Thread's E abstraction. This supersedes the
generic buffer framing, not the separate allocation, permissions or Passkey rules.
The user then clarified that Abstractions are complex structures better defined
by LUMPs and selected “The abstraction the Thread will start in” for the
Thread's E-GT, then specified “Mint always primes a thread with Amoeba.”
The user resolved their relationship by selecting “The application abstraction
Amoeba will start.”

**How to apply:** Do not impose a temporary buffer or retain a redundant content
length merely from the older proposal. Do not CALL the supplied Thread E-GT
as an initializer. Preserve the fixed Amoeba priming and supplied application
target as distinct roles; do not invent the handoff ABI. Keep rounded allocation distinct from readable source
extent. Do not invent a second scalar format for Abstraction creation in place
of its LUMP.

CREATE's Abstraction case accepts an R or RW GT to the defining LUMP.
Source W is unnecessary; returned rights are independently requested as
E, LS or L, with B=1. Mint zero-fills remaining allocated space.

**Why:** On 2026-10-18 the programmer explicitly confirmed this complete case,
including separate allocation size and Passkey authority, without a second
description record.

**How to apply:** Keep source read access separate from returned permissions.
Do not require writable source LUMPs or caller padding. This approval does not
independently settle case selection; apply the later packed-size decision.

Data CREATE allocates separate storage and returns it entirely zeroed. It takes
no initial payload; this supersedes the earlier R/RW source-GT approval.

**Why:** After challenging why Mint should read potentially top-secret data,
the programmer selected “No—create separate storage” and added “And return it
clean(all zero)”.

**How to apply:** Remove source reads, source-length plumbing and copying from
the Data path. Zero the entire allocation before issuance, not just a remainder.
Keep Passkey allocation accounting and requested RW/R/W result permissions.
Do not replace allocation with a new GT alias for existing storage. This removes
payload exposure during CREATE; it is not proof of post-return confidentiality
without controlling retained allocator authority.

CREATE sets its Namespace slot through Mint's private same-scope LAMBDA body.

**Why:** The programmer explicitly directed “Set the slot as well using LAMBDA”
after choosing separate zero-filled Data allocation.

**How to apply:** Keep Namespace RW authority inside the private Lambda, update
the selected slot after zeroing, and confirm writes before issuing the result.
Do not turn the slot body into another public method or treat LAMBDA itself as
atomicity. Trusted binding, metadata validation and exclusion remain required.

Mint instruction evidence must use the real simulator for authority-changing
and control-transfer behavior, not just an assembler or hand-written walker.

**Why:** The first native Data trial exposed two false assumptions in earlier
fragment evidence: TPERM CLEAR tests rather than erases authority, and ordinary
LAMBDA falls through without the protected profile's extra entry/return handling.
The walker had falsely reported cleanup; syntax checks had not tested dispatch.

**How to apply:** Keep hand walkers for arithmetic only, and label test-provided
authority as fixture privilege. Do not port protected-profile semantics into
ordinary code by assumption or add host PC/register mutation to make a test
claim service success. Resolve real erasure and continuation before publishing.

CREATE's Thread case uses CR4 E for its initializer; the later packed-size
decision selects Thread creation. That GT identifies the application Amoeba
will start, not an existing Thread or Amoeba itself.

**Why:** On 2026-10-18 the programmer explicitly confirmed this case, including
requested Thread size, Passkey allocation authority, Mint's Amoeba priming, and
a NONE/B=0 result. This resolves the earlier concern about selecting Thread
creation without an independent kind argument.

**How to apply:** Preserve this method-specific convention without conflating
the input application's identity with the new Thread's identity. Do not restore
a separate numeric kind argument. Apply the later packed-size decision for
case selection. The detailed Amoeba handoff remains unresolved.

Unfinished Mint must be available as an editable source draft. Implementing
the method APIs with supported input/result checks is an authorized minimum;
unfinished bodies must be explicit, not grounds for withholding the source.

Mint's native instruction source must display as Assembly when opened and
compiled, rather than inheriting JS from another document. Each TODO must
identify its exact API method and the missing check or operation.

**Why:** The user again reported the wrong language and explicitly required
method-labelled TODOs and input correctness checks against the API.

**How to apply:** Preserve source language across editor navigation and
structured-method compilation. Distinguish implemented scalar/permission
guards from unresolved GT-type, authorization and object-specific checks.

**Why:** The user challenged keeping Mint out of the editor and explicitly
requested coding each method's API and input/result type checks first.

**How to apply:** Expose the draft through the existing source-file editor
without replacing live Mint or an owned editor buffer. Keep unsupported
checks and bodies visibly unresolved; never manufacture successful results.

The Phase 1 API/checking source is the current editable Mint, not a separate
optional draft beside an obsolete current version.

**Why:** After seeing the editable minimum, the user requested: “Make it the
latest version of Mint.”

**How to apply:** Continue work on the canonical Mint source and preserve
the previous source as history. Keep unfinished status explicit. Promotion
of editable source is not proof of a successful compiled or installed release.

Phase 1 Namespace labels must open the current authoring target even without
a compiled LUMP, including MMIO mappings and the nstab table definition.

**Why:** The user rejected labels that only searched saved compiled revisions
and explicitly required links for MMIO and nstab as well as Mint.

**How to apply:** Keep source/definition navigation separate from exact
assigned-artifact inspection and installation. Retain editor-replacement
consent and Namespace placement. Disclose a label/source spelling mismatch;
do not silently rename or rebind the selected object.

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

DESTROY's purpose is to reduce garbage and speed up activities through
explicit reclamation when the program is finished with an eligible object.

**Why:** The user stated: “The role of destroy is to reduce Garbage and speed
up activities.”

**How to apply:** Lead with this purpose. Explain how prompt destruction
reduces work left to GC, without promising measured speedups or weakening
the resident/Outform exclusions and safe-release rules.

DESTROY cannot destroy resident or Outform objects.

**Why:** The user explicitly corrected the Mint/GC definition with this
exclusion.

**How to apply:** Enforce it for explicit destruction and GC-requested
destruction before mutation. Do not resolve an Outform or change residency
inside DESTROY to bypass the rule. Releasing an unused Outform binding
is distinct from destroying its target.

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

Namespace links shared with the programmer must explicitly identify the
intended profile; a generic Namespace view is not proof of the same selection.

**Why:** A link opened the older default Namespace instead of Phase 1, and the
user reported it as the wrong, stale Namespace.

**How to apply:** Verify the linked profile and whether its document is actually
saved rather than a generated seed. Do not describe a server-saved document as
including unsaved changes from another browser tab or origin.

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
