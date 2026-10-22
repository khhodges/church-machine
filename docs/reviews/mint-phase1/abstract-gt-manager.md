# AbstractGTManager — native Phase 1 implementation

## Authority and scope

The user approved the two-method named interface, the 100-entry constants
catalogue, duplicate proof-name rejection and the bit layout below. The later
Phase 1 approval replaces the separate random-input buffer with 100 embedded
preformatted proof tokens. This implementation is a new editable
CLOOMC abstraction, not an installed Namespace service.

Source: `simulator/cloomc/abstract_gt_manager.cloomc`.
Genesis image helpers: `simulator/abstract_gt_phase1.js`.
Executable checks: `node simulator/test_abstract_gt_phase1.js`.

The helpers prepare inputs only. They do not implement the methods in
JavaScript, patch simulator dispatch or grant capabilities. The older
`simulator/abstract_gt_manager.js` is a different historical manager and is
not used by this implementation.

## Public methods and ABI

| Source method index | Method | Result |
|---|---|---|
| 0 | Constant(name) | Stable exact-value Abstract GT |
| 1 | NewProof(name) | New random B=0 Abstract proof GT |

For register CALL syntax, use `CALL CR0, #0` or `CALL CR0, #1`;
the assembler encodes these as selectors 1 and 2. The standard LUMP builder
emits the method table. No hand-written dispatch header is needed.

CR2 holds an R capability to a name DATA object. Word zero is its LUMP
header, word one is length, followed by one ASCII character per word.
Names are case-sensitive, 1..31 printable non-space ASCII characters.
`encodeName()` prepares the payload with word zero reserved for provisioning.
The constants catalogue includes 100 canonical names and the PHI alias.
Constants and named proofs are selected by their respective methods.

Successful RETURN retains CR1 (the result GT), sets DR1 to 1, clears working
DRs and uses RETURN keep-mask 2 to discard private capabilities. DR5 and CR5
retain the existing Thread convention. Failures HARDFAULT without successful
RETURN. No new lookup, replacement, revocation or verification API is added.
Mint still uses EXACT against its Genesis-approved reference.

Both methods are Genesis-owned: grant the manager's E capability only to
authorized provisioning callers. Merely passing the text "Mint" does not
authorize a call. The source cannot establish trust in an arbitrary caller
without that externally provisioned capability boundary.

## Approved word layout

| Bits | Meaning |
|---|---|
| 31 | B (zero in emitted constants and proofs) |
| 30..29 | Subtype: 00 constant, 01 proof; 10/11 reserved |
| 28..27 | High two payload bits |
| 26..25 | Outer GT type: 11 Abstract |
| 24..0 | Low 25 payload bits |

The constant implementation assigns payload IDs 1..100 in approved catalogue
order. These are identity labels, not numeric approximations. PHI uses the
GOLDEN_RATIO token. TRUE and FALSE are not aliases for ONE and ZERO.
The original 100 secure random 27-bit values are formatted once into proof GTs
and embedded with `.word`, which preserves the exact 32-bit value. The tagged
`WORD` instruction is not used for these raw GT words.

## Private provisioning contract

The method's C-list contains SELF followed by:

1. `ide.AbstractGTState RW`
2. `ide.AbstractGTCatalogue R`
3. `ide.AbstractGTScratch L`

All data offsets are ISA word offsets. Objects must fit their declared bounds.

| Object | Layout |
|---|---|
| State | header, issued count, capacity, random cursor, scratch, reserved, records |
| Catalogue | header, record count (101), records |
| Embedded pool | 100 preformatted B=0 proof words inside the manager's code LUMP |
| Scratch | One-word L view of State word 4 |
| Record | name length, token, 31 character words |

Genesis must provision disjoint private objects, the exact scratch view and
valid DATA headers/bounds. Capacity is 1..1024 records. `stateImage()` and
`catalogueImage()` reserve word zero for that header; they are not complete
installable LUMPs by themselves.

There is no external random buffer or runtime random-generation helper.
The first method starts with a branch over the embedded pool. With the header
and two method-table entries, the pool starts at LUMP word 4. Native DREAD
through CR14 reads the pool; a compiled-layout test guards this offset.
Tests compile separate source variants to force collisions; normal execution
uses the exact 100 approved words, not an executable-RAM patch.

The source scans existing names before consuming a pool entry. It then scans
existing proof tokens for each candidate; collisions consume another word.
The count is published only after the record and result have been formed.
A full catalogue or duplicate name leaves state unchanged. Exhaustion after
collisions retains the advanced cursor but publishes no new record.

Genesis must serialize calls and retain State, catalogue and the exact
embedded-pool artifact/cursor together across restarts. Never reset issued history
while its proofs remain provisioned. An interrupted partial tail record is
not published; a hard fault still requires explicit recovery, not an automatic
retry. No persistence service, pool refill or automatic regeneration is implemented.
The pool is internal data, not a secret from someone who can inspect the
source or binary. Genesis capability provisioning remains the authority boundary.

## Evidence and boundaries

The checks compile the complete source, issue all 100 embedded proofs and
reject the 101st without wrapping, and run it through ordinary simulated
CALL/RETURN, LOAD, DREAD/DWRITE and arithmetic. They check every canonical
constant, alias identity, random collisions, duplicate and case-sensitive
names, maximum-length names, full/exhausted inputs, corrupted metadata,
capability/data cleanup and an invalid executable rejection.

Tests use private simulator RAM, not a saved live image. Diagnostic sidecars
are not installed in this fixture, so negative tests assert the actual
HARDFAULT instruction site rather than the runtime's generic placeholder
message. This is simulator software evidence, not hardware acceptance.

The compiler now accepts the assembler's existing `.word` directive inside
method bodies, validating unsigned 32-bit literals. No new opcode is introduced.
No ISA instruction, simulator implementation, old manager, live manifest,
boot image, Namespace or board was changed. The new source still requires
explicit Genesis provisioning before it can be called in an installed design.
