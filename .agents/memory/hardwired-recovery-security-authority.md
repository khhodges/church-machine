---
name: Hardwired recovery and security authority
description: User corrections on CR13, CR15, recovery readiness, SecurityRegulator M custody and indexed CALL.
---

CR13 is reserved for now, with no IRQ/WatchdogFault role. The fault-recovery
Thread and initial CR15 authority are hardwired. Trust the IDE builder and
the seals without introducing a new W3 cold-boot seal or waiving applicable
Church checks.

The proposed IDE-generated bitstream guards for slots 1 and 2 are for
accidental boot-image mismatch detection, not secret authentication.
Representation/provisioning remain undecided; keep GT version checks separate.

**Why:** The user explicitly selected accidental wrong-image loading as the
threat to address, rather than deliberate unauthorized substitution.

Reloading CR15 requires activation of the incoming Namespace's slot-2 Thread
under the same authority, with no second Thread-activation grant. SWITCH's
CR15.M covers both; reset retains authorized bootstrap and its marker sequence.
Thread validation remains mandatory. This does not settle reset GT version.

**Why:** The user explicitly tied required slot-2 activation to the authority
that reloads CR15, rather than an independently authorized operation.

The user subsequently approved exact reset marker 0x27000001: one-shot per
reset at the designated trusted reset-ROM instruction, incoming-only activation
of Namespace slot 2 into CR12. Outside authorized reset context it is INVALID_OP;
programmer-set M does not grant admission. Bounded hardware fetch authority
for immutable reset ROM during bootstrap is now explicitly approved: no
software enablement or additional data/table permissions; normal fetch checks
apply after handoff. The user explicitly retained the final reset-ROM CALL CR0:
normal CALL validation applies and successful transfer ends ROM fetch authority.
No additional ROM CALL is implied for ordinary CHANGE or SWITCH. Consume marker
authorization on valid acceptance before activation; faults never restore it,
only fresh reset re-arms it. No additional CR12.M grant is required or issued
solely for the marker: the user chose reset-context authorization with ordinary
Thread validation, unchanged initial Namespace authority and unchanged M rules.

**Why:** The user selected a distinct reset exception, not indexed CHANGE or
a general software privilege, and subsequently chose to retain the checked CALL
into the prepared first abstraction rather than infer direct Thread entry.

After bootstrap passes validation, the system must complete at least one
successful CHANGE for save-first fault recovery to work. Before that, the
stuck-in-a-loop condition remains. Do not invent a readiness register or latch
as an ISA requirement.

M authority belongs only to SecurityRegulator, trusted as part of the TSB.
Do not reopen this as arbitrary per-Thread privilege inheritance or introduce
a blanket M-clearing rule.

Indexed CALL is already agreed. Missing verification or transcription of
its exact bit allocation is a documentation gap, not missing feature approval.

**Why:** The user explicitly corrected the review for reopening settled
decisions and retaining speculative IRQ/watchdog/register roles.

**How to apply:** These decisions supersede earlier alternatives in the
scheduling/recovery notes. Update architectural review text only; no hardware,
implementation or retained-image migration is authorized by these corrections.
