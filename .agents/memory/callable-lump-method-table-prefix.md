---
name: Callable LUMP method-table prefix
description: Defines the binary-layout requirement for generated artifacts entered through a numbered CALL method.
---

Every callable LUMP starts with its header and method-routing table, before
method bodies. Use the established compiler/LUMP builder and CALL contract;
do not create a new dispatcher or use method-zero entry as an excuse to omit
the table. Historical BRANCH-entry formats and bare-offset formats exist;
inspect the current producer and consumer rather than assuming which encoding
is active.

Do not confuse source method ordinal zero (`CALL CR1, #0`) with encoded
dispatch selector zero. The former selects the first declared method and
encodes selector one; the latter is obsolete direct entry.

**Why:** Rejecting the source ordinal would break valid callers rather than
enforcing mandatory dispatch. Historical inspection does not authorize new
direct-entry compilation or automatic rebinding.

**How to apply:** Validate the emitted selector, require a method operand,
and use the canonical offset-table builder for new positive execution tests.

**Why:** The user explicitly corrected work on Mint: “The LUMP starts with a
method rounting table ALWAYS, the CALL instruction expects it. Start there!”
Undefined TODO targets had distracted from this already-solved structural
requirement.

**Why:** A numbered CALL reads the corresponding LUMP word as a dispatch entry. If a builder places the first body instruction there, the dispatcher reads ordinary code as a method-table entry and faults (or an unsafe legacy dispatcher can interpret it as an enormous PC).

**How to apply:** Begin callable source work with the API-ordered table and
its method entry points, then input checks and bodies. Generate the table
once through the existing builder. Keep unfinished method implementation
distinct from verified dispatch-table layout.

Legacy bare entries include the header in their LUMP-word offset; convert to logical PC by subtracting one. Canonical BRANCH entries retain PC-relative semantics.

**Why:** Treating WukongCallHome's bare entry 2 as logical PC 2 skipped its first LOAD, leaving BTN_DEV in CR3 and causing the subsequent LED DWRITE permission fault. A manually installed test context bypassed the erroneous CALL path and initially concealed the cause.

**How to apply:** Test through real CALL entry and instruction stepping, not a manually selected body PC. Keep CALL, any legacy dispatch consumers, and displayed method targets consistent.

Never classify a saved bare entry of 2 as inherently corrupt, or promote a BRANCH-entry replacement based on the builder alone.

**Why:** An isolated SelfTest candidate probe found hardware interpreting the BRANCH instruction as a raw word offset, producing an out-of-range NIA before body entry. The exact same bytes completed the body and returned successfully through method zero. This is a consumer-format mismatch, not evidence that the old bare entry was bad.

**How to apply:** Require a numbered CALL hardware-model trace before adopting a candidate. Both canonical signed relative entries and bounded legacy offsets must remain supported, with table-index and target bounds checked before instruction fetch. Keep direct-entry success distinct from method-table compatibility, and keep simulation evidence distinct from physical-board release evidence. Fixing the model decoder does not update previously generated RTL or an installed bitstream.