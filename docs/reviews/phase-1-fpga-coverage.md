# Phase 1 FPGA review crosswalk

Audit evidence only; not an active specification, inventory or runtime authority.
All 86 resolution entries are assigned a disposition below. Coverage means
a requirement/test destination or explicit blocker, **not execution or a pass**.
Older choices are interpreted through their later explicit resolutions.

Source SHA-256: `6760cbaffa662cc7e1c3268a8cfbb9fe4509663c7a9f9a71630fb999e4196c61`

Source: `docs/archive/phase-1-expanded-collection/REVIEW-2026-10-14.md`.
Targets: current Phase 1 Master ISA and hardware acceptance H01–H20/S01–S07.
BLOCKERS means the acceptance plan's explicit oracle/configuration/evidence gaps.

## Original completeness findings

| Finding | Disposition |
|---|---|
| F1 layout | H12 |
| F2 reset slot | H10–H11 |
| F3 handoff | H09 |
| F4 bounded execution | H13–H17 |
| F5 CR13 | H09–H10 |
| F6 generation | H06/S05 |
| F7 integrity mask | H06 |
| F8 identity | S01; software representation still open |
| M1 scope | README, S01–S07 |
| M2 complete encodings/reset | H01–H05/H10; core oracle gaps explicitly remain |
| M3 Mint ABI | S02–S05; software ABI still open, not hardware gate |
| M4 lifecycle | H09–H12/H20 and S02/S04/S05 |
| M5 evidence | H19/H20/S07; no physical pass claimed |

## Every resolution entry

