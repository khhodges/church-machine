# Namespace authority implementation — 17 October 2026

## Delivered

Removed the active-manifest-row prerequisite from LUMP admission. The shared
selection validator now checks the exact Namespace-selected filename and SHA-256
against pending publication bytes or the saved file. Catalog membership and
archive status are not approval inputs. The R26 consistency check uses this same
validator instead of a second implementation.

Admission still performs its existing authorization, generation, allocation,
review-fingerprint and atomic-publication checks. No seal algorithm or trust
policy was changed. No UI or installed artifact was substituted.

Errors now identify the selected object, distinguish unreadable files from
changed bytes, and state the corrective action. The ADD-modal test was updated
to intercept the current draft-placement boundary rather than the retired
simulator mutation call. Developer guidance now distinguishes catalog
bookkeeping from approved Namespace authority.


## Historical verification — before fixture repair and acceptance continuation

This initial result is retained as historical evidence, not the current status.
The fixture-repair result below was **55 passed, 2 xfailed**; the original missing
NS[1] allocation fixture failure was resolved. The generator correction and
current focused results are recorded at the end of this document.

- `python -m pytest tests/server/test_lump_admission_service.py -q --tb=short`
  — **17 passed, 1 failed**. Passing cases cover real admission with missing,
  archived and duplicate catalog rows; preservation of existing selections;
  changed/missing files; pending bytes; invalid filenames; interrupted
  publication; and immutable destination-local derivatives.
- Failure at that time: `test_boot_resident_admission_builds_an_image` could not
  establish NS[1] allocation in its copied fixture. The fixture copies the LUMP
  directory without the parent boot configuration required by admission.
  No runtime allocation check was weakened to accommodate it.
- `python -m pytest tests/lump/test_lump_consistency.py -q -k live_namespace --tb=short`
  — **1 passed**, 1417 deselected. This reads the real selected bytes without
  modifying them; it is not a full LUMP-suite result.
- `node simulator/test_ns_slot_modal_persist.js` — **36 passed**.
- `node simulator/test_namespace_boot_authority.js` — passed.
- `node simulator/test_namespace_single_save.js` — passed.
- IDE workflow restarted and serving HTTP 200; homepage screenshot loads.
  This is not a browser save/reload acceptance test.

An earlier broader diagnostic run of the admission, table-save, single-review,
sole-authority, plan and image-refresh files produced **91 passed, 46 failed**.
That result is retained as incomplete diagnostic evidence, not release
qualification. Some tests stopped because their explicit isolated-server mode
was absent; other extracted-route fixtures omit current dependencies, and
additional image/layout failures remain unresolved. No full suite was restarted.
Raw diagnostic logs are not attached because pytest assertion representations
can include process-environment content.

## Historical verification — before fixture repair and acceptance continuation

This initial result is retained as historical evidence, not the current status.
The fixture-repair result below was **55 passed, 2 xfailed**; the original missing
NS[1] allocation fixture failure was resolved. The generator correction and
current focused results are recorded at the end of this document.

- `python -m pytest tests/server/test_lump_admission_service.py -q --tb=short`
  — **17 passed, 1 failed**. Passing cases cover real admission with missing,
  archived and duplicate catalog rows; preservation of existing selections;
  changed/missing files; pending bytes; invalid filenames; interrupted
  publication; and immutable destination-local derivatives.
- Failure at that time: `test_boot_resident_admission_builds_an_image` could not
  establish NS[1] allocation in its copied fixture. The fixture copies the LUMP
  directory without the parent boot configuration required by admission.
  No runtime allocation check was weakened to accommodate it.
- `python -m pytest tests/lump/test_lump_consistency.py -q -k live_namespace --tb=short`
  — **1 passed**, 1417 deselected. This reads the real selected bytes without
  modifying them; it is not a full LUMP-suite result.
- `node simulator/test_ns_slot_modal_persist.js` — **36 passed**.
- `node simulator/test_namespace_boot_authority.js` — passed.
- `node simulator/test_namespace_single_save.js` — passed.
- IDE workflow restarted and serving HTTP 200; homepage screenshot loads.
  This is not a browser save/reload acceptance test.

An earlier broader diagnostic run of the admission, table-save, single-review,
sole-authority, plan and image-refresh files produced **91 passed, 46 failed**.
That result is retained as incomplete diagnostic evidence, not release
qualification. Some tests stopped because their explicit isolated-server mode
was absent; other extracted-route fixtures omit current dependencies, and
additional image/layout failures remain unresolved. No full suite was restarted.
Raw diagnostic logs are not attached because pytest assertion representations
can include process-environment content.

## Original Phase 1 requirements

