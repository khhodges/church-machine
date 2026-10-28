---
name: Alice and Mallory thread isolation
description: User-directed separate Thread setup for the NewLayout protection demonstration.
---

Run Alice and Mallory in different Threads for the protection demonstration.
The user confirmed priming each Thread's respective actor entry capability
in CR1, not the protected object's capability.

The Factory Build must demonstrate both Thread-GT and callable-Abstraction-GT
cases, not choose one: the Mallory attack and the
CapabilityTest/SelfTest/CallHome loop respectively.

**Why:** When asked to choose between the two arrangements, the user explicitly
required both demonstrations.

**How to apply:** Keep their context ownership, exact bindings, and turn
contracts separate for approval. Preserve separate actor Threads and the
CapabilityTest-owned CALL/RETURN loop; do not infer new boot CR0 authority
or a fault-continuation ABI from this scope decision.

The error case is **one RW data object in Mallory**, with the instruction at
error pinpointed.

**Why:** The user corrected the overly broad fault description and explicitly
required: “This example should explain security not hide it.”

**How to apply:** Distinguish executing Abstraction, affected object, GT, and
Thread. Show the exact instruction, attempted operation, failed check, and
containment evidence rather than a generic fault badge. Do not invent which
permission/bounds check failed or label a blocked access as actual corruption.
Attribute per-object reliability to the actual object, not a whole Thread.

Distinguish failure to acquire a target capability from failure to use that
capability for RW data access in the tutorial.

**Why:** The retained Mallory denial is consistent with source C-list bounds
rejecting a capability fetch; treating every BOUNDS event as target-object
corruption or a target permission test would teach the wrong mechanism.

**How to apply:** Follow the exact faulting instruction and participating
checks, not the intended attack narrative. Keep source-check evidence,
target-check evidence, and physical execution claims distinct.

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
Its approved default minimum is **12 months**: MTBF must be at least
12 months, with strict less-than triggering Must Resolve when assessable.
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
Insufficient evidence is Unassessed, not threshold compliance; the approved
12-month target is not a measured reliability claim.

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

The corrected-Mallory example also demonstrates side-by-side LUMPs, code
evolution, and fallback when needed during an upgrade.

**Why:** The user explicitly added upgrade/fallback as a lesson of this example.

**How to apply:** Preserve distinct immutable revisions and explicit caller
adoption. Fallback must target an eligible, compatible known-good revision,
not the OFFLINE attacking Mallory. Demonstrate with a safe baseline and safe
upgrade candidate where executable fallback is needed. Do not equate retaining
old code with rollback of data or external effects.

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

For the combined running-loop demonstration, the user proposes Alice saving
x+1 on each turn to show that useful work continues across Mallory's denial.

**Why:** A retained constant alone demonstrates preservation, not ongoing work.

**How to apply:** Derive the increment from Alice's retained protected value and
check continuity before updating, rather than reinitializing or reconstructing
the value from an external counter. Treat this as the proposed demonstration,
not proof of fault containment or permission to implement it.
