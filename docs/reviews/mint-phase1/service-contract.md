# Effective service contract

[Entry point](README.md) · [Decision authority](decisions.md)

This is the **required behavior**, not a description of a working service.
Concrete layouts in [implementation-plan.md](implementation-plan.md) are proposals.

## Actors and capability matrix

| Actor | Entry / data authority | Must not acquire |
|---|---|---|
| Genesis through authorized IDE setup | Assign Owners; approve credential records; authorize Forge/Revoke; provision/restore before execution | Ambient runtime authority from being first caller or naming Genesis |
| Authorized client hierarchy | Mint E; own PassKey; own proof R; request/payload R; explicitly held object GTs | Registry, pool, NSRW, verifier E, another recipient's credentials |
| ide.Mint, slot 9 | Five E methods; runtime private registry RW; private random pool; allocator metadata; PkVerify E; protected scratch | Permission to invent Owner assignments, targets, recipients or grants |
| Same-scope Mint Lambda | Only code referencing slot-14 NSRW, including READ/recheck/COMMIT; one slot per invocation | Separate service identity, delegation of NSRW, CALL/CHANGE/SWITCH/yield during writes |
| ide.PkVerify, slot 15 | E distributed only to Mint; registry R; frozen request/proof/provenance R | Registry W, randomness pool, Namespace RW, caller-chosen expected proof |
| ide.NSTab, slot 14 | Existing table RW view; no executable methods | A second table, helper service, or authority inferred from its name/slot |
| IDE persistent store / provisioner | Authoritative credentials, revocations, permissions, consumption and ID state | Public/browser-readable proofs; replay of stale or revoked state |
| Bridge/debug/upload/operator paths | Existing maintenance capabilities under their own contracts | Assumed permission to read Mint secrets or interrupt publication safely |

The matrix is a provisioning and code-audit obligation. Same-scope code shares
authority: restricting references to the Lambda is not itself hardware isolation
from malicious Mint code. Mint's exact bytes and control flow are trusted for
this policy. No proof checks are added to ordinary ISA LS/RW operations.

## Encoding and identity

```text
31        30 ........ 27  26..25  24 .................... 0
B (Bind)  Owner A-GT-id   11      Owner-defined payload
```

`GT = (B<<31) | (owner<<27) | 0x06000000 | payload`, with independent range
checks before packing. Owner values 0–15 are assignable by Genesis, unique to
one hierarchy throughout this configuration's lifetime, including reboot and
revocation. The mapping is not global or an authority grant. Assigned-Owner
Abstract GTs are PassKeys; historical Abstract/Outform/device/portable-lock
consumers require a compatibility audit before applying that interpretation.

Mint's payload is a sequential ID, initially 0, through `0x1ffffff`.
Committed/issued IDs are never reused; a wider next-ID value `0x2000000` means
exhausted, not wrapped. An uncommitted candidate is not an issued ID (Q54).
Owner 0 with payload 0 and B=0 is `0x06000000`, **not NULL**. NULL is type `00`,
including nonzero encodings. Proof presence is independent of its numeric
value: a complete all-zero synthetic proof is not forbidden by policy.

## First operational credential

| Field | Effective grant |
|---|---|
| Owner and recipient | ide.Mint, Owner ID 0; same hierarchy in two distinct roles |
| B / payload | B=0; sequential 25-bit ID starting at 0 |
| Create | All four supported types; one explicitly bound Boot Namespace |
| Replace | Four type selections recorded, **empty target set** |
| Destroy | Four type selections recorded, **empty target set**; resident prohibition retained |
| Administration | New/replacement credentials and revocation only on Genesis-through-IDE authorization |
| Sharing | None; ordinary SAVE into another C-list faults; cannot erase/detect arbitrary copied proof bytes |
| Lifetime | Reusable across hard boot until revoked; restore same pair, consume neither ID nor randomness again |
| Provisioning | Protected Mint-owned credential C-list plus separate private proof storage, before ordinary execution |

“None, period” is not “none initially.” Any permissions change requires revoke
and replacement, with different GT and fresh proof. No tests may manufacture
positive Replace/Destroy rights for this real credential.

## Operations and verification

