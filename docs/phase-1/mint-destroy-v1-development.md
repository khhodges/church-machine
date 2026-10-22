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

It also stops immediately after each of the 13 Allocate writes, separately for
fresh and recycled storage (26 cuts). This includes equal-value writes and every
word cleared. At each cut DR1 is still zero. A separate service request using
the same private RAM must allocate outside the interrupted reservation, leave
that reservation unchanged, and return only fully cleared storage.
Release is stopped after its status write: completion is still zero, a repeated
release faults, and a subsequent smaller allocation clears the entire capacity.
Both ValidateRelease and Release reject a different owner, oversized/zero
length, and a mismatched base without changing Cleaner state or pool bytes.

**These are instruction-boundary RAM-stop/re-entry checks, not reset or
power-loss recovery tests.** They do not prove Namespace invalidation happened
before the service was called. The fixture intentionally calls the private
service directly for component evidence; it is not a public release interface.

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

## Remaining acceptance gates

### Closure decision

The user approved closing the current development work and deferring the
unfinished full-path acceptance gates below until FPGA testing. This is a
scope deferral, **not a passed destructive-path safety proof**. Retain the
component evidence; revisit lifecycle rejection, stale/duplicate destruction,
510 → 511 retirement, every publication/release write cut, and restart safety
at the FPGA testing stage. Closure grants no live destruction, artifact
installation, hardware programming, or production authentication authority.

`node simulator/test_mint_destroy_input_guards_v1.js` separately exercises
eight native pre-mutation rejections: missing credential, missing readable
proof, missing target, non-NULL CR4/CR8, protected slots 0/1, and a slot outside
16 bits. It checks zero completion, NULL result, and unchanged private
state/pool/Namespace after fixture initialization. Initialization primes the
legacy proof descriptor's first-read flag; that simulator bookkeeping is not
destruction. These tests do not authenticate a non-NULL credential or establish
protected-target rejection after a successful CREATE.

| Requirement | Evidence |
| --- | --- |
| Cleaner fresh/recycled Allocate write cuts | Passing component checks above |
| DESTROY eight early input rejections | Passing native entry checks; no lifecycle/authentication claim |
| Cleaner malformed/non-owned Release and ValidateRelease | Passing component checks above |
| Release status cut, duplicate release, subsequent whole-capacity clearing | Passing component checks above |
| CREATE → DESTROY → clean/reuse with exact V1 source | Blocked in the legacy fixture before DESTROY |
| Protected targets and invalid credentials/proofs through DESTROY | Not accepted; always-approve PkVerify cannot establish authentication |
| Stale/duplicate DESTROY; retained 510 → retired 511; retired queue exclusion | Not accepted end-to-end |
| Every Namespace/history/queue write cut and restart safety | Not accepted end-to-end; RAM stops are not durable restart evidence |

The physical-byte ChurchCore replay infrastructure under
`tests/hardware/test_mint_create_core.py` is a potential compatible execution
path, but its historical fixture lacks the current Cleaner binding. Its older
CREATE acceptance must not be cited as V1 lifecycle acceptance without adapting
the complete disposable service graph and running the exact current bytes.

Live use still requires approval of the credential/proof verifier's protected
interface and of any protected evidence needed to reject active/code/Thread/
C-list aliases. Neither synthetic provisioning nor an always-approve return
defines those authorities. No new authority or production policy is supplied
by these tests.
