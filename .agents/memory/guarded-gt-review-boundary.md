---
name: Guarded GT use review boundary
description: TRY and service-owned AFB remain proposals; fast fault correction and attack containment govern their design.
---

The user requested an ISA change proposal for review after discussing hostile
API GTs and ARM-style conditions. Treat guarded use as proposed, not approved.
The DREAD-only initial scope and separate-opcode recommendation are engineering
recommendations, not user decisions.

**Why:** Asking for an acceptable proposal does not authorize implementation,
new encodings, or changes to the experimental starter release.

**How to apply:** Obtain explicit semantic and encoding decisions before
changing executable behaviour. Preserve existing hard-fault rules outside any
explicitly approved guarded rejection set. Do not equate a successful individual
access with a lasting SAFE-GT certificate.

## AFB purpose and limits

The user reaffirmed: "Remember the goal to fix faults fast (in test) not
provide automated recovery or rollback and prevent attacks from breaking in."

**Why:** The AFB discussion must not expand fault diversion into a recovery
system or hide bugs that should be corrected at their first occurrence.

**How to apply:** Keep faults visible with their original diagnostic evidence;
retain all authority checks and reject unauthorized effects. A proposed
service-owned handler reports/terminates the failed operation, not automatic
retry, resumption, repair or rollback. Do not promise that partial service state
is safe to reuse. Service-owned establishment after CALL is the current review
direction, not approval of an encoding, catchable-fault set, nested-call
unwinding mechanism or implementation. Caller-selected CALL.AFB was an earlier
assistant suggestion, not an accepted requirement.

## Accepted direction: Amoeba Fault Policy

The user explicitly agreed to retaining the ISA and hard-fault path unchanged
and exploring trusted, bounded service-specific checks after containment.
This supersedes pursuing TRY or AFB as the preferred solution, not their
historical review records.

**Why:** The goal is fast fault diagnosis/correction and preventing unauthorized
effects, not automatic recovery or rollback.

**How to apply:** Scope a software-level post-fault policy using the existing
trusted fault handoff. Preserve original evidence, do not resume/retry the failed
work, and do not treat passing checks as activation authority. Owner-selected
checks must have limited authority; unknown results leave affected work stopped.
Agreement to this direction does not settle the checker ABI or authorize
hardware changes.
