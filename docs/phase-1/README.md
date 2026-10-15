# Phase 1 — self-contained document collection

**Start with the [Master ISA](01-isa/instruction-set.md).**

## Current decision and implementation entry points

- [Current folder consistency audit and simplifying proposals](CONSISTENCY-AUDIT.md).
- [Master ISA: approved contract and delegated hardware choices](01-isa/instruction-set.md#approved-phase-1-contract).
- [Decision ledger and source-level implementation gaps](REVIEW-2026-10-14.md#resolution-log--guided-review).
- [Approved single-word CALL encoding](CALL-SINGLE-WORD-DRAFT.md) — retained filename, not draft status.
- [Hardware acceptance plan](04-release/isa-to-fpga-alignment-plan.md#hardware-only-acceptance-reconciliation).

The user has now authorized hardware RTL implementation and simulation.
Earlier documentation-only entries remain historical; this does not authorize
vendor bitstream builds, uploading, flashing, saved-artifact migration or
application changes. Collected decisions are not proof of hardware readiness.
Implementation and simulation results must be recorded separately from
physical qualification. The original 45-source audit remains preserved.

**Review boundary:** Software cannot block the Phase 1 bitstream. Keep software
TBDs, including the Abstract PassKey Owner-ID/payload format, separate from
hardware readiness. Software delivery remains required but is not a bitstream
prerequisite; hardware conformance is not waived. See the
[resolution log](REVIEW-2026-10-14.md#resolution-log--guided-review).

Latest collection review: [conflicts and missing information — 2026-10-14](REVIEW-2026-10-14.md).

Approved decisions have now been reconciled into the
[Master ISA Phase 1 contract](01-isa/instruction-set.md#approved-phase-1-contract),
[Mint contract](03-namespace-thread-mint/ide-mint-forge-contract.md) and affected supporting sources.
See [the reconciliation record](REVIEW-2026-10-14.md#approved-decision-source-reconciliation).
Unresolved software choices remain TBD. This is not implementation, release
acceptance, a Genesis override, or authorization to build/flash.

Review outputs outside the original 45-source snapshot:
- [Mint service draft](MINT-FIRST-DRAFT.md).
- [Code draft and sizing estimates](MINT-CODE-DRAFT.md).
- [Blocked CLOOMC source drafts](source-drafts/README.md).

This folder contains local copies of the Phase 1 architecture, contracts,
implementation plans, review evidence and referenced reading material.
There are no symbolic links to documents outside the folder. Reading links
resolve inside this collection, so it can be copied independently.

There is no active collection manifest. The checker inspects actual files
and reading links directly. `package-index.json` is historical copy provenance
only, not an authoritative current inventory. It records source fingerprints
before link rewriting. The original audit snapshot and repository originals
remain untouched; local navigation changes are not changes to historical claims.

Use this folder for the Phase 1 checkpoint. Subsequent Phase 1 decision edits
must update these local documents explicitly; they no longer follow changes to
repository originals automatically.

See [unavailable historical sources](UNAVAILABLE-SOURCES.md) for the one missing
referenced PDF. Its absence is disclosed, not silently replaced with another file.

## Authority and scope

Collection membership does **not** approve a draft, resolve a pending encoding,
or certify simulator/FPGA conformance. The Master ISA governs ISA requirements;
the status and evidence limits stated in each supporting document still apply.
Historical editions remain historical and must not be edited through their links.
In particular, the Golden Token references disagree on some authority claims;
including them here does not settle the separate GT-layout review.

“Phase 1” here means the Church Machine architectural/release work discussed
with the Master ISA: petnames, Thread/Namespace transitions, LUMPs, Mint,
capability security and exact release evidence. Unrelated project milestones
also called “Phase 1” (such as older language-front-end, messaging, patent or
board-port plans) are not silently made release requirements.

## 01 — ISA first

1. [Master ISA](01-isa/instruction-set.md) — controlling ISA and October amendment reconciliation.
2. [CLOOMC++ petname execution model — Phase 1](01-isa/cloomc-petname-execution-model-phase-1.md) — approved architecture with separately pending allocations.
3. [Architecture overview](01-isa/architecture.md) — supporting architectural context.
4. [mLoad](01-isa/mload.md) — capability-mediated memory access.
5. [SWITCH lifecycle](01-isa/switch-lifecycle.md) — Thread/Namespace handoff behavior.
6. [Indexed operand semantics proposal](01-isa/isa-indexed-operands-proposal.md).
7. [Indexed binary encoding proposal](01-isa/isa-indexed-encoding.md).
8. [Experimental indexed profile](01-isa/isa-indexed-profile.md).
9. [Indexed containment](01-isa/isa-indexed-containment.md).

The indexed documents retain their own proposal/experimental status; the master
selects which requirements apply.

## 02 — Golden Tokens, LUMPs and security

- [Golden Tokens](02-tokens-lumps-security/golden-tokens.md).
- [Golden Token v2 encoding draft](02-tokens-lumps-security/golden-tokens-v2.md).
- [Hardware format reference](02-tokens-lumps-security/GoldenDetails.md) — supporting format record, not an override of the Master ISA.
- [Abstract GTs](02-tokens-lumps-security/abstract-gt.md).
- [GT parity and integrity](02-tokens-lumps-security/gt-parity-integrity.md).
- [LUMP specification](02-tokens-lumps-security/CM_LUMP_SPECIFICATION.md).
- [Compact LUMP API contract](02-tokens-lumps-security/compact-lump-api-contract.md).
- [Trusted compiler and untrusted LUMP admission](02-tokens-lumps-security/TRUSTED_COMPILER_AND_UNTRUSTED_LUMP_ADMISSION.md).
- [Namespace security](02-tokens-lumps-security/namespace-security.md).
- [Trusted security base](02-tokens-lumps-security/trusted-security-base.md).
- [Boot permission rules](02-tokens-lumps-security/boot-permission-rules.md).
- [Phase 1 security validation TODO](02-tokens-lumps-security/phase-1-security-todo.md) — non-silicon work; not evidence of completion.

## 03 — Namespace, Thread boot and Mint

- [System Namespace handoff contract](03-namespace-thread-mint/system-namespace-handoff-contract.md).
- [Boot → System first-pass definition](03-namespace-thread-mint/boot-system-handoff-first-pass.md).
- [Namespace plan contract](03-namespace-thread-mint/namespace-plan-contract.md).
- [Prepared Thread release replay](03-namespace-thread-mint/prepared-thread-release-evidence.md) — bounded simulator evidence.
- [Boot ROM layout](03-namespace-thread-mint/boot-rom-layout.md) — existing layout, not approval of a replacement boot contract.
- [ide.Mint Forge contract](03-namespace-thread-mint/ide-mint-forge-contract.md) — design draft.
- [ide.Mint hardware atomicity review](03-namespace-thread-mint/ide-mint-hardware-atomicity-review.md).
- [Mint Phase 1 bounded rule](03-namespace-thread-mint/mint-phase1-bounded-rule.md) — supplied scope/decision note; retain its approval boundaries.

## 04 — Release and acceptance

- [ISA → simulator → bitstream → FPGA alignment plan](04-release/isa-to-fpga-alignment-plan.md).
- [Bitstream candidate readiness](04-release/bitstream-candidate-readiness.md).
- [Wukong boot verification](04-release/wukong-boot-verification.md).
- [Portable LUMP compilation and FPGA loading](04-release/portable-lump-compilation-and-fpga-loading.md) — supporting workflow, not authority to expand Phase 1.

## 05 — Review records and historical evidence

- [October 13 amendment reconciliation](05-review-history/isa-amendment-reconciliation-2026-10-13.md).
- [Supplied corrected completeness review](05-review-history/isa-completeness-review-2026-10-13.txt).
- [October 9 cooperative scheduling review](05-review-history/isa-review-cooperative-round-robin-hard-faults.html)
  and [manifest](05-review-history/isa-review-cooperative-round-robin-hard-faults.manifest.json).
- [October 9 split-magnitude review](05-review-history/isa-review-change-split13-magnitude.html)
  and [manifest](05-review-history/isa-review-change-split13-magnitude.manifest.json).
- [Hardwired-authority review](05-review-history/isa-review-hardwired-authority.html)
  and [manifest](05-review-history/isa-review-hardwired-authority.manifest.json).
- [Master ISA historical evidence](05-review-history/instruction-set-history.md)
  and [reconstruction inventory](05-review-history/instruction-set-history-inventory.json).
- [Historical ISA reference](05-review-history/isa_reference.md).
- [Historical ISA encoding reference](05-review-history/isa_encoding.md).

These are supporting evidence, not additional competing “master” documents.
No document's bytes or status were changed merely to add it to this collection.
The subsequent approved-decision reconciliation edits active originals; the
historical editions and original review snapshot remain unchanged.

## Maintaining this folder

Add related Phase 1 documents as local files in the appropriate section and
link them from this README. Do not create symlinks or a replacement inventory
manifest. Historical review metadata stays alongside its frozen review editions;
it does not govern current membership, Namespace contents or hardware readiness.

Check the collection with:

```sh
python3 scripts/check_phase_1_documents.py
```