| Item | Progress | Closure |
|---|---|---|
| IDE-03 | Complete: isolated endpoint and browser acceptance demonstrated exact save/reload, resident and boot selections; see continuation below. | Original criterion met: no silent layout or artifact-identity changes. |
| IDE-04 | Missing/changed artifact diagnostics are specific and actionable. | Executed-artifact freshness and integrated UI evidence remain. |
| SEAL-02 | Exact-byte selection check retained without catalog authority. | No claim of full seal-field, replay or destination-identity coverage. |
| REL-03 | R26 and ADD-modal checks now pass. | Other regression groups remain open. |
| BASE-02 | Admission and R26 no longer require active catalog rows. | Remaining consumer coverage must be established before broad closure. |

The earlier implementation newly closed **zero** requirements. The acceptance
continuation below closes **IDE-03 only** in the original 104-row checklist;
it does not close the other rows or the entire six-step plan.

All 1,246 previously inventoried saved/build files retained their hashes after
the tests and server restart. No hardware command, build, upload, flash or
saved-artifact replacement was performed.

## IDE-03 acceptance continuation

The extracted-route fixtures now supply the production staging-copy and
allocation dependencies, structurally valid private LUMP bytes, complete
allocation geometry, private approval/index files, and the current writer
signature. The client assertion distinguishes the read-only upgrade check from
the single protected save. The refresh test compares retained body bytes at
their explicitly compacted address; ordinary Save still must leave the image
unchanged. These are test repairs, not changes to runtime integrity checks.

- `python -m pytest tests/server/test_namespace_table_save.py tests/server/test_namespace_single_review.py -q --tb=short`
  — **35 passed**.
- `python3 scripts/run_namespace_save_acceptance.py endpoints`
  — **4 passed**, exercising the actual Flask application with no route stubs:
  exact save/reload, Lazy→Resident choices, boot-marker selection and reload,
  incomplete design saving, cancellation/replay rejection, and stale-tab
  protection. Selected catalog rows are removed in the private fixture;
  filename/hash-bound selections remain valid. Assertions compare complete
  saved rows, not only names or policy flags.
- `node simulator/test_namespace_boot_authority.js`,
  `node simulator/test_namespace_single_save.js`, and
  `node simulator/test_ns_slot_modal_persist.js` — passed (ADD-modal: **36/36**).

The acceptance runner copies the complete boot configuration, LUMP library,
build snapshots and SQLite database into a fresh temporary directory. Explicit
isolated mode disables external startup services. Browser runs choose a
non-live port and forbid existing-server reuse. The protected boot control uses
a synthetic test-only credential; production authorization is not disabled.
All **1,280** inventoried live Namespace/LUMP/image/build/configuration files
remain byte-identical after endpoint acceptance.

The first browser attempt reached the separately persisted ascending-design
editor and stopped on an editor-specific cancellation assertion. It is **not**
saved-Namespace acceptance evidence. The test now selects the visible
“Previous saved design / committed-image controls” profile explicitly. That
profile is the existing `ns-state.json` save/reload boundary covered by IDE-03;
ascending-v1 candidate approval and hardware installation remain separate.

The saved-Namespace browser continuation then passed cancellation/reload,
Lazy save/reload, stale-tab rejection and restoration to Resident, including
complete-row and protected-file hash comparisons. The existing upgrade chooser
is handled explicitly with **zero upgrades selected**, even when newer library
revisions are offered. An initial test-helper assumption that Save immediately
opens the protected confirmation was corrected without suppressing that chooser.

This continuation exposed a real boot-click mismatch: the Namespace stores
`lump_version` (or `issue_n`), while the artifact chooser expects `revision`.
The UI now adapts the exact selected Namespace row to that chooser contract;
missing or duplicate catalog rows cannot replace or veto it. The server still
validates the requested revision, filename, token, approved bytes and Namespace
fingerprint. No integrity check or approval workflow changed.

The boot-authority regression now exercises the actual click plus real chooser
for each supported saved-version field, absent/misleading catalogs, and missing
selection rejection. The final browser follow-up was restricted to the
fixed boot-selection boundary and incomplete-design save/reload; the already
passing resident/cancellation/stale-tab journey was not repeated.

### Final closure evidence

- The original saved-Namespace browser journey passed cancellation/reload,
  Resident→Lazy save/reload, stale-tab rejection and restoration to Resident,
  with complete saved-row comparisons and byte-identical protected files. It
  stopped at the subsequently repaired boot chooser boundary; this is recorded
  as passing portions of a failed journey, **not** a full green suite result.
- `node simulator/test_namespace_boot_authority.js` — passed after the
  boot-click repair, including actual chooser integration and catalog-independent
  exact selection.
- `python3 scripts/run_namespace_save_acceptance.py browser --remaining`
  — **1 passed, 22.6 s**. The same tester verified only the repaired boot flow
  and previously untested incomplete-design flow on a fresh isolated server.
  Boot marker and design save each used the existing **428 review → 200 commit**
  sequence. Both persisted exactly after reload. No API responses were mocked.
