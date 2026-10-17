# Atomic issuance, revocation and protected provisioning

[Q17–Q21/Q54 authority](decisions.md) · [G5/G6 gates](open-issues.md)

## Required state transition

```text
authorized Forge invocation, private candidate (not issued, not exposed)
          |
          | ONE durable IDE transaction
          v
complete issued credential + consumed pool entry + advanced ID + new revision
          |
          | authenticated exact board mirror agreement
          v
protected recipient delivery, then ordinary success return
```

Before commit, neither consumption nor issuance exists. After commit the random
entry belongs to an existing credential, even if delivery/return never occurs.
Hard boot forgets execution and restores committed credential authority. It
does **not** resume the interrupted Forge call, consume another entry, reissue
under another ID, un-revoke a credential or discard the pool.

This is Q54, not the rejected Q18.1 burn-first, Q18.2 pending/resume or Q18.3
pool-discard policies. Normal success additionally requires Q21 matching board
state. These are two boundaries; no distributed atomic-commit claim is made.

## Proposed authoritative store (G5)

Use a dedicated private transactional store, **not** the ordinary application
models/database, public revision directory, LUMP sidecars or browser storage.
Candidate engine: SQLite with verified `synchronous=FULL`, one writer,
foreign keys and explicit atomic transaction. This is an engineering proposal,
not proof that SQLite configuration, filesystem or hosting supplies required
durability. `IntentStore` shows transaction patterns, `RevisionStore.publish`
shows fsync/rename patterns (S10); neither is a credential vault or Q54 evidence.

Proposed logical schema:

| Record | Fields and constraints |
|---|---|
| Configuration | 128-bit ID, Genesis Owner→hierarchy assignments, immutable lifetime association, monotonic security revision |
| Mint counter | next ID in 0..33554432, no decrement, unique configuration/Owner row |
| Pool entry | unique pool/index, encrypted 16-byte secret, `unused` or `issued_to` exact credential; no separately committed “reserved/consumed” state |
| Credential | full GT, Owner/payload, recipient hierarchy set, per-operation/type grant rows, one Create Namespace, distinct Replace/Destroy incarnation target lists, encrypted proof, active/revoked state, record revision |
| Administration record | authenticated Genesis authorization ID, approved operation and full request digest, committed result reference; no secret audit fields |
| Mirror receipt | configuration/security revision, exact protected-state digest, board identity, boot session and challenge, confirmed status; cannot authorize another issuance |

Unique constraints: full GT/configuration; Owner/payload; pool entry referenced
by at most one credential; one committed result per admin authorization ID.
Per-operation grant rows avoid accidental type/target cross-products.
No update API for issued permissions: revoke and new issuance. Keep revoked
records and IDs; do not garbage-collect them into availability.

Proposed Forge transaction:

1. Authenticate Genesis authorization and current configuration/revision, acquire
   one service-wide admission. Do not infer authority from REPORT_TOKEN/session
   possession or a browser flag; G6 defines a separate scoped credential.
2. Inside the private store's writer transaction, assert authorization not already
   consumed, current Owner assignment, ID not exhausted, and random entry unused.
   Mint constructs the candidate GT/proof and immutable grant record privately.
   Any precommit failure faults; the storage engine's uncommitted atomic-abort
   semantics are not compensating rollback of an issued operation.
3. Insert the complete credential, link pool entry, advance counter, advance
   security revision and consume that authorization in **the same transaction**.
   No independent log write can mark a proof used earlier. Check referential
   invariants before committing.
4. Obtain durable commit confirmation before copying proof into recipient-owned
   storage or returning it. Mint-internal candidate storage is not recipient
   storage, even for the first credential where both hierarchy names are Mint:
   provisioning must establish separate service-private and operational cells.
5. Mirror the committed record to the protected board registry under authenticated
   correlation. Normal verification/admission remains blocked on disagreement.
   Only after exact agreement may protected recipient delivery and success occur.

The IDE performs persistence on Mint's behalf; it does not become an independent
issuer that chooses grants or forges a second credential. How on-board Mint
invokes this private persistence service is part of G6, not an existing firmware
primitive. Any received duplicate admin request hard-faults without mutation;
an audit lookup may identify an already committed record but **must not resume
or retry** that call. This is duplicate rejection, not request recovery.

## Failure-cut oracle

