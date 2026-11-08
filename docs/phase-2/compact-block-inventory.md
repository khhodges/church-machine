# Phase 2 direction — compact, expandable Block inventories

**Status:** Architectural direction agreed on 2026-11-02. This document does
not implement the design or authorize image installation, simulator activation,
saved-artifact replacement or hardware programming.

## Objective and Phase 1 boundary

**Phase 2 alignment:** use the [current lifecycle](../lazy-lifecycle-unified.md)
and [consolidated tests](test-checklist.md). This is later than the first
hardware lazy-load proof. Boot.Thread below is slot-2 SYSTEM; the shared
startup's ordinary CHANGE is a voluntary yield, not an LLR event or automatic
Thread recycling. It restores saved SYSTEM Z=0 without event injection.
Current watchdog, software-owned waiting state and authority checks still apply.

Prove compact placement, explicit capability handoff and expansion without
disturbing existing Blocks. Demonstrate B1 and B2 before scaling to ten Blocks.
This is Phase 2 direction, not a new Phase 1 completion gate. Complete the
existing B1 path without silently replacing its 64-entry C-list baseline.

A Block is a logical inventory of named objects and private allocation state,
not a fixed contiguous memory slab. Keep one shared `ide.FreeHandler`
executable and one shared `ide.FreeThreadStartup`; do not duplicate either
per Block or replace the existing boot/test `ide.AmoebaStartup`.

## Proposed compact profile

All allocation sizes are 32-bit words. Entry counts are not word counts.
Use B1 below; B2 uses the same suffixes under `ide.B2`.

| Named object | Quantity | Words each | Initial contents / authority |
|---|---:|---:|---|
| `ide.B1.FreeData0–2` | 3 | 64 | Zeroed; issued RW |
| `ide.B1.FreeData3–4` | 2 | 128 | Zeroed; issued RW |
| `ide.B1.FreeData5` | 1 | 256 | Zeroed; issued RW |
| `ide.B1.FreeClist` | 1 | 64 proposed | 16 total GT entries: SELF E + 15 NULL; issued LS |
| `ide.B1.FreeThread` | 1 | 512 | Offline-primed startup; application home initially NULL |
| `ide.B1.Inventory` | 1 | 64 | 11 private capability entries |
| `ide.B1.State` | 1 | 64 | Private allocation bookkeeping |

The 16-entry C-list fitting a 64-word allocation is a **validation target**,
not an established layout guarantee. Confirm header, entry placement, bounds,
protected SELF and ordinary SAVE behavior before adoption. Larger C-lists
remain a future option where workload requirements justify them; no new
size-selection API is approved here.

If that allocation is valid, the ten objects occupy **1,408 words per Block**,
excluding alignment gaps, Namespace table, directory, executables, boot/test
objects and applications. The existing recipe uses 1,472 allocated words
including Inventory and State; its pool also has 192 words of template gaps.
Removing fixed-slab placement may recover those gaps only where actual
alignment constraints permit. Neither saving implies ten Blocks fit the
current resident Namespace.

## Named GT structure and ownership

FreeHandler's C-list remains:

| Row | GT |
|---:|---|
| 0 | `ide.FreeHandler E` (SELF) |
| 1 | `ide.FreeHandlerBlocks L` |
| 2 | `ide.FreeHandlerBlocks R` |

The L view loads Inventory grants; the R view reads the explicit Block count.
The directory has SELF `ide.FreeHandlerBlocks E`, followed by
`ide.B1.Inventory L`, then `ide.B2.Inventory L` when registered. Scan rows
1 through count, never by LOAD of a NULL sentinel. The current directory
capacity is 63 Blocks plus SELF, not a guarantee of available resident memory.

Each Block's private Inventory contains:

| Row | B1 GT |
|---:|---|
| 0 | `ide.B1.Inventory E` (SELF) |
| 1 | `ide.B1.State RW` |
| 2–7 | `ide.B1.FreeData0–5 RW` |
| 8 | `ide.B1.FreeClist LS` |
| 9 | `ide.B1.FreeThread` (no permission bits) |
| 10 | `ide.B1.ThreadSetup S` |

