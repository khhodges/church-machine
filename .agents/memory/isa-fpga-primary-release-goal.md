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

Namespace image design/adoption is TBD within the Phase 1 bitstream work.
Do not resume the earlier standalone multi-Namespace adoption plan.

**Why:** The user withdrew that plan after changes including Mint, explicitly
stating that this is all TBD as part of Phase 1 bitstream.

**How to apply:** Re-establish the Phase 1 image scope and inputs before preparing
or adopting a new executable Namespace. Earlier private candidate reports do
not establish the current resident policy or authorize activation.

Draft the ide.Mint contract before completing its instruction bodies; keep the
saved LUMP untouched while authentication, operation authorization, commit
atomicity and exit guarantees are unresolved.

**Why:** The supplied review explicitly endorses contract-first work and warns
against inferring permission for arbitrary Namespace writes from a valid passkey.

**How to apply:** Treat unresolved mechanisms as release blockers, not invented
ABIs. Distinguish ordinary pre-commit denial from interruption after commitment;
only the former can promise no Namespace write events.

Do not adopt the legacy hardware Mint writer as ide.Mint's commit primitive
merely because it stalls CPU execution.

**Why:** CPU exclusion alone does not establish external-writer exclusion,
completed RAM writes or defined interruption handling.

**How to apply:** Keep Outform containment intact. Require explicit write and
interruption evidence before enabling the writer, rather than treating an FSM
completion pulse as proof. A full transaction engine is not a Phase 1 requirement.

Phase 1 uses run-to-suspension cooperative round-robin timesharing.

**Why:** The user explicitly restated this scope when questioning whether the
Mint atomicity review justified more immediate infrastructure.

**How to apply:** Do not assume preemptive software concurrency or require a new
transaction engine solely for sequential Namespace writes. A bounded,
non-suspending update can exclude other scheduled Threads; reset/fault handling
and external writers remain separate requirements if Mint is enabled.

The user's final ide.Mint direction is the Phase 1 bounded rule, not the earlier
full transaction-engine recommendation. The authoritative Forge contract remains
the design team's draft; the supplied scaffold is a correction log only.

**Why:** The user supplied the bounded-rule and correction-log documents as the
final word on ide.Mint. They retain draft/unapproved mechanism status and do not
authorize implementation or saved-LUMP changes.

**How to apply:** Require a single non-suspending update body (no CALL/yield),
R1 external-writer exclusion or accepted writes, R2 bounded reset/fault drain or
proven recovery, and R3 publication only after completed writes and the reset
boundary. Preferred scope is exclusion plus bounded drain, create-only; the
documents still leave create-only versus replace as a team decision and exact
hardware bounds/real T input unresolved. Authentication and authorization gates
remain mandatory. Revisit at true-concurrency/multi-machine boundaries. Do not
interpret a recovery marker alone as reconstructing overwritten old words, or
create-only as permission to ignore retained generations on reused empty slots.

For the ide.Mint bootstrap discussion, apply the frozen-base T === GT rule
before asking for a separate content-token input.

**Why:** The user corrected the review's carryover of deferred portable-token
requirements into Phase 1. Missing a content hash is not a reason to write zero
for a bootstrap entry.

**How to apply:** Within the frozen resident single-machine scope, proposed W3
is the exact full resulting runtime GT, not zero or a projected token. Do not
extend that scope to dynamic rebinds/re-sequencing merely because scheduling is
cooperative. This correction is not authorization to change the saved LUMP or RTL.
The user subsequently authorized the narrow source-code correction for bootstrap
T instead of zero, not activation of Mint, a saved-LUMP change, or a hardware build
or flash. Keep those separate approval boundaries.

The physical-abstraction inventory must cover the full A7 board, not only the
minimal currently implemented bitstream. The user explicitly includes Ethernet,
HDMI and other board options.

**Why:** A minimal MMIO catalog omitted board resources and was mistaken for a
complete driver inventory during alignment review.

**How to apply:** Separate board-present, RTL-implemented, capability-exposed and
physically verified status for each resource. Verify the exact board/carrier
revision before claiming an exhaustive connector list or assigning GTs. Include
deferred resources in the inventory without making all of them Phase 1 release
requirements by implication.