| Method | Required authority and effect |
|---|---|
| Create | Valid credential/proof and authenticated allowed recipient; operation/type grant in one fixed Namespace. Mint selects eligible unused slot and free block, validates/initializes full object, publishes only after confirmed NS update. |
| Replace | Valid operation/type and exact-object target grant; reject resident, current active or live return dependency. Same slot, next version exactly once, separate free block. Current version 510 faults before changing target. |
| Destroy | Valid operation/type/exact-object grant and exclusions. Invalidate binding by advancing version before free; zero full block before allocator reuse. Version 510 becomes retired 511. No result object capability. |
| ForgePassKey | Authenticated Genesis-through-IDE request; Mint forges from approved Owner/grants and private random pool. Q54 atomic IDE commit; board agreement before success; protected delivery only after commit. |
| RevokePassKey | Authenticated Genesis-through-IDE request; invalidate pair durably and on board before success. No cascading invalidation of already-issued object GTs. |

All five share one admission guard. Overlap hard-faults **before the overlapping
request's mutations**. No queue/retry; do not promise the first request survives
a machine hard fault. A verifier cannot read a partially updated record.

PkVerify checks independently trusted, initialized, actively issued state;
non-NULL correctly classified GT; complete bound 128-bit proof and revocation;
original recipient; exact frozen operation/type/destination/target permission.
Compare all four proof words with XOR/OR accumulation and one final equality
decision, not early mismatch exits. Earlier validity checks may fail earlier;
this is **fixed-work equality**, not whole-verifier constant time.
Success is usable only for that immutable request and current registry state.
Mint separately validates live eligibility, allocation and publication.

Request/proof R capabilities do not freeze aliases. Snapshot coherently into
private storage before authorizing; retain the exact snapshot through use.
Caller-provided names, Owner bits, numeric GTs, expected proofs or expected
permissions are never authenticated evidence.

## Slot and block lifecycle

```text
proven never-used slot --Create--> occupied version 0
occupied v (0..509) --Replace--> occupied v+1, new block
occupied v (0..509) --Destroy--> free slot retaining v+1
occupied 510 --Replace--> HARD FAULT, unchanged target
occupied 510 --Destroy--> permanently retired 511
free retained v (1..510) --Create--> occupied same v
old block --binding invalidated/switched--> reclaiming --fully zeroed--> free
```

Slot history and per-size-class block pools are independent. Empty words alone
do not prove never-used. No wrap/reset of generations, reuse of retired slots,
in-place replacement fallback, GC or automatic lazy installation. Reclaiming
Replace's old block does not increment again. Interrupted clearing cannot
publish a free block; loss of trustworthy metadata blocks allocation.

Supported types: application Abstraction, Thread, LS C-list object, RW data.
No Namespace creation or MMIO creation. Validate complete payload framing,
rights, bounds, code/method table and c-list, Thread geometry, permitted initial
contents and destination-local binding before installation. No rights union
between Church and Turing domains. Resource sizing includes header/metadata,
private records/proofs, stacks/snapshots, temporary replacement blocks and
quarantined blocks, within the approved half-memory budget. The 256-slot
ascending start and old 2/1 KiB guesses do not establish available capacity.

Resident exclusions apply even to Mint/PkVerify. The current active Thread,
executing code, active C-list and live pending-return dependencies across
suspended contexts are protected before **target-memory or version** changes.
Outstanding GTs alone are not an in-use prohibition.

## Three distinct visibility boundaries

1. **Frozen request:** coherent private inputs plus authenticated requester,
   immutable until consumption; not a grant that survives arbitrary changes.
2. **Namespace:** exclusion from final live-state check through acknowledged
   writes and four-word actual-storage readback, then result materialization.
   No caller may observe/use a partial entry. Post-write failure is a hard
   fault, not “nothing changed.” See [exclusion](namespace-update.md).
3. **Credential durability:** whole issued record/consumption/counter commits
   atomically in IDE; board mirror matches before success. After interruption
   boot restores committed authority, not the old call. See [persistence](persistence.md).

All failed checks hard-fault. No normal rejection status, silent repair, rollback,
fallback destination or automatic retry. Only accepted writes may finish within
the verified fault/reset bound; never finish the unaccepted remainder. Watchdog
and reset are not waived. Diagnostics must be static, non-secret and independent
of reporting availability. HARDFAULT word `0xF7000000` is selected but emission,
map trust and exact-target acceptance remain gates.

Without networking T===GT, including dynamic local generation changes; no zero
W3 or old bootstrap-only content-hash rule. virtualGT/non-memory binding remains
G7, not authority to create a network registry. Hardware evidence and software
release evidence stay separate: software completion/reload does not block the
Phase 1 bitstream, and a Genesis override is never recorded as a passed test.
