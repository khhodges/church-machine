---
name: Next bitstream design scope
description: Approved separate planning view and three-view Switch loop.
---
The user approved a second Image Development view to design the next bitstream with two resident Namespaces and a common memory zone for individual LUMPs, preserving the existing view and working configuration.

The user also confirmed two resident Namespaces for the next FPGA test
candidate, with consequential specification decisions reviewed step by step.

**Why:** Retain the two-Namespace hardware requirement even though the first
native-loading tests exercise one Namespace; avoid an unnecessarily narrow
candidate that requires another build.

**How to apply:** Namespace residency is not executable residency. Keep the
Amoeba-only initial executable test and separate specification approval from
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

**How to apply:** Only Amoeba code starts resident; required structures/data
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
