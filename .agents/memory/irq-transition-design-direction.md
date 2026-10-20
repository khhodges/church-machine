---
name: IRQ transition design direction
description: Preferred cooperative scheduling with watchdog hard faults; earlier IRQ alternatives remain unfinalized.
---

**Latest direction supersedes the alternatives below:** see
[Hardwired recovery and security](hardwired-recovery-security-authority.md).
CR13 is reserved with no IRQ/WatchdogFault role; recovery and initial CR15
authority are hardwired. Earlier watchdog proposals below are historical,
not authority to reintroduce them into the current review.

The user initially agreed to reconsider CR13's dedicated IRQ role and explore
cause-specific Thread GTs. The later preferred direction is cooperative
round robin with watchdog hard faults, rather than event-driven IRQ activation.
Cause-specific targets can be ordinary scheduled service Threads with retained
device events; do not assume the earlier IRQ-return proposal remains desired.

**Why:** If full context transitions are required, swapping GT registers alone
does not restore the execution context. A single dedicated handler register
may offer little advantage and needlessly constrain cause-specific dispatch.
The user explicitly confirmed this direction, but deferred finalization.

**How to apply:** The user authorized consolidating special-operation definitions
and defining the cooperative/hard-fault model in the red-text review. Withdraw
the old IRQ-swap/return proposal there rather than presenting incompatible
alternatives as simultaneously active. This is not approval of a master ISA
change, register reassignment, timing configuration, scheduler implementation
or hardware vector table. Distinguish a valid permissionless Thread GT from
a genuinely NULL GT.

The user requires hardware enforcement against runaway Threads. After initially
describing this as a watchdog interrupt, they proposed treating watchdog expiry
as a hard fault instead, and explicitly favored its simplicity because
"it forces designers to comply." The preferred direction is cooperative
scheduling with bounded yielding, with watchdog hard faults for noncompliance,
rather than watchdog-driven IRQ Thread activation.

**Why:** Cooperative yielding alone cannot stop a noncooperating Thread.
The user favors making timely yielding a designer obligation rather than
automatically preempting healthy execution to compensate for it.

**How to apply:** Preserve the hardware timeout requirement without assuming it
must activate an IRQ Thread. This supersedes watchdog-preemption as the favored
direction, not the existing master ISA. Timeout authority, budget accounting,
safe fault capture and recovery scope remain to be specified. A machine-wide
hard fault contains a runaway but does not guarantee continued service for
other Threads. General device IRQs, cause-specific handlers and CR13 remain
under reconsideration; do not silently remove or implement them. No ISA,
encoding, hardware build or board action is authorized by this agreement.

## Save-first fault recovery direction

**Superseded for recovery:** The later approved rule uses trusted Namespace
boot without saving a resumable faulted Thread and without a program-supplied
M grant; fault evidence remains retained. See
[Namespace recovery decisions](namespace-handoff-evidence.md).
The text below records the earlier direction, not current recovery authority.

The user confirmed trying full CHANGE to preserve the faulting Thread first,
with incoming-half-only fallback if the recovery CHANGE faults while saving
the outgoing context. ColdStart has no outgoing Thread to save. The user
expects a persistent failure to repeat the three-instruction boot sequence.

**Why:** Preserve useful fault context when possible without making a damaged
outgoing Thread prevent recovery activation.

**How to apply:** This supersedes the earlier draft's manual-only recovery and
terminal-stop proposal as the discussion direction. Do not waive incoming GT
validation. Distinguish original fault context from the recovery continuation.
Repeated boot assumes functioning fault/boot machinery, not arbitrary broken
hardware. No implementation or board action is authorized; the detailed ISA
contract still needs reconciliation.

The user explicitly confirmed the recovery direction on the basis of a minimal
TSB that always applies mLoad security checks.

**Why:** Omitting an outgoing save must not create a security bypass during
ColdStart, fault recovery or repeated boot attempts.

**How to apply:** Keep applicable mLoad checks mandatory for incoming authority
on every recovery path. This is an architectural security requirement, not
proof of current hardware conformance or guaranteed recovery from arbitrary
failure of the TSB itself.

The user proposes a fixed one-second watchdog and an LED indication so
repeated expiries make failure to sustain round-robin execution visible.
The user explicitly corrected the indication to toggle on each expiry, not
pulse: one second on and one second off gives a two-second cycle when
expiries recur at one-second intervals.

**Why:** Provide a simple physical indication without software-configurable
timer authority.

**How to apply:** Treat the duration and LED as a proposed machine profile,
not an ISA encoding or implementation authorization. Indicate actual expiry,
not a free-running heartbeat. Expiry proves a missed handoff deadline, not
its root cause or fairness of otherwise timely scheduling; recovery time can
affect the interval between indications.

The user subsequently requires protected watchdog refresh through the same
M-bit control word: low bits 0–15 control CR M state; upper bits 16–31 provide
other hardware controls. See [M-bit object](m-bit-io-object.md).

**Why:** A fixed duration does not eliminate the need for authorized refresh.

**How to apply:** Separate duration-setting authority from refresh authority.
Reconcile the earlier automatic-handoff renewal proposal with this explicit
refresh direction before adopting a final contract; exact command bit and
write semantics are not yet approved.
