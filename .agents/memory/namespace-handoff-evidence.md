---
name: Namespace handoff evidence
description: Namespace runtime authority decisions and discriminating handoff evidence.
---

## Hard-fault containment and ordinary activation evidence

Handoff errors, including interrupted context-save/restore errors, take the
existing hard-fault path. Do not require a new recovery/rollback/retry policy.

**Why:** The user explicitly requires CHANGE to satisfy its existing contract
and every handoff problem to hard-fault, without assuming writes were undone.

**How to apply:** Verify containment and absence of partial-context execution.
Do not grant L/S to a permissionless Thread operand or seed active ownership
to make an ordinary full-core handoff fixture proceed. Keep unreachable
write/interruption checkpoints explicitly unproved until ordinary activation works.

Two-Namespace transition tests must include destination-only and conflicting-slot
cases, not only a shared transition context with mirrored descriptors.

**Why:** A SWITCH/CHANGE probe executed the target successfully with mirrored
tables despite later lookup still using the old table. A destination-only Thread
exposed the false positive. A changed CR15 and successful target execution alone
do not establish destination-authoritative resolution.

**How to apply:** Retain independent table contents and prove which view governs
lookup. Never repair a probe by changing a host-side table-base variable after
SWITCH. Separate expected-blocker characterization from positive release gates,
and unit lookup evidence from complete core transition/recovery evidence.

## Runtime authority — user review decisions

The user explicitly confirmed that the physical Namespace header itself must
occupy four words (16 bytes), not merely that a descriptor or UI row should
display four words.

**Why:** The user rejected the capacity table's sixteen-word header reservation
and selected a physical format correction, not a relabeling of that reservation.

**How to apply:** Use the approved ascending NST contract: metadata in slot 0,
self in slot 1, entry Thread in slot 2. Do not invent a compact variant of the
old tail-table format or shrink its constant while retaining fields past word 3.
Keep historical images and their actual geometry distinct from new-format images.

The user authorized migrating the saved design and rebuilding its bindings,
rather than keeping the change only as a separate proposed image. Historical
images must be preserved.

**Why:** After being told that the four-word format moves self to slot 1 and the
entry Thread to slot 2, the user explicitly selected saved-design migration.

**How to apply:** This is consent to the saved-design cutover and binding rebuild,
not to hardware programming or activation. Preserve immutable source artifacts
and historical images, and validate the new-format consumers before publication.

The approved target must be visible as the primary Namespace design for inspection;
a warning above the old layout is not a substitute for showing that target.

**Why:** The user explicitly corrected the legacy-only display after approving the
target, because they need to see the new layout to test it.

**How to apply:** Display the deterministic target separately from saved legacy
rows and installed-image evidence. Do not confuse design approval with completed
executable binding, image admission, or activation.

Phase 1 CHANGE and combined SWITCH leave reserved CR13 untouched, including
its M bit. The active Master supersedes the older IRQ-role/clearing decision.

**Why:** The approved Phase 1 contract explicitly excludes loading, restoring
or clearing CR13; the former Namespace-switch clearing rule is historical.

**How to apply:** Follow the active Master rather than reintroducing the older
IRQ policy. CR15.M alone authorizes and is consumed by combined SWITCH.

New-format execution must be selected explicitly rather than silently upgrading
a historical live image. Its execution metadata must not inherit the host's
catalog, native handlers, lazy-loading state or inspection labels.

**Why:** The user approved candidate preparation, not live artifact adoption.
The ascending table and slot-0 header are incompatible with historical images;
retaining their bytes alone does not preserve their execution contract.

**How to apply:** Keep preparation, image approval and activation distinct.
For new-format execution, derive geometry from CR15 and active Thread identity
from CR12; a stored slot number must never imply cross-Namespace identity.

The user answered the first four cache-review questions:

- Namespace identity: “The GT identifies a Namespace.”
- Shared/hidden optimizations: “any hidden optimization is rejected.”
- Caches to switch or invalidate: “None exist.”
- Invalidation handling: “A Hard Fault.”

**Why:** The user rejects introducing hidden runtime caches as a mechanism
for making Namespace handoff work. Architecture must not depend on invisible
slot-identity maps or automatic repair of invalid authority.

