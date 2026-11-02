# Phase 1 — transaction-oriented Thread model

**Status:** Agreed architectural direction, recorded 2026-11-02.
This documents the intended model; it does not claim that lazy loading of
Threads is implemented or qualified. Implementation remains paused for review.

## Agreed model

Maintain **three resident boot/test/startup Threads**, with additional
transaction Threads **as resources permit**. A transaction can have its own
Thread—for example, **one per order or one per telephone call**, using the
PP250 telephone-call example raised in the review.

Load transaction Threads lazily **as and when needed**, applying the existing
**run-to-suspension rules** and **lazy-load retirement rules**.

The number of transaction Threads can therefore exceed the number resident
at any one time. Resident memory limits the working set, rather than defining
the entire population of transactions. Namespace capacity, backing storage
and other available resources still bound that population.

The three resident roles above describe Threads, not a requirement for exactly
three executable abstractions or three LUMPs. This note does not assign slots,
replace the current Namespace, or change its boot bindings.

## Shared code, independent contexts

Many transaction Threads may use the **same executable abstraction**.
Each Thread carries its own execution context, working state and capabilities;
sharing code does not require sharing transaction state or authority.

For example:

```text
Shared executable: ProcessOrder
Transaction Threads:
    order A — its own context and capabilities
    order B — its own context and capabilities
    order C — its own context and capabilities
```

This is not a requirement to allocate a Thread for every ordinary function
call. CALL/RETURN remains appropriate for nested work within a transaction.

## Suspension, loading and retirement

- First initialization and resuming a suspended Thread are different operations.
  Reloading a suspended Thread must preserve its actual context, not replace it
  with a fresh startup template.
- Execution follows the established run-to-suspension rules.
- Retirement follows the established lazy-load retirement rules.
- This note introduces no replacement scheduler, eviction policy, automatic
  restart, revocation mechanism or recycling scheme. It does not redefine
  suspension, transaction completion or retirement as interchangeable events.

The [Master ISA](../instruction-set.md) remains authoritative for machine
semantics. This note records the intended use of those rules, not new encodings
or exceptions to authority checks.

## Phase 1 implementation boundary

The present Phase 1 resident-only baseline remains unchanged. The lazy-loaded
transaction population is the intended direction **when Thread lazy loading
is available**; documenting it is not permission to mark current placements
Lazy or a claim of runtime or hardware acceptance.

The [FreeHandler B1 example](../../simulator/examples/free_handler.md) is a
small, finite initial inventory—not the long-term limit on Threads:

- One shared `ide.FreeHandler` manages block-specific private inventories.
- One shared `ide.FreeThreadStartup` starts the application's first method
  through CR1 and yields to Boot.Thread after it returns.
- The existing boot/test `ide.AmoebaStartup` remains separate and unchanged.
- Adding transaction capacity does not require duplicating the handler or
  startup code for each block.
- The current Release operation quarantines objects. It does not claim to
  implement the eventual Thread lazy-load retirement or reissue lifecycle.

No saved Namespace, executable image, running Thread or hardware configuration
is changed by this document.

The agreed [named SD-card storage abstraction](../phase-2/sd-storage-abstraction.md)
is a **Phase 2 objective** that can support this model. It is not an additional
Phase 1 completion requirement.
