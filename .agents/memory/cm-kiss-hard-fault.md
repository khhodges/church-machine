---
name: CM KISS and hard-fault default
description: Prefer first-fault detection and correction over recovery strategies or hidden continuation mechanisms.
---

KISS is a confirmed standing CM design rule, not a pending review proposal.
The user directs that faults default to a hard fault rather than initiating
new recovery strategies.

**Why:** The user's engineering rationale is that sound software construction
exposes faults on first occurrence, they are fixed promptly, and removing
their causes improves MTBF. Recovery machinery is not the design priority.
The assistant had overcomplicated the Namespace review with speculative
recovery strategies and must not keep reopening those alternatives.

**How to apply:** Preserve the required authority, version, type, bounds, and
context checks; fail hard on violations. Do not add retries, alternate targets,
silent repairs, automatic continuation, transactional rollback, or new
recovery protocols to make a handoff succeed. Keep fault attribution and
diagnostic evidence useful for correcting the cause. Hardware never changes
version numbers; authorized software management owns version-based
blacklisting. Boot Thread faults retain the specified purgatory outcome.
The PP250 remote-spare example is separate system-level precedent, not
permission to add recovery machinery inside the CM.

Existing explicitly agreed architectural fault behavior is not authorization
to invent additional recovery mechanisms, nor does this principle authorize
silently deleting existing fault handling or altering retained artifacts.

The user reaffirmed this rule during the Phase 1 Mint Q&A: “Any fault is a hard
fault.” Apply it to Mint, its same-scope NSRW-GT LAMBDA and pkverify, including
failed authorization/verification/validation checks, rather than drafting
recoverable rejection returns. Hard faults do not imply rollback of prior writes.