**How to apply:** Do not implement per-Namespace hidden execution caches or
silently refresh/repair invalid bindings. Follow GT authority and explicit
architectural validation. These answers concern the first four review
questions; they do not settle carried capabilities, asynchronous loading,
or recovery after partial Thread writes.
Do not infer that every authorized descriptor update must fault merely from
the invalidation answer.

## Namespace isolation

The user states: “different Namespaces are isolated any similarity is ignored.”
Matching slot numbers, generations, names, or bytes must not establish
cross-Namespace identity, access, or a fallback relationship.

**Why:** The user rejected treating numerical similarity as an architectural
ambiguity. Isolation is the specified rule, not an open design choice.

**How to apply:** Treat conflicting and numerically identical fixtures as tests
of isolation, not as grounds for inventing cross-Namespace matching. Discuss
remaining handoff questions in terms of the explicitly valid execution and
recovery context between SWITCH and CHANGE, without presuming carried state
acquires destination authority through similarity.


## Combined Namespace/Thread handoff under review

The user approves a CM-defined Namespace SWITCH requiring CR15.M=1 that begins
CHANGE's outgoing save, loads CR15 at the midpoint, then completes the incoming
Thread activation. They explicitly selected reuse of the existing
`SWITCH CR15, CRs, #row` encoding. Other SWITCH destinations retain their
existing isolated-register LOAD behavior.

**Why:** An ordinary SWITCH followed by a separate CHANGE exposes an interval
with the destination Namespace selected but the outgoing Thread still active.
The proposed instruction would make that transition an explicit architectural
operation rather than hidden instruction fusion.

**How to apply:** Distinguish outgoing save under the old Namespace from
incoming restore under the new Namespace. A microcode midpoint is not a
software-visible retirement boundary or a guarantee of physical write
atomicity. Apply the [CM KISS hard-fault rule](cm-kiss-hard-fault.md) on failure;
do not keep proposing recovery strategies for the transition. No extra Thread
operand, new opcode, or separate programmer-issued CHANGE is needed. Reusing
the encoding changes CR15-target behavior; it does not authorize silently
rewriting retained programs that assumed a Namespace-only register reload.
Implementation and physical-image conformance remain to be established.

The user proposes reusing the Boot selection rule for the incoming Thread:
the third slot, index 2, is the destination Namespace's designated Boot/entry
Thread. In that proposed layout slot 0 is metadata and slot 1 the Namespace
self-entry.

**Why:** A fixed architectural entry slot removes an additional incoming-Thread
operand or hidden selection mechanism from the combined Namespace SWITCH.

**How to apply:** Resolve and validate the destination's actual slot-2 Thread
under destination authority; the fixed index is not a fixed GT generation or
permission bypass. Distinguish cold boot's restore-only activation from
Namespace SWITCH's outgoing save plus incoming restore. This proposal does
not authorize rewriting retained boot images with older slot numbering.

## STANDARD Namespace Thread management

The user places Thread organization in a Thread manager abstraction within the
STANDARD Namespace design. Scheduling and remembering which suspended Thread
to activate are explicit software responsibilities, not hidden Namespace
hardware state.

**Why:** Fixed slot-2 entry does not mean the hardware remembers or resumes
the last Thread active in that Namespace. CR12 identifies the current Thread;
each Thread LUMP holds its own saved continuation.

**How to apply:** Keep Namespace entry deterministic. Entry-Thread code can
invoke a Thread manager abstraction, which holds appropriately authorized
Thread GTs and uses ordinary CHANGE to select a Thread. Do not conflate the
manager abstraction with the slot-2 Thread object or grant the manager
implicit access across Namespace boundaries.


## Interrupted Thread save disposition

The user specifies that a Thread whose context save is interrupted is
blacklisted until management decides its disposition. Mandatory immediate
reinitialization is not the selected policy.

**Why:** Recovery policy belongs to explicit management, not an automatic
retry, resume, or repair performed by the handoff mechanism.

**How to apply:** Keep the affected Thread unavailable for scheduling pending
an explicit management decision. Do not automatically reinitialize or retry
it, invent hidden hardware state, or expand this policy into a new recovery
strategy. Follow the hard-fault default and existing management authority.

The user defines blacklisting as authorized software changing the affected
Namespace slot's version number. It is not a separate hidden blacklist or
an autonomous hardware fault action.

**Why:** Existing GT version validation provides revocation: previously
issued GTs become stale when the slot version changes.

