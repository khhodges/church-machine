---
name: Alice and Mallory thread isolation
description: User-directed separate Thread setup for the NewLayout protection demonstration.
---

Run Alice and Mallory in different Threads for the protection demonstration.
The user confirmed priming each Thread's respective actor entry capability
in CR1, not the protected object's capability.

The error case is **one RW data object in Mallory**, with the instruction at
error pinpointed.

**Why:** The user corrected the overly broad fault description and explicitly
required: “This example should explain security not hide it.”

**How to apply:** Distinguish executing Abstraction, affected object, GT, and
Thread. Show the exact instruction, attempted operation, failed check, and
containment evidence rather than a generic fault badge. Do not invent which
permission/bounds check failed or label a blocked access as actual corruption.
Attribute per-object reliability to the actual object, not a whole Thread.

Mallory's denied “steal” attempt must be reported but must not halt the whole
FPGA. This supersedes treating that denial as a whole-board stopping endpoint
for the next Factory Build.

**Why:** The user explicitly clarified: “The Mallory Fault should be reported
but not HALT the hardware.”

**How to apply:** Preserve denial enforcement and actor/instruction evidence,
while allowing other authorized work under Amobea to continue. The user chose
“Keep Mallory faulted” applies to the Mallory Abstraction, NOT the Thread.
The user explicitly corrected the mistaken Thread-fault interpretation.
Do not fault or deschedule the Thread because Mallory was denied; preserve
its availability for authorized work. Do not automatically re-enter the
faulted Abstraction; require explicit operator action before restoring its
eligibility.
Do not infer instruction skipping, automatic retry/restart, added authority,
or a general exemption for other faults. Distinguish a contained actor fault
from global hardware halt. Normal alternation applies only while both targets
are eligible; do not re-enter Mallory merely to maintain alternating evidence.

The user subsequently authorized a security demonstration loop based on the
default MTBF setting, repeated until the message is understood.
**Default MTBF belongs to Amoeba**, as explicitly clarified by the user.
The demonstration consumes Amoeba's configured value; do not invent a separate
IDE or demonstration-owned default.

**Why:** The example is educational: each cycle must pinpoint the instruction
and RW object and explain security and containment, not hide the error.

**How to apply:** Treat explicitly started demonstration mode as authorization
for controlled repetitions without per-cycle approval, with a visible Stop.
This is not blanket automatic recovery for ordinary faults. Preserve incident
evidence, actual checks, and the Must Resolve rule; distinguish intentional
demo events from operational MTBF. Do not invent a default value or assume an
MTBF threshold is itself a retry interval; the mapping must be defined.

The affected object's slot version defines OFFLINE and requires a design
change: in this example, removing Mallory's attack.

**Why:** The user clarified that the security demonstration must force design
correction, not restore the same attack through retries or resets.

**How to apply:** Demo repetition is subject to version-defined eligibility.
Do not clear OFFLINE, refresh stale GTs, or mint matching replacements just to
continue the loop. Preserve the explanation while OFFLINE. Authorized software
owns slot-version changes; hardware only checks them. Returning the object
requires corrected design adoption, not merely operator acknowledgement.

The analysis directs **Amoeba, Mallory's user/caller, to stop polling Mallory**.

**Why:** The user explicitly assigned the caller this response; repeated
hardware denials are not the intended ongoing demonstration behavior.

**How to apply:** Stop Mallory requests in Amoeba while continuing other
eligible work. Do not disable the Thread or substitute repeated stale-GT
faults for caller compliance. Hardware version checks remain independent
enforcement; this requirement does not specify a new notification ABI.

Close the demonstration with a revised Mallory that removes the attack and
performs its intended authorized work without error.

**Why:** The user proposed the corrected Mallory to complete the security
example, showing design correction rather than only exclusion.

**How to apply:** Preserve the attacking revision and fault evidence, explain
the correction, explicitly adopt the revised design through authorized
bindings, and show Amoeba resuming requests successfully under unchanged
security checks. Associate the corrective evidence with Must Resolve; do not
silently restore stale GTs or claim operational MTBF from one clean run.

**Why:** The user explicitly confirmed that expected endpoint.

**How to apply:** Correlate the denial with Mallory's actual instruction and
preceding actor/thread sequence. An unrelated fault is not success; report
fault-code conformance separately from the observed access denial.

**Why:** The user explicitly requested different Threads rather than running
both actors in one execution context.

**How to apply:** Preserve distinct saved register contexts and deliberate
capability grants. Do not infer that Thread separation alone restricts object
access, or that this requires separate Namespaces or SWITCH.

Isolated actor fixture provisioning is not adoption into the user's selected
Namespace. Keep the evidence and user-facing claims distinct.

**Why:** An ascending-layout runtime can exercise protection correctly using
preboot fixture provisioning without proving the saved-design preparation path.

**How to apply:** Label fixture-only initialization and historical source
adaptations explicitly; never present that run as installation or execution
of the user's saved NewLayout.

Alice's stash must survive fault restart and be readable afterward without
running Stash again.

**Why:** The user accepted LUMP-backed storage conditionally on survival through
fault restart; unchanged bytes at the fault itself are insufficient.

**How to apply:** Distinguish restarting execution over retained memory from
reloading a pristine image. Verify Reveal after recovery, not just the
pre-restart value. Do not imply persistence across power loss.
