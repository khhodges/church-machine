---
name: Thread designer tuple and rollback scope
description: User-directed extension of Thread design and its Alice acceptance example.
---

Build-retained tuple definitions are annotations, never initialization authority.

In the transaction/tuple discussion, the user clarified: “the self-GT is the
Amoeba that can save GTs against pet names.”

**Why:** This identifies Amoeba's role in named GT storage in the user's model.

**How to apply:** Preserve this contextual meaning when discussing tuple access
and transaction identity. Do not generalize it to every abstraction's SELF GT,
invent a new storage service, or infer an ABI or implementation authorization.

Only explicit approval may freeze a design for a future build; inspection must
not retrofit browser definitions onto historical bytes or infer allocation from
nonzero heap contents.

**Why:** The user requires named tuple evidence tied to the exact image and
individual Thread identity while leaving heap initialization and hardware unchanged.

**How to apply:** Preserve approval and byte-generation as separate actions.
Display retained names only when image and Thread-body evidence match; otherwise
say the definitions were not recorded.

Tuple approvals must retain the complete browser design identity, including
Thread and Namespace names as well as slot and generations.

**Why:** Renaming or rebinding a saved Namespace row does not necessarily advance
its sequence; slot plus generation alone can transfer another Thread's annotations.

**How to apply:** Recheck authoritative names during approval and new-build
capture. A same-generation replacement must leave old definitions unrecorded,
not inherit them merely because its geometry matches.

The Thread designer must cover the Tuple Store and rollback/checkpoint concepts, not only the Thread's register and stack layout. Use the Alice Save LUMP rejection as a concrete diagnostic and tuple-storage acceptance example.

Treat Threads as individually designed objects: the user states that all three
Threads in a build can differ, including tuple stores and design sizes.

**Why:** One Thread layout accompanied by a Thread count does not describe a
heterogeneous build.

**How to apply:** As-built inspection must follow each Thread's own Namespace
descriptor and built body. Show tuple capacity separately from named tuple
definitions; design-only definitions must not be presented as built evidence.

The tuple heap and initialized GTs are also per-Thread, including Alice and
Mallory's initial capabilities.

Initial Data Register values and CR capability assignments must be configurable
per Thread on the Thread design page, carried through the explicit build, and
displayed from the resulting bytes on Namespace — as built.

**Why:** The user explicitly rejected separate scripted Alice/Mallory
initialization as a substitute for the IDE workflow: both Data Registers and
CRs can be customized by the IDE.

**How to apply:** Treat initialization as authored Thread design, not just
browser drafts or lab setup. Preserve independent values per Thread and the
distinction between editable intent, committed initialization and live state.
This requirement does not authorize flashing hardware.

**Why:** The user explicitly clarified that each Thread has its own tuple heap
and initialized GTs; displaying one common layout loses those distinctions.

**How to apply:** Inspect each Thread's own built storage and capability homes.
Keep initialized image contents distinct from live runtime contents, and resolve
GT names only against matching Namespace evidence.

The user identifies the existing five-zone Thread page as the location for
defining tuples, associated with the CR5 heap zone.

**Why:** Tuple definitions should be configured alongside the Thread's storage
layout, rather than confused with the existing live-simulator record editor.

**How to apply:** Extend that existing page for saved-design tuple definitions;
keep runtime inspection and deployment separate. This location decision alone
does not authorize hardware changes.

Tuple-definition saving must remain separate from boot-layout submission.
Browsing to another design page must not implicitly submit geometry; rejecting
a layout review must leave the user on the page where they requested it.

**Why:** The user approved separating these actions after tuple work exposed an
unrelated proposed Thread/stack resize and rejection still navigated onward.

**How to apply:** Keep local design persistence, boot-configuration review, and
page navigation explicit. Never compile unrelated editor source as part of a
Thread geometry save.

**Why:** The user identified the unexplained browser-alert failure as an opportunity to test the tuple-store mechanism and explicitly requested extending the Thread designer.

