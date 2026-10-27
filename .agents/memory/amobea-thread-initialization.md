---
name: Amobea Thread initialization ownership
description: All Thread initialization belongs to Amobea; distinguish fixture prerequisites from an operational lifecycle.
---

Mint completion is mandatory in Phase 1. Use Mint to initialize new Threads
against templates for each application transaction used for clean recovery.

**Why:** The user explicitly added this completion and operational-use
requirement to the Phase 1 agreement.

**How to apply:** Preserve Mint priming with Amoeba and Amoeba's application
initialization role. Define transaction templates and the clean-recovery
authority/interface before implementation; fixture priming does not close
the requirement. A fresh context is not rollback of external effects or
permission to revive OFFLINE code. Do not assume automatic retry authorization.

Fault entry must bypass CHANGE's outgoing save and explicitly prime
Boot.Thread's DRs and CRs. Microcode owns this priming under the KISS rule.

**Why:** The user specified this while reviewing successful/failed fault-context
saves and Boot.Thread dump inspection. The handoff must not repeat the save.
The user explicitly agreed that microcode must perform Boot.Thread priming.

**How to apply:** Separate diagnostic capture from the dedicated fault handoff.
Define exact register values, authority sources and entry ordering before
implementation; do not weaken ordinary CHANGE or destination validation.
Keep normal prepared boot separate, and do not recursively prime an active
or faulting Boot.Thread. Keep microcode minimal and deterministic: no retry
loops, alternate targets, silent repair or hardware version changes. Software
owns fault assessment and authorized transaction recovery after entry.

Boot.Thread fault entry runs in the Boot Namespace, not necessarily the
faulting Namespace. Remember the faulting Namespace before replacing CR15.

**Why:** During register review the user corrected the proposed preservation
of the current Namespace: “Current Namespace is Boot, the faulting Namespace
must be remembered!”

**How to apply:** Keep captured Namespace identity and live Boot root distinct.
Resolve destination bindings against Boot, retain original Namespace/Thread/
executable attribution, and never reinterpret fault evidence using Boot slots.
This correction does not approve the rest of the proposed register ABI.

Phase 1 fault inspection uses the saved Thread context, not a separate
diagnostic dump object or duplicated register snapshot.

**Why:** The user chose to see how far saved context takes Phase 1, citing
PP250 experience that Thread hard faults blocking CHANGE should be few and
easy to locate. This is a design rationale, not measured FPGA reliability.

**How to apply:** Keep microcode Boot.Thread priming and bypass the second
CHANGE save. Define minimal missing fault/Namespace evidence and inspection
authority; do not assume CR15 is already in Thread homes. Diagnose blocking
hard faults before adding recovery machinery. The separate 96-word dump and
its proposed release interface are superseded, not implementation authority.

Boot.Thread is primed with both the existing GT of the Thread executing at
the fault and its existing Namespace capability.

**Why:** The user explicitly selected the existing Thread GT as the reference
for the saved-context approach, then explicitly added “and Namespace.”

**How to apply:** Carry that reference with its faulting Namespace association;
do not mint a replacement, silently refresh it or invent a dump capability.
Keep the references distinct from Boot.Thread's own CR12 and Boot Namespace
in live CR15. The receiving registers and
inspection interface still require agreement.

Mint always primes a Thread with Amoeba (spelled Amobea in earlier notes).
The supplied E-GT identifies the application abstraction Amoeba will start,
not Amoeba itself or a routine Mint should call to format the Thread.
All Threads should be initialized by that abstraction. As of 2026-10-18,
the user explicitly states that this abstraction does not yet exist.
Do not confuse an Amobea design view or prototype with the initialization
service.

**Why:** The user clarified: “In truth all Thread should be initialized with
the Amobea abstraction, but that doe not yet exist,” and later explicitly
specified “Mint always primes a thread with Amoeba.” The user then selected
“The application abstraction Amoeba will start” as the supplied E-GT's role.

**How to apply:** Distinguish Mint's required priming from Amoeba's initialization
work; do not move the latter into instruction microcode or a generic Mint
formatter. Preserve the application handoff without inventing its detailed ABI.
Disposable tests may supply an initialized context
before admission to test capability use, but must label it as a prerequisite,
not successful Amobea execution or a complete Thread lifecycle. Do not add
implicit initialization, CALLs or preparation operations to CHANGE/SWITCH.

The user approved fresh IDE startup assignments for Thread.2 and Thread.3
to saved AmoebaStartup at NIA 1, retaining Alice/Mallory application E-GTs.
This permits private-image startup-frame construction, not an assertion that
Mint's operational Thread CREATE or hardware initialization has been completed.

**Why:** Explicit confirmation on 2026-10-23 supersedes empty-on-boot behavior
for these two configured Threads only.

**How to apply:** Regenerate fresh contexts on reboot, discard prior execution,
and preserve hard faults for Threads without an explicit startup assignment.

Startup configuration and capability binding are separate prerequisites.
Complete the explicit Namespace binding step when applying an approved fresh
startup assignment; do not silently bind inside CHANGE.

**Why:** Fresh Amoeba entry frames could be present while the exact selected
graph had no binding snapshot, leaving even SELF unresolved and causing CHANGE
to reject the entry. Seeing NS/NIA in the Thread display alone is not execution
proof.

**How to apply:** Verify actual CHANGE into the selected saved startup bytes,
and inspect the current saved boot selection rather than assuming the target
from earlier conversation.

Minimal startup experimentation is authorized separately from storage and
rollback, but fixture priming must never be presented as an operational Mint
implementation or a fix to live reboot.

**Why:** The user requested a CLOOMC startup prototype for the empty-Thread
CHANGE case. A Thread must already have a legal entry frame before Amoeba can
execute inside it; ordinary CALL/RETURN also cannot be assumed to preserve
scratch capability registers.

**How to apply:** Keep executable startup evidence separate from protected
priming evidence. Reload continuation/supervisor authority from an explicit
declared capability after application RETURN, rather than relying on CR2.
