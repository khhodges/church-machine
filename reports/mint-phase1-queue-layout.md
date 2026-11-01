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
