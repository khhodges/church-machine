# NFB1 starting baseline

## Verdict

**Baseline captured; not a release-ready or fully green baseline.**
No runtime fixes, image uploads, FPGA commands, flashing, or publication were
performed. This investigation identifies existing failures and implementation
gaps; it does not authorize the next development tasks.

Observed checkout: `ea9988593538b8664ac2e34537b4f95fe854dfcb`.
The checkout was clean before investigation and remained clean after tests,
before this report was added. The snapshot is the workspace, not proof of
what is currently published or programmed on the board.

## Component and artifact inventory

| Component | Current evidence |
| --- | --- |
| Simulator | `simulator/simulator.js`; compiler, assembler and audit modules are separate. Existing fault tests include boot-return behavior, not proof of the proposed contained-Abstraction continuation. |
| Server | `server/app.py`, `server/boot_image.py`, `server/artifact_revisions.py`; selected approved Namespace uploads use retained source/configuration and project to board-native bytes. |
| Bridge | `hardware/wukong_bridge.py`; UART upload acknowledgement followed by requested reboot remains the current transfer path. |
| RTL | `hardware/wukong_top.py`; source declares build version **20** and scheduler minimum **18**. These constants do not establish the physically installed build. |
| Installation UI | `simulator/app-build-approval.js` and `server/fpga_status.html`; exact-revision installation exists, but completion is not full memory verification. |
| Saved catalog | `server/lumps/manifest.json`: **106 records, 36 marked archived**. All manifest-referenced filenames exist. Presence is not an integrity/admission pass. |
| Saved generic boot image | `server/lumps/boot-image.bin`, **65,536 bytes**. Size alone does not establish its format or suitability for direct UART transfer. |
| Tutorial candidates | Several non-archived Alice/Mallory entries, archived historical variants, AliceDriver/MalloryDriver entries, and `ide.AmoebaStartup.1.f6b1d589.lump`. No NFB1 target pair inferred from catalog order. |
| Factory specification | `factory-build-verified-install-approval.md`; scope, review gates, and Amoeba default minimum MTBF of 12 months are documented, not runtime acceptance evidence. |

Selected saved filenames observed:

- `ide.Mallory.1.0ca567b5.lump`
- `ide.Mallory.1.fdaed91d.lump`
- `ide.Mallory.1.32e361e7.lump`
- `ide.Mallory.1.3a5e7373.lump`
- `ide.Alice.1.1eec355e.lump`
- `ide.Alice.1.a91d33f7.lump`
- `ide.Alice.1.d5125806.lump`
- `ide.Alice.1.9d996919.lump`

These coexistence observations do not establish which exact revision is
selected by a live Namespace or that any one is the corrected Mallory.

## Input fingerprints

SHA-256:

| File | Digest |
| --- | --- |
| `server/app.py` | `6a3d380830c34a9ec71a039e98d88b01f824ede396b96ffcab2e5a6f64ba74ab` |
| `server/boot_image.py` | `3134a89e14a9b1f9f351f35fc11a80a04cd9f319b6ee4da14833234bd6c792d7` |
| `simulator/simulator.js` | `c953215e491e6738edfc4d879386c72b23853e36791715662cab70a4935d4e51` |
| `hardware/wukong_top.py` | `9e847fc38cb65b397fe737d1a37172f402ef7820a649b7e41438a4e73a40abfc` |
| `hardware/wukong_bridge.py` | `6c474646c7b3a9c16ca03ad91fed0441544b8ac2a33e7af4f2981ee52103910e` |
| `server/lumps/boot-image.bin` | `0ff1b24d76b7010c13b8b50737f4513a771b586be73b8d0fa80a748087070a5b` |
| `server/lumps/manifest.json` | `0ecff5798639370aca2909474a8eb67908a3f27915a751616992317ddef72c7e` |

Boot-image and manifest hashes matched before and after the focused checks.
This does not establish the identity of a production image or board RAM.

## Fresh focused checks

Run sequentially without live board interaction:

| Command | Result |
| --- | --- |
| `node simulator/test_rci_threading.js` | **FAIL: 23 passed, 32 failed assertions** |
| `node simulator/test_lazy_resolve_pending.js` | **FAIL: 47 passed, 24 failed assertions** |
| `node simulator/test_fault_recovery.js` | **FAIL: 365 passed, 1 failed assertion** |
| `node simulator/test_namespace_image_install.js` | PASS |
| `node simulator/test_fpga_control_auth.js` | PASS |
| `node simulator/test_build_approval_revision_selection.js` | PASS |
| `python3 -m pytest hardware/test_wukong_thread_scheduler_contract.py -q --disable-warnings` | **51 passed** |

