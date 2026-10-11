---
name: ISA-to-FPGA primary release goal
description: User-designated main objective and separation of release stages.
---

Align the approved red-ISA, simulator, bitstream and physical FPGA as the primary
project objective. The next corrected candidate is provisionally called B.1.1+.

**Why:** The user explicitly identified this as the main event after unrelated
work distracted from the later boot/root-frame correction sequence.

**How to apply:** Keep one gated evidence chain from approved semantics through
exact frozen binaries to physical acceptance. Do not confuse older remote build
completion with synthesis of subsequent corrections. Plan finalization does not
approve unresolved red-text proposals or authorize physical operations.

The user approved bit-exact golden-layout and architectural-checkpoint comparisons
as mandatory release evidence, including the Namespace Table and three resident
LUMPs, registers and intermediate write events.

**Why:** A simulator-generated dump alone can reproduce its own bugs; generic
image, projected memory and FPGA initializer evidence must remain distinct.

**How to apply:** Independently derive expectations from approved semantics and
frozen inputs, reuse them across simulator/RTL/synthesized/physical checks, and
report unobservable FPGA state as an evidence gap rather than a pass.

The user identifies `ide.Mint` as a critical additional LUMP to consider in this
alignment work.

**Why:** Its capability-forging and passkey checks are part of the requested
review, not an unrelated feature.

**How to apply:** Review its exact source and authority checks before candidate
inclusion; do not infer authorization to add a fourth resident LUMP or replace
the existing Mint merely from this request.

Draft the ide.Mint contract before completing its instruction bodies; keep the
saved LUMP untouched while authentication, operation authorization, commit
atomicity and exit guarantees are unresolved.

**Why:** The supplied review explicitly endorses contract-first work and warns
against inferring permission for arbitrary Namespace writes from a valid passkey.

**How to apply:** Treat unresolved mechanisms as release blockers, not invented
ABIs. Distinguish ordinary pre-commit denial from interruption after commitment;
only the former can promise no Namespace write events.