| Entry | Review question/decision | Acceptance destination | Disposition |
|---|---|---|---|
| 1 | Phase 1 collection — portable local copies requested | README | Organization/authorization; not hardware behavior |
| 2 | Phase 1 transition — hardware implementation and simulation authorized | README | Organization/authorization; not hardware behavior |
| 3 | Pre-release checkpoint review — boot and SWITCH hardware source inspection | H09 H10 H11 | Source gap requires current implementation evidence |
| 4 | Pre-release checkpoint review — watchdog and fault-code source inspection | H08 H13 H14 H17 | Source gap requires current implementation evidence |
| 5 | Pre-release checkpoint review — read-only hardware encoding source check | H03 H04 | Source gap requires current implementation evidence |
| 6 | Pre-release checkpoint review — hardware acceptance plan reconciled | H19 H20 S07 | Separate hardware and software evidence |
| 7 | Pre-release checkpoint review — shared checked indexing datapath selected | H03 H04 | Captured widened arithmetic, not live operands |
| 8 | Pre-release checkpoint review — serialized accepted-write completion selected | H17 | Serialized accepted writes; validated save |
| 9 | Pre-release checkpoint review — immutable bootstrap configuration selected | H10 H11 | Immutable protected bootstrap parameters |
| 10 | Pre-release checkpoint review — routine FPGA details delegated | BLOCKERS | Engineering discretion does not settle architectural oracles |
| 11 | Pre-release checkpoint review — combined timeout selection and exemption exit are atomic | H15 H16 | Atomic writes and expiry priority |
| 12 | Pre-release checkpoint review — expiry wins over same-edge exemption write | H15 H16 | Atomic writes and expiry priority |
| 13 | Pre-release checkpoint review — INVALID_OP for reserved-bit watchdog writes approved | H15 H16 | Atomic writes and expiry priority |
| 14 | Pre-release checkpoint review — reserved-bit watchdog writes reject wholly and hard-fault | H15 H16 | Atomic writes and expiry priority |
| 15 | Pre-release checkpoint review — watchdog timeout selector codes approved | H13 H14 H15 | Latest four-duration decision supersedes fixed-second/old reserved bits |
| 16 | Pre-release checkpoint review — watchdog timeout selection retained across reset | H13 H14 H15 | Latest four-duration decision supersedes fixed-second/old reserved bits |
| 17 | Pre-release checkpoint review — timeout changes apply at next start or renewal | H13 H14 H15 | Latest four-duration decision supersedes fixed-second/old reserved bits |
| 18 | Pre-release checkpoint review — four watchdog timeouts approved; initial selection one second | H13 H14 H15 | Latest four-duration decision supersedes fixed-second/old reserved bits |
| 19 | Pre-release checkpoint review — watchdog exemption control word approved | H13 H14 H15 | Latest four-duration decision supersedes fixed-second/old reserved bits |
| 20 | Pre-release checkpoint review — BFEXT/BFINS runtime position indexing approved | H04 | Approved indexed bitfield encoding |
| 21 | Pre-release checkpoint review — single-word DR-indexed BRANCH approved | H03 | Single-word encodings only |
| 22 | Pre-release checkpoint review — DREAD/DWRITE common signed-offset layout approved | H03 | Single-word encodings only |
| 23 | Pre-release checkpoint review — single-word direct CALL runtime-method extension approved | H03 | Single-word encodings only |
| 24 | Pre-release checkpoint review — single-word indexed CALL approved for Phase 1 | H03 | Single-word encodings only |
| 25 | Pre-release checkpoint review — multiword proposals rejected; single-word CALL redesign requested | H03 | Single-word encodings only |
| 26 | Pre-release checkpoint review — runtime mLoad checks, no full incoming C-List scan | H08 | Runtime mLoad; context versus operand faults |
| 27 | Pre-release checkpoint review — all context-validation failures use 0x1D; operand permissions retain 0x1E | H08 | Runtime mLoad; context versus operand faults |
| 28 | Pre-release checkpoint review — Thread no-permissions failure maps to 0x1E | H08 | Runtime mLoad; context versus operand faults |
| 29 | Pre-release checkpoint review — Phase 1 bootstrap starts watchdog-exempt; Genesis = IDE | H13 H14 H15 | Latest four-duration decision supersedes fixed-second/old reserved bits |
| 30 | Pre-release checkpoint review — preserve watchdog exemption across reset | H13 H14 H15 | Latest four-duration decision supersedes fixed-second/old reserved bits |
| 31 | Pre-release checkpoint review — instruction fault wins same-cycle watchdog reporting tie | H16 H17 | Instruction-fault reporting does not defeat containment |
| 32 | Pre-release checkpoint review — watchdog accepted-write completion boundary approved | H17 | Serialized accepted writes; validated save |
| 33 | Pre-release checkpoint review — watchdog capture retains Thread-save validation | H17 | Serialized accepted writes; validated save |
| 34 | Pre-release checkpoint review — three hardware fault-code assignments approved | H08 | Runtime mLoad; context versus operand faults |
| 35 | Pre-release checkpoint review — watchdog MMIO GT under the MMIO abstraction | H06 BLOCKERS | MMIO abstraction authority; placement still needs closure |
| 36 | Pre-release checkpoint review — software cannot block the Phase 1 bitstream | S02 BLOCKERS | Software delivery not a hardware gate |
| 37 | Pre-release checkpoint review — abstraction-hierarchy Owner A-GT-id clarified | S03 | Approved policy retained; proof/ABI remains software work |
| 38 | Pre-release checkpoint review — PassKey format remains draft; Owner defines bits 30:27 | S03 | Approved policy retained; proof/ABI remains software work |
| 39 | Pre-release checkpoint review — SAVE detects Abstract PassKeys | S03 | Approved policy retained; proof/ABI remains software work |
| 40 | Pre-release checkpoint review — onward sharing requires Genesis authority and hard fault | S03 | Approved policy retained; proof/ABI remains software work |
| 41 | Pre-release checkpoint review — Genesis-authorized initial PassKey setup approved | S03 | Approved policy retained; proof/ABI remains software work |
| 42 | Pre-release checkpoint review — Replace active-use exclusions approved | S04 | Active/resident exclusions before mutation |
| 43 | Pre-release checkpoint review — full-block zeroing before reuse approved | S05 H06 | Software lifecycle, hardware stale-GT rejection |
| 44 | Pre-release checkpoint review — Destroy active/resident exclusions approved | S04 | Active/resident exclusions before mutation |
| 45 | Pre-release checkpoint review — boot-guard versions exclude 511 | S06 H11 | 0–510 boot halves supersede earlier 512-value probability |
| 46 | Pre-release checkpoint review — version 511 is permanent slot retirement | S05 H06 | Software lifecycle, hardware stale-GT rejection |
| 47 | Pre-release checkpoint review — Destroy may invalidate outstanding GTs | S05 H06 | Software lifecycle, hardware stale-GT rejection |
| 48 | Pre-release checkpoint review — PassKey required for every Mint case | S03 | Approved policy retained; proof/ABI remains software work |
| 49 | Pre-release checkpoint review — LS C-lists, RW data and Destroy required | S02 | Type/service scope; lazy loading deferred |
| 50 | Pre-release checkpoint review — Mint Abstraction/Thread scope approved | S02 | Type/service scope; lazy loading deferred |
| 51 | Pre-release checkpoint review — Genesis-authorized revokers approved | S03 | Approved policy retained; proof/ABI remains software work |
| 52 | Pre-release checkpoint review — PassKey-only revocation approved | S03 | Approved policy retained; proof/ABI remains software work |
| 53 | Pre-release checkpoint review — reusable PassKey credentials approved | S03 | Approved policy retained; proof/ABI remains software work |
| 54 | Pre-release checkpoint review — automatic lazy loading deferred | S02 | Type/service scope; lazy loading deferred |
| 55 | Pre-release checkpoint review — per-configuration guard policy approved | S06 H11 | Per-configuration retained guard/default policy |
| 56 | Pre-release checkpoint review — retain-guard default approved | S06 H11 | Per-configuration retained guard/default policy |
| 57 | Pre-release checkpoint review — CR0 startup guard policy is an IDE setting | S06 H11 | Per-configuration retained guard/default policy |
| 58 | Pre-release checkpoint review — boot-guard VERSION fault approved | H11 S06 | Later version-pair/two-stage decisions supersede metadata-copy proposal |
| 59 | Pre-release checkpoint review — guard lifetime approved | S06 H11 | Per-configuration retained guard/default policy |
| 60 | Pre-release checkpoint review — two-stage guard checks approved | H11 S06 | Later version-pair/two-stage decisions supersede metadata-copy proposal |
| 61 | Pre-release checkpoint review — 18-bit version-pair guard approved | H11 S06 | Later version-pair/two-stage decisions supersede metadata-copy proposal |
| 62 | Pre-release checkpoint review — shared boot-pair guard approved | H11 S06 | Later version-pair/two-stage decisions supersede metadata-copy proposal |
| 63 | Pre-release checkpoint review — boot matching-guard scope approved | H11 S06 | Later version-pair/two-stage decisions supersede metadata-copy proposal |
| 64 | Pre-release checkpoint review — boot matching-guard purpose approved | H11 S06 | Later version-pair/two-stage decisions supersede metadata-copy proposal |
| 65 | Pre-release checkpoint review — shared Namespace/Thread authority approved | H09 H10 | Shared authority, reset-only admission, final CALL |
| 66 | Pre-release checkpoint review — no additional CR12.M grant approved | H09 H10 | Shared authority, reset-only admission, final CALL |
| 67 | Pre-release checkpoint review — reset marker consumption approved | H09 H10 | Shared authority, reset-only admission, final CALL |
| 68 | Pre-release checkpoint review — final reset-ROM CALL retained | H09 H10 | Shared authority, reset-only admission, final CALL |
| 69 | Pre-release checkpoint review — reset-ROM fetch authority approved | H09 H10 | Shared authority, reset-only admission, final CALL |
| 70 | Pre-release checkpoint review — reset-only marker approved | H09 H10 | Shared authority, reset-only admission, final CALL |
| 71 | Pre-release checkpoint review — source completeness | H01 H02 H05 BLOCKERS | Baseline restored; unresolved oracles explicitly block full qualification |
| 72 | Pre-release checkpoint review — fixed transition destinations approved | H09 | Fixed destinations/source, one-GT CHANGE, CR13 rejection |
| 73 | Pre-release checkpoint review — SWITCH source approved | H09 | Fixed destinations/source, one-GT CHANGE, CR13 rejection |
| 74 | Pre-release checkpoint review — ordinary CHANGE encoding approved | H09 | Fixed destinations/source, one-GT CHANGE, CR13 rejection |
| 75 | Pre-release checkpoint review — CR13 rejection approved | H09 | Fixed destinations/source, one-GT CHANGE, CR13 rejection |
| 76 | F2 resolution — approved | H10 | Reset-slot decision |
| 77 | F5 resolution — approved | H09 | No IRQ CR13 role |
| 78 | F1 resolution — approved | H12 | Ascending layout, fixed slots, half-memory budget |
| 79 | F3 resolution — approved | H09 | Combined handoff; no second CHANGE |
| 80 | F4 resolution — approved | H14 | Bounded elapsed turns, not retirement progress |
| 81 | F6 resolution — width and software/hardware boundary approved | H06 S05 | Nine-bit equality; software-only lifecycle |
| 82 | F7 resolution — approved | H06 | Unchanged integrity formula masks F and G |
| 83 | F8 resolution — new definition of T approved | S01 S02 | Identity/network/service scope distinct from hardware gates |
| 84 | M1 resolution — networking scope approved; service scope open | S01 S02 | Identity/network/service scope distinct from hardware gates |
| 85 | M3 resolution — full Mint scope must be resolved in this Q&A | S02 S03 S04 S05 | Full Mint policy; unresolved ABI/mechanisms stay explicit |
| 86 | M5 resolution — acceptance evidence with Genesis override | H07 H18 S04 S07 | Exact-build acceptance; override is not a pass |
