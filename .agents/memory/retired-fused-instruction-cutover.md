---
name: Retired fused instruction cutover
description: Defines the hard-cutover and boot-load policy for removing ELOADCALL and XLOADLAMBDA.
---

Retire ELOADCALL and XLOADLAMBDA with no automatic translation. Existing source is corrected manually, and any remaining retired mnemonic must cause a recompilation error.

**Why:** This Phase 1 cutover was explicitly approved on 2026-09-15. A hard error exposes every stale use and prevents old authority or encoding semantics from being silently carried into extended CALL and LAMBDA.

**How to apply:** The Phase 1 boot load contains exactly CapabilityTest, SelfTest, and WukongCallHome. Manually correct and rebuild those three; reject old opcode-8/9 binaries on the new ISA.

The user explicitly approved enforcing retirement even when saved post-flash
test artifacts still use ELOADCALL. Leave those artifacts intact and inspectable;
do not translate or replace them automatically.

**Why:** Keeping an older test executable is not an exception to the hard cutover.
Programmer source correction and rebuilding remain explicit actions.

CapabilityTest SELF-row relocation compatibility with changed compact LOAD/SAVE
encoding is programmer-owned correction, not an automatic compatibility project.

**Why:** The user explicitly rejected that proposed compatibility work and
stated that the programmer must solve it.

**How to apply:** Do not revive that relocation migration proposal or implement
it without a new explicit request.

Retirement evidence must distinguish explicit assembly rejection from
high-level compiler-generated instructions.

**Why:** An assembler test described as “public compilation” did not cover
capability-call lowering, so successful compilation could still produce an
instruction that runtime rejected.

**How to apply:** Exercise the high-level compiler with known method conventions
and real generated calls; inspect emitted opcodes as well as diagnostics.
Assembly-only coverage cannot certify compiler-wide retirement.

When reconciling old regression fixtures, manually correct positive assembly
fixtures and separately retain rejection tests for retired mnemonics and
high-level syntax that still generates them.

**Why:** Treating all old successful-compilation assertions as rejection tests
would lose supported CALL row, selector, permission, and diagnostic coverage.
Conversely, silently translating input in the harness would mask the cutover.

**How to apply:** Preserve those semantic assertions against explicit supported
source; report unrelated example or UI regressions separately rather than
changing their expected result merely to make the suite pass.

Keep source regression verification separate from audits of the programmer's
live saved catalog; neither a green regression suite nor source-only declaration
checks establish that the catalog is current or release-ready.

**Why:** A retired-instruction fixture repair must not implicitly replace saved
programs or approve a new Namespace merely to make a general test command green.

**How to apply:** Exercise binary guard rejection behavior with isolated fixtures,
and keep the live catalog guard fail-closed as an explicit separate check. Report
its failures separately; never silently reclassify active saved artifacts as history.