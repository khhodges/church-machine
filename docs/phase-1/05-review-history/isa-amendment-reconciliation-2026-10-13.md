# ISA amendment reconciliation — Design Team review

**13 October 2026 · Review only; no ISA approval or implementation authorization**

## Finding

Accept the attachment's request for reconciliation, **not its assertion that two
October 12 supersessions are established**. The master already requires one-GT
direct CHANGE. That semantic rule does not approve the amendment's new binary
layout. The reported INDEX deferral and replacement boot contract require their
decision records or explicit Design Team confirmation. No current boot encoding
failure was reproduced.

## Provenance and authority

- **Reviewed edition [A]:** [ISA review — special operations and cooperative
  scheduling](isa-review-cooperative-round-robin-hard-faults.html), dated
  2026-10-09. Its seven items, encoding-before-condition rule, watchdog model,
  withdrawn IRQRETURN and retained final boot CALL match the attachment.
  SHA-256: `62b32e62686d225c3009794de32ba77e99512c3ffc25953e5d556482391cfc48`,
  matching its [manifest](isa-review-cooperative-round-robin-hard-faults.manifest.json).
  Its embedded baseline hash is
  `72c3fb50f301880a7b782be55ce4d3477fa4eb195f38ca55187b86dc84f0fcce`;
  this is not an assertion that today's master has those bytes.
- **Earlier edition [B]:** [Split 13-bit CHANGE magnitude](isa-review-change-split13-magnitude.html),
  also dated October 9, still proposes IRQ exchange and IRQRETURN (§3) and
  preserves CR13 (§6). It is not interchangeable with [A]. [A] §§1, 3 expressly
  withdraw those earlier proposals within the review series, not by amending the master.
- **Supplied review [R]:** [Completeness Review, October 13](../references/attached_assets/Pasted-ISA-Amendments-2026-10-09-Completeness-Review-Oct-13-20_1791900330097.txt),
  especially lines 9–11, 22–28. Its claims about October 12 decisions and the
  separate nine-page PDF are attributed reports. The named PDF was not located
  in the searched files; no PDF-to-HTML identity is certified here.
- **Revised supplied review [R2]:** [Four-page completeness review PDF](<../UNAVAILABLE-SOURCES.md>),
  subsequently supplied on October 13. Pages 1–2 explicitly retract established
  supersession status and distinguish direct semantics from encoding approval;
  pages 3–4 correct the legacy boot-word inference and adopt prospective release
  gates. This is a revised review, **not the nine-page amendment PDF** mentioned
  in [R], and not independent evidence of the reported October 12 decisions.
  Its account of session-local decisions remains attributed. Its page-2 reference
  to “§1's” CR13 clearing should be read against [A] §§3.1 and 6, where that
  proposal actually appears. Its unchanged opening verdict still calls the
  edition stale against October 12; the explicit correction and reconciled
  recommendation qualify that assertion.
- **Authority [M]:** [Master ISA](../01-isa/instruction-set.md), “Document authority,”
  “CHANGE: one-GT Thread activation,” and “Encoding and implementation status.”
  Approved semantic corrections override historical tables; implementations
  and review drafts do not establish new encoding approval.
- **Additional decision evidence [H]:** [Hardwired-authority review](isa-review-hardwired-authority.html),
  §§3.1–3.3, 4 and 6, records reserved CR13, hardwired recovery and initial CR15
  authority, and SecurityRegulator M custody. It still describes a final boot
  CALL. Its embedded historical master is not a new approval.

**Search boundary:** inspected the named sources, review manifests, later
hardwired-authority review, relevant project decision-memory notes, and local
Git log subjects; searched available `docs/`, `reports/`, and `attached_assets/`
text for October 12, INDEX deferral, CR12-only grants and ROM CALL removal.
No independent record establishing those two reported decisions was located.
This is **missing evidence**, not proof that no such decision exists elsewhere.

## Item-by-item reconciliation

| Issue | Supported finding | Disposition for Design Team |
|---|---|---|
| Direct versus indexed CHANGE | [M], one-GT correction dated October 3, specifies `CHANGE CRn`: one permissionless Thread GT already in the register, no implicit lookup, and hard faults on invalid context. [A] §1 explicitly proposes replacing the restriction with direct and indexed forms. | Retain direct semantics as baseline; indexed CHANGE remains a proposal. **Missing evidence:** [R]'s October 12 Phase-1 INDEX deferral, including its scope for CHANGE/SWITCH. Do not call ordinary CHANGE privileged: [M] explicitly says it is not protected and does not require operand M. |
| Direct binary encoding | [A] §1 explicitly proposes `0x27060000` for `CHANGE CR12`, replacing the earlier repeated-register draft word `0x27660000`. [M] separately describes repeated-register simulator compatibility and explicitly declines to approve a new hardware layout. | Decide the binary allocation separately. Even confirmation of INDEX deferral would **not** approve `0x27060000`, retain its IDX bit automatically, or choose a migration policy. |
| Boot marker and final CALL | [A] §3.1 proposes exact one-shot marker `0x27000001`, initial Thread from NS[1], canonical prepared frame, then the **final boot CALL**. Canonical frame preparation alone does not remove CALL. [H] §3.1 retains the marker as a candidate and the final CALL, while naming NS[2]. | **Missing evidence:** [R]'s replacement contract combining CR12-only hardware M grant, canonical-frame entry and ROM CALL removal. Neither the marker nor the claimed replacement is approved by this note. Confirm exact entry, grant consumption, fetch authority and slot contract together. |
| Handoff documents | [System handoff contract](../03-namespace-thread-mint/system-namespace-handoff-contract.md), status and §§1, 6, records approved direction but a draft mechanism. [First-pass handoff](../03-namespace-thread-mint/boot-system-handoff-first-pass.md), status and §§1, 4–5, proposes a post-diagnostic transition, not removal of reset-ROM CALL. | Neither October 11 document proves the reported October 12 boot replacement. Today's [M] “Namespace destination: CR15” supplies a combined SWITCH handoff and clears CR13 there; do not confuse this with reset entry or every ordinary CHANGE. |
| CR13 | [A] §§3.1, 3.7, 6 proposes reserved CR13, fully NULL on boot and every CHANGE, no IRQ role. [H] §§3.3, 6 supports reservation/no IRQ or WatchdogFault role, but leaves reserved contents without a new operational meaning and rejects a blanket M-clearing rule. | Accept reservation/no automatic IRQ role as supported review direction. Do **not** promote [A]'s full clearing rule to approval or infer it from [M]'s narrower Namespace-handoff clearing. The exact “ISA approval draft” quoted by [R] was not independently identified; Design Team must confirm the intended clearing contract. |
| Other amendment items | [A] distinguishes baseline, user-selected direction and proposed details: §2 validation sequence/fault allocations; §4 bootstrap identity; §5 Heap/derived views; §6 state table; §7 acceptance. | Preserve each stated strength, subject to later sourced decisions—not blanket approval of “everything else.” In particular, [H] §§3.1–3.3 replaces manual-only recovery in the review direction with save-first/hardwired recovery; this does not certify implementation. |

The experimental [IDX1 profile](../01-isa/isa-indexed-profile.md), status and
“Current software implementation,” says indexed CALL/SAVE/SWITCH/CHANGE are not
enabled there. That implementation limitation is not an October 12 decision
deferring all indexing. [M]'s compact indexed LOAD/SAVE rules remain distinct.

## Encoding acceptance evidence — release requirement, not a defect report

Source inspection of [hardware/boot_rom.py](../references/hardware/boot_rom.py), lines
25–27 and 98–105, finds the legacy encoder and three-instruction BOOT_PROGRAM:
LOAD, `CHANGE` with `cr_dst=12, cr_src=15, imm=1`, then CALL.
With opcode 4 and AL=14, the displayed encoder yields:

```text
(4 << 27) | (14 << 23) | (12 << 19) | (15 << 15) | 1 = 0x27678001
```

This is **neither quoted direct word** nor the candidate `0x27000001` marker.
[Boot ROM Layout](../03-namespace-thread-mint/boot-rom-layout.md), §1, likewise documents the legacy
three-instruction sequence; its historical layout is not authority over [M].
This is a source-derived observation only, not a generated-image, decoder,
flashed-board or execution result.

Before an approved cutover may be released, require:

1. One explicitly approved bit-field contract for ordinary direct CHANGE and
   any distinct boot operation, including legal selectors, reserved fields,
   predicates, boot-phase authority and the disposition of indexed forms.
2. Identical golden words and meaning across assembler, disassembler, simulator,
   RTL decoder and the **exact release ROM image**. Bind image bytes/hash and
   source revisions to the evidence; round-trip text alone is insufficient.
3. Positive checks for direct activation, self-target continuation and approved
   boot entry. Negative checks for every form declared retired/unsupported by
   that approval, malformed fields, wrong boot phase/replay and conditional
   variants. Include the old direct and boot words and withdrawn IRQRETURN
   candidates explicitly in the disposition matrix: collisions must not silently
   become authorized operations under a new interpretation.
4. Verify encoding-before-condition faults if adopted, and assert no unauthorized
   lookup or context publication. If indexed forms are approved later, verify
   full magnitude reconstruction and non-wrapping bounds independently.
5. Preserve historical LUMPs unchanged; any migration/recompilation and ROM
   rebuild requires separate authorization. Record unrun consumers as NOT RUN.

These are prospective release gates. No build, runtime test, saved-image change,
publishing or physical hardware operation was performed for this note.

## Open questions and requested disposition

Keep visible: reset-ROM fetch authority ([A] §3.1); memory-backed watchdog
capture authority (§3.6); protected configuration, refresh/timebase and numeric
budgets (§§3.5, 3.7); and indexed CALL's separate field allocation (§1).
Later M-custody direction in [H] does not itself supply a complete platform binding.

GT-layout completeness is a separate track. [A] does not settle it; [R] reports
a separate disputed draft without identifying its exact edition. **Missing
evidence:** that GT-layout draft and its decision record. This note neither
selects a GT layout nor approves additional watchdog/platform scope.

**Accept now:** edition identification, the semantic/encoding distinction,
explicit proposal status, supported CR13 reservation direction, and the need
for cross-consumer release evidence. **Require confirmation:** the two claimed
October 12 supersessions, direct and boot binary allocations, CR13 clearing
semantics, and unresolved authority/platform/GT decisions. Keep both October 9
editions unchanged as historical evidence.
