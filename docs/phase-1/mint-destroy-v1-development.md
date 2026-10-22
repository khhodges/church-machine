# Mint DESTROY and cleaner — isolated V1 development

This is editable-source development, **not an approved or end-to-end validated
Mint service**. No LUMPs, Namespace bindings, FPGA image or board were changed.
The user authorized the existing always-approve PkVerify only for isolated V1
development and tests. It is not destruction authorization for live use.

## Source interface

- `simulator/cloomc/mint.cloomc`: CREATE always calls `ide.MintCleaner`;
  DESTROY accepts the slot in DR2 and its exact current DATA RW GT in CR7,
  with CR2/CR3 credential/proof and NULL CR4/CR8.
- `simulator/cloomc/mint_cleaner.cloomc`: Allocate, Release and ValidateRelease
  use DR7 slot and DR6 requested word count. Release/ValidateRelease also take
  DR8 physical byte base. Allocate returns its physical byte base in **DR2**,
  with DR1=1. RETURN restores DR4–15; DR8 cannot carry a service result.
- Mint's new c-list entry is `ide.MintCleaner E`, after the previous five
  dependencies. The old MintPool dependency remains for the historical
  allocator component fixtures, not the public V1 CREATE path.
- CleanerState and CleanerPool are separately provisioned private RW views.
  CleanerState contains header, cursor, exclusive end, physical byte base,
  record count, then four-word records: offset, capacity, owning slot, status.
  Status is unused/live/released (0/1/2).

## Intended lifecycle

DESTROY verifies the exact target and private allocation ownership, advances
the Namespace version before release, preserves the new version in MintState,
clears the descriptor, hands memory to Cleaner and returns a non-retired slot
to Mint's free-slot queue. Version 511 never returns to that queue. CREATE uses
the retained version, without a second increment.

Cleaner prefers a fitting released record, otherwise advances its cursor.
It zeros the entire chosen capacity before allocation succeeds. Release does
not zero synchronously. V1 does not split or coalesce released blocks.
Insufficient contiguous capacity faults with
`No free memory of the size required`; malformed state, invalid release and
allocation-record exhaustion are distinct faults.

These sources assume a single-threaded, privately provisioned test environment
with no executable, Thread, C-list or resident aliases into the data pool.
The checks do not establish a production active-use detector. Interruptions
abandon reservations; there is no rollback/recovery or concurrency guarantee.

## Verification and current blocker

`node simulator/test_mint_cleaner_v1.js` executes real compiled service methods
through CALL/RETURN in disposable RAM. It checks fresh allocation, release,
whole-block clearing, reuse by another slot, exhausted-cursor reuse, wrong-base
release, duplicate allocation, double release and exhaustion without mutation.

`node simulator/test_mint_destroy_v1.js` is the **strict integration reproducer**.
It currently fails during CREATE's result permission check, before DESTROY:
the produced byte-addressed descriptor is interpreted as word-addressed by the
legacy simulator's DATA bounds check. The fixture selects ascending Namespace
geometry only; no mLoad/TPERM/instruction checks are bypassed. Do not claim that
changing the Namespace layout alone validates the byte-addressed profile.

The full CREATE → DESTROY → stale-GT rejection → reuse flow, retirement,
protected-target rejection and interruption points still require execution
against a compatible, approved model. The strict reproducer is deliberately
not registered as a passing release check. Do not publish this source as an
operational Mint release until that validation and real authorization exist.