**How to apply:** Connect source diagnostics to visible storage definitions and allocation review. Preserve Alice's intended authority boundaries; shared Thread storage is not automatically abstraction-private. Distinguish design reservations, runtime tuple edits, saved LUMPs, and continuation restoration. This scope direction does not resolve the outstanding checkpoint, running-bit, or hardware contracts.

Clarify privacy across abstractions, Threads, Namespaces, and Church Machines before assigning privacy labels to designer storage.

**Why:** The user explicitly requested clarification of privacy rules at all these levels after discussing the tuple-store extension.

**How to apply:** Separate containment, authority, lifetime, and administrative/debug access. Present unresolved policy as proposed, not as an existing hardware guarantee.

Namespace encapsulation supplies the enclosing Thread privacy boundary; Thread tuples do not themselves supply abstraction-to-abstraction privacy within that Thread.

**Why:** The user explicitly distinguished Namespace-guaranteed Thread privacy from tuple storage, which does not create the same encapsulation.

**How to apply:** Describe privacy relative to the boundary: Namespace-external versus within-Thread access. Do not imply that tuple naming, typing, or allocation creates an independent security boundary, or that Namespace encapsulation makes every Thread private from all peers within its Namespace. Keep architectural guarantees distinct from implementation qualification.

Do not introduce tuple-specific security capabilities, ACLs, or a parallel privacy mechanism. When state requires isolation from other abstractions sharing a Thread, require a separate Thread and communication through Dijkstra messages, governed by existing capabilities.

**Why:** The user corrected the proposed tuple-privacy direction: capabilities are the bedrock; do not reinvent them for tuples.

**How to apply:** Tuple services handle structure, allocation, bounds, and lifetime, not a new security policy. The designer should direct isolation requirements to Thread separation and existing capability-authorized messaging. Do not invent message protocol details or claim this direction proves implementation readiness.

Use **Transaction** (initially written “Trasaction”, subsequently “transaction” by the user) for shared Thread activity. Model a private Namespace as an extension of an individual for private, secure tasks, with examples such as “Phone Mum”, “Make supper”, and “Ask Claude.ai”. The user requests this abstraction as part of Amobea and a Phase 1 demonstration objective.

**Why:** The user supplied this product vocabulary and person-centered interpretation explicitly.

**How to apply:** Explain cooperating abstractions and shared tuples in terms of a Trasaction's task. Keep existing capabilities as the authority foundation and Dijkstra messages for communication with isolated Threads. The term does not itself promise database atomicity, rollback of external effects, or privacy from an external service receiving an authorized message.

The augmented Thread designer prototype is restricted to Phase 1 tuple storage and Amobea.

**Why:** The user explicitly narrowed the requested design view to these concepts.

**How to apply:** Keep prototype work isolated until integrated under the subsequent approval below, and preserve the prior prototype. Do not expand the view into hardware programming, Namespace building, or real external integrations. Unresolved rollback behavior is design-only.

The Individual-facing Amobea view and augmented Thread designer are approved for the IDE as additions, NOT replacements.

**Why:** The user explicitly approved additive IDE integration after reviewing the distinction between the Individual's everyday-task interface and the technical Thread designer.

**How to apply:** Preserve existing IDE views and functionality. Add the new entry points alongside them; do not replace technical tools with the simplified Individual interface. Approval to integrate the views does not authorize external service execution or resolve the Phase 1 runtime contracts.

Use tuple storage for the Alice/Mallory containment demonstration, with existing capability enforcement as the evidence boundary.

**Why:** The user explicitly requested the tuple option for this containment test. Older Alice/Mallory fixtures can outlive the ISA they encoded; fixture names alone do not establish current execution compatibility.

**How to apply:** Validate actual instruction retirement and first-fault evidence under the current simulator contracts. Separate fixture setup, complete-record integrity checks, simulator results, and hardware acceptance; never represent an isolated denial test as proof against every attack.
