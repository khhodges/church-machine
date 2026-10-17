# Phase 1 Namespace save/reload acceptance — 17 October 2026

## Requirement and exact target

Original CTMM **IDE-03**, unchanged closure criterion:

> Verify save/reload, resident selection and boot entry without silent layout/identity changes.

**Complete for the approved Phase 1 profile.** This is design persistence
acceptance, not LUMP execution, simulator activation, image installation, RTL,
seal or hardware qualification. No other requirement is newly closed.
The original checklist has **2 Complete out of 104** (SPEC-01 and IDE-03).

Authority: [approved target](approved-target-namespace.md) and
`attached_assets/image_1792254185928.png`. The machine-readable acceptance
snapshot is `tests/fixtures/phase1_namespace_target.json` (SHA-256
`73f2eb89290f525d4d83cc0020d424e3dfa51b9bd55d80e847fdb4c3f156d582`).
It transcribes the approved design with exact selections from the saved
Phase 1 draft; it is not a catalog-latest selection or an executable artifact.

- Metadata at slot 0; Boot.NS self at 1; entry Boot.Thread at 2; UART at 8.
- CapabilityTest boot selection at 10.
- 256 slots, 1024 table words / 4096 bytes, table-only CR15 limit 1023.
- 17 assigned entries, all Resident intent, no Lazy policy.
  MMIO rows retain internal `Hardware` policy and device address/limit semantics,
  displayed and counted as Resident I/O registers.
- ide.Mint, nstab, pkverify, ide.Alice and ide.Mallory remain unfinished,
  named Resident-intent rows without substituted executable artifacts.

| Selected entry | Revision | Exact filename | SHA-256 |
|---|---:|---|---|
| SelfTest | 98 | SelfTest.1.8b19abd7.lump | 65f6e254b1f0a164f2d2163239f28e4521d792d8d96800b26cdbff607f77b5de |
| WukongCallHome | 20 | WukongCallHome.1.7084172e.lump | 549aa4138bf722b48c2ff304ec628af0139d70685ea99e66dfb3200ad0055738 |
| CapabilityTest | 45 | CapabilityTest.1.1feaf30b.lump | e41b861a87a13066e4a7cb76e5a01d39c62857bfddfffc5e3f2ffdcb12dd8c21 |

All three selected file hashes matched. The existing SelfTest embedded-name
warning remains visible; persistence acceptance does not resolve that separate
identity/execution issue or authorize replacement.

## Inspected path and scoped corrections

The profile adapter supplies the existing Namespace table, toolbar, Inspect /
Edit placement, Bind Namespace Design and lightning-bolt controls.
`?profile=phase1` selects its own `design-drafts/phase1.json`; ascending and
historical `ns-state.json` remain distinct. The existing protected-change review,
fingerprint check and atomic DesignStore save remain in force.

Corrections:

1. A new unsaved Phase 1 profile omitted Alice and Mallory. Its default now
   includes both at 16/17. Existing saved documents are not rewritten.
2. Edit placement displayed “Unfinished” although it retained a selected
   revision internally. It now visibly selects “Keep selected revision” with
   the exact revision/filename. A newer catalog row does not replace it.
3. Switching profile closes the old placement dialog, so a Phase 1 edit cannot
   be applied into another profile's document.

The copied saved draft spelled slot 16 `ide.Alace`. Tests corrected that
spelling explicitly through the private endpoint/browser editor to the approved
`ide.Alice`; the live draft was not migrated or renamed.

## Verification and retained evidence

### Endpoints and focused regression checks

- `python3 scripts/run_namespace_save_acceptance.py endpoints --profile phase1`
  — **4 passed**, actual Flask application, no route stubs. Exact target
  save/readback and new-client reload; exact selected bytes/revisions;
  unfinished entries; boot 7→10; cancelled approval replay; stale fingerprint;
  Lazy rejection; cross-profile approval and format rejection.
- `python3 -m pytest tests/server/test_namespace_phase1_design.py tests/server/test_namespace_design_v1.py tests/server/test_namespace_binding_report.py -q --tb=short`
  — **26 passed**. Includes default membership, absent/existing design saves,
  profile separation, one-use reviews and stale-state rejection.
- `node simulator/test_namespace_placement_retention.js` — passed, including
  an explicitly newer catalog row while keeping the selected v45.
- `node simulator/test_namespace_original_view_adapter.js`,
  `node simulator/test_namespace_design_node_save.js`,
  `node simulator/test_namespace_profile_memory.js`,
  `node simulator/test_namespace_view_preference.js` — all passed.

Two stale fixture assumptions were repaired in the existing extracted-route
tests: Phase 1 proposals used Lazy despite the existing Resident-only rule,
and GET was expected to contain the save-only binding report. Runtime checks
were not relaxed.

### Browser acceptance (one journey, continued only at unfinished segments)

`tests/e2e/namespace_phase1_acceptance.spec.js` uses the original controls and
real endpoints. It explicitly selects Phase 1; it does not use the historical
acceptance target or mocked save responses.

1. `python3 scripts/run_namespace_save_acceptance.py browser --profile phase1`
   passed edit/cancel, rejected-save draft retention, reload discarding rejected
   edits, explicit Alice correction, exact target save/reload, selected-v45
   display and no implicit upgrade. The run then stopped on a **test fixture
   error**: it attempted to read an ascending profile file that legitimately
   did not exist.
2. `... browser --profile phase1 --remaining` continued only the unfinished
   segment. Profile-dialog ownership passed; boot selection saved/reloaded
   7→10 with every non-boot field retained; all five unfinished rows remained.
   It then stopped on a **test timing error**: the assertion read the ascending
   document before its asynchronous load completed after a browser reload.
3. `... browser --profile phase1 --remaining profiles` passed (**1 passed**).
   This skipped both completed edit and boot segments, and verified the final
   ascending→legacy→Phase 1 switches, retained documents, unchanged optional
   ascending file, protected hashes, unchanged simulator memory and no browser
   page errors. The screenshot shows 17 Resident-intent entries, zero Lazy and
   the boot marker on CapabilityTest slot 10.

The two test assumptions were corrected (optional-file comparison and explicit
load wait). **This is completed segmented acceptance, not a claim that a fresh
full-command run passed after those corrections.** Already-passing segments
were not rerun. The full command remains available as the regression entrypoint.

Retained [final profile-isolation screenshot](phase1-profile-isolation.png).
Original browser output: `test-results/namespace_phase1_acceptanc-80be7-sions-and-profile-isolation-chromium/phase1-approved-save-reload.png`.
The final test also attaches the exact Phase 1 document as JSON.

## Isolation and limits

The runner uses a disposable copy of LUMPs, full boot configuration,
build snapshots and database, a dedicated port, no existing-server reuse and
the server's external-integration shutdown mode. Browser requests to external
hosts/hardware are blocked; writes are allowed only to the selected Phase 1
design and change-review endpoints. IDE node was already `ide` and was not
changed. Missing ignored Phase 1 drafts in clean checkouts use the explicitly
reported frozen acceptance fixture, never latest catalog selections.

Every endpoint/browser run reported **1,281 live artifact/configuration files
byte-identical**. The inventory includes both profile drafts, LUMPs, boot
configuration, build snapshots, hardware build outputs and IDE hierarchy.
The browser also checked private non-target state and simulator memory.
No LUMP replacement, live design migration, image installation, execution
activation, vendor build, device command or hardware operation was performed.

The existing IDE workflow was restarted after the code changes and served the
original table successfully. Its read-only preview screenshot is only startup
evidence; target acceptance comes from the isolated browser journey above.

Historical acceptance and regression results remain in
[Namespace authority progress](namespace-authority-progress.md), unchanged.
