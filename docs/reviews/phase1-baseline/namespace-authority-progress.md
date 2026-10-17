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

## Fresh verification

- `python -m pytest tests/server/test_lump_admission_service.py -q --tb=short`
  — **17 passed, 1 failed**. Passing cases cover real admission with missing,
  archived and duplicate catalog rows; preservation of existing selections;
  changed/missing files; pending bytes; invalid filenames; interrupted
  publication; and immutable destination-local derivatives.
- Remaining failure: `test_boot_resident_admission_builds_an_image` cannot
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
| IDE-03 | Removed an admission veto; modal, boot-marker and single-save JavaScript checks pass. | Still needs isolated server save/reload and integrated browser evidence for resident and boot selections. |
| IDE-04 | Missing/changed artifact diagnostics are specific and actionable. | Executed-artifact freshness and integrated UI evidence remain. |
| SEAL-02 | Exact-byte selection check retained without catalog authority. | No claim of full seal-field, replay or destination-identity coverage. |
| REL-03 | R26 and ADD-modal checks now pass. | Other regression groups remain open. |
| BASE-02 | Admission and R26 no longer require active catalog rows. | Remaining consumer coverage must be established before broad closure. |

**Zero of the original 104 requirements is newly marked Complete.** This
delivers the first implementation portion, not the entire six-step plan.

All 1,246 previously inventoried saved/build files retained their hashes after
the tests and server restart. No hardware command, build, upload, flash or
saved-artifact replacement was performed.
