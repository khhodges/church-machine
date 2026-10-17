# Phase 1 baseline audit — 17 October 2026

Subsequent implementation and fresh results are recorded separately in
[Namespace authority progress](namespace-authority-progress.md). Historical
baseline observations below are preserved, not overwritten as if freshly run.

## Scope and evidence boundary

Authorized: baseline inspection and failure classification, with **no saved
artifact changes or hardware actions**. No runtime fix, catalog repair,
source recompilation for publication, boot-image generation, RTL generation,
build, flash, device command or workflow restart was performed.

The audit updates documentation and the CTMM W7 tracker only. Existing
`all-tests` was running when observed; no duplicate broad suite was launched.
Its eventual result is **not** known from this audit. Previously failed
workflow output has no supplied execution timestamp or input fingerprint, so
it is historical observation, not a fresh failure against the captured commit.
No aggregate “all regressions” pass/fail total is claimed.

Evidence:

- [Existing workflow excerpts](workflow-observations.json): bounded tails from
  eight workflows, observed during this audit, not newly executed suites.
- [Read-only input/probe observations](input-observations.json): captured commit,
  source hashes, 1,246 saved/build-file hashes, selected binding comparisons,
  provenance drift and a new in-memory compiler dependency probe.
- Reproducer: `python scripts/audit_phase1_baseline.py` prints JSON and does not
  write saved state. It does not import project Python services.

The protected-file inventory was identical before and after that probe.
This is not a global write lock: concurrent workflows remain independent
actors. Saved Namespace metadata is not a physical-board readback or proof of
installed image contents.

## Classification register

| ID | Area | Classification / confidence | Observation | Next action | Tracker links |
|---|---|---|---|---|---|
| BASE-01 | Assembler/compiler | Confirmed dependency-initialization failure; not an ISA verdict | Existing assembler workflow throws `TypeError: ChurchAssembler is not a constructor` at compiler line 220. Fresh in-memory probe reproduces it with global assembler undefined; injecting the real constructor removes this exception (the sample still has one compile diagnostic). | Establish explicit Node/compiler dependency setup and regression coverage; rerun isolated assembler suite before interpreting encoding failures. Do not weaken retired-opcode diagnostics. | SIM-01; REL-03 |
| BASE-02 | Namespace authority | Test imposes a competing manifest-authority requirement | Selected SelfTest has one active matching catalog row; selected WukongCallHome and CapabilityTest have zero. All three selected binary hashes match their files. Genesis confirms the approved Namespace list is authoritative; missing active catalog rows do not invalidate these selections. Hash agreement alone is not full execution qualification. | Correct the test's requirement for an active manifest row and inspect consumers for equivalent catalog vetoes. Validate exact Namespace-selected bytes, identity, permissions, allocation and binding directly. A library/history index may locate files but cannot override approval. No catalog repair or reselection is required merely to satisfy this test. | RES-SelfTest; RES-WukongCallHome; RES-CapabilityTest; IDE-03 |
| BASE-03 | LUMP GT validator | Legacy-oracle conflict; affected binary validity not established | Four reported R22 failures use `_gt_word0_violation`, which declares bit 26 spare and rejects it. The test itself notes Abstract GT encodings use bits 26:25=11. The four reported cases are 04b2913d, 3b057bbb, Ethernet.1.b169bba4 and Ethernet.1.fc72b0e3. | Classify each rejected word by approved type and permissions; replace the obsolete blanket rule only under the current contract. Do not declare all four artifacts valid just because the old rule is wrong. | SIM-01; SEAL-02; REL-03 |
| BASE-04 | Boot-image agreement | Shared generator/fixture contract failure; root cause provisional | All 18 reported failures stop at `mandatory NS slot 2 is zeroed`; 8 other cases passed. Tests build synthetic Boot.Abstr fixtures in temporary directories; generator still requires legacy slots (0,1,2,3,4,5,6,10). Agreement is not reached in these failed cases. | Trace fixture selection, generation policy and validator mode in an isolated copy. Reconcile approved slot-2 entry versus legacy device/profile semantics; do not remove validation merely to pass tests. | SIM-03; H10; H11; H12 |
| BASE-05 | RTL boot/control | Unresolved fixture/implementation/oracle failures | Existing run: 8 failed, 46 passed. Failures cover SWITCH outcomes, delayed-fault issuer attribution, nested CALL/RETURN and saved-PC validation. No fresh RTL simulation was performed. | Capture instruction words and pre-fault state, verify approved fixture encodings, then replay minimal isolated cases. Keep implementation defects possible until evidence excludes them. | SIM-02; SIM-03; H05; H09; H18 |
| BASE-06 | Generated initialization | Reported generated-artifact/source mismatch; not freshly recomputed | Existing guard: RTLIL init ROM 2693 entries versus Python source 2694; 1 failed, 25 passed in that suite. | Freeze source and approved image first; then regenerate and qualify exact outputs under separate authorization. Do not equate a one-entry count fix with a qualified bitstream. | REL-01; H19; H20 |
| BASE-07 | SelfTest freshness | Reported source/entry-format drift, not observed execution failure | Selected SelfTest hash is intact. Existing freshness guard says instruction body MATCH, embedded text DIFFERENT, method-entry format DIFFERENT. The first failing command prevents the chained guard-test command from running. | Independently inspect actual CALL dispatch/decoder behavior for the exact selected artifact before proposing replacement. Preserve the selected bytes and distinguish source freshness from execution compatibility. | RES-SelfTest; SIM-05 |
| BASE-08 | API reference suite | Probable fixture/contract drift; not a fresh test result | Existing run fails in `test_abs_saved_api.js`: compiled method declarations unavailable. The fixture invokes `_formatLumpApiDefinition('LED', [])`; failure occurs before the advertised reference comparison completes. | Supply authentic compiled metadata in the fixture, or establish why valid metadata is lost; retain fail-closed refusal to infer API from another LUMP. | IDE-06; REL-03 |
| BASE-09 | Bitstream provenance | Confirmed current-source drift from recorded build | Fresh hash comparison finds 22 of 39 recorded input fingerprints differ from current files. The record's historical “verified” label is not qualification of today's source. | Freeze the candidate source/configuration; obtain matching generation, build/timing, artifact hashes and authorized physical evidence. Do not relabel the historical bitstream. | REL-01; REL-02; CM-H |