| Cut | Durable state allowed | Recipient / next boot |
|---|---|---|
| Before transaction / during private candidate preparation | Old state; no issued candidate | No exposed proof; boot restores old records |
| During transaction / torn storage write | Entire old or entire new transaction only | Validate store; corruption/uncertain freshness blocks execution, never zero defaults |
| Durable commit acknowledged, before board mirror | New complete credential, consumed entry and advanced ID | No ordinary success; boot installs existing committed record |
| Board mirror interrupted / mismatched receipt | New authoritative IDE state | Board verification disabled until authorized setup; no automatic retry, no “not issued” claim |
| Board matches, before protected recipient delivery | New record | Authorized setup restores same pair, no new randomness/ID |
| Delivery done, return interrupted | New record; recipient may already hold pair | No resumed call; same credential remains issued |
| Revocation durable, board stale | Revoked authoritative state | No ordinary verification on stale board, including after reset |
| Store corruption or rollback detected | No trusted current state | Hard-fault/block execution; no restoration from a convenient stale backup |

No lost entry means no consumed entry lacking its complete recorded credential.
It does **not** mean every caller receives a success return despite power loss.
No ordinary verification IDE round trip is introduced: after authorized
restoration and matching state, PkVerify uses its local R copy. During changes
the service guard/exclusion must prevent use of partial/stale registry state.

Revocation proposal: under the same admission guard, atomically mark the exact
credential revoked and advance security revision, preserving pool association
and counter; mirror and confirm before success. Existing object GTs remain
unchanged. Missing or mismatched target/admin authority faults. No board-only
revocation that boot can undo. Permission replacement is separately authorized
revoke plus Forge, not in-place rewriting or an implicit combined retry protocol.

## Mirror/transport proposal (G6)

Define a typed authenticated envelope, not a raw UART command or ordinary JSON
containing plaintext secrets:

```text
version=1, message_type (SETUP / COMMIT_MIRROR / RECEIPT),
configuration_id[16], board_id[16], boot_session[16],
authorization_id[16], security_revision[u64],
challenge[32], payload_length[u32], ciphertext[...], authentication_tag[16]
```

All integer fields big-endian; authenticate the full header and ciphertext.
Receipt binds the same identities/revision/challenge plus a digest of exact
installed protected state. No stale, duplicated, wrong-board, wrong-session or
mismatched receipt releases admission. Digest alone is not receipt authentication.
Bound message lengths to approved configuration capacity before allocation.
Cryptographic suite, nonce uniqueness, key provisioning and board trust anchor
are **not established**; these envelope sizes are proposed interface requirements,
not deployed crypto or permission to use existing signing/session/IDE keys.

Evaluate two bounded delivery options: dedicated authenticated/encrypted endpoint
through a trusted bridge to a protected board endpoint; or explicit physically
isolated pre-execution provisioning with an approved physical-custody threat
model. Prefer the former where feasible. Physical isolation does not by itself
authenticate later runtime Forge persistence or defeat debug readout; no option
may quietly narrow multi-Thread execution or require a fresh pool every reset.

S09 shows verified TLS by default **if HTTPS is selected**, HTTP default and
explicit insecure override. UART FW=2 remains plaintext; nonce-correlated halt
ACK/CRC are correlation/corruption checks, not cryptographic proof. Existing
upload and host command locks do not protect secrets or establish durable mirror
agreement. Do not transmit actual pool/proof material over them.

## Custody and restoration requirements

- Dedicated encryption keys and separate access-controlled key custody; approval
  must identify who can decrypt and which processes/debuggers can access them.
  Encryption at rest without safe keys does not solve administrator compromise.
- Entire transaction's journal/WAL, temp files, backups and crash dumps need
  equal protection. Restrict file permissions; exclude from source, public
  artifacts, browser caches and logs. No live credentials were inspected here.
- Authenticate backups and retain an independently trustworthy latest-revision
  anchor. A self-contained signed/encrypted old backup is still replayable.
  G5 must choose an external monotonic anchor or an explicit Genesis-controlled
  latest-state verification procedure; timestamps alone are not sufficient.
- Pre-execution setup checks exact board/configuration, pool/counter consistency,
  revocations and registry revision before enabling verification. Restore B=0
  into the private credential C-list and proof into separate protected storage;
  never runtime SAVE bypass or proof embedding in LUMPs/bitstreams.
- Reset must block unprovisioned/stale verification, not initialize empty state
  as authoritative. Missing store, proof or confirmation hard-faults.
- Successful paths clear service scratch; fault/reset can skip cleanup. Board
  snapshots, traces and dumps must be prevented from exposing secret scratch
  before secrets are provisioned. Recipient copies cannot be remotely erased.
