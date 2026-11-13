# Native read-only Amoeba lifecycle

## Scope and evidence boundary

`simulator/examples/amoeba_readonly_lifecycle.cloomc` is an offline native
successor to the [fixed-allocation loader](amoeba-loader-contract.md). The
original source and saved review LUMP remain unchanged. No saved Namespace,
boot image, live service, vendor build or hardware was changed.

The user narrowed the first step to **read-only bodies that remain true to
their compilation**. Modified or mutable bodies remain allocated. There is no
checkpoint protocol, mutable-state migration, automatic eviction or new ISA.
While Amoeba runs, no USER executes concurrently. This is not a concurrent
collector and adds no hardware pin bits or synchronization.

This first allocator has **one reusable block and a provisioned set of
equal-sized executable Inform LUMPs**. It is intentionally bounded, not a
variable-sized heap allocator. It can load A, retire/collect A, put B in the
same block, retire/collect B, and reload A. A and B retain distinct Namespace
slots, versions and tokens throughout. Capacity exhaustion never evicts B to
satisfy A. Namespace/Thread LUMPs and LAMBDA frames are outside this candidate;
unsupported continuation geometry hard-faults before reclamation.

## Native entry points

| Selector | Method | Input and result |
|---|---|---|
| 0 | EnsureResident | DR1 selected slot; 0 resident, 2 block occupied by another slot |
| 1 | Retire | DR1 resident owner slot; records explicit intent, returns 0; does not release memory |
| 2 | Collect | DR1 explicitly retired resident owner; 0 reclaimed, 1 reference retained, 3 modified body, 4 not read-only |
| 3–8 | Private helpers | Selection, receiver access, descriptor validation/publication, protected-root scan |
| 9 | Run | Same one-USER SYSTEM loop as the original loader; optional startup DR1 slot / CR1 E-GT |
| 10 | UserStart | CALL the initial CR1 application, then yield without restarting it |

Only trusted SYSTEM orchestration receives this service's E capability. Helper
selectors are an internal ABI, not independent untrusted publication endpoints.
The services return DR1; callers must treat the other DRs and working CRs as
scratch across a service call, especially a self-CHANGE. CR5 is not used as
scratch. CR1 is retained by the public service RETURN mask.

`Run` invokes EnsureResident after LLR handoff and resumes USER through ordinary
CHANGE. Occupancy failure in this loop hard-faults with an explicit capacity
diagnostic. It never schedules an uninstalled target or initiates retirement
automatically. Explicit retirement/collection must be invoked separately by
trusted software. No IDE retirement button or live installation is included.

## Publication and reclamation order

State words are owner slot, phase and retirement slot. Phases are FREE=0,
RESIDENT=1, INSTALLING=2 and RECLAIMING=3.

1. EnsureResident validates the slot against private selected records and its
   retained absent descriptor. It reserves the free block before requesting
   the selected artifact through the existing CLA1 receiver.
2. The receiver admits the provisioned localized SHA-256 and complete length.
   Native code checks slot, size and executable header geometry, copies every
   body word, writes the header last, and commits complete consumption.
3. Native code publishes the target descriptor's resident location/seal only
   after copying, then marks RESIDENT. Other target descriptors still point
   to their own absent-header stubs.
4. Retire records intent but leaves the body callable. Collect requires that
   exact resident owner and explicit intent, checks read-only eligibility and
   descriptor identity, and scans continuation roots.
5. Collect requests the **same admitted artifact**, compares every received
   word to the resident body—including header, data, padding and C-list—and
   commits complete consumption even when comparison fails. A mismatch returns
   3 without modifying the body, descriptor, ownership or retirement intent.
6. After the receiver wait, Collect checks roots again. Only self-CHANGE ran
   during waiting; no USER was scheduled. It marks RECLAIMING, publishes the
   absent descriptor, zeroes the complete freed block, clears owner/intent,
   and publishes FREE **last**.

The absent and resident descriptors have identical authority/limit, generation
and token. Only location and its integrity word change. The runtime G mark is
ignored by identity comparison and preserved, not confused with a different
artifact. Neither retirement nor collection frees a Namespace slot or issues
a new GT. Requests for unknown slots or inconsistent state hard-fault.

