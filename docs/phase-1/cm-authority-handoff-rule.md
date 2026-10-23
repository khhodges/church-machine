# CM rule — authority handoff at a boundary

**Status:** Finalized Phase 1 design obligation, not a new ISA mechanism or
claim of implementation correctness.  
**Date:** 2026-10-23

## Statement and scope

Where a design requires authority to be surrendered, consumed or invalidated
at a boundary, the guarded effect must not become observable while the
authority required to be surrendered remains usable by the prior owner.
Surrender and effect must be one indivisible observable commit, or ordered
so that every intervening fault fails closed.

If they cannot be one atomic act, surrender precedes the effect: failure may
leave authority spent with no effect produced, never the effect produced with
the authority still live. For an exclusive transfer, the new holder must not
be able to act while the prior service owner retains usable working authority.

This applies to **required surrender, one-shot use and exclusive handoff**.
It does not prohibit ordinary, intentional capability sharing.

## Why the rule is shared

The review identifies a common obligation at three design boundaries:

| Design | Boundary | Required property | Permitted fail-closed outcome |
|---|---|---|---|
| Amobea checkpoints | Restore a retained continuation | One-shot consumption cannot follow an observable restore | Continuation spent, not restored |
| Mint M3 result permit | Manufacture/publish a result GT | Single-use permit consumed before or with the guarded publication | Permit spent, no result capability published |
| Mint Cleaner | Publish cleaned memory to a clean/free queue | Cleaner surrenders working authority before or with consumer visibility | Block unavailable, Cleaner working authority surrendered |

These are obligations, not assertions that the three designs already satisfy
them. This document does not alter their implementations.

Version advancement invalidates old-version GTs. It does not invalidate a
current-version copy retained by the service performing a handoff.

## References and custody

GTs are copyable. Clearing a register with `LOAD NULL` removes that register's
authority, not every other copy. Each protocol must enumerate the relevant
registers, saved Thread state and scratch storage, and prove that no usable
service working copy survives its surrender boundary.

An unpublished queue entry may hold the transfer GT in queue custody, but
consumers must not be able to obtain it before the publication commit. Nor may
the previous owner retain an operational path to recover and use that custody
copy contrary to the handoff protocol. Protected queue state and trusted
service conduct must establish this; GT validity alone does not.

## What the rule does not provide

- No new opcode, GT format, automatic revocation or linear-capability guarantee.
- No rollback, retry, compensation or durable restart recovery.
- No assumption that a mutex disables faults, scheduling or all observers.
- No guarantee that reserving queue capacity makes publication fault-free.
- No machine-wide prohibition on deliberate capability sharing.

## Obligation on each citing design

1. Identify the authority being surrendered and all relevant storage locations.
2. Define the exact commit point and which observers can see it.
3. Specify approved ISA operations, synchronization and scheduling assumptions.
4. Prove the intended success path and the fail-closed outcome at each cut.
5. Inject faults at instruction boundaries around authority/state writes and
   publication, and exercise scheduling interleavings in the faithful approved-
   ISA simulator, including saved-state restoration.

A proven protocol can provide a reusable pattern; **each application must
separately prove its commit point, authority storage, fault cuts and scheduling
interleavings**. Software evidence is not automatically FPGA acceptance.

See the [Mint/Cleaner proposal](mint-cleaner-gt-queues-proposal.md) and
[review disposition](cleaner-queue-review-note.md).
