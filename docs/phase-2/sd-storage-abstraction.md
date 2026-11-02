# Phase 2 objective — named SD-card storage abstraction

**Status:** Objective and method responsibilities agreed on 2026-11-02.
Not implemented or hardware-qualified by this document.

## Objective

Expose each SD card through a named abstraction, using the user's **`ide.SD#`**
notation. Multiple named cards may share one driver code abstraction while
retaining separate device bindings and state.

The board's SD slot provides storage, not additional resident RAM. Its capacity
does not enlarge the resident execution working set or the Namespace table.
The controller's presence and behavior in the selected bitstream require
verification; the existence of a physical slot is not evidence of driver support.

## Agreed minimal methods

| Method | Responsibility |
|---|---|
| **Info()** | Report card presence, capacity, block size, write protection and device status. |
| **ReadBlocks(first, count, destination)** | Read card blocks into an authorized writable **Data buffer**. |
| **WriteBlocks(first, count, source)** | Write card blocks from an authorized readable **Data buffer**. |
| **Sync()** | Wait for outstanding writes to complete and report failure. Completion alone does not guarantee recovery from power failure. |

Buffer arguments are capabilities, not unrestricted physical addresses.
Operations must enforce card bounds and buffer authority. Failure must be
reported explicitly rather than disguised as successful or simulated I/O.

This approves method responsibilities, not a register ABI, numerical error
codes, transfer limits or asynchronous completion protocol. Those details,
along with card-to-name binding and the precise suffix interpretation, remain
to be specified without changing the agreed abstraction boundary.

## Architectural boundary

```text
Thread/object backing-store service
    Object identities, storage placement, saved contexts and retirement rules
                          |
                       ide.SD#
    Capability-controlled access to the particular card's blocks
                          |
                    SD controller
```

The service above the SD abstraction owns:

- Locating stored objects and managing their storage allocation.
- Preserving and validating mutable saved Thread contexts.
- Deciding when objects may be loaded or retired from residency.
- Handling interrupted updates and recovery under an explicit storage format.

The SD abstraction itself does **not** create, resume, destroy or retire
Threads. A raw SD read must not directly overwrite protected Thread context.
No filesystem or transaction policy is added to the device driver by this
objective.

## Relationship to transaction Threads

This storage interface can underpin the
[transaction-oriented Thread model](../phase-1/transaction-thread-model.md):
three resident boot/test/startup Threads and additional transaction Threads as
resources permit.

First initialization uses a template; resumption requires the transaction's
actual saved context. Executable LUMPs and mutable suspended contexts must not
be confused. Loading and retirement continue to follow the established
run-to-suspension and lazy-load retirement rules; this objective does not
replace them or equate removal from RAM with destruction or revocation.

SD access is slower and less predictable than resident RAM access. Performance
and capacity claims therefore require measurement of the actual controller,
card and workload. Stored transaction count is not simultaneous execution
capacity.

## Verification objectives

Before claiming this objective complete, establish evidence for:

- The exact board, controller implementation and card binding used.
- Correct block transfers and explicit handling of absent/unavailable media
  and write protection.
- Rejection of out-of-bounds transfers and insufficient buffer authority.
- Write completion and error reporting with precisely stated Sync guarantees.
- Higher-level detection of corrupt or incomplete saved state, and validation
  against current object identity and authority before restoration.

These are verification objectives, not claims of existing tests or guarantees.
In particular, persistence alone does not establish crash recovery or permit
restoring stale capabilities as valid authority.

## Scope

This is a **Phase 2 objective**, not an additional Phase 1 completion gate.
It does not change the Phase 1 resident-only baseline, allocate Namespace
slots, grant capabilities, install a loader, or authorize hardware programming.
