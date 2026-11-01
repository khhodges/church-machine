# Phase 1 preconfigured object queues

Status: offline placement design, not a constructed or executable image.
This supersedes the eight-word single-object sizing proposal and synchronous
Mint scratch conversion as the foreground allocation path.

## Approved starting inventory

| Queue | Object size | Initial count | Object slots | Object words |
| --- | ---: | ---: | --- | --- |
| Free64 | 64 words | 4 | 32–35 | [7168,7424) |
| Free128 | 128 words | 2 | 36–37 | [7424,7680) |
| Free256 | 256 words | 2 | 38–39 | [7680,8192) |
| Returned | mixed | 0, capacity 8 | no new object slots | none |

Object sizes are powers of two, aligned to their size. Each object's inclusive
descriptor limit will be size minus one. These are RW data objects, not
executable LUMPs. Object storage totals 1024 words (4096 bytes).

## Separate private queue storage

| Queue | Reserved descriptor slot | Reserved words |
| --- | ---: | --- |
| Free64 | 40 | [8704,8768) |
| Free128 | 41 | [8768,8832) |
| Free256 | 42 | [8832,8896) |
| Returned | 43 | [8896,8960) |

Each queue reserves the minimum 64-word allocation, including its eventual
bookkeeping and GT entries. Total queue storage is 256 words (1024 bytes).
Combined object/queue reservation is 5120 bytes and 12 previously vacant slots.
These slots are reservations, not installed descriptors or granted capabilities.
The queue word format and executable/capability views are not fixed by this
placement check; in particular raw GT words are not automatically LOAD-able.

Prior service/state reservations [5120,6976) and caller/Thread reservations
[8192,8704) remain untouched. They are not evidence of a prepared service.
The previous whole-pool descriptor is not installed by this design. Any broad
pool grant for a future Cleaner belongs to a later custody review, not clients.

## Foreground contract

- Exact supported size class; minimum 64 words. No splitting or larger-class
  fallback. Keep existing passkey input present but ignored for this profile.
- Pop one already-prepared GT and return it in CR1; DR1 zero denotes success.
- Queue exhaustion is explicit; its numeric status remains to be defined.
- Queue storage and write grants are private to the service. Clients receive
  only their object's bounded GT, not queue, pool, or Namespace-write grants.
- Dequeue must have a single commit point and exclusive execution. The initial
  one-caller demonstration does not prove multi-Thread atomicity.
- Release validates exact issued slot/version and rejects duplicate or foreign
  returns before enqueueing. Returned storage is unavailable until recycled.
- Software advances generation before reissue, clears storage, and publishes
  the matching descriptor/GT before placing the object back in a free queue.
  Never wrap exhausted generations. Rejection of stale already-loaded GTs is
  still a frozen-profile verification requirement, not a demonstrated result.

## Deferred work and evidence boundary

Mint becomes an independent background refill Thread later. Until implemented,
the initial free inventory can be consumed; Returned does not imply working
refill. No direct creation fallback is authorized.

The checker reads the exact frozen archive image with SHA-256
5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d.
It validates that unchanged baseline, verifies slot vacancy, allocation
alignment and minimum size, bounds, both occupied extents and zero bytes, and
preserves UART word 255 and the boot target. Vacancy does not prove live slot
history: the approved fresh disposable origin is required.

Reproduce:

```sh
python3 scripts/check_mint_queue_layout.py
python3 -m pytest scripts/test_check_mint_queue_layout.py -q
```

This check does not emit or install an image, relax the image validator,
compile a queue service, or execute a dequeue. The next implementation must
define the protected queue representation and normal capability-load path,
then implement synchronous allocation/release against the finite inventory.
Boot handoff, physical upload, RTL replay and background refill remain separate.

## Proposed protected representation — pending review

For the finite-inventory first implementation, keep the eight preprovisioned
object GTs in the resident foreground allocator's ordinary C-list. The data
queue blocks contain object indices and bookkeeping, not writable raw GTs.
This is a proposed representation, not an implemented binding or a new API.

- C-list row 0: SELF E.
- Rows 1–4: private RW grants for Free64, Free128, Free256, Returned.
- Rows 5–8: the four 64-word object GTs.
- Rows 9–10: the two 128-word object GTs.
- Rows 11–12: the two 256-word object GTs.
- No Namespace RW, whole-pool RW, scratch L, or C-list write grant is needed
  by this foreground allocator.

The normal CALL establishes CR6.M. LOAD of a selected fixed C-list row resolves
an existing GT; it does not convert client-writable data into new authority.
Use explicit fixed-row branches for the eight entries initially, avoiding any
assumption about a variable-index LOAD encoding.

Each free queue's proposed 64-word data block uses word 0 for head, word 1 for
tail, word 2 for count, and words 3 onward for its bounded ring entries.
Ring entries are object indices: Free64 uses 0–3, Free128 uses 4–5, and Free256
uses 6–7. Capacity and class-to-index bounds are code constants rather than
caller-writable configuration. Each free block also reserves words 16 onward
for its per-object states (FREE, ISSUED, RETURNED) and matching issue versions.
Returned uses the same three-word queue header and eight index entries.
Unused words remain zero. Initial full rings have head=tail=0, with count equal
to capacity. Returned starts empty.

Synchronous dequeue:

1. Clear the incoming CR1 passkey; it remains ignored under this profile.
2. Validate the request against the existing packed allocation/RW API contract.
3. Select the exact size class. Empty means ordinary exhaustion; malformed
   queue bounds, state or class membership mean hard fault.
4. Read the head index, require FREE state and the expected provisioned version,
   then LOAD the corresponding fixed C-list row into CR1.
5. Mark ISSUED, advance head and decrement count before RETURN. Return CR1 with
   DR1=0. No calls or yields occur during this operation.

The multiple state writes are NOT hardware-atomic. The first implementation
requires exclusive single-caller execution. A fault during update is fail-stop:
do not retry, restore old free lists, or automatically requeue an uncertain
object. Recovery requires reconciliation; returned references must never
coexist with a reset queue claiming those same versions are free.

Ordinary failures return NULL CR1 and a documented nonzero DR1 status (numeric
codes still to be selected). No new GT is minted or version changed by dequeue.

Release/refill needs a separate implementation review. A future version bump
also requires replacing the corresponding retained GT before requeueing; the
initial read-only C-list cannot be assumed to refresh itself. Background Mint
will need a protected publication mechanism and synchronization with dequeue.
This initial representation demonstrates bounded distribution of prepared
capabilities, not a complete recycling allocator or proven revocation.
