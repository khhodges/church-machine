---
name: Fault recovery boot precedence
description: Boot wins after a fault; its three steps enter the prepared lightning-bolt target, without an implicit SelfTest.
---

After a fault, boot always takes control, not a direct handoff from the faulted Thread to a test manager. The user requires diagnosis after SelfTest, but this does not insert SelfTest into the boot sequence: the lightning-bolt target follows the three Boot steps. With CapabilityTest selected and prepared, those steps enter CapabilityTest.

**Why:** The user explicitly corrected both the proposed direct-manager recovery path and the assumption that boot unconditionally enters SelfTest. A test stopped at the initial fault boundary proves rejection, not the complete recovery lifecycle.

**How to apply:** Recovery tests must verify boot precedence and the prepared entry authority; do not silently substitute SelfTest for CapabilityTest or invent an intermediate call. Establish the explicit SelfTest/diagnosis path separately. Do not simply clear HALT, skip the offending instruction, or resume the manager as a substitute. Preserve existing snapshot capture and correlation safeguards before any destructive reset; capturing evidence is distinct from diagnosing it.