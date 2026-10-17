# Mint Phase 1 — technical and TSB assurance review

**2026-10-17 · Design/review package, not an operational service.**

This package covers **ide.Mint**, **ide.PkVerify** and **ide.NSTab** for expert
open-source review. It publishes the approved guided Q&A and a concrete,
dependency-ordered implementation and verification proposal. It is not a
completed worldwide audit, certification, formal isolation proof, implementation
approval, or permission to install, build, upload or flash anything.

## Start here

| Reader's question | Document |
|---|---|
| What exactly did Genesis approve or reject? | [Complete decision record](decisions.md), then [supersession index](supersessions.md) |
| What must the service do? | [Effective service contract](service-contract.md) |
| What would engineers implement, and in what order? | [ABI and work packages](implementation-plan.md) |
| How can issuance survive interruption without losing pool entries? | [Persistence and provisioning](persistence.md) |
| What prevents observers seeing half a Namespace entry? | [Exclusion and publication](namespace-update.md) |
| What is trusted, and where can authority or secrets escape? | [Security assurance](security.md) and [project threat model](../../../threat_model.md) |
| Which claims have evidence? What are the independent test oracles? | [Verification matrix and fixtures](verification.md) |
| What still needs a decision or engineering evidence? | [Bounded gate register](open-issues.md) |
| Which exact source was inspected? | [Symbols, ranges and provenance](sources.md) |
| Can Mint legally obtain protected caller/live-return evidence today? | [Bounded G1–G3 feasibility and synthetic cross-layer probes](context-feasibility.md) |
| What minimal machine interfaces are now proposed for review? | [Caller context, private Lambda and GT result delivery](minimal-machine-interfaces.md) — design proposal only; not implementation approval |

Read the [active Master ISA](../../phase-1/01-isa/instruction-set.md) for hardware
semantics, not the larger root ISA or archived RTL. This package is deliberately
outside the compact [Phase 1 hardware collection](../../phase-1/README.md).
Historical Mint sources remain linked in the supersession index, not copied
into that collection.

## Executive contract

The first credential belongs to and may be used only by **ide.Mint**, Owner ID
**0**, B=**0**, with a non-reused sequential **25-bit credential ID starting at
0** and a separate private 128-bit proof. It authorizes Create of the four
approved types in **Boot**, not whichever Namespace is current. Replace and
Destroy have **empty target sets, permanently for this issued credential**.
Genesis through the IDE alone authorizes new/replacement issuance and revocation.
The pair survives hard boot unless revoked. It is reusable, not a one-time code.

Q54 commits the complete credential, random-entry consumption and ID advancement
in one durable IDE update. There is no burn-first entry loss, pool discard on
boot, pending-issuance recovery, resumed interrupted call, or automatic retry.
Normal success also requires a matching protected board copy.

**Principal blockers:** authentic original-requester evidence; legal internal
Lambda binding/return and capability result materialization; complete live-use
checks; whole-update reader/writer exclusion; protected persistent custody and
delivery; rollback-resistant restoration. A slot, name, host call stack, halt
acknowledgement or four successful-looking writes supplies none of these by
itself.

## Evidence language

- **APPROVED** means a selected policy in the decision record or retained ISA.
- **PROPOSED** means a new engineering design here, not retroactive approval.
- **INSPECTED** means read-only source inspection at the recorded revision.
- **CHECKED-DOC** means a reproducible documentation/provenance check only.
- **NOT RUN / BLOCKED** means no runtime result is claimed.
- A historical test report remains historical; it is not a new execution.

No running service, secret, private store, live catalog, Namespace, image,
hardware or external publication was accessed or changed for evidence. No
vendor tools or hardware/control endpoints were used. Runtime and physical
tests in the original verification matrix are designs, not results.
The later [G1–G3 investigation](context-feasibility.md) adds isolated synthetic
JS/Amaranth component results, not service or hardware acceptance. Documentation
checks are recorded separately in the verification document.

## Reviewer checklist

### Genesis review refinements

The Genesis review endorses the assurance package's policy and evidence
boundaries, not an operational service or closure of G1–G8. Its three
documentation refinements are incorporated without changing the decision ledger:

- [Shared Mint/Amobea activation and observation inventory](namespace-update.md#producerobserver-inventory),
  with separate ownership and publication invariants.
- [Protected Thread word +17 and saved-frame access/format boundaries](context-feasibility.md#protected-word-17-and-running-ownership),
  preserving the proposed status of live bit 13 and the absence of a service
  attestation/traversal authority.
- [Worked issued-but-board-stale outcome](persistence.md#worked-interruption-issued-in-the-ide-board-not-ready),
  distinguishing durable issuance from permission to enable local verification.

Priority remains G4's whole-update exclusion and G1's legal Lambda/result path.
Early assessment of a minimal interlock is a review recommendation, not
authorization to introduce it. The later synthetic context probes reproduce
bounded gaps; they do not convert this endorsement into runtime acceptance.

### Review checks

1. Reconstruct the first credential from Q22–Q35/Q40, not Q23 in isolation.
2. Read all three Q18 rejections and Q54 together.
3. Check each proposed authority-bearing CR against the access matrix and G1/G2.
4. Challenge the exclusion argument with **each** producer/observer in the
   Namespace table, including M6 and reset, not just cooperative software.
5. Trace every security claim to an S-source and V-fixture; distinguish tests
   of JS, RTL, generated RTL, exact builds and physical FPGA behavior.
6. Review failure after a write/commit separately from failure before it.
7. Do not approve software release until open safety gates have evidence, or
   record a specific Genesis override as an override, never PASS.

## Glossary

| Term | Meaning here |
|---|---|
| Genesis | Configuration/policy authority; Phase 1 IDE-mediated setup, not an unauthenticated first caller |
| Owner | Abstraction hierarchy identified by four GT bits; not necessarily the recipient |
| Recipient | Authenticated requesting hierarchy allowed to use a particular credential |
| GT | 32-bit Golden Token; a data word containing equal bits is not a CR capability |
| PassKey | Abstract GT plus independent 128-bit proof bound to a protected issuance record |
| NSRW / ide.NSTab | RW view of the existing Namespace table at slot 14; only Mint's internal Lambda references it |
| E / X / R / W / L / S | Enter, execute, read, write, capability load, capability save permissions; Church and Turing domains remain distinct |
| T | Object identity; without networking T===GT, not a content hash or an authorization proof |
| virtualGT | IDE identity for a non-memory object; no automatic local memory authority |
| Credential ID | Mint's 25-bit non-reused public identifier; not a Namespace generation |
| Slot generation | Nine-bit version: live 0–510, permanently retired 511 |
| Commit | Named durable or visibility boundary; IDE credential commit and Namespace publication are different boundaries |
| Mirror | Protected board working copy of authoritative IDE credential state |
| TSB | Irreducible architectural trust base; wider Mint assurance dependencies are not automatically added to it |
| Resident | Protected from Mint Replace/Destroy; not a permission to rewrite an installed artifact |