**How to apply:** Hard-fault on version mismatch; never silently update a
held GT to the slot's current version. Constructing a fresh matching GT
from the live descriptor would defeat this revocation mechanism. Do not
treat a fixed slot index as authorization to mint a new GT.

## Hardware must never change versions

The user explicitly states: “Hardware cannot change version numbers ever!”
They also selected leaving the slot version unchanged when an already-stale
GT faults again.

**Why:** The assistant incorrectly implied that fault hardware could advance
Namespace slot versions. Detection and enforcement do not confer management
authority to mutate versions.

**How to apply:** Hardware and fault/transition microcode validate versions
and raise faults without changing them, for first faults as well as repeated
stale-GT faults. Version-based blacklisting is an authorized software
management operation. Do not implement automatic version increments in fault,
CHANGE, SWITCH, or recovery microcode. An already-stale GT still hard-faults;
do not advance the live slot version again because of that stale reference.
The policy does not imply that management remains reachable after a Boot
Thread fault.

## Hardwired entry-Thread GT

**Later approved boot-pair exception:** Slots 1 and 2 of the guarded boot
configuration receive IDE-assigned nine-bit versions whose concatenation is
the 18-bit accidental-mismatch guard. Reset and handoff into this pair use the
bitstream's expected slot-2 version, not necessarily zero. The version-0 rule
below still applies to other Namespace handoffs. Never synthesize either
expected version from live descriptors. See hardwired-recovery-security-authority.md.

The user specifies that Namespace SWITCH obtains the destination's slot-2
Thread GT from “a hardwired value with a version number!”

**Why:** Fixed entry selection must preserve version-based blacklisting.
A hardwired expected GT version does not change when the destination slot's
version changes, so revoking the entry Thread produces a mismatch rather
than an automatically refreshed credential.

**How to apply:** Validate the fixed, version-bearing entry GT against slot 2
in the selected destination Namespace. Retain ordinary Thread/frame checks;
the hardwired value is not a permission or validation bypass. Do not derive
the expected version from the live descriptor, keep a hidden per-Namespace
Thread-ID map, or silently change the constant after a fault. A version
mismatch faults, with the specified Boot Thread purgatory consequence.
The user explicitly selected version **0** for the hardwired slot-2 Thread GT.
Use the permissionless Inform Thread GT required by CHANGE, with slot 2 and
version 0. This is not a LUMP issue number. Do not copy an older differently
numbered boot profile or replace version 0 with a live descriptor's version.

## General fault attribution: GT in the faulting CR

The user first corrected the proposed outgoing-Thread-only handoff policy:
“The Namespace is blacklisted.” They then clarified the general rule:
“This is true for every fault so the answer depends on the GT in the faulting
CR.”

**Why:** Blacklist attribution follows the faulting capability, not a newly
invented source/destination policy for SWITCH or an assumption that the
currently running Thread is always the target.

**How to apply:** Follow the GT in the faulting CR to identify the corresponding
NS entry for software-managed blacklisting; hardware must not change its
version. This applies to all faults, including combined Namespace SWITCH.
A Namespace GT identifies the
Namespace to blacklist; do not select source, destination, both Namespaces,
or the current Thread merely by instruction phase or numerical similarity.
Preserve the faulting GT and its proper resolution context rather than
attributing the fault from registers after recovery has replaced them.

## Boot Thread fault: purgatory

The user specifies: “If it is a boot thread fault the CM is stuck in
purgatory.”

**Why:** The ordinary blacklist-until-management-decides policy must not
presume that management can execute when the Boot Thread itself has faulted.

**How to apply:** Describe a Boot Thread fault as leaving the CM in purgatory,
not as a successful handoff to the Thread manager. Do not invent an alternate
entry Thread, automatic blacklist removal, or an automatic escape. This
statement does not specify a new hardware state bit or whether purgatory halts
or loops. Under the KISS rule, do not treat an unspecified escape procedure as
a requirement to invent a recovery strategy.

## External recovery precedent

The user reports that PP250 detected a missing CPU remotely and transferred
the load to a working spare.

**Why:** Service recovery need not depend on the failed CPU executing its own
management or recovery code.

**How to apply:** Distinguish remote workload failover from restoring execution
on a CM in purgatory. The failed CM can remain unavailable while a spare
provides service. Treat PP250 as the user's historical precedent, not evidence
that remote detection, spare commissioning, or state transfer is implemented
or approved for this project.