INSTALLING/RECLAIMING are not resumable allocation states. A fault during copy,
descriptor publication or clearing leaves the block unavailable; there is no
automatic recovery or reset-persistence promise. No native code returns
success after a rejected delivery.

## Continuation protection

Amoeba's exclusive execution removes concurrent USER execution, but not future
uses. Collect begins with real self-CHANGE to save live working capability
registers into the SYSTEM Thread's actual homes. The private Thread table must
enumerate every configured Thread in the same Namespace, including SYSTEM.

The native scanner checks Thread geometry and CHURCH frame shape. It examines:

- every live protected CALL/CHANGE frame from protected STO to the root;
- the saved capability homes of every configured Thread.

A target's slot in any of those roots defers reclamation. This includes a
target that CALLs Amoeba and expects to RETURN, a suspended current abstraction,
and a pending CALL operand in a saved home. The scanner does not trust a host
call-stack shadow. Popped frame bytes below the current live stack do not pin
an allocation. Saved homes are deliberately conservative: an unused E or R
handle can defer collection until software drops it and saves the Thread.
Stale-version references also conservatively pin by slot rather than silently
upgrading their authority. Amoeba and its required services are never selected
reclamation targets.

## Private provisioning contract

The candidate declares SELF, Config R, State RW, Pool RW, EntryTable L,
ThreadTable L, Receiver R, Control W, USER Thread and SYSTEM Thread.

- Config starts with allocation words, selected target count, Thread count.
  Each target record is ten words: slot, read-only flag (exactly 1 permits
  collection), absent descriptor[4], resident descriptor[4].
- EntryTable row `i+1` is a bounded four-word RW view of target `i`'s Namespace
  descriptor, not a general Namespace grant. Row zero is SELF.
- ThreadTable row `i+1` is a private R view of a configured full Thread body.
- The pool grant is exactly the selected allocation size. Every selected
  target has the same size and a separate, retained zero-code header stub.
- Receiver selected records retain their original immutable localized bytes,
  digest, slot and geometry. They do not accept replacement bytes from the
  sender. CLA1 transaction/epoch, staging lock and full-consumption rules remain
  unchanged.
- Code, state/configuration, tables, Thread storage, stubs, staging and pool
  must be disjoint. Provision only ordinary executable Inform targets, never
  Amoeba, a Thread, Namespace, device, staging or collector-private storage.
  Read-only admission is trusted provisioning, not a user-supplied flag.
  Do not export writable aliases to an eligible body.
- Provision descriptors with matching size/version/token and independently
  valid seals; the resident location must be the pool and the absent location
  its selected retained stub. Freeze selected records and Thread membership
  for this candidate. A changed catalog “latest” is not reload authority.

Receiver admission and these grants are prerequisites, not authority conveyed
by a slot argument. Existing immutable compilation checks still apply to the
first image; this implementation does not create or save catalog artifacts.

## Local verification

Run:

```sh
node simulator/test_amoeba_readonly_lifecycle.js
```

The fixture provisions disposable state, compiles the native source and target
programs, and executes actual simulator CALL/RETURN/CHANGE/DREAD/DWRITE
instructions. A transport device model supplies admitted bytes and status only:
it does not compare resident bodies, allocate, retire, modify Namespace
descriptors, clear the pool or choose a reload destination. A small native Trial
method drives the public lifecycle methods; it is not part of the deliverable
service. Negative tests include deliberate delivery/body corruption.

Coverage includes A/B/A execution, delayed delivery, unchanged nonzero versions
and tokens, full zeroing before reuse, a real target-to-Amoeba CALL that must
retain its return body, saved Thread roots, mutable/modified refusals, occupied
capacity, idempotent residency, invalid identities, malformed Thread state,
missing retirement intent, unknown targets, duplicate collection, rejected
delivery and compiled fault cuts during publication/clearing.

**This is native simulator evidence, not integrated RTL or physical evidence.**
The existing `test_amoeba_receiver.py` suite owns real receiver RAM/SHA/framing
tests. Qualifying this successor with that receiver on the retained RTL is a
separate next step; neither the fixture device model nor the earlier loader's
passing RTL tests qualify the new lifecycle on hardware.
