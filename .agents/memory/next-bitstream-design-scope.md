---
name: Next bitstream design scope
description: Approved separate planning view and three-view Switch loop.
---
For this candidate, Genesis alone issues M authority, exclusively to
SecurityRegulator. Use that mediated path; Namespace ownership and direct
Amoeba M-control are not alternatives.

Genesis is the human configurator using the IDE, not another executable LUMP
or a runtime service to implement. The configurator determines authority
assignments; M-to-SecurityRegulator is the current explicit choice.

**Why:** The user explicitly corrected both the ownership choice and the
mistaken treatment of Genesis as missing software.

**How to apply:** Follow the authoritative issuance rule in
[M-bit I/O object](m-bit-io-object.md). The approved initial executable baseline
is now Amoeba plus SecurityRegulator; do not grant raw M to Amoeba.

The user approved **Amoeba and SecurityRegulator as the two initially resident
executable LUMPs**, available throughout the run. All other executable
dependencies remain initially absent and must load lazily.

**Why:** SecurityRegulator's central role warrants availability from startup,
avoiding a dependency on loading the regulator before privileged operations.
This explicitly supersedes the only-Amoeba residency rule for this candidate,
not the historical single-loader test.

**How to apply:** Include both footprints in the 128 KiB budget, preserve
Genesis-only issuance exclusively to SecurityRegulator, and do not describe
the resulting candidate as an only-Amoeba test. Residency grants no authority.

The user approved a second Image Development view to design the next bitstream with two resident Namespaces and a common memory zone for individual LUMPs, preserving the existing view and working configuration.

The user initially approved creating the two named candidate review drafts as
independent copies of New Layout. They subsequently authorized auditing and
correcting both drafts' settings and slots, not activating them.

**Why:** The immediate request was to open and inspect each Namespace in the IDE.
Identical initial contents were intentional starting points, not evidence that
the proposed service/application separation was implemented.

**How to apply:** Correct draft membership and policies without replacing
historical LUMP bytes or inventing grants. Unresolved implementations and new
Thread continuations must remain explicit. A schema-valid layout is not a
qualified two-Namespace image; compilation, binding and activation remain
distinct from editing the drafts.

The user selected a **separate AppSystem LUMP**, not an application-entry method
in shared Amoeba. AppSystem remains Lazy and must be loaded by Boot-side Amoeba
before the first application Namespace dispatch.

**Why:** The user explicitly selected the separate-LUMP option in the native
services review. This preserves the two initially resident executable identities.

**How to apply:** Treat this as a software-structure decision, not evidence of
implementation, tested startup or approval of additional grants. Native service
qualification remains open.

SecurityRegulator is to be Resident and locally addressable in both Namespaces,
at slot 23 in the reviewed layout.

**Why:** The user proposed adding it to both Namespaces to avoid requiring a
SWITCH before AppSystem can invoke the regulator that performs that SWITCH,
then directed the review to continue.

**How to apply:** Preserve SR-only M custody. Local presence is not an invocation
grant; exact private M-control bindings and shared-versus-copied physical code
remain separate decisions. Do not claim the application draft has been updated
or that runnable regulator code exists merely because this design is settled.

The user also confirmed two resident Namespaces for the next FPGA test
candidate, with consequential specification decisions reviewed step by step.

**Why:** Retain the two-Namespace hardware requirement even though the first
native-loading tests exercise one Namespace; avoid an unnecessarily narrow
candidate that requires another build.

**How to apply:** Namespace residency is not executable residency. Keep the
two-LUMP initial executable baseline and separate specification approval from
implementation, vendor-build and physical-operation authorization.

The next test candidate targets the second Wukong V3 used for the recent
physical demonstrations.

**Why:** The user selected that board to retain the established board/toolchain
baseline.

**How to apply:** Treat this as target selection only, not permission to alter
its installed image or proof that newer runtime changes are installed.

The user approved the first test inventory: Boot/service holds Amoeba,
CapabilityTest, SelfTest and WukongCallHome; application has a Slot 2 starter
and separate Alice/Mallory Threads. Mint/Cleaner and read-only retirement are
later software test stages, with interface/capacity checks before hardware freeze.

**Why:** Establish native loading and legitimate progress despite deliberately
rejected attacks before expanding lifecycle acceptance.

**How to apply:** Amoeba and SecurityRegulator code start resident; required structures/data
are distinct from executable residency. Inventory approval does not settle
cross-Namespace dispatch, scheduling or fault recovery.

The user approved explicit cross-Namespace Lazy servicing: USER LLR enters
its local Slot 2; that SYSTEM records origin and request, explicitly SWITCHes
to Boot/service Amoeba, then returns through application Slot 2 and CHANGE
to the ready USER.

**Why:** Preserve Namespace-local LLR and fixed Slot-2 SWITCH entry rather
than introducing an implicit global SYSTEM transfer.

