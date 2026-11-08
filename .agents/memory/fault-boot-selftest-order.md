---
name: Fault recovery boot precedence
description: Hard Fault resumes Boot.Thread; distinguish that continuation from explicit boot/reboot preparation.
---

## Hard Fault continuation clarification

The user explicitly states: “After a Hard Fault the Boot.Thread runs as a
continuation.” This takes precedence over interpreting the historical
fault/reboot discussion below as a fresh startup after every Hard Fault.

**Why:** Treating hardware fault entry as a separately selected recovery program
introduced a new selection requirement that the user rejected; IDE
Namespace/LightningBolt configuration already owns startup.

**How to apply:** Distinguish explicit cold boot/reboot preparation from Hard
Fault entry. Check that fault entry resumes Boot.Thread's continuation rather
than replacing it with a freshly constructed handler frame. Do not equate a
structurally valid handler binding with compliance with this continuation rule.

Derive the hardware binding from the already selected prepared IDE image;
do not introduce a second handler-selection or approval workflow.
**Why:** The user rejected presenting old frozen images and handler hashes as
new configuration decisions and authorized correcting the continuation path.
**How to apply:** Bind foundational Namespace/Thread identities to exact bytes;
the retained Thread frame, not a release-time executable pin, determines resume.
Keep vendor builds and physical operations separately authorized.

Historical saved `faultHandlerSlot` values are retained for document
compatibility, not interpreted as runtime authority.
**Why:** The old simulator path used them to replace the retained frame with a
fresh handler entry, contradicting the clarified continuation rule.
**How to apply:** Do not migrate exact saved artifacts just to remove the field,
or restore a separate selector in new simulation clients.

For the approved multi-Namespace design, the user subsequently qualified the
reboot scope: a Namespace-attributable fault reboots only the responsible
Namespace, preserving other Namespaces and the running FPGA configuration.
This is intended behavior, not established implementation. The historical
single-Namespace boot sequence below must not be interpreted as requiring a
whole-machine reset for every Namespace fault.

The user requires the ultimate double-error fallback to reboot the first
Genesis Namespace.

Qualification: for retained-continuation recovery, the user subsequently
specified “try again and again” and rejected switching to Genesis on the second
failure. See [reboot authority evidence](reboot-authority-evidence.md). Do not
apply the older double-error interpretation to that path.

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