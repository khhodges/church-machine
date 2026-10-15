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

Keep known conformance mismatches as real failures in the explicitly invoked
qualification suite, not xfails or revised expectations copied from the DUT.

**Why:** The Phase 1 test effort is intended to expose hardware/specification
differences; a green regression wrapper must not be mistaken for qualification.

**How to apply:** Report decoder-only, unit and integrated-core coverage
separately. Do not apply architectural descriptor-limit semantics directly to
an internal unit's count interface without establishing the caller contract.

Long independent arithmetic sweeps must stay within the separately latched
fetch fence after the reset window, not just retire three setup instructions.

**Why:** The reset ROM's small fetch bound can terminate an otherwise valid
sweep and falsely implicate the instruction being tested. Also, a faulting
instruction may assert retirement to report its fault; that is not successful
architectural completion.

**How to apply:** Establish the fetch-fence contract separately from the
visible code descriptor. Keep setup execution inside the authorized range
without reopening reset privileges, and distinguish fault reporting from
successful retirement when attributing the first fault.

For large-core CXXRTL tests, preserve hierarchy and enough debug metadata to
retain aliased observation ports.

**Why:** Flattened full-core C++ compilation was disproportionately slow;
minimum debug metadata omitted aliased output ports from runtime lookup.

**How to apply:** Keep independent generated execution fail-closed on missing
ports, and bound compilation separately from instruction completion.

Do not port fused-instruction recovery tests by changing only the opcode.
Separate declared-capability resolution, scheduler suspension, and retirement
rejection into distinct cases.

**Why:** Explicit name-and-rights declarations can resolve before LOAD consumes
the row. That successful operation is not the old fused instruction's lazy IRQ
path. Expecting the same IRQ after an opcode substitution creates false failures.

**How to apply:** Keep exact destination identity and grant assertions for
supported loads, no-write assertions for invalid declarations, separate named-slot
scheduler coverage, and explicit rejection coverage for retired instructions.
