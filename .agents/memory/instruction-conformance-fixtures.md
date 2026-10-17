---
name: Instruction conformance fixtures
description: Keep independent instruction oracles separate from boot and simulator setup behavior.
---
Treat older instruction-driven test fixtures as historical examples, not as
encoding authority when building new integration tests.

**Why:** Some Thread fixtures predate compact LOAD indexes and single-register
CHANGE. Reusing their encodings can load SELF and recurse or reject switching,
making a fixture bug look like a protected-frame regression.

**How to apply:** Check the current assembler/decoder contract before borrowing
fixture instructions, and log bounded retirement history on failures.

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

Historical Alice/Mallory lab inputs must remain pinned and immutable. If their
pre-compact literal LOADs need current encodings, adapt only disposable RAM
copies before minting new fixture identities, and label the evidence accordingly.

**Why:** Those saved words now decode as register-indexed LOADs. Successful
execution of an adapted lab fixture is not proof that the historical binary
can execute unchanged, and catalog "latest" selection can silently test a
different program.

**How to apply:** Keep exact-file/hash checks, prove saved input preservation,
and use real retirement/fault evidence for the derived lab residents. Never
install a decoder compatibility exception or publish corrected historical files.

Do not port fused-instruction recovery tests by changing only the opcode.
Separate declared-capability resolution, scheduler suspension, and retirement
rejection into distinct cases.

**Why:** Explicit name-and-rights declarations can resolve before LOAD consumes
the row. That successful operation is not the old fused instruction's lazy IRQ
path. Expecting the same IRQ after an opcode substitution creates false failures.

**How to apply:** Keep exact destination identity and grant assertions for
supported loads, no-write assertions for invalid declarations, separate named-slot
scheduler coverage, and explicit rejection coverage for retired instructions.

Treat Alice/Mallory tuple isolation evidence as cross-Thread containment, not
proof that every access outside the heap subregion faults.

**Why:** The tuple lab deliberately preserves existing capability rules. An
out-of-range test must exceed the authority actually enforced; tightening
Thread-relative authority to the heap alone would be a separate ISA decision,
not a test-fixture repair.

**How to apply:** Distinguish tuple offsets, heap layout, and the owning
Thread's authorized range in test descriptions. Keep any proposal for narrower
subregion enforcement separate from the bounded cross-Thread regression.

Synthetic activation probes must provide a complete executable continuation,
not assume constructor boot completion makes every placeholder resumable.

Boot acceptance must execute the first ordinary instruction and a C-list
access before any CHANGE; reaching `bootComplete` alone is insufficient.

**Why:** Later Thread activation can hide lost CALL-boundary M authority or a
skipped first instruction, while a synthetic later entry still passes.

**How to apply:** Exercise the exact generated image through root entry, LOAD,
CALL, RETURN and caller continuation without manually moving PC or repairing
registers. Keep exact approved-profile acceptance separate from synthetic
machine-path evidence.

**Why:** Constructor placeholders and poison roots can let setup finish while
ordinary CHANGE correctly rejects the missing suspended continuation or C-list
geometry. Those fixture failures say nothing about an exclusion mechanism.

**How to apply:** Construct disposable canonical code/C-list and suspended-frame
evidence appropriate to the entry path; keep boot/root admission separate from
ordinary resumption. Never repair live artifacts or stub admission for a probe.
