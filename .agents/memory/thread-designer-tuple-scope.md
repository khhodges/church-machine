---
name: Thread designer tuple and rollback scope
description: User-directed extension of Thread design and its Alice acceptance example.
---

The Thread designer must cover the Tuple Store and rollback/checkpoint concepts, not only the Thread's register and stack layout. Use the Alice Save LUMP rejection as a concrete diagnostic and tuple-storage acceptance example.

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
