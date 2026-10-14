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

**No GC in Phase 1.** The PP250 garbage-to-NULL suggestion is withdrawn.
Phase 2 hardware G-bit inversion requires the system GC-enable setting to be
set; the setting's location and how it is set remain Phase 2 open issues.
No automatic garbage/stale-GT conversion to NULL or GC mechanism is inferred
for Mint. This does not change the agreed NULL-test or EXACT fault semantics.

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

## 3. Service separation — LAMBDA and passkey direction approved; details pending

**Passkey-GT direction — approved:** Mint creates the passkey-GT and shares it
as Mint is permitted by the design structure, TBD as a **list of approved GTs**.
**Genesis is responsible for defining and approving that list and permitted
sharing structure for Phase 1.** Mint creates/shares under Genesis's policy;
it does not choose approved recipients. List contents, representation,
enforcement and issuance/sharing mechanics remain unresolved.
Do not infer IDE-only access, unrestricted CM
access, onward-sharing permission or NSRW-GT delegation. The pkverify proof
contract remains open; GT equality alone is not implicitly approved as proof.

**Approved:** Mint uses a **same-scope LAMBDA** as the only code referencing
`NSRW-GT`, accessing **one Namespace slot at a time**. Surrounding Mint code and
pkverify do not reference that capability. Route table reads and writes requiring
it through the LAMBDA; do not introduce a separate service LUMP.
This does not settle the LAMBDA ABI, capability provisioning, atomicity,
external-writer exclusion or interruption behavior.

- Mint performs authorized creation/replacement and Namespace publication.
- pkverify verifies the agreed proof/credential contract; token equality alone
  must not be silently substituted for the required separate 128-bit proof.
- nstab supplies the actual table-write capability, referenced only by the
  same-scope LAMBDA above. Provisioning must still be defined; a caller's E access
  to Mint does not confer NSRW-GT.
- A verification success must not silently authorize every possible operation.
  Define how the requested destination, object and rights are authorized.

These roles do not assign scratch CRs, DRs, proof storage or cryptographic
primitives. Existing draft ABI assignments are not adopted merely by reference.

**Proof requirement — approved:** pkverify requires both the passkey-GT and a
separate **128-bit proof**. **Mint creates the proof when it forges the PassKey.**
Missing or invalid proof hard-faults. Generation mechanism, protected storage,
transfer and verification ABI remain unresolved; this does not authorize
exposing proof material in public results, traces or diagnostics.

**Validity before equality:** NULL/NULL must never pass pkverify. EXACT alone
is bit comparison, not PassKey validation. Validate both supplied and trusted
GTs as non-NULL, valid and actively issued/bound credentials; require initialized
trusted reference state and complete proof presence independently of bit values.
Never fill missing credentials with zeros or trust caller-provided expected
values. Preserve validated bindings through use. Failure hard-faults.

**Approved fault rule:** Any fault in Mint, its same-scope LAMBDA or pkverify
is a **hard fault**, including failed authorization, verification, validation
and destination/commit checks. No recoverable rejection return, retry, rollback
or automatic continuation is introduced. A hard fault does not undo writes
already made; write visibility and interruption boundaries still need definition.

**Standard reporting requirement:** Software hard faults need a common
non-returning path carrying structured diagnostic data for the IDE. Protect
proofs and private authority; diagnostic delivery must not gate faulting.
The record fields, ABI, transport and implementation mechanism remain unresolved,
not new ISA or hardware requirements inferred from this design discussion.

**Agreed starting design:** compiler pseudo-instruction `HARDFAULT reason`,
with an exact-artifact IDE fault map from instruction offset to reason, method,
source line and explanation. Start with static diagnostics only, no runtime
reporting CALL or diagnostic scratch registers. Tiny LUMPs need not carry
explanatory strings. If no matching map exists, show the raw fault location.
The actual non-returning machine-code sequence and reliable capture of its
fault location still require verification; no new opcode or HALT substitution.

## 4. Growth headroom — proposal pending

**Allocation requirement:** Track used and free memory blocks per LUMP size
class in Phase 1, independently of Namespace-slot availability and generations.
This is explicit allocation management, not GC. Define pool ownership, initial
sizes, authorized release, safe reuse and exhaustion behavior in the remaining
contract; no splitting/coalescing or RESIDENT reclamation is implicitly approved.
Pool memory and bookkeeping must fit the approved half-FPGA-memory budget.

**User direction:** Draft the code first. The 100% growth-headroom proposal
below was not approved. The [code draft](MINT-CODE-DRAFT.md) exposes the proposed
control flow and unresolved mechanisms; it is not an executable or size estimate.

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
