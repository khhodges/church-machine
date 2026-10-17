# Mint security assurance and threat analysis

[Project reference](../../../threat_model.md) · [Sources](sources.md) ·
[Verification oracles](verification.md)

## System, scope and assurance boundary

Flask IDE + JS compiler/simulator + Amaranth Wukong A7 core/bridge. Ordinary
callers request capability-mediated object changes; Genesis authorizes credential
administration and pre-execution setup. Existing examples, draft CLOOMC and the
dormant installation FSM are not an implemented secure service.

The architectural irreducible TSB is what is logically prior to the first
instruction: processor validation/boot machinery and minimal foundational
Namespace/Thread/initial abstraction context. The
[foundation document §4](../../cloomc-foundation.md#4-the-trusted-security-base-tsb)
records that design principle, **not proof**, and its old slot/layout/lazy-loading
examples do not override the active Master. Calling this a TSB review requirement
does not add Mint/PkVerify/NSTab to the irreducible hardware TSB.

This assurance scope is wider: it relies on trusted Mint and PkVerify software,
Genesis policy, compiler/linker correctness, private IDE store/key custody,
provisioning/transport, protected board copies, allocator bookkeeping, physical
memory arbitration and diagnostic containment. Compromise of these can violate
Mint guarantees even if individual ISA gates operate correctly. State this
dependency honestly instead of claiming an expanded hardware TSB or formal
isolation.

## Assets and attackers

Assets: random pool and proofs; complete issued/revoked records and monotonic
history; requester identity; operation/target grants; private NSRW and registry
capabilities; Namespace entry integrity/visibility; live code/C-lists/Thread
continuations; free-block confidentiality; exact artifact identity/fault evidence.

Attackers considered: ordinary malicious LUMPs with some legitimate capabilities;
copiers of public GT bits; clients with mutable aliases to input buffers; malicious
or stale browser/admin requests; bridge/network/raw-UART attackers; concurrent
Thread/control producers; rollback/corruption of storage; accidental faults,
reset and power interruption. A holder of its own proof is still not entitled
to another recipient's identity, grants or administration.

Trusted Genesis and the authorized host custody environment must be identified
before release. Full compromise of that environment can authorize arbitrary
records and read proofs; no claim here protects against an all-powerful trusted
provisioner. Physical debug/readout resistance, invasive attacks, power/EM side
channels and whole-verifier constant time are **not demonstrated**. Treat access
by debug/maintenance operators as an explicit trust assumption, not silent exclusion.

## Data flow and boundaries

```text
untrusted caller
  | actual GT + proof R + descriptor R + target/payload capabilities
  v                         [B1: coherent capture / requester authentication]
Mint private snapshots -----> PkVerify
  |                         [B2: Mint-only E / read-only trusted registry]
  | eligibility + allocation
  v                         [B3: same-scope-only NSRW / all memory observers]
single-slot Lambda ---------> Namespace RAM -> private result cell -> CR1

Genesis -> authenticated admin request -> Mint
  |                         [B4: privileged setup vs ordinary clients]
  v
IDE private durable store <--atomic record/pool/counter-->
  |                         [B5: host custody / rollback / secret transport]
  v
protected board registry -> PkVerify R / Mint RW
  |                         [B6: debug, fault snapshots, crash and public output]
  x no public proof/registry/NSRW exposure
```

## STRIDE analysis and required invariants

| Threat / boundary | Required invariant and enforcement | Bypass to challenge / evidence status |
|---|---|---|
| Spoofing B1/B2 | **I1** Authenticate original hierarchy from trusted context, preserve through nested calls; verifier E only to Mint (Q52/53), G2 | Caller name/Owner, identical DR GT, immediate Mint caller; CALL frame exists but service interface absent, S03 INSPECTED |
| Spoofing B4/B5 | **I2** Genesis-only scoped administration and exact authenticated board/config/session/revision receipt | Browser flag, reused host credential, CRC/nonce treated as authentication, stale ACK; G6 OPEN, S09/S10 |
| Tampering B1 | **I3** Authorize and execute the same coherent immutable request/proof/payload and live target | Writable aliases, torn snapshot, ABA, post-Verify target swap; G4 OPEN, S06/S07 |
| Tampering B2/B5 | **I4** Valid issuance/proof/revocation/operation/type/Namespace/target checked independently from trusted records | Caller supplies expected proof, missing zero defaults, accidental cross-product grants; proposed verifier, no service tests |
| Tampering B3 | **I5** Only Lambda references NSRW; confirmed four-word actual storage before result; no partial-state consumer | M6/IRQ/raw upload, reset releases lock, dropped write, private RW alias escaping; S02/S06–S08 only source |
| Tampering B5 | **I6** Atomic complete credential + pool consumption + counter; no reused issued ID, no stale revocation restore | Burn-first, old signed backup, duplicate Forge, board agrees to wrong revision; S10 patterns not implementation |
| Repudiation B4/B5 | **I7** Non-secret audit identifies authorization, configuration, revision and commit outcome; uncertainty never becomes success | Lost return labeled “not issued,” caller retries; audit/durable correlation proposed, not implemented |
| Disclosure B1/B2/B6 | **I8** Proofs/private authority never appear in ordinary returns, public artifacts, trace/log/snapshot/browser storage | DR scratch captured on fault, caller heap, raw UART, WAL/crash/backups; selected snapshot paths real, S07/S09 |
| Disclosure B3 | **I9** Entire reclaimed block zero before free; interrupted clear remains unallocatable | Only payload cleared, unused tail leaked, freed before ack; required Q48, no new service evidence |
| Denial of service B1/B3/B5 | **I10** Overlap/exhaustion/malformed bounds hard-fault without unauthorized mutations; bounded accepted-write completion | Pool/ID exhaustion, oversized payload, pathological frame chain, blocked mirror; expected hard-fault availability loss, not a recovery promise |
| Elevation B1/B2 | **I11** First credential only Create in Boot; no target rights, sharing, forging or revocation inferred | Q23 mistaken for full targets, B=0 ignored, Owner 0 interpreted NULL, source draft authority reused |
| Elevation B3 | **I12** Resident/current/return dependencies excluded; generation semantics independent of credential ID | Slot reuse target substitution, current 510 Replace, stale object GT accepted, host diagnostic index trusted |

All invariants require named implementation and test evidence before operational
claims. Public unkeyed integrity32, token equality, file hashes, slots and names
are **not** authenticators. File hashes here only pin reviewed evidence.

## Negative claims and limits

- Same-scope Lambda is an audited software-reference boundary, not hardware
  separation from compromised Mint code.
- SAVE B=0 can reject GT propagation, not detect arbitrary proof copying or
  erase recipient backups. Correct recipient identity remains necessary.
- R buffers only limit that capability's writes; aliases can still mutate.
- Fixed-work four-word comparison does not prove constant-time lookup, faults,
  authorization, cache effects or physical leakage.
- Four readbacks do not prove exclusion; CPU busy does not prove raw UART
  exclusion; halt nonce does not prove authenticated or durable state.
- An accepted write completing after fault is not permission to run the remainder
  of the update. No rollback or uninterrupted execution guarantee exists.
- A hardware fault can occur before cleanup; suppressing only normal-return
  leaks is insufficient. Debug/trace protection must be proven before provisioning.
- Restore means committed authority only, never resurrection of revoked records
  or continuation of an abandoned call.
- Legacy tests and source inspection do not prove new service implementation.
  Generated RTL, exact build and physical evidence remain separate release gates.