Summary: **4 commands passed, 3 failed**. The three failed JavaScript suites
reported **435 passed / 57 failed assertions** in total. Do not add these
assertion counts to pytest test counts as though they were the same unit.
Full output, command exit codes, and durations are retained in
[focused test evidence](nfb1-baseline-test-evidence.txt).
This is baseline evidence, not NFB1 release acceptance.

### Confirmed failures and triage

1. **RCI/source-line reporting — 32 failed assertions.**
   Expected capability-row violations are absent, causing downstream display
   and line-number checks to fail too. The audit currently decodes compact
   LOAD/SAVE rows and skips dynamically indexed forms. Fixture encoding
   compatibility needs reconciliation before deciding whether the fault is in
   the tests, audit, or both. BRANCH source-line display checks passed.
2. **Pending GT resolution — 24 failed assertions.**
   Existing expectations about inline resolution, NULL authority, lazy
   suspension, and reserved-slot behavior do not match the current simulator.
   Do not relax authority rules merely to restore these historical expectations.
   Fixture-versus-runtime attribution is unresolved.
3. **Fault snapshot diagnostics — 1 failed assertion, T012f.**
   The combined assertion about snapshot/log message equality and preservation
   of the raw diagnostic suffix fails. Other tested snapshot fields and
   immutable fetched-instruction evidence pass. The snapshot reads the last
   fault record's message; determine which subcondition differs before fixing.

All three failures were reproduced before any NFB1 runtime implementation.
They are starting-baseline failures, not regressions caused by this report.
No failure was fixed or dismissed as harmless.

## Existing workflow failures: historical, not freshly reproduced here

Read-only workflow observations reported:

| Workflow | Retained output |
| --- | --- |
| assembler-tests | Failed; observed tail is a Node stack trace, insufficient to identify the initiating assertion. |
| lump-consistency | 7 failed, 1211 passed, 11 skipped; includes c-list GT-format and tracked-LUMP/manifest checks. |
| boot-image-loads-and-boots | 5 failed, 11 passed; selected-entry initial-PC expectations. |
| boot-image-upload-endpoint | 15 failed, 1 passed; examples expect HTTP 400 but receive 428 with change-confirmation evidence. |
| check-api-reference-stale | Failed suite; post-run LUMP guard reported unchanged files. |

These retained outputs have no correlated current-input fingerprint in this
investigation. They are investigation leads, not additional fresh failures
to add to the counts above. Other failed/not-started workflows are also not
certified by the focused run.

The broad launcher was deliberately not run: existing project test-isolation
guidance warns that some boot suites mutate shared live LUMP/configuration
state. A safe broad rerun requires a private, dereferenced artifact sandbox
and isolation of all runtime persistence inputs, not snapshot/restore alone.

## NFB1 gaps versus baseline defects

The following are planned NFB1 capabilities, not failed claims of an already
completed NFB1 implementation:

- Fault-safe installation hold without reboot-then-halt.
- Full FPGA memory readback and exact installed-byte comparison.
- Verified/stopped state followed by explicit Start: current upload command
  still requests `reboot: True`.
- Mallory Abstraction containment with Thread availability, safe control
  transfer to Amoeba, OFFLINE management, and caller stop-polling.
- Amoeba's 12-month default, assessable per-object MTBF, Must Resolve lifecycle,
  and the complete corrected-Mallory/upgrade/fallback tutorial.

Current RTL gates upload on absence of `recovery.fault_pending`. Current
bridge code reboots after upload acknowledgement when requested. Existing
selected-revision UI tests do not prove these missing hardware capabilities.

The historical physical report records BOUNDS `0x08` at `0x2e08` for
`LOAD CR1, CR6, #2`. The causal reconciliation belongs to the next planned
investigation; it was not resolved or physically rerun here.

## Readiness and next deliverables

- **Task 1 investigation delivered:** reproducible starting snapshot, scoped
  test results, historical failure separation, and implementation-gap inventory.
- **Not ready to claim:** green full suite, selected NFB1 target pair, proven
  containment continuation, readback verification, calibrated operational MTBF,
  or physical NFB1 acceptance.
- Proceed next, when authorized, with the Mallory fault-mechanism
  reconciliation. Keep the three confirmed simulator failure clusters visible
  and resolve them before claiming relevant release gates pass.
- Confirm the exact physical starting build and selected Namespace revision
  through the authorized evidence path before any board trial. Source build
  version 20 is not proof of the programmed bitstream.