`ide.B1.ThreadSetup S` is **private to B1**, targeting the same Namespace
slot and generation as `ide.B1.FreeThread`. It adds one grant, not another
object. FreeHandler uses it to SAVE the supplied application E-GT into that
Thread's saved CR1, subject to normal transfer checks. It is not handed to
the caller or issued Thread.

Keep State separate from Inventory: ordinary bookkeeping is not capability
storage. The issuable FreeClist is also separate from the private Inventory.
Names describe bindings; trusted destination binding supplies actual GTs.
Names alone never confer authority.

## Placement and expansion

Builder assigns valid nonoverlapping allocations to independently named
objects. FreeHandler follows GTs; it must not calculate an object's address
from a Block base or rely on adjacency.

Prepare B2's objects, State and Inventory, resolve exact bindings, then register
`ide.B2.Inventory L` and update the directory count together through the normal
explicit preparation/approval process. Preserve B1's issued and quarantined
state. Do not reseed an existing Block, replace the directory with a fresh
template, or silently substitute newer shared executable revisions.

Live insertion and state migration are not authorized by this direction.
The eventual expansion procedure must specify how continuing B1 state is
preserved, rather than treating a fresh whole-image reset as proof.

## Useful transaction demonstration

1. Allocate Data64, receiving `ide.B1.FreeData0 RW`.
2. Allocate a C-list, receiving `ide.B1.FreeClist LS`.
3. Place the Data GT into an allowed C-list row through normal transfer checks.
4. Invoke FreeThread with an explicit application E-GT.
5. Use B1's private ThreadSetup S to populate saved CR1 and return
   `ide.B1.FreeThread`; allocation does not activate it.
6. Under separate activation authority, run a bounded application operation.
   `ide.FreeThreadStartup E` calls the application in CR1, method 0; after
   return it loads its `Boot.Thread` GT and performs CHANGE.

**Open interface decision:** the present FreeThread interface supplies only
the application E-GT. Specify how that application obtains this transaction's
Data/C-list authority. Do not infer hidden register initialization, ambient
lookup authority, or access merely from a known name. Use an explicit,
reviewed handoff consistent with normal transfer rules.

Application completion does not automatically release or recycle the Thread.

## Acceptance evidence

Use the same exact FreeHandler and startup executable selections for both
Blocks, but deliberately give B2 a different valid physical placement.

| Test | Required evidence |
|---|---|
| Compact C-list layout | SELF protected; 15 writable entries; bounds enforced; LS works |
| Different B1/B2 placement | Both work without Block-base address assumptions |
| Three B1 Data64 allocations, then another | First three are B1 objects; next comes from B2 |
| B1 C-list exhaustion | Next C-list comes from B2 |
| Both Threads allocated with distinct applications | Each saved CR1 has its supplied application E-GT |
| B1 object released | Only owning B1 allocation state changes |
| Foreign/unissued release | Explicit rejection; no allocation-state mutation |
| Both Blocks exhausted for a kind | Explicit empty result; no automatic provisioning |
| B2 registered after B1 issuance/quarantine | Existing B1 state and object contents remain intact |
| Caller-visible authority | No directory, Inventory, State or ThreadSetup grants leak |
| Transaction capability handoff | Application receives only explicitly transferred required authority |
| Normal application completion | Return through shared startup to Boot.Thread; no implicit reuse |

Distinguish isolated fixture results, saved Builder design evidence, exact-image
simulation and physical hardware qualification. One does not prove the others.

## Deferred decisions and storage relationship

Keep a single exclusive caller and the existing 512-word Thread for the first
compact experiment. Do not combine it with smaller Threads, variable inventory
recipes, concurrent allocation, automatic recycling or SD backing storage.

Later work may qualify 256-word Threads from measured context/stack needs and
different inventory mixtures from measured workloads. These are not already
supported by the fixed Inventory contract.

The initial lifecycle remains **available → issued → quarantined**. Safe reuse
requires an explicit approved process for outstanding GT copies, generation
changes and reinitialization. Hardware never silently changes versions.
Quarantine alone does not revoke outstanding authority.

This direction supports the
[transaction-oriented Thread model](../phase-1/transaction-thread-model.md).
The separate [SD storage objective](sd-storage-abstraction.md) may later
support backing-store services, but storage capacity does not enlarge resident
RAM, and neither raw SD reads nor eviction imply Thread creation or revocation.
