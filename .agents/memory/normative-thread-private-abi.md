---
name: Normative Thread private ABI
description: Durable ownership and size-derived rules for Church Machine Thread geometry.
---

Thread suspension identity belongs only to the canonical two-word CHURCH return frame on the private stack. Never add a separate executable-identity word to the Thread body; Heap begins immediately after protected context.

**Why:** The user rejected the invented executable-identity field. CR0 is mutable state and can intentionally name a different abstraction from the code being resumed.

**How to apply:** Use the shared Thread layout for geometry. Seed, suspend, and resume through the established CHURCH frame and RETURN-equivalent Enter-GT/NIA validation while preserving the existing private CR/DR homes.

Related durable constraints:
- [Amobea initialization ownership](amobea-thread-initialization.md) — all Threads are to be initialized by Amobea; disposable preinitialized tests do not implement that service.
- [Protected Thread indicator](protected-thread-indicator.md) — protected packing and save/restore ownership.
- [Thread object runtime authority](thread-object-runtime-authority.md) — single context authority, lifecycle labels, and continuation semantics.
- [Thread base address zero](thread-base-address-zero.md) — zero is a valid base, not missing authority.
- [Thread root frame](thread-root-frame-invariant.md) — fresh Threads require the canonical poison root.
- [Thread LUMP placement](thread-lump-placement.md) — saved descriptors control placement, not special-address reservations.
- [Thread designer and Amobea scope](thread-designer-tuple-scope.md) — Transaction vocabulary, shared tuples, capability boundaries, and isolated prototypes.
- [Call-record ownership](thread-call-record-ownership.md) — explicit cooperative reservation, not inferred ownership or new capability revocation.