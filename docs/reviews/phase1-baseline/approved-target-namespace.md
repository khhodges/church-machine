# Confirmed Phase 1 Namespace target

Genesis confirmed the pictured **Phase 1 — 256-slot default / metadata, self,
entry Thread** design on 17 October 2026.

Reference: `attached_assets/image_1792254185928.png` and the explicit confirmation
“Yes—use the pictured Phase 1 design.”

| Slot | Approved entry | Design intent |
|---|---|---|
| 0 | Namespace metadata/header | Four-word table metadata |
| 1 | Boot.NS | Namespace self; Resident |
| 2 | Boot.Thread | Entry Thread; Resident |
| 3 | LED_DEV | Resident I/O register |
| 4 | BTN_DEV | Resident I/O register |
| 5 | TIMER_DEV | Resident I/O register |
| 6 | SelfTest | Resident |
| 7 | WukongCallHome | Resident |
| 8 | UART_DEV | Resident I/O register |
| 9 | ide.Mint | Resident intent; unfinished implementation retained |
| 10 | CapabilityTest | Resident; selected boot entry |
| 11 | Thread.2 | Resident Thread |
| 12 | Thread.3 | Resident Thread |
| 13 | M_BIT_DEV | Resident I/O register |
| 14 | nstab | Resident intent; requested RW |
| 15 | pkverify | Resident intent; requested E |
| 16 | ide.Alice | Resident intent |
| 17 | ide.Mallory | Resident intent |

IDE node: **ide**. Total slots including metadata: **256**. Table storage:
**1024 words / 4096 bytes**; table-only CR15 limit **1023**. There are 17
assigned entries, all with Resident intent, and no Lazy placements.

Visible approved details and explicit selected revisions govern. The screenshot
is not a substitute for an exact machine-readable snapshot of those revisions
and fields when preparing execution evidence. Do not infer missing identities,
rename entries to historical workbook labels, or reuse older slot assignments.
Requested rights are design intent, not newly granted executable authority.
Unfinished entries remain in the target; internal seals and binding mechanics
must implement that target without a second user approval of bookkeeping.

## Acceptance boundary

The earlier IDE-03 browser acceptance used the historical saved-Namespace
profile. At target confirmation, IDE-03 was reset to Needs verification and the
original checklist had 1 Complete out of 104. Those historical results remain
valid for their profile, but were not used to close this target.

The subsequent [Phase 1 persistence acceptance](phase1-save-reload-acceptance.md)
now closes **IDE-03 for this approved target**, using its unchanged criterion.
Only SPEC-01 and IDE-03 are Complete in the original checklist:
**2 Complete out of 104**. This is not executable-image qualification.

No installation, simulator activation, build, flash, live migration or artifact
replacement is authorized by this design confirmation. The historical
migration defect is not the next Phase 1 implementation priority merely because
an old-profile test fails.

## Coding work and CTMM tracking

The workbook's Completeness sheet combines implementation requirements and
verification requirements; it is not an exhaustive coding-task queue.

- Namespace UI, persistence and exact boot selection: IDE-03.
- Diagnostics and executed-artifact freshness: IDE-04.
- Mint and its protected interfaces: RES-ide.Mint, G1–G8, FUNC-01 and FUNC-02.
- nstab / pkverify implementation requirements: RES-ide.NSTab and
  RES-ide.PkVerify (existing workbook labels, not authority to rename the target).
- Alice / Mallory behavior: RES-ide.Alice and RES-ide.Mallory.
- Internal seal handling: SEAL-01–SEAL-05.
- Generator / simulator / RTL agreement and regression resolution: SIM-03 and
  REL-03, with separate physical acceptance requirements.

Each subsequent coding task should cite the original requirement IDs and this
target. Completing a coding task is not automatically full requirement closure.
