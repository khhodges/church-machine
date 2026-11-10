# Isolated different-size revision adoption

Run from the repository root:

```sh
node docs/phase-2/cooperative-retry/test_revision_adoption.js
```

This is a bounded **local simulator execution demonstration**, not a new
production admission service, full-top RTL result, UART delivery test, or
physical acceptance result. It does not invoke the server, write saved LUMPs,
reset/reload an application image during adoption, build a BIT, or contact hardware.
The shared [runtime contract](starter-runtime-contract.md) remains authoritative.

## Boundary and authority

The ordinary CLOOMC compiler and LUMP builder produce complete executable word
arrays with a dispatch table and C-list. This demonstration supports type-0
stateless executable LUMPs, 64–1024 words, with compiler-owned SELF and optionally
one explicitly selected E dependency. The legacy zero-freespace profile is used;
this is not a test of embedded source/API transport or signed network admission.

The host approves its own exact compiler output using an opaque, instance-local,
single-use ticket. A SHA-256 digest checks that the presented bytes equal those
approved bytes; the hash alone is **not** authentication. An unknown ticket,
changed words, truncated/extra data or reused approval cannot publish a body.
There is no raw caller-supplied `validation_ok` flag.

Publication uses the simulator's ordinary identity minting, Namespace descriptor
writer, E capabilities and live generation checks. Destination identities are
distinct slots, not a retargeting of the old token or a name-wide redirect.
An explicit `compile(..., {dependency: publishedRevision})` creates a **new caller**
whose C-list grants that exact revision. A copied metadata object cannot grant
authority. Dependency authority is checked again immediately before publication.
The two revision bodies return constants and require no state migration.

The pre-reserved arena begins at word `0x2400`, defaults to 2048 words, and lies
below the Namespace table. Slots 40–59 are reserved for this private fixture.
Both slots and memory must be empty at staging and publication. Allocation sizes,
arena bounds, complete body length and freespace are checked before writes.
Reservations include staged/cancelled bodies and are never reclaimed. Peak
reserved words in each positive scenario are **448** (1792 bytes): both revisions
plus both 64-word caller LUMPs. Host-held staging arrays are additional to this
simulated-memory figure; it is not a hardware peak-memory measurement.

## What actually executes

One private simulator boots with the existing protected-Thread fixture.
The driver selects an old caller, which executes compiled LOAD/CALL instructions.
With execution paused inside the old revision, the demo stages and publishes the
new revision and separately authorized caller. Assertions preserve the old code,
registers, PC, STO, diagnostic frames **and actual protected Thread RAM**.
Normal instructions then finish the old method and RETURN to the original caller.

The driver subsequently selects the new caller and then the old caller again.
These selections are test-driver entry selections, not evidence of a concurrent
Thread scheduler or a hardware adoption instruction. All nested LOAD/CALL/RETURN
operations are real simulator operations on unchanged compiler output.
No whole-image reset occurs between those calls.

Both 64→256 and 256→64 allocations produce results **17, 29, 17**. A separate
80-instruction body also verifies automatic growth to 128 words by the ordinary
builder, rather than testing allocation padding alone.

The JSON output records input hashes, allocation addresses/sizes, distinct GTs,
validation/publication events and result assertions. It is regenerated from exact
compiler output on each run, not a hardcoded acceptance receipt.

## Rejections and limits

The harness checks insufficient memory, invalid allocation/arena sizes,
compiler rejection, tampered/truncated/extra bodies, unauthorized selection,
interruption before publication, duplicate approval, a competing allocation,
and stale dependency authority. It also exercises an ordinary CALL with the
stale GT and asserts a VERSION fault before replacement of the active frame.
Rejected cases leave the old call able to finish. Cancellation retains space
but never publishes a Namespace entry.

Publication is synchronous in this local model. This does **not** prove atomic
multi-cycle RTL writes, authenticated UART admission, progress of USER B during
transfer, watchdog renewal, or power-loss behavior. These remain shared-runtime
integration/qualification gates; image lifecycle integration is separate.
No hardware or watchdog implementation was changed by this demonstration.

Local checks:

- `node docs/phase-2/cooperative-retry/test_revision_adoption.js` — passed.
- `node tests/simulator/sim_return_cr6_l_perm.js` — existing neighboring suite
  fails at its c-list rejection expectation: expected `NO_CAPABILITY`, observed
  `BOUNDS`. No production simulator or shared fixture was edited here.
