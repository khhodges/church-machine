---
name: Fault recovery boot precedence
description: Boot wins after a fault; its three steps enter the prepared lightning-bolt target, without an implicit SelfTest.
---

For the approved multi-Namespace design, the user subsequently qualified the
reboot scope: a Namespace-attributable fault reboots only the responsible
Namespace, preserving other Namespaces and the running FPGA configuration.
This is intended behavior, not established implementation. The historical
single-Namespace boot sequence below must not be interpreted as requiring a
whole-machine reset for every Namespace fault.

The user requires the ultimate double-error fallback to reboot the first
Genesis Namespace.

Genesis is also the default for unfinished or unspecified behavior; improvements
are second-order refinements rather than prerequisites to that baseline.

**Why:** The user explicitly stated, “By default Genesis is anything unfinished
or unspecified, improvements are second order effects.”

**How to apply:** Use Genesis as the design baseline where no more specific
behavior is defined. Do not invent additional recovery layers or repeatedly
block discussion on optional refinements. Keep intended default behavior
distinct from demonstrated implementation; this rule does not waive existing
capability checks or grant unspecified operations authority.

**Why:** Namespace-local reboot needs a final recovery target when recovery
itself fails; it must not recursively depend on the failing Namespace.

**How to apply:** Distinguish the original Genesis entry authority from the
currently selected CR15 root. Treat a fault during fault handling or Namespace
reboot as the working interpretation of double error, pending an exact trigger
contract. Two unrelated faults are not automatically a double error. This
direction does not authorize FPGA reconfiguration, replacing the bitstream,
or discarding all other Namespaces. Hardware implementation, protection of the
Genesis recovery path, and failure of Genesis recovery remain unspecified.

After a fault, boot always takes control, not a direct handoff from the faulted Thread to a test manager. The user requires diagnosis after SelfTest, but this does not insert SelfTest into the boot sequence: the lightning-bolt target follows the three Boot steps. With CapabilityTest selected and prepared, those steps enter CapabilityTest.

IDE boot/reboot must discard prior-run execution state for every Thread, not
only the currently active one. Initialize Boot.Thread for the Lightning Bolt.
Non-boot Threads stay empty unless explicitly assigned a fresh startup context.
On 2026-10-23 the user approved Thread.2 and Thread.3 starting at the saved
AmoebaStartup abstraction, NIA 1, with Alice/Mallory application E-GTs in CR1.
These are fresh starts, never restored prior execution.
**Why:** The user explicitly required clearing stale state “including the 3
threads.” Suspended registers, stacks and continuations are execution state too.
**How to apply:** Route every selected-design reboot control through whole-image
reconstruction followed by clearing unconfigured non-boot Thread payloads.
Explicit startup assignments use newly generated pristine frames from the
saved design. Historical driver bindings without an explicit fresh-start
assignment must not restore old actor contexts. Individual Thread reset
baselines must reflect that same empty-or-fresh policy.
Keep separately labelled historical fault evidence outside live execution.

**Why this distinction matters:** The user explicitly confirmed that “clear”
includes starting contexts, not merely restoring saved actor images. The later
explicit AmoebaStartup approval is a bounded exception. CHANGE into a cleared
Thread must still fault; never silently initialize it or resume old execution.

**Why:** The user explicitly corrected both the proposed direct-manager recovery path and the assumption that boot unconditionally enters SelfTest. A test stopped at the initial fault boundary proves rejection, not the complete recovery lifecycle.

**How to apply:** Recovery tests must verify boot precedence and the prepared entry authority; do not silently substitute SelfTest for CapabilityTest or invent an intermediate call. Establish the explicit SelfTest/diagnosis path separately. Do not simply clear HALT, skip the offending instruction, or resume the manager as a substitute. Preserve existing snapshot capture and correlation safeguards before any destructive reset; capturing evidence is distinct from diagnosing it.