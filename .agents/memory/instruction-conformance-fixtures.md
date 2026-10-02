---
name: Instruction conformance fixtures
description: Keep independent instruction oracles separate from boot and simulator setup behavior.
---
Instruction conformance fixtures must leave the core's three-retirement boot
microcode window before issuing ordinary LOAD/SAVE, and capture simulator
fault state before host recovery.

**Why:** Otherwise a real instruction test can measure boot-only capability
handling or post-fault reset state instead of the ordinary instruction contract.

**How to apply:** Explicitly record fixture boundaries and normalized units.
Keep unresolved ISA policies blocked rather than adopting an implementation's
flags or operand roles. Generated RTL must evaluate the independent oracle,
not just compare against Amaranth output.

For large-core CXXRTL tests, preserve hierarchy and enough debug metadata to
retain aliased observation ports.

**Why:** Flattened full-core C++ compilation was disproportionately slow;
minimum debug metadata omitted aliased output ports from runtime lookup.

**How to apply:** Keep independent generated execution fail-closed on missing
ports, and bound compilation separately from instruction completion.