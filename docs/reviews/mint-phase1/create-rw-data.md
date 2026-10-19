# CREATE: first RW Data implementation slice

Scope: editable ordinary CLOOMC assembly in `simulator/cloomc/mint.cloomc`,
not a runnable service, installed LUMP, private-opcode implementation, or
hardware change. Requested by the programmer after the four-case input review.

**Superseding confidentiality decision:** The programmer chose separate storage
returned clean (all zero), not a copy or new authority for existing storage.
Data CREATE no longer accepts a source payload or needs source-extent metadata.
The working draft requires CR4 NULL to avoid accepting unnecessary source
authority. It zeros every allocated word before publication. This removes
payload exposure during creation; post-return confidentiality also requires
controlling retained allocator authority and is not proven by this fragment.

## Working inputs

| Input | Meaning |
|---|---|
| CR2 / CR3 | Passkey GT / readable four-word proof reference |
| CR4 | NULL; no Data initialization source |
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
| Private allocation, slot/generation reservation | Explicit unresolved service branch; proposed internal CR8 destination |
| Zero entire allocation | Native indexed DWRITE loop; no payload reads |
| Namespace slot update | Private same-scope LAMBDA, four writes and read-back checks; protected binding/exclusion still unresolved |
| Publication, GC bookkeeping, accounting and issuance | Explicit unresolved service branch after Lambda return |
| Cleanup and final issued identity checks | Explicit unresolved branches, with native completion/NULL/RW checks |

The zeroing fragment expects allocator-issued private destination authority
in CR8 and decoded allocation size in DR6. These are internal continuation
contracts to bind, not additional caller parameters or implemented services.
Caller-provided CR8 grants no allocation authority. There are no copy-word or
source-length variables.
The publication stage must debit decoded DR6 once and issue Inform DATA RW B=1.
There is no fabricated completion assignment or promised rollback.

All unresolved fault/service branches remain undefined TODO labels: the whole
draft deliberately fails compilation rather than executing an incomplete path.
No implicit fault implementation or new HARDFAULT emission has been added.

## Slot-setting Lambda

The programmer directed that CREATE set the slot using LAMBDA. After zeroing,
the draft invokes `LAMBDA CR9` for an internal X-code body, not an E-GT service
or another public method.

| Internal variable | Working register |
|---|---|
| Trusted X GT to the private slot body | CR9 |
| Reserved slot index, then its four-word offset | DR7 |
| Four frozen descriptor words | DR8–DR11 |
| Namespace RW view, acquired only inside the body | CR10 |
| Read-back comparison scratch | DR4 |

These internal values must be bound from the validated reservation, not
accepted as caller authority. DR8–DR11 carry Namespace metadata, not payload.
The body writes exactly the selected four words, reads each back, checks
equality, and clears CR10 before releasing exclusion and returning. The caller
clears CR9 and proceeds to accounting/issuance. No result is issued first.

Explicit blockers still cover trusted X/NSRW binding, descriptor preparation,
slot bounds and empty-slot generation checks, and writer/observer exclusion.
LAMBDA does not itself provide atomicity, and four writes/read-backs do not
prove an exclusion mechanism. Partial writes on faults are not rolled back.

## Verification

`node simulator/test_mint_phase1_api_draft.js` checks ordinary compiler syntax,
requires all remaining compile errors to be unresolved TODO labels, and walks
the actual scalar/zeroing source fragments with test-owned storage. It covers
packed cases, permissions, power-of-two boundaries, absence of payload reads,
zeroing every allocated word from dirty storage, and leaving words outside
the allocation untouched. Passkey proof reads remain necessary.
The slot fragment is separately exercised with test-owned metadata to check
exact-slot writes, all four read-back mismatch branches, and clearing Namespace
authority before release. Ordinary compilation checks LAMBDA/RETURN syntax;
these tests do not establish real X-capability binding or runtime continuation.

This is fragment verification, not proof of Passkey validation, real allocation,
successful service execution, or committed accounting.