**How to apply:** Retain full Namespace/Thread identity and explicit grants.
Approval is for the route, not a completed request ABI, provisioning mechanism,
startup bootstrap, scheduler, fault policy or implementation.

The user approved automatic repeated Mallory attacks in the first containment
test: record each rejection, initialize a fresh authorized Mallory attempt,
and verify Alice's retained protected state and progress between attempts.

**Why:** A single rejection does not demonstrate sustained useful service
through repeated deliberate attacks.

**How to apply:** Do not resume the faulted context or skip its failed
instruction. Bring any required fresh-Thread initialization subset into initial
test scope; general lifecycle work remains separate. Exact reset/grant/version
mechanisms still need design and evidence.

The user approved a provisional aggregate memory target of 128 KiB for
resident allocations plus 16 KiB isolated incoming-LUMP staging, at the
retained 25 MHz functional-test target.

**Why:** Accommodate both resident Namespaces and the agreed test workloads
without treating the earlier 64 KiB demonstration as a capacity requirement.

**How to apply:** This is not a fixed 64 KiB partition per Namespace, measured
resource fit, or approval to implement SD/Ethernet. Verify exact allocation,
overhead, staging limits and new timing/resource results before freezing.

The user approved the candidate's acceptance gates, including 100 rejected
Mallory attempts and a read-back-verified Alice update after every rejection.

**Why:** Define measurable bounded containment rather than infer success from
one fault, a console PASS or successful byte transfer alone.

**How to apply:** Keep generation/counter headroom without wrap, never
reinitialize Alice, and distinguish local, vendor and physical evidence.
The count is a functional target, not MTBF or full W7 closure.

The user selected maintained RTL as the next candidate's source base, with
explicit reconciliation against the retained successful Amoeba snapshot.

**Why:** Preserve newer maintained fixes rather than treating an older passing
snapshot as the complete future platform.

**How to apply:** Keep historical evidence immutable and freeze a new manifest
after reconciliation. Source selection does not authorize implementation,
vendor builds, saved-image replacement or physical operations.

The user confirmed that this candidate preserves Boot.Thread's saved
continuation on fault entry, not a fresh offset-zero handler.

**Why:** Maintained RTL and the later recovery direction preserve Boot's
service continuation; older fresh-handler wording must not reintroduce a
separate handler selector.

**How to apply:** Distinguish Boot's valid continuation from Mallory's faulted
context, which remains non-resumable evidence. Verify fault processing with
outstanding service work and retain catastrophic Boot-entry failure behavior.

The user approved combined stopped installation: replace both Namespaces with
one complete 128 KiB allocation-area image, initialize the separate staging
area, verify received RAM and require a separate authorized START.

**Why:** Keep the first test platform's installation mechanism bounded;
independent Namespace replacement introduces additional state/reference rules.

**How to apply:** Installation starts a new test run and replaces volatile
state, including Alice's value. Never use it as ordinary attack recovery.
Partial/invalid installs remain stopped; no rollback promise or new sender-
authentication claim. Physical installation still requires separate approval.

The user authorized the first isolated memory/admission code and local-test
stage, with a stop for review before later integration.

**Why:** Begin bounded engineering after the candidate decisions rather than
treat every internal implementation detail as a separate approval question.

**How to apply:** Preserve historical profiles and evidence. Do not extend
this approval to vendor builds, board operations, saved-artifact changes,
Namespace-aware scheduling or fresh-Mallory integration. Report core-facing
foundation evidence separately from a runnable core/top demonstration.

The user subsequently authorized isolated maintained-core/trusted-Boot
integration, including BOUNDS for otherwise-admitted misaligned/out-of-range
ordinary RAM accesses, truthful acceptance, and retained Boot continuation.

The user selected **one LUMP transfer at a time** for this first bitstream.
This serializes delivery, not Namespace residency or runnable Thread execution.

**Why:** The user chose the simpler first-bitstream path after clarification
that both Namespaces remain resident and runnable Threads can still take turns.

**How to apply:** Do not implement concurrent staging transfers for this
candidate. Retain each request's originating identity across Namespace switches;
a slot number alone is not a globally unique destination.

Qualified candidate delivery uses a separately identified wire profile rather
than redefining legacy slot-addressed messages. Its record table must be frozen
with the host delivery inputs and installation epoch.

**Why:** Two resident Namespaces may use identical target slots; interpreting
legacy slot messages as global record identifiers could silently misroute bytes.

**How to apply:** Keep old receiver profiles unchanged. Require a fresh,
non-reused epoch when replacing the provisioned table; cancellation must not
reuse transaction identifiers within an epoch.

Entering maintenance cancels runtime delivery before an installation BEGIN;
it does not independently reset the executing CPU or the UART transmitter.

**Why:** Installer and runtime traffic must not compete for staging or serial
ownership. A packet arbiter that retains a cancelled producer can otherwise
block every later installer reply.

**How to apply:** Release abandoned packet ownership while allowing an already
transmitting byte to finish. Host delivery must resynchronize truncated
requests; leaving maintenance alone must not reset the transaction counter.

