---
name: Actionable error reports
description: Project-wide requirements for errors shown to programmers in the IDE.
---

Every visible error must state what operation failed, preserve the server or validator’s real reason, say whether data changed when known, and provide a concrete next action. Never show a bare HTTP status or generic “failed” message.

**Why:** The programmer explicitly requires all error reports to be actionable; a saved-LUMP audit previously displayed only “HTTP 409” while hiding a precise bootstrap SELF mismatch.

**How to apply:** Parse structured error bodies defensively, avoid inventing semantics from status codes, include actual/expected values for identity failures, and give operation-specific retry, reload, rebuild, or re-approval guidance.

Thread faults should explain the specific failed execution prerequisite, not
only the generic BOUNDS category. Distinguish empty starting contexts from
invalid frames using fault-time evidence; never infer historical state from
the current Thread after reboot.

**Why:** The user confirmed the empty-Thread CHANGE diagnosis and requested
that understanding directly in the fault popup.

**How to apply:** State which Thread was rejected, why it could not be entered,
and what explicit initialization is needed, without silently initializing it.

Hardware fault reports must pinpoint the programmer's problem using full
Namespace, Thread, object and method names where supported, the faulting
instruction, operand values, actual versus permitted bounds, and relevant
caller context. Separate captured hardware facts from image-map annotations
and unavailable evidence; never render undefined fields as diagnostic values.

**Why:** The user explicitly identified the generic BOUNDS popup as inadequate:
“The goal is to pinpoint the problem for the programmer.”

**How to apply:** Lead with the specific rejected operation and decisive
comparison, followed by evidence and source-navigation actions. Distinguish a
rejected C-list lookup from access to the target object's data. Do not recommend
widening authority merely to remove an intentional security-test fault.

Keep Machine Fault dialogs within the viewport, with paginated details rather
than a long scrolling report.

**Why:** The user approved the deeper diagnosis but explicitly required “a better
modal that dosnt need to scroll.”

**How to apply:** Keep the immediate diagnosis visible; paginate register,
instruction and provenance evidence. Hardware annotations require an explicitly
selected immutable image reference and must not be described as UART capture
or hardware attestation. Correlate register snapshots by incident and bridge
session, not just a matching NIA.

Known bridge-map PetNames must remain visible even when register evidence is
pending. Name availability and snapshot correlation are separate questions.

**Why:** The user correctly challenged “unresolved” labels when the bridge had
already supplied the full Namespace/Thread/object path.

**How to apply:** Label the name's reference provenance independently. Never
weaken incident correlation to fill a register gap; explicitly advance a report
when a superseding current incident supplies the accepted snapshot.

Label host-to-IDE transport diagnostics “BRIDGE DELIVERY ONLY,” separately from
machine faults. An HTTP timeout means delivery is unconfirmed, not proven loss.

**Why:** The user found TRACE INCOMPLETE and fault-upload chatter misleading
alongside genuine UART fault output and requested explicit bridge-only labels.

**How to apply:** Keep actual queue drops distinguishable from missing HTTP
acknowledgements, and never imply a transport warning is another FPGA fault.