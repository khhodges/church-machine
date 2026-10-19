# CREATE: first RW Data implementation slice

Scope: editable ordinary CLOOMC assembly in `simulator/cloomc/mint.cloomc`,
not a runnable service, installed LUMP, private-opcode implementation, or
hardware change. Requested by the programmer after the four-case input review.

**Confidentiality review reopened:** The programmer questioned why Mint should
read initial data that might be top secret. The current copy loop does load
payload words into Mint registers. Passing an R/RW source GT already grants
read authority, so removing the reads alone would not establish confidentiality.
The earlier initializer approval is not acceptance of this exposure.
No replacement has been selected: allocating a separate initialized object and
issuing authority for existing storage have different identity and accounting
semantics. Resolve this boundary before completing the copy path; do not treat
helper delegation as proof of payload isolation.

## Working inputs

| Input | Meaning |
|---|---|
| CR2 / CR3 | Passkey GT / readable four-word proof reference |
| CR4 | R or RW GT to initial data |
| DR2 | Power-of-two word size OR case 4, using the low three bits |
| DR3 | 3: DATA permission mask W+R; not TPERM's RW preset index 2 |

The proof bounds probe uses scratch DR4, preserving DR2/DR3.
The scalar guards reject other cases, other permissions, zero decoded size,
and non-power-of-two size. Decoded size is retained in DR6. The still-proposed
64-word minimum is not silently made mandatory.

## Written instructions versus missing bindings

| Stage | Current source |
|---|---|
| Input shapes and packed-size decoding | Native instructions |
| Passkey proof, authority and sufficient allowance | Explicit unresolved service branch |
| Source kind and authoritative readable extent | Explicit unresolved service branch; proposed internal DR11 result |
| Source fits destination | Native unsigned comparison |
| Private allocation, slot/generation reservation | Explicit unresolved service branch; proposed internal CR8 destination |
| Copy initial data | Native indexed DREAD/DWRITE loop |
| Zero-fill remainder | Native indexed DWRITE loop |
| Publication, GC/NS bookkeeping, accounting and issuance | Explicit unresolved service branch |
| Cleanup and final issued identity checks | Explicit unresolved branches, with native completion/NULL/RW checks |

The copy fragment expects independently verified source extent in DR11 and
private, disjoint destination authority in CR8. Those are internal continuation
contracts to bind, not additional caller parameters or implemented services.
Neither caller-provided CR8 nor a fabricated length grants authority.
The publication stage must debit decoded DR6 once and issue Inform DATA RW B=1.
There is no fabricated completion assignment or promised rollback.

All unresolved fault/service branches remain undefined TODO labels: the whole
draft deliberately fails compilation rather than executing an incomplete path.
No implicit fault implementation or new HARDFAULT emission has been added.

## Verification

`node simulator/test_mint_phase1_api_draft.js` checks ordinary compiler syntax,
requires all remaining compile errors to be unresolved TODO labels, and walks
the actual scalar/copy source fragments with test-owned storage. It covers
packed cases, permissions, power-of-two boundaries, source-too-large rejection,
exact and short copies, zero-filling, and unchanged input data.

This is fragment verification, not proof of Passkey validation, real allocation,
successful service execution, or committed accounting.
