# Mint DESTROY and cleaner — isolated V1 development

This is editable-source development with **isolated RTL lifecycle evidence,
not an approved live Mint service**. No saved LUMPs, live Namespace bindings,
FPGA image or board were changed.
The user authorized the existing always-approve PkVerify only for isolated V1
development and tests. It is not destruction authorization for live use.

## Source interface

- `simulator/cloomc/mint.cloomc`: CREATE always calls `ide.MintCleaner`;
  DESTROY accepts the slot in DR2 and its exact current DATA RW GT in CR7,
  with CR2/CR3 credential/proof and NULL CR4/CR8.
  CALL clears B on passed arguments; DESTROY materializes the expected
  comparison GT with B=0, without changing W3 or any identity/permission bit.
  EXACT remains a full-word comparison; no machine check is bypassed.
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


## Verification and execution-profile boundary

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

`python -m pytest tests/hardware/test_mint_destroy_core.py -q` now exercises
the complete compiled CREATE and DESTROY methods with MintCleaner and PkVerify
in the Amaranth simulator running `ChurchCore(iot_profile=False)`. This model
implements physical-byte descriptor bases, word offsets, ascending four-word
Namespace entries and native permission, integrity and version checks.

The profile authority is
[`approved-target-namespace.md`](../reviews/phase1-baseline/approved-target-namespace.md):
256 slots, metadata at 0, self at 1, entry Thread at 2, table-only limit 1023.
The fixture puts Mint at 9 and PkVerify at 15, but deliberately does **not**
claim coverage of the approved full 17-entry workload. Caller, Cleaner, private
views and fresh-history slots are disposable test provisioning. Slot 39 starts
explicitly never-used; empty table bytes are not used to infer history.
The pool remains at physical byte address `0xD400`, exactly the original JS
reproducer's `0x3500` word address times four. Private state bases are likewise
preserved, not relocated to disguise the address mismatch.

The harness compiles the current editable sources through the shared compiler
and canonical LUMP builder. It copies all service instruction and dispatch-table
words unchanged. Only headers/C-lists and a tableless, branchless test caller
are provisioned. A synthetic bootstrap NOP/CHANGE/CALL enters Thread 2 through
the ordinary boot checks; this is not certification of the installed boot ROM.
There are no host continuations, instruction translations, bus remaps or
permission-check overrides. Every retired instruction is compared with its
input word. Writes to service/caller instruction addresses are forbidden.

Four passing RTL cases establish:

1. CREATE returns DR1=1 and the exact DATA RW GT at version 0, with eight
   cleared words. The caller writes and reads the actual pool through that GT.
2. DESTROY returns DR1=1 and NULL, clears the descriptor, records version 1
   in private history, and marks the Cleaner record released without cleaning
   inline. A subsequent CREATE reuses the same slot and bytes, zeros them,
   retains version 1 (reserved history 1025), and permits caller write/read.
3. The captured old GT is rejected after release and after reuse. These are
   separate bounded executions: the former faults on the cleared descriptor's
   seal, the latter on version mismatch. A hard fault is never skipped to
   continue testing. The successful reuse execution shares the same initial
   CREATE/DESTROY prefix.
4. A read-only GT cannot write: the native PERM_W fault leaves pool data zero.

Snapshots at each service return check result identity, descriptor integrity,
release state, retained history, zeroing and unchanged allocation cursor on
reuse. Global write checks protect everything outside the Thread, private
state/scratch, selected descriptor and eight-word allocation. The caller's
test-only scratch captures the issued W3 token; no unissued token is inserted
into the boot-validated C-list.

**Not validated:** real authentication/authorization (PkVerify still always
approves only in this isolated development fixture); retirement at 511;
protected/non-owned targets; interruption, concurrent use, crash/reboot
history or recovery; production provisioning/alias exclusion; full 17-entry
integration; exact saved candidate acceptance; synthesis, timing or physical
hardware. Protected-target and partial-release coverage remains separate
downstream work. The legacy JS reproducer remains diagnostic, not a passing
release gate. Do not publish these sources as an operational Mint service.
## Additional Cleaner component evidence

`node simulator/test_mint_cleaner_v1.js` also stops immediately after each of
the 13 Allocate writes, separately for
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
| CREATE → DESTROY → clean/reuse with exact V1 source | Passing isolated byte-addressed ChurchCore checks above; legacy fixture remains blocked before DESTROY |
| Old GT access after release and reuse | Passing isolated native seal/version rejection checks; not stale/duplicate DESTROY acceptance |
| Protected targets and invalid credentials/proofs through DESTROY | Not accepted; always-approve PkVerify cannot establish authentication |
| Stale/duplicate DESTROY; retained 510 → retired 511; retired queue exclusion | Not accepted end-to-end |
| Every Namespace/history/queue write cut and restart safety | Not accepted end-to-end; RAM stops are not durable restart evidence |

The physical-byte ChurchCore lifecycle fixture under
`tests/hardware/test_mint_destroy_core.py` provisions the complete disposable
Mint/Cleaner/PkVerify graph and runs the exact current compiled instruction
words. The older fixture in `tests/hardware/test_mint_create_core.py` lacks the
current Cleaner binding and must not itself be cited as V1 lifecycle acceptance.
Neither fixture establishes the deferred destructive-path safety gates above.

Live use still requires approval of the credential/proof verifier's protected
interface and of any protected evidence needed to reject active/code/Thread/
C-list aliases. Neither synthetic provisioning nor an always-approve return
defines those authorities. No new authority or production policy is supplied
by these tests.
