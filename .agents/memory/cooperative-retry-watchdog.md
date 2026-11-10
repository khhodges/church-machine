---
name: Cooperative retry watchdog boundary
description: Fixed-watchdog diagnostic approval and evidence boundaries.
---

The user approved a fixed, enabled watchdog with no software control access
for the isolated delayed-delivery/cooperative-USER diagnostic.
**Why:** The successful UART parent had no integrated execution watchdog;
general SecurityRegulator control provisioning remains unresolved.
**How to apply:** Keep this exception diagnostic-only. Do not add a raw SYSTEM
control capability, general kick, or SYSTEM exemption. Preserve separate
vendor-build and physical-operation boundaries.

A halted UART-observation fixture is not automatically reusable with an
always-enabled execution watchdog.
**Why:** Stopping the core also stops its successful CHANGE renewals, while
the ungated timer continues. Terminal retirement alone cannot qualify the
later observation exchange.
**How to apply:** Validate the complete observation/host flow before exporting
a watchdog-enabled build; do not quietly disable the timer for reporting.

In the inherited diagnostic, scratch capabilities cannot be treated as
preserved scheduling authority across CHANGE/LLR.
**Why:** A second-USER fixture initially retained its Thread GT in CR5;
LLR scratch use replaced it and CHANGE correctly rejected the resulting rights.
**How to apply:** Reload through the software owner's actual C-list before
dispatch. Never repair the capability by altering the runtime frame externally.

Observation must include the timing cost of UART arbitration and trace
backpressure, not just removal of explicit terminal stops.
**Why:** The inherited diagnostic has both a terminal latch and a separate
forced step halt. Removing both still left watchdog expiry during the extended
report exchange. Signal capture then confirmed trace stall while the diagnostic
report owned UART, with step halt and recovery hold off. The artificial 2,500
baud fixture exhausted the interval; 5,000 baud allowed full observation
without changing the one-second timer or bypassing backpressure.
**How to apply:** Keep simulated UART throughput compatible with the observation
budget, retain the slow-UART expected-fault case, and never pause or exempt the
watchdog to make reporting pass.

Mid-transition containment tests must distinguish pre-execution Boot writes
and CHANGE's own busy signal from the separate SWITCH indication.
**Why:** A baseline initially included writes before watchdog activation, and
the SWITCH busy output falsely appeared to disprove mid-CHANGE expiry.
**How to apply:** Calibrate deadlines from active-timer write cycles and observe
the unit executing the tested instruction; use the normal issue/settle contract.

Agree cooperative scenarios through saved Namespace designs and readable code
in the existing IDE before treating a diagnostic build as the shared design.
**Why:** The user explicitly called this the right way to understand and agree
the goal; isolated Python fixture images alone did not provide that shared view.
**How to apply:** Keep the two scenarios independent. Create real saved LUMPs
and exact assignments, not just rows plus source files: the user twice flagged
missing Memory Glass data as an incomplete handoff. Mark remaining runtime
qualification honestly; never imply new compiled designs reproduce the earlier
qualified fixture bytes. Use locally owned leaves under the configured IDE node,
not a new foreign hierarchy branch for the test names.