- Screenshot: the browser spec writes
  `test-results/namespace_save_acceptance--40957-complete-design-save-reload-chromium/namespace-save-reload.png`.
  This is local generated evidence; the checked-in runner/spec reproduce it.
- The runner again verified all **1,280** live files byte-identical. Private
  assertions also preserved all selected LUMP files, library/index data, images,
  boot configuration, and unchanged row layout/identity during these operations.

**IDE-03 is Complete.** The original workbook row's closure criterion is
unchanged: “Verify save/reload, resident selection and boot entry without silent
layout/identity changes.” Only its status and evidence were updated. This is
acceptance of saved Namespace configuration, not executable-image regeneration,
ascending-v1 approval, simulation activation, hardware qualification or flashing.

For a future full replay, run the endpoint command above followed by
`python3 scripts/run_namespace_save_acceptance.py browser`. The browser spec is
split at the boot boundary so a targeted follow-up never needs to repeat the
already verified resident/cancellation/stale-tab checks.

The browser spec is opt-in via the dedicated runner. Ordinary Playwright
discovery skips it rather than failing or writing shared state; explicitly
requested acceptance still rejects missing or live writable paths. Completion
validation also restored the pre-existing always-on VM deployment requirement
after a conflicting incoming configuration selected Autoscale. No deployment
was performed.

Completion-fix checks: `tests/server/test_primary_publish_config.py` **3 passed**;
the standard npm Playwright entry point discovers both acceptance cases without
error. A no-server execution skips both when not requested; explicit opt-in
without isolated paths is rejected, and valid isolated opt-in discovers both.
No additional browser acceptance pass or destructive full-suite run was needed.
## Historical generator defect — corrected below

`test_boot_generator_preserves_noncompact_admitted_location` exposes a genuine
runtime discrepancy with otherwise identical, valid private inputs: admission
accepts UploadedBoot at word **1024**, but `generate_boot_image` emits its boot
entry/body at word **336**. These are not equivalent approved placements.
The test is **strict xfail**, once for each
configuration lookup path, not counted as a passing image test. It expects only
the placement assertion to fail; unrelated generation exceptions remain errors,
and a future successful assertion becomes XPASS/failed until the marker is removed.

Reproduce the unsuppressed failure with:

```text
python -m pytest tests/server/test_lump_admission_service.py \
  -k noncompact --runxfail -q --tb=short
```

In `server/boot_image.py`, the public generator leaves
`honor_namespace_layout=False`; `_namespace_location` returns the running-pool
fallback instead of the approved placement. The compact positive fixture
explicitly describes only the layout where these agree. It is not evidence that
arbitrary admitted placements survive generation. Correcting that generator
behavior is separate work; no allocation gate, ISA, profile, live state, hardware
build or device action was changed for this test repair.

## Historical fixture repair — deterministic private inputs

The incomplete directory-copy fixture in
`tests/server/test_lump_admission_service.py` has been replaced with a private
8K-word Namespace, one generated Thread, architecture-defined device rows,
synthetic exact-hash bootstrap-approved SelfTest/CapabilityTest bytes, and a
quarantined upload admitted through the real service. Every physical allocation
has an explicit location. No live LUMP, approval, Namespace or boot configuration
is used to construct this fixture.

Both configuration lookup paths are covered: the private parent
`boot-config.json`, and `CHURCH_TEST_BOOT_CONFIG_PATH` pointing to another private
file while the parent is deliberately incomplete. This also prevents an outer
isolated suite runner's copied configuration from supplying accidental geometry.
The existing runner remains unchanged; copying state is isolation, not a
deterministic test specification.

The compact-layout positive cases prove:

- Admission commits exactly one resident boot selection and preserves other
  selected rows except their previous boot markers.
- Missing, archived and duplicate catalog entries do not veto exact selected
  bytes, including the newly admitted resident. Unselected absent files are
  irrelevant.
- The unmodified hardware-profile generator and validator accept the image.
  Its header names the admitted slot and location; every selected resident body
  equals the approved file word-for-word (big-endian LUMP versus little-endian
  image), and descriptor W3 equals the approved SELF GT.
- Generation changes none of the private persisted inputs.
- Missing configuration/placement, Thread or resident overlap, reserved-header
  or table overlap, and out-of-RAM placement reject with status 409. Namespace,
  catalog, approvals, quarantine, artifacts and evidence remain byte-for-byte
  unchanged, with no transaction journal or staging directory published.

Verification through `scripts/run_test_suite_isolated.sh`:

```text
python -m pytest tests/server/test_lump_admission_service.py \
  tests/server/test_namespace_allocation.py -q --tb=short -rx
55 passed, 2 xfailed
```

