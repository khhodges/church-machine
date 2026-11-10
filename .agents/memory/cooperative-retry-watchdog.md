---
name: Cooperative retry watchdog boundary
description: Fixed-watchdog diagnostic approval and evidence boundaries.
---

## Single starter bitstream demonstration goal

Genesis approved a physical maintenance-enable input for whole-image replacement
controls and a protected build-time SHA-256 allowlist of the two starter images.
**Why:** Naming Genesis as the authority did not define how UART commands could
exercise that authority; the user then explicitly approved this bounded mechanism.
**How to apply:** UART and application code cannot modify the allowlist. Trust
the maintenance operator while enabled; do not claim remote sender authentication.
Pin assignment, vendor synthesis, transfer and physical programming remain separate.

The user approved reset → load → validate → start for whole-Namespace image
replacement on the separate experimental target.
**Why:** Stopped transfer exceeds the enabled watchdog interval; a defined
execution reset boundary avoids a hidden pause or kick.
**How to apply:** Keep execution and its watchdog in reset during replacement,
start a fresh epoch only after admission, and leave failed uploads non-executing.
The reset controller/transport must remain outside that reset domain. This does
not authorize modifying the working board, automatic fault recovery, or using
whole-image reset for individual side-by-side LUMP upgrades.

The user set a four-week release target on 2026-11-10 (target 2026-12-08),
prioritizing minimum duplicated effort and bitstreams with rapid progress.
**Why:** The discussion must converge into a bounded release, not expand into
an open-ended architecture programme.
**How to apply:** Reuse completed manuscript/evidence/licensing work and target
one reusable new starter configuration for the three proofs. Preserve safety
and truthful evidence; the target date is not authority to waive acceptance.

Use one of the two new cooperative Namespaces as the starter bitstream and
demonstrate the other without creating a second bitstream. The user's three
goals are proving Lazy Load, proving Namespace image replacement, and
demonstrating a LUMP upgrade. The original same-size-only constraint was
subsequently corrected: side-by-side LUMPs have independent allocations and
need not have equal sizes.

**Why:** The user explicitly replaced the two-bitstream demonstration direction
with one reusable hardware configuration. A second synthesis cannot count as
proof of application-image replacement.

**How to apply:** Establish all three outcomes on the same new FPGA configuration.
Distinguish exact image/LUMP changes from hardware changes. Physical programming
remains an explicit operation, not an incidental test step.

The user requires old and new development side by side: “never stop what
already works.” Preserve the working hardware, source/build packages, saved
Namespaces and LUMPs while developing the starter separately. Do not overwrite
an executing old LUMP with the new revision or treat the earlier suggested
application pause as accepted.

**Why:** The user explicitly rejected disruption in response to the proposed
upgrade pause.

**How to apply:** Stage new revisions separately, retain old authority and active
continuations, and establish a safe adoption boundary before redirecting calls.
Do not infer that staging alone implements concurrent upgrade or grants permission
to activate new code. Namespace image replacement is demonstrated on the new
test setup, not by stopping the preserved working setup.

**Why:** The user explicitly corrected applying the same-size restriction to
side-by-side LUMPs. Validate each allocation and total memory capacity, not
equality between revision sizes. Equal size alone would not make an in-place
overwrite safe either.

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
