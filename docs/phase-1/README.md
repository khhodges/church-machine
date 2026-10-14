# Phase 1 — shared document collection

**Start with the [Master ISA](../instruction-set.md).**

Latest collection review: [conflicts and missing information — 2026-10-14](REVIEW-2026-10-14.md).

Approved decisions have now been reconciled into the
[Master ISA Phase 1 contract](../instruction-set.md#approved-phase-1-contract),
[Mint contract](../ide-mint-forge-contract.md) and affected supporting sources.
See [the reconciliation record](REVIEW-2026-10-14.md#approved-decision-source-reconciliation).
Unresolved software choices remain TBD. This is not implementation, release
acceptance, a Genesis override, or authorization to build/flash.

Review outputs outside the original 45-source snapshot:
- [Mint service draft](MINT-FIRST-DRAFT.md).
- [Code draft and sizing estimates](MINT-CODE-DRAFT.md).
- [Blocked CLOOMC source drafts](source-drafts/README.md).

This folder brings the Phase 1 architecture, contracts, implementation plans,
review evidence and security work into one place. The files in its numbered
sections are **relative symbolic links to the existing originals**, not copies.
Editing a linked file edits that same original; existing document paths, tests,
review hashes and inbound links remain valid.

Use the reading links below when browsing Markdown: they open the original
locations so each document's own relative links retain their intended base.
`manifest.json` records every collection entry and its repository source.

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

1. [Master ISA](../instruction-set.md) — controlling ISA and October amendment reconciliation.
2. [CLOOMC++ petname execution model — Phase 1](../cloomc-petname-execution-model-phase-1.md) — approved architecture with separately pending allocations.
3. [Architecture overview](../architecture.md) — supporting architectural context.
4. [mLoad](../mload.md) — capability-mediated memory access.
5. [SWITCH lifecycle](../switch-lifecycle.md) — Thread/Namespace handoff behavior.
6. [Indexed operand semantics proposal](../isa-indexed-operands-proposal.md).
7. [Indexed binary encoding proposal](../isa-indexed-encoding.md).
8. [Experimental indexed profile](../isa-indexed-profile.md).
9. [Indexed containment](../isa-indexed-containment.md).

The indexed documents retain their own proposal/experimental status; the master
selects which requirements apply.

## 02 — Golden Tokens, LUMPs and security

- [Golden Tokens](../golden-tokens.md).
- [Golden Token v2 encoding draft](../golden-tokens-v2.md).
- [Hardware format reference](../GoldenDetails.md) — supporting format record, not an override of the Master ISA.
- [Abstract GTs](../abstract-gt.md).
- [GT parity and integrity](../gt-parity-integrity.md).
- [LUMP specification](../CM_LUMP_SPECIFICATION.md).
- [Compact LUMP API contract](../compact-lump-api-contract.md).
- [Trusted compiler and untrusted LUMP admission](../TRUSTED_COMPILER_AND_UNTRUSTED_LUMP_ADMISSION.md).
- [Namespace security](../namespace-security.md).
- [Trusted security base](../trusted-security-base.md).
- [Boot permission rules](../boot-permission-rules.md).
- [Phase 1 security validation TODO](../phase-1-security-todo.md) — non-silicon work; not evidence of completion.

## 03 — Namespace, Thread boot and Mint

- [System Namespace handoff contract](../system-namespace-handoff-contract.md).
- [Boot → System first-pass definition](../boot-system-handoff-first-pass.md).
- [Namespace plan contract](../namespace-plan-contract.md).
- [Prepared Thread release replay](../prepared-thread-release-evidence.md) — bounded simulator evidence.
- [Boot ROM layout](../boot-rom-layout.md) — existing layout, not approval of a replacement boot contract.
- [ide.Mint Forge contract](../ide-mint-forge-contract.md) — design draft.
- [ide.Mint hardware atomicity review](../ide-mint-hardware-atomicity-review.md).
- [Mint Phase 1 bounded rule](../../attached_assets/mint-phase1-bounded-rule_1791705504631.md) — supplied scope/decision note; retain its approval boundaries.

## 04 — Release and acceptance

- [ISA → simulator → bitstream → FPGA alignment plan](../releases/isa-to-fpga-alignment-plan.md).
- [Bitstream candidate readiness](../../reports/bitstream-candidate-readiness.md).
- [Wukong boot verification](../wukong-boot-verification.md).
- [Portable LUMP compilation and FPGA loading](../portable-lump-compilation-and-fpga-loading.md) — supporting workflow, not authority to expand Phase 1.

## 05 — Review records and historical evidence

- [October 13 amendment reconciliation](../../reports/isa-amendment-reconciliation-2026-10-13.md).
- [Supplied corrected completeness review](../../attached_assets/Pasted-ISA-Amendments-2026-10-09-Completeness-Review-Oct-13-20_1791978480955.txt).
- [October 9 cooperative scheduling review](../../reports/isa-review-cooperative-round-robin-hard-faults.html)
  and [manifest](../../reports/isa-review-cooperative-round-robin-hard-faults.manifest.json).
- [October 9 split-magnitude review](../../reports/isa-review-change-split13-magnitude.html)
  and [manifest](../../reports/isa-review-change-split13-magnitude.manifest.json).
- [Hardwired-authority review](../../reports/isa-review-hardwired-authority.html)
  and [manifest](../../reports/isa-review-hardwired-authority.manifest.json).
- [Master ISA historical evidence](../instruction-set-history.md)
  and [reconstruction inventory](../instruction-set-history-inventory.json).
- [Historical ISA reference](../isa_reference.md).
- [Historical ISA encoding reference](../isa_encoding.md).

These are supporting evidence, not additional competing “master” documents.
No document's bytes or status were changed merely to add it to this collection.
The subsequent approved-decision reconciliation edits active originals; the
historical editions and original review snapshot remain unchanged.

## Maintaining this folder

Add related Phase 1 documents to the appropriate section, add their source and
collection path to `manifest.json`, and create a relative symbolic link.
Do not copy a specification into a second independently maintained master.
Keep manifests alongside their frozen review editions.

Check the collection with:

```sh
python3 scripts/check_phase_1_documents.py
```
