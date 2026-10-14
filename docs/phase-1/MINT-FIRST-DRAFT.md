# Phase 1 Mint services — first contract draft

Status: working Q&A draft. Approved decisions are identified below; proposed
details are not implementation approval. No executable LUMP or memory reservation
is created by this document. The resolution log in
[the Phase 1 review](REVIEW-2026-10-14.md) records the user's decisions.

This is a new review output, not an additional member of the original 45-file
audit snapshot. Older source contracts remain evidence pending reconciliation.

## 1. Approved service scope

| Namespace slot | Object | Required role |
|---|---|---|
| 9 | ide.Mint, E | Working service supporting creation and authorized replacement |
| 14 | nstab, RW | Hand-crafted RW capability to the Namespace table |
| 15 | pkverify, E | Working verification LUMP; exact verification contract to be settled |

The table has 256 slots including metadata slot 0. Existing slot assignments
stay fixed; actual resident-body placement is a separate layout calculation.
The agent owns delivery. Prefer completing and validating the services before
the bitstream build; alternatively demonstrate a reloadable-LUMP path.
All services must work before Phase 1 is complete.

Two Phase 1 Namespaces sharing one CM FPGA's memory to test CM networking are
**Phase 2** work, not a Phase 1 Mint acceptance requirement. This does not change
the approved Phase 1 scope of one IDE managing several CMs or specify the future
test's memory layout or networking mechanism.

**Approved Phase 1 memory budget:** one half of the FPGA memory size; the other
half is left for the second Namespace in Phase 2. The Namespace table, LUMP
allocations and service growth headroom must all fit within the Phase 1 half.
Exact bytes and placement remain to be established against the target memory.

The user requests a first draft with enough space to grow. The allocation policy
below is proposed to satisfy that requirement; no exact byte allocation has
been approved or measured.

## 2. Draft operations — supported scope approved, ABI pending

**Create:** request installation into an empty destination entry.

**Replace:** request replacement of an occupied destination entry with explicit
authorization, **excluding RESIDENT LUMPs**. Mint must reject replacement of a
RESIDENT LUMP even for an otherwise authorized caller. Create-only restrictions
in the older draft no longer describe the selected Phase 1 scope, but the
RESIDENT exclusion is mandatory.

Both operations need a defined destination CM/Namespace, object, allocation,
requested authority and expected destination state. These are conceptual inputs,
not approved register assignments or a new wire protocol. Determine whether
one method or separate methods implement them during the Q&A.

Replacement is not blanket permission to overwrite executing code, the active
Thread, the Namespace itself, Mint or pkverify. Eligibility, exclusion, old
capabilities, generation changes and failure semantics remain explicit decisions.
The RESIDENT exclusion is already decided, not an unresolved eligibility option.
It applies to Mint and pkverify too if they are RESIDENT; their required
reloadability cannot be justified through Mint replacement in that case.
Hardware only checks generation equality; software owns generation management.
No wrap/reuse policy is inferred.

## 3. Service separation — proposal pending

- Mint performs authorized creation/replacement and Namespace publication.
- pkverify verifies the agreed proof/credential contract; token equality alone
  must not be silently substituted for any required proof.
- nstab supplies the actual table-write capability. Its holder and permitted
  delegation must be decided, not inferred from a caller's E access to Mint.
- A verification success must not silently authorize every possible operation.
  Define how the requested destination, object and rights are authorized.

These roles do not assign scratch CRs, DRs, proof storage or cryptographic
primitives. Existing draft ABI assignments are not adopted merely by reference.

## 4. Growth headroom — proposal pending

For each executable service LUMP, ide.Mint and pkverify:

1. Measure the complete required object size for the selected output profile:
   header, dispatch/method table, code, data, carried API/source metadata,
   C-List and required structural space—not just instruction bytes.
2. Allocate the smallest supported power-of-two size that provides **at least
   twice that required size**.
3. Keep that reservation stable for updates fitting within it. Recompute and
   validate the new artifact normally; spare space is not permission to mutate
   immutable saved artifacts, skip admission or replace a RESIDENT LUMP through
   Mint. Any separate resident-update procedure requires its own explicit
   contract; this headroom proposal does not approve one.
4. If a revision exceeds its reservation, require an explicit validated layout
   change; never overwrite the next object or silently relocate it.

This provides at least 100% headroom relative to the first complete payload,
subject to the approved half-FPGA-memory Phase 1 budget. It does not assert that the current board
has enough free memory. Exact initial capacities must follow compilation and
layout checks; guessing byte counts now would not establish usable headroom.

nstab is table access, not a third executable service body needing doubled
code space. Its exact descriptor/bounds must cover the approved Namespace-table
view; rights must not silently expand to unrelated memory.

## 5. Decisions to finish in this Q&A

- Approve or revise growth headroom; select supported object types and methods.
- Identify callers, nstab custody/delegation and operation authorization.
- Define pkverify, credential issuance/storage, proof ABI, revocation and replay.
- Define request/results, scratch/clobbers and authorized GT materialization.
- Define create/replacement validation, expected-state checks and in-use rules.
- Define write exclusion, reset/fault behavior and GT publication timing.
- Define loading/reloading of Mint and pkverify without a circular dependency.
- Define networked T to local-GT binding for one IDE managing several CMs.
- Define required tests and exact simulator/RTL/board evidence.

No missing mechanism is replaced by an accepting stub. Proposed implementation
choices stay open until resolved here; factual hardware bounds require evidence.
