---
name: Boot.Abstr c-list must be pre-populated
description: The boot path executes SelfTest directly, so its two-row c-list and row-0 identity check must be present in the binary before boot.
---

## Rule

The canonical SelfTest/Boot.Abstr LUMP (NS slot 6) MUST have `cc=2`:

- c-list row 0 = `0x4A000006`, the immutable SelfTest E-GT;
- c-list row 1 = the configurable Next.GT continuation.

**Why:** The simulator enters Boot.Abstr directly at boot. Its SelfTest code
loads row 0 into CR1 and uses an EXACT comparison against CR0, the boot-entry
SelfTest E-GT. Replacing row 0 with a managed capability causes a BIND fault.
Only row 1 is safe for boot configuration to rewrite.

**How to apply:** Preserve row 0 verbatim when embedding SelfTest in a boot
image. Generate row 1 from the configured continuation. Use the JS simulator
GT format for row 0 (`0x4A000006`), not the Python abstract-GT encoding.