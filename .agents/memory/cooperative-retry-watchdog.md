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