## Count reconciliation

These are counts **within each observed suite**, not additive independent
project totals (the full runner can repeat the same suites):

| Observed suite | Failure count | Reconciliation |
|---|---:|---|
| lump-consistency | 5 | BASE-02: 1; BASE-03: 4. Also 1402 passed, 11 skipped and 188 warnings; warnings are not extra failures. |
| boot-image-matches-sim | 18 | BASE-04: all 18 stop at the same slot-2 error; 8 passed. |
| boot-rom-no-false-halt | 8 | BASE-05: 2 SWITCH tests, 3 delayed-fault attribution cases, 1 nested CALL/RETURN case, 2 saved-PC cases; 46 passed. |
| wukong-boot-rom-guard | 1 | BASE-06: one initialization-count mismatch; 25 passed. |
| assembler-tests | Fatal exception | BASE-01: no final aggregate assertion total established; do not count preceding PASS lines as a completed suite. |
| check-selftest-lump-stale | Guard failed | BASE-07: two freshness/format differences, not two independently executed test failures. |
| check-api-reference-stale | 1 runner suite | BASE-08: exception in prerequisite test; reference freshness itself not evaluated. |
| all-tests | In progress | No final aggregate status asserted. |

## Recommended correction order

1. Fix the compiler dependency failure and API test setup in isolated tests:
   these block useful evidence without needing saved-artifact changes.
2. Reconcile the R22 oracle and synthetic boot fixture contract with the
   approved ISA. Do not weaken capability or boot checks to get green results.
3. Diagnose the eight RTL failures using exact instruction/fault evidence.
4. Remove competing manifest-authority requirements from validation under the
   existing Namespace-authority rule; preserve approved selections and actual
   integrity checks. Separately investigate the SelfTest entry-format question
   before proposing any artifact replacement.
5. Only after the intended inputs are frozen, regenerate and qualify outputs
   with separately authorized build and physical-board work.

Mint G1–G8, seal storage and the remaining ISA oracle gaps are still open.
This audit does not grant new protected interfaces or architectural authority.
It does not establish that the three-abstraction startup path conforms.

**Genesis authority clarification:** The initial audit incorrectly proposed
reconciling approved Namespace selections with manifest history. The observed
catalog discrepancy is real, but an active catalog row is not a second approval
requirement. BASE-02 now records the test/consumer authority defect, not a
request to change Genesis's selection. Raw observations remain unchanged.

## Tracker maintenance

The workbook adds a **Baseline audit** sheet and BASE-01–BASE-09 rows to
Completeness. Original threat sheets and existing statuses are preserved.
Related rows receive evidence references, not inferred PASS/Complete values.
Owners and due dates remain unassigned until explicitly allocated.

Validation: workbook now contains 113 unique tracker rows; all 104 prior
statuses and the original three sheets' populated cells/formulas/styles were
preserved. The Phase 1 package check passed (69 files, 26 local links), and
`git diff --check` passed. All 1,246 inventoried saved/build files retained
their hashes at delivery; 11 inspected source files were fingerprinted.
