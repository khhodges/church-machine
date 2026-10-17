# Remaining engineering gates and explicit approvals

[Entry point](README.md)

These are the unresolved contracts, not a new questionnaire about settled
policy. “Engineering” calls for code/measurement; “approval” means a choice
would change authority, compatibility, custody or observable behavior. Detailed
work packages are in the implementation plan; all gates are currently OPEN.

| Gate | Evidence / problem | Bounded alternatives and recommendation | Decision / closure needed |
|---|---|---|---|
| **G1 — Legal Lambda/ABI/results** | S02 Lambda location jump vs inline JS; S03 continuation/frame/keep-mask differences; no demonstrated internal label X or CR result path | Prefer an existing legal same-artifact X binding plus validated private result-cell LOAD. Otherwise specify smallest architectural change; do not fabricate CRs, make a separate service, or enable old fused opcodes | Engineering trace and same-byte cross-layer tests first. Explicit architectural/provisioning approval if new subobject authority, aliases or continuation semantics are required. Accept exact proposed ABI only after this |
| **G2 — Original requester** | S03 protected caller E exists, not a proven service-facing authenticated hierarchy API | Prefer bounded read-only context attestation using existing trusted frame validation. Alternative new narrowly scoped context interface; reject caller strings, Owner bits and host callStack | Demonstrate legal authority and hierarchy mapping across Mint→PkVerify. Approve any new interface rather than broad Thread/NSRW access |
| **G3 — All live return dependencies** | S03 protected STO outside heap; no complete authoritative cross-Thread scanner found | Prefer validated bounded traversal of all live/suspended contexts under exclusion; alternative protected fully maintained dependency index | Engineering coverage of every frame/context lifecycle and corruption case. Approve interface if protected state is inaccessible; never narrow to current CR14/CR6 or all outstanding GTs |
| **G4 — Whole-update envelope** | S06 per-instruction busy; S07 M6/raw UART/reset and RAM priority; readback alone insufficient | First prove bounded existing admission/observer exclusion. If impossible, propose minimal interlock/reset containment or explicitly enforceable operational constraints. Prefer no new engine, but never weaken safety to avoid hardware | Engineering reachability and accepted-write latency evidence. Explicit approval for new hardware or restrictions; software gate separate from bitstream milestone |
| **G5 — Durable custody and anti-rollback** | S10 ordinary transactions/fsync are not a vault; Q54 needs atomic record/pool/counter and trustworthy boot restore | Dedicated private transactional store and separate keys; external monotonic revision anchor vs Genesis-verified latest-state procedure. Recommend independent anchor where available | Select custody/backup/latest-state mechanism and actual durability boundary, prove crash cuts and corruption/rollback rejection. No permission to lose pool entries or resume calls |
| **G6 — Protected provisioning/administration** | S09 verified HTTPS option but HTTP default and plaintext UART; board secure endpoint/key anchor unestablished | Authenticated confidential end-to-end path recommended; alternative explicit physical-isolation custody model only with evidence. Neither is a runtime Forge transport yet | Approve trust anchors/key custody, authenticated Genesis authorization and board receipt protocol; demonstrate secret-safe boot/debug/reset and runtime store exchange |
| **G7 — Identity/type/layout/allocator binding** | S01 Boot.Namespace role vs S11 Boot.NS seed; Q06 assigned-Owner policy vs legacy Abstract users; free/retired entry representation and virtualGT unresolved | Bind Boot to exact approved configuration self-entry, not new name. Configuration-scoped incarnation registry proposed; local T===GT. Reject virtual/non-memory objects until explicit binding exists. Typed validators and retained slot-history records | Engineering exact packing/allocator/zeroing fixtures and resource measurement. Approve identity-lifecycle/compatibility changes and final capacities; do not reopen initial empty targets or change residency |
| **G8 — Diagnostic and release evidence** | S04 HARDFAULT emission disabled; map verifier has empty production trust pins; old tests cover narrow paths | Reuse existing wider Phase 1 map/target qualification work, not a second standalone candidate investigation | Binding/key approval and exact-site provenance; JS/RTL/generated/exact-build/physical acceptance separately recorded. Any Genesis override must name missing evidence and scope |

No policy decision remains about first Replace/Destroy targets, fresh pools,
burn-first consumption, interrupted-call replay, no-sharing, resident exclusion,
same-slot replacement, zeroing timing or all-five-method admission. Those are
settled; implementation difficulty does not reopen them.

### Administration ABI still needing joint acceptance

The following exact proposal completes the method-call surface without inventing
an existing admin capability. Forge/Revoke take **CR2: Genesis-authorized admin
capability (G6)** and **CR4: R descriptor**, CR3/CR7/CR8 NULL. Names/session flags
do not substitute for CR2. A separate protected setup path uses the same validated
authorization record before ordinary execution. No operational PassKey grants
Forge or Revoke merely by possession.

`AdminRequestV1` is 24 big-endian words:

| Words | Meaning |
|---|---|
| 0–2 | `0x4d414431` (“MAD1”), count 24, version 1 |
| 3 | Owner ID 0–15 for Forge; zero for Revoke |
| 4–7 | Configuration ID |
| 8–11 | Genesis authorization ID |
| 12–15 | Immutable approved policy-record ID for Forge; zero for Revoke |
| 16 | Exact credential GT to revoke (ordinary matching field, never authority); zero for Forge |
| 17 | Expected registry revision |
| 18–23 | Required zero |

The method selector determines operation. Forge policy is looked up independently
in protected Genesis-approved records, not caller-supplied permissions. Revoke
requires the authorization record to name the exact GT/configuration and expected
revision. The monotonic mirror transport revision is u64; this proposed on-board
u32 field must fault before exhausting its range, never truncate; widen it in a
future approved ABI if needed. Admin descriptors use the same coherent snapshot
and bounds rules. Responses have no proof or private registry material.
