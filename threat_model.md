# Threat Model

## Project Overview

This is a scoped project-level reference for the Mint Phase 1 review, not a
general audit of all IDE subsystems. Church Machine combines a Flask IDE,
JavaScript compiler/simulator and Amaranth Wukong A7 capability processor.
The [Mint review entry point](docs/reviews/mint-phase1/README.md) distinguishes
approved requirements, proposed implementation and missing evidence.

## Assets

Mint protects private proof/randomness material, issued credentials and
revocations, Genesis grants, authenticated requester identity, Namespace write
authority, live execution dependencies and safe memory reclamation. Exact
artifact/fault evidence and persistent counter/history integrity also matter.

## Trust Boundaries

Untrusted caller buffers/capabilities cross into Mint and its verifier; Mint's
same-scope Lambda crosses into Namespace RAM; Genesis administration crosses
into IDE durable custody and board provisioning. Debug, trace, UART and snapshot
paths are separate disclosure/control boundaries. The wider trusted software
and provisioning dependencies are not automatically part of the irreducible
architectural hardware TSB.

## Scan Anchors

- `server/app.py`: public IDE and separately authorized administration/board
  surfaces; existing command locks are not Mint security.
- `hardware/wukong_bridge.py`, `hardware/wukong_top.py`: transport, maintenance,
  physical switching and snapshot boundaries.
- `hardware/call.py`, `hardware/ret.py`, `hardware/core.py`: trusted execution
  context and memory admission.
- `server/change_confirmation.py`, `server/artifact_revisions.py`: persistence
  patterns, not a demonstrated credential vault.
- Archived Mint CLOOMC is review-only; simulator host diagnostic state and test
  hooks are not production authority.

## Threat Categories

**Spoofing:** Authenticate the original requesting hierarchy across nested
verification and independently authenticate Genesis administration and exact
board receipts. A caller-supplied name, Owner bits or equal GT data is insufficient.

**Tampering:** Authorize coherent frozen inputs, exclude partial Namespace
consumers, and commit complete issuance/consumption/counter state atomically.
Boot must reject stale/corrupt security state and preserve revocations.

**Repudiation:** Retain non-secret authorization/commit evidence; interruption
after commit must not be reported as “nothing changed” or trigger replay.

**Information disclosure:** Protect proof/pool/private capability material from
transport, logs, snapshots, crash files, browser storage and public artifacts.
Clear the whole reclaimed block before free. Hardware faults may bypass cleanup.

**Denial of service:** Bounds, overlaps, exhaustion and uncertainty hard-fault;
do not weaken safeguards or invent retries to improve availability. Watchdog
and reset remain effective with bounded completion of accepted writes only.

**Elevation of privilege:** Enforce per-operation/type/target grants, recipient
identity and resident/live-return exclusions. Mint-only verifier E and
Lambda-only NSRW are provisioning/audit requirements, not achieved proof.

Detailed code-grounded invariants, attackers, assumptions, bypasses and evidence
limits are maintained once in
[Mint security assurance](docs/reviews/mint-phase1/security.md).
