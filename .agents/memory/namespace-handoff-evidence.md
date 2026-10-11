---
name: Namespace handoff evidence
description: Discriminating fixtures and limits of mirrored-table transition evidence.
---

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

Handoff errors, including interrupted context-save/restore errors, take the
existing hard-fault path. Do not require a new handoff recovery/rollback/retry
policy or reopen CHANGE semantics to unblock active-Namespace implementation.

**Why:** The user explicitly rejected treating these as new design questions:
CHANGE must work as already required, and any handoff problem must hard-fault.

**How to apply:** Fix implementation defects against the approved CHANGE
contract. Verify fault containment and absence of partial-context execution;
do not substitute automatic recovery or assume completed writes were undone.

Do not grant L/S to a permissionless Thread operand or seed active ownership
to make a full-core handoff fixture proceed. Ordinary activation must establish
the owned bridge before interruption of its suspension can be evidence.

**Why:** A legacy execution path or scheduler bypass can reach context writes
without establishing that the normative programmatic instruction can do so.

**How to apply:** Stop at an ordinary-instruction blocker, retain a fail-closed
acceptance gate, and label unreachable write/recovery checkpoints unproved.