## Generator correction — approved placement preserved

Hardware/publication generation now uses saved Namespace locations for resident
bodies, SelfTest and generated Threads, independently of simulator profile
selection. The simulator-only flag still selects the same admission/profile
behavior; it no longer decides whether saved physical addresses are honored.
Hardware generation rejects a selected artifact with no saved location rather
than inventing one. Private simulation retains its existing ability to stage
unplaced drafts for review.

Every RAM allocation is checked for overlap and header/table bounds before body
writes. Allocation sizes still come from validated artifact headers or configured
Thread geometry, not shortened capability limits. Generated Threads without a
saved location follow the highest allocated end, even when SelfTest is located
below a noncompact resident. Invalid saved placements fail explicitly; generation
does not rewrite Namespace rows, approvals, artifact bytes or configuration.
Explicit Refresh Image compaction is outside this correction.

The strict xfail markers have been removed. Both parent-config and explicit-config
fixtures now prove:

- UploadedBoot remains at word **1024**, or **7872** immediately below the table,
  in both the boot header and Namespace descriptor.
- Every selected resident body matches its approved file word-for-word; the old
  compact destination remains empty.
- Thread/resident collisions, header/table overlap, out-of-RAM placement, and
  missing/malformed addresses fail without persisted changes.
- Saved noncompact root and secondary Thread locations are preserved. An
  unplaced generated secondary Thread follows the resident high-water address;
  a colliding secondary Thread fails rather than overwriting approved bytes.
- Matching Step-2 compatibility rows are accepted for the same allocation,
  including placements below another body's high-water address. Conflicting
  addresses and real overlaps still fail; a short Step-2 size cannot shrink
  the artifact's reserved allocation.
- The existing private simulator preparation tests still pass without changing
  their draft-placement behavior.

Current focused verification:

```text
python -m pytest tests/server/test_lump_admission_service.py \
  tests/server/test_namespace_allocation.py tests/simulation/test_preparation.py \
  -q --tb=short
128 passed
```

These tests construct private inputs and require no live-state repair, hardware
build, upload, flash or device command. This is generator regression evidence,
not integrated browser acceptance or closure of the broader Phase 1 requirements.

## Combined post-merge verification — 17 October 2026

Fresh verification of the merged generator and independent image fixtures:

```text
bash scripts/run_test_suite_isolated.sh <private-temp-directory> \
  namespace-merge-verification \
  "CHURCH_TEST_ISOLATED_MODE=1 CHURCH_LUMPS_DIR=<private-temp-directory>/lumps \
   python -m pytest tests/server/test_lump_admission_service.py \
   tests/server/test_namespace_allocation.py tests/simulation/test_preparation.py \
   tests/server/test_namespace_sole_authority_repair.py -q --tb=short -ra"

190 passed, 2 failed in 45.60s
```

The first three files contribute **128 passes**; the independent image suite
contributes **62 passes and 2 failures**. No skipped or expected-failure cases
were reported. The noncompact-placement tests have no xfail markers: the exact
boot location and resident bodies at words 1024 and 7872 are checked, as is the
empty former compact destination. Matching Step-2 placements, full allocation
bounds, Thread placement, rejection paths and private simulation preparation
are covered by the passing cases.

The two failures are the parent-config and explicit-config variants of
`test_reviewed_migration_tool_recreates_image_state_and_provenance`.
The historical fixture supplies CapabilityTest at NS[2] with device-space
location `0x40000014`. The migration copies that row to NS[10] without establishing
an approved resident RAM location. The corrected generator rejects allocation
`[0x40000014, 0x40000054)` as outside RAM/reserved-table bounds. This is a migration
compatibility issue exposed by the combined changes, not permission to restore
implicit compaction or weaken the bounds check.

Next correction: establish an explicit reviewed resident destination in the
historical migration path, distinguish invalid historical-state rejection from
successful migration fixtures, and prove atomic no-mutation behavior on failure.
Do not select or rewrite a live destination merely to make the test pass.

The JavaScript Add/Save payload harness takes private JSON on stdin and is
exercised through the passing server tests, not as a standalone empty-input
command. A direct empty-input invocation is invalid and is not counted as a
product regression.

All **1,289** inventoried live LUMP/build/configuration files retained their
hashes; no files were added or removed from that inventory. No application
implementation was changed by this verification, and no hardware operation was
performed.

**Phase 1 accounting:** IDE-03 stays Complete. SIM-03 and REL-03 gain verified
generator evidence but remain Needs verification; the original checklist still
has **2 Complete out of 104** (SPEC-01 and IDE-03). The remaining migration
failure prevents describing the combined image suite as fully green. No new
hardware, ISA, seal or image-refresh acceptance is claimed.