Device rejection that depends on write data must inspect the original issuing
engine payload, not the data bus after the fault-stash mux.

**Why:** Native MMIO integration exposed a real combinational cycle from
device rejection through fault-code selection and stash data back to rejection.
RTLIL conversion catches this even when simulation guards appear mutually
exclusive. Capturing fault identity must likewise avoid using post-SWITCH Boot
identity or creating a same-cycle cancellation/admission feedback loop.

**How to apply:** Keep the recovery and original device operands distinct and
sample terminating Namespace/Thread at the original fault edge. Recheck
elaboration whenever MMIO validation or fault routing changes.

A larger RAM fabric does not establish that every capability restoration path
accepts high-bank objects. Test saved home capabilities and Namespace switching
as well as direct program reads/writes.

**Why:** Native cross-root integration found private SWITCH and startup
activation resolvers still using the smaller profile after basic high-bank
execution already passed.

**How to apply:** Exercise high-bank capabilities in initial homes and incoming
Namespaces using exact compiled instructions; preserve the historical profile
defaults rather than globally changing the meaning of old descriptors.

Keep the next work focused on the shortest path to this candidate bitstream:
candidate-specific checks and exact build preparation, not unrelated legacy
test cleanup or additional side projects. Stop before synthesis for approval.

**Why:** The user explicitly questioned distractions and agreed to prioritize
the bitstream. Unrelated failures reproduced on the baseline are not new
release blockers for this work.

**How to apply:** Fix actual candidate defects; report unrelated baseline
failures without expanding the scope. Distinguish a diagnostic installation
image from the approved two-LUMP resident candidate before freezing build inputs.

**Why:** Fabric error outputs alone do not prevent instruction engines from
reporting success; the real core must consume the checked access outcome.

**How to apply:** Preserve existing authority fault reasons and prior accepted
effects; no false read results, dropped writes, retries or faulted-context
resumption. Keep vendor/physical operations and later scheduler/Mallory
integration outside this authorization, and stop at unresolved interface rules.

**Why:** The next platform layout needs a separate design workspace, not modification of the demonstrated image.

**How to apply:** Use the Switch loop Namespace Designer → Image Development → Next Bitstream Design → Namespace Designer. Sizes and slot counts remain undecided. This approval covers the design workspace, not synthesis, flashing, board changes or automatic cross-Namespace access.

Unsaved planning state must survive replacement of the embedded frame during
Switch navigation, not only React visibility changes.

**Why:** A full browser selection test showed that returning through the IDE can
reload the frame and discard component-local drafts despite keeping both React
views mounted.

**How to apply:** Retain the draft in the owning IDE tab's memory without making it
a saved Namespace or hardware input. A full IDE page reload still clears it.

Dropdown acceptance must include choosing an item and checking the resulting
label, not merely observing that options exist or a popup opens.

**Why:** Repeated user reports contradicted popup-only audits. Automated desktop
success alone does not establish success in the user's nested preview or touch
environment; distinguish tested behavior from an inferred root cause.

**How to apply:** Check both A/B independently, focus-loss ordering, and the
user's viewport. Do not describe an untested browser-specific cause as proven.

Prefer in-page Namespace choice menus over native select popups in the embedded
IDE, including Namespace Designer, not just the A/B planner.

**Why:** The user repeatedly reported that the menu itself would not open even
after option-refresh and missing-catalog fixes. Passing DOM tests do not establish
native popup behavior in their embedded browser.

**How to apply:** Preserve draft guards, show rejected transitions inline, and
keep open menus and focused choices stable across background renders. Do not
claim the underlying browser cause is established.

The user wants A/B alternatives as left-side tabs with individual LUMPs in one
Memory Glass and bidirectional selection between membership rows and glass.

**Why:** The design workspace must make Namespace-to-LUMP relationships visible.

**How to apply:** The user explicitly rejected both equal-height schematic bands
and overlapping A/B comparison lanes. Both Namespaces must coexist in one
physical memory map with strictly disjoint allocations and proportional sizes.
They run concurrently, executing sequentially on one FPGA without replacing
memory when switching. Propose relocated ranges without modifying saved inputs;
unknown sizes block placement, and proposed addresses are not a generated or
rebound executable image. Matching artifact references do not grant cross-root
authority or imply permission to share mutable copies.

The Boot Namespace must hold MMIO and NS-GTs and run the abstractions as FPGA
services. Other Namespaces provide their starter Thread at Slot 2. Amoeba is
shared by all Threads and organizes round-robin execution; Threads use CR5 for
private data. The user explicitly confirmed that other Namespaces may contain
additional Threads beyond their Slot 2 starter.

**Why:** The user specified the Boot/service and application-Namespace roles;
duplicating complete standalone boot environments for A and B is not that model.

**How to apply:** Treat these as next-bitstream architecture requirements, not
evidence of an implemented scheduler, authorized hardware change, or permission
to overwrite historical saved Namespace layouts.
