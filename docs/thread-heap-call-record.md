# Thread heap call record — demonstration ABI v1

This is a software record convention, not a new ISA feature, hardware standard,
GT type, or change to the Thread header. It demonstrates the telephony example
using the current Thread's existing CR5 heap authority. No additional data GT
is created. It is Thread-local, not private to the Alice abstraction.

## IDE demonstration

Open **Builder → Thread Lump — Design Page → Thread heap record**.
This is the active, paused software simulator Thread's canonical CR5 heap,
not the saved/build Thread design on that page. Opening is read-only: it does
not prepare/enter a Thread, change targets, reserve a pool, allocate/import
records, save a design, build a LUMP, replace editor source, or access hardware.
The action is not in the Code toolbar or Actions menu. Its source panel provides a downloadable
`ide.CallRecord` example specialized to the selected heap offset.

Enter/prepare a software Thread and pause execution first. Set the heap offset
and **Pool words**, then **Reserve pool at offset**. Confirm that the entire
range is exclusively assigned to this demo, including zero-filled words.
Reservation records software ownership without writing memory. It cannot
detect another application's undocumented reservations.

1. Choose **Allocate next** or **Allocate at offset** to claim a 58-word record
   inside the pool. Allocate next uses the first available 58-word pool cell;
   explicit offsets may be unaligned. Overlapping allocations are rejected,
   even when all their words are zero. Nonzero unallocated data is never adopted.
2. Import the sample JSON to initialize the allocation, or use callable Initialize.
   Do not call Initialize after import: it deliberately clears the record.
3. Read current to inspect/export all fields. Click an allocation in the list
   to select and read it; use **Refresh allocations** after switching Threads.
4. Paste a partial JSON object, for example
   `{"routingSelection":"local","endpoint":"desk-12","callState":"connected"}`,
   and choose Apply partial update. Omitted fields remain unchanged.
5. Download JSON for inspection/transport. File selection only fills the text
   box; it does not mutate memory.
6. **Release** requires confirmation and erases exactly the selected record's
   58 words before making the range reusable. Other records are untouched.
   Reallocation gets a new identity, so a stale dialog confirmation cannot
   write into a released-and-reused allocation, even if its bytes are identical.

Pool exhaustion fails without writing anything. Release a record to make room.
An existing pool cannot be moved or enlarged in the same lifetime. Neither
import, read, update nor export accepts an offset without an active allocation.
Nonzero unknown data blocks import; replacing an initialized record still
requires separate approval. Release can erase a damaged but owned record.

The entire proposed JSON record is validated before publication. Unknown
fields, oversized UTF-8 strings, malformed state, wrong schema/version, and
invalid capability access fail without modifying any word. Changes to target
identity or record bytes after review invalidate the confirmation. Run/Walk/
Boot must remain stopped. No hardware endpoint is called.

## Exact word layout

All offsets below are relative to the selected record start in CR5's heap.
The record occupies 58 consecutive 32-bit words (232 bytes).

| Offset | Words | Field |
|---|---:|---|
| 0 | 1 | Magic = 137 |
| 1 | 1 | ABI version = 1 |
| 2 | 1 | Record extent = 58 |
| 3 | 1 | Revision, unsigned 32-bit wrapping counter |
| 4 | 1 | Call state: 0 new, 1 routing, 2 connected, 3 ended |
| 5 | 1 | Conditions: application-defined unsigned 32-bit bitmask |
| 6 | 17 | Caller name: byte length, then 64-byte UTF-8 capacity |
| 23 | 9 | Telephone number: byte length, then 32-byte UTF-8 capacity |
| 32 | 9 | Routing selection: byte length, then 32-byte UTF-8 capacity |
| 41 | 17 | Endpoint: byte length, then 64-byte UTF-8 capacity |

Each string's first word is its byte length, not character count. Bytes are
packed most-significant first in each following word, with zero padding.
Telephone numbers are strings, preserving `+` and leading zeros. Endpoint and
route identifiers are data, never authority to access their destinations.
Conditions do not confer permissions. UTF-8 decoding is strict.

JSON has schema `"church.thread.call-record"` and version `1`, plus
`callerName`, `telephoneNumber`, `routingSelection`, `endpoint`, `conditions`,
and `callState`. Export adds the stored revision. Import validates but does not
trust an incoming revision: first import starts at 1; replacement and updates
advance the current revision. Partial updates accept only the six data fields.

## Callable interface

The generated `ide.CallRecord` source contains explicit methods and uses the
normal compiler-generated dispatch table:

- **Initialize:** clear the reserved region and install the v1 header.
- **ReadState:** return the numeric state in DR1.
- **MarkRouting / Connect / End:** set the corresponding state.
- **ReadConditions:** return the conditions bitmask in DR1.
- **UpdateConditions:** store the bitmask supplied in DR1.
- **ReadCallerNameLength**, and corresponding methods for the other strings:
  return the UTF-8 byte length in DR1.
- **Read…Word0**, etc.: return the selected packed text word in DR1. Explicit
  fixed-index getters avoid allowing an unchecked index to escape a field.

State/conditions updates increment revision and clobber DR2. Text updates and
JSON conversion are IDE operations in this first version, not runtime JSON
parsing. Methods require an initialized v1 record at the compiled offset.
Initialize is destructive and must be invoked only for an allocated region.
Ordinary ISA permission and bounds checks still apply to every load/store.
These fixed-offset callable methods do not consult the IDE's software allocator.
Stop using them before releasing the allocation. A stale compiled method is not
revoked by release: CR5 still authorizes the Thread heap, not individual records.

## Lifetime and limits

The record remains in that Thread's live heap across ordinary method returns.
Reset, Thread replacement, or explicit reinitialization can discard it. It is
not automatically persisted to a saved LUMP. Allocation metadata is ephemeral,
per simulator and Thread identity; it is not encoded into heap words, JSON,
headers, GTs, or saved LUMPs. Reset generations, memory replacement, Thread
baseline reset, and overlapping program-load events invalidate ownership.
Switching away and back to the same live Thread preserves its allocations.
Bytes surviving an invalidation are not automatically adopted as owned records.
Processing on another Thread does not automatically acquire access.

This is a cooperative, fixed-size demonstration allocator, not a general heap
manager, cross-Thread handoff protocol, or private multi-tenant call database.
External software must respect the explicitly reserved pool. Raw writes through
CR5 remain possible under the existing ISA; no new authority or protection is
introduced.
