# Thread heap call record — demonstration ABI v1

Phase 1 local reference copy of `docs/thread-heap-call-record.md`, captured
2026-10-16. This describes the initial demonstration, not completion of the
broader Thread service interface.

This is a software record convention, not a new ISA feature, hardware standard,
GT type, or change to the Thread header. It demonstrates the telephony example
using the current Thread's existing CR5 heap authority. No additional data GT
is created. It is Thread-local, not private to the Alice abstraction.

## IDE demonstration

Open Code → **Heap record** (also under Actions → Thread heap record). The dialog never replaces the
editor or saves a LUMP. Its source panel provides a downloadable
`ide.CallRecord` example specialized to the selected heap offset.

Enter/prepare a software Thread and pause execution first. Choose a region you
explicitly reserve for this demo (default heap offset 0). Initial JSON import
requires all 58 words to be zero; zero contents alone do not establish allocator
ownership, so the programmer must confirm exclusive reservation. Unknown
nonzero data is rejected. Replacing a recognized record requires confirmation.

1. Import the sample JSON to initialize the region, or use callable Initialize.
   Do not call Initialize after import: it deliberately clears the record.
2. Read current to inspect/export all fields.
3. Paste a partial JSON object, for example
   `{"routingSelection":"local","endpoint":"desk-12","callState":"connected"}`,
   and choose Apply partial update. Omitted fields remain unchanged.
4. Download JSON for inspection/transport. File selection only fills the text
   box; it does not mutate memory.

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
Initialize is destructive and must be invoked only for the reserved region.
Ordinary ISA permission and bounds checks still apply to every load/store.

## Lifetime and limits

The record remains in that Thread's live heap across ordinary method returns.
Reset, Thread replacement, or explicit reinitialization can discard it. It is
not automatically persisted to a saved LUMP. Processing on another Thread
does not automatically acquire access. This prototype is not a heap allocator,
cross-Thread handoff protocol, or private multi-tenant call database.
