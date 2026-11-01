# Review: validating Mint data ranges and intentional aliases

Status: proposed changes only. No validator, admission policy, image builder,
upload route, or runtime enforcement was modified.

## Findings

`server/namespace_ascending_image.py:validate_image` currently conflates
Namespace descriptors with independent storage allocations:

- Every non-self resident descriptor must start outside the Namespace table.
- Every resident object must have a LUMP header.
- Every such object contributes a separate owned range; any overlap fails.
- Nonzero words outside owned ranges fail.

Those assumptions reject the approved Namespace RW view, the one-word scratch
view, and a raw allocation pool even though ordinary hardware capabilities can
describe them. Changing only the first overlap test is insufficient.

The validator already explicitly leaves ordinary C-list bindings to execution
and use. Therefore no new passkey gate, all-rows-bound gate, or binder status
rewrite is needed. `server.symbolic_binding.bind` correctly reports the unused
NULL verifier and approval rows as unresolved. Retain that diagnostic.

## Recommended minimal model

Distinguish **storage ownership** from **descriptor views** in the offline
candidate layout. This describes how the programmer constructed this exact
image; it is not new machine authority or an ISA format change.

Use an optional explicit layout accompanying the exact image:

1. **LUMP allocations:** existing executable/Thread validation remains intact.
2. **Data allocations:** explicit bounded raw-word extents, without requiring
   their contents to resemble a LUMP header.
3. **Aliases:** descriptor views wholly inside a named existing allocation.
   They do not allocate or own additional bytes.

Keep the existing behavior when no explicit layout is supplied. Do not detect
data merely because header parsing failed, and do not identify object kinds
from mutable names or content patterns.

The layout records the image SHA-256 and exact slot/base/limit/sequence
assignments. Recompute these from the bytes and reject mismatches. The
existing review already hashes both image and candidate metadata; include
the layout in that retained metadata rather than introducing a separate
approval system. A hash proves consistency, not permission to install.

## Apply to the approved candidate

| Slot | Classification | Required check |
| --- | --- | --- |
| 22 | alias of Namespace table | base 0, limit 255, exactly the table extent |
| 23, 24 | executable LUMPs | exact retained candidate/Cleaner and normal geometry |
| 25 | data allocation, MintState | 256 words at 6656 |
| 26 | data allocation, pool | 1024 words at 7168 |
| 27 | alias of MintState | one word at 6911, the private scratch word |
| 28 | data allocation, CleanerState | 64 words at 6912 |
| 29, 30 | future caller/Thread allocations | validate actual prepared bodies, not reservations |
| 32 | absent before CREATE | no fabricated initial object or live descriptor |

MintState contains a header that Mint uses to locate scratch, but it remains
data storage in this image-layout check, not executable code.

Aliases must refer directly to a real owned extent; no cycles or dangling
targets. Check each descriptor's sequence, flags, integrity and full extent.
The owned extents, including raw data, must remain non-overlapping. Continue
rejecting unowned nonzero words. Report aliases separately from `ownedRanges`
so the same bytes are not counted twice.

Do not allow an alias/data declaration to exempt the mandatory Namespace self,
entry Thread, or executable startup targets from their existing checks.
Do not use layout declarations to infer capability permissions: actual GTs
and existing runtime checks remain authoritative.

## NULL bindings and execution claims

Keep rows 4 and 7 NULL, the API unchanged, and the binder status `unresolved`.
Display the exact rows rather than marking the artifact “fully bound.”
The saved CREATE source ignores the passkey and does not load either row.
That observation is not proof that every method or future source revision
can safely use those NULL bindings. Unexpected use must still fault normally.

A structurally valid image, fully bound artifact, completed CREATE and
hardware acceptance remain different results. Do not collapse them into one
success flag.

## Integration boundary

The same optional layout must be used by candidate construction and
`NamespaceCandidateStore.review`, with derived range/alias results compared
against retained metadata. Otherwise a locally accepted candidate would fail
when reviewed, or review could describe different bytes.

`server/uart_profile_install.py` currently obtains the approved image and
configuration, discards the configuration, and calls `prepare_image(raw)`
without layout information. A future installation path must retrieve and
verify the layout from the exact retained approved revision, not from an
unchecked browser payload. Both prepare and install must recheck it.

For the next offline implementation, leave upload eligibility unchanged.
An offline candidate result must not silently enable UART installation.
Any later route integration must preserve exact BIT identity, image size,
version-zero boot pair, word-255 rule, target-specific installation evidence,
STOP/queue checks and explicit runtime-replacement consent.

## Verification required for implementation

- Existing frozen image still validates without layout metadata.
- Exact Namespace and scratch aliases validate with the matching layout.
- Wrong image hash, altered descriptor, unknown/duplicate slot or dangling
  alias fails.
- Escaping aliases, partial unowned coverage and overlapping owners fail.
- Raw data need not have headers; malformed executable/Thread bodies still fail.
- Mandatory boot objects cannot be reclassified to escape their checks.
- Nonzero sequence and bad-integrity cases remain independently checked.
- NULL rows remain unresolved and unchanged; no fake verifier is introduced.
- Review uses the same bytes/layout as construction.
- Offline acceptance does not authorize or enqueue hardware operations.

No tests above were run as new-behavior tests in this review: the behavior
is not implemented. Caller compilation, Thread setup and startup handoff
remain subsequent preparation work.
