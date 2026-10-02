# Namespace authority and publication

The programmer-approved Namespace rows define slot membership, Pet Names,
entry kinds, artifact selection, and deployment policy. Catalog metadata,
boot-config labels, browser caches, generated images, and observed hardware
must not rewrite those assignments.

## Artifact and image revisions

Saving a selected artifact and preparing a composite image are separate
approved operations. A saved revision may be newer than the image. An image
is usable only after validation against both its own full memory allocations
and the exact current Namespace revision and selected artifacts.

Generation provenance records `namespace_fingerprint`: SHA-256 over the
canonical complete Namespace rows. Changing even a nonresident assignment or
Pet Name invalidates this revision binding. Existing images without the
revision binding are not silently blessed or regenerated. They require an
explicit reviewed preparation. Reading the IDE and inspecting invalid state
remain available.

Symbolic placements cannot simultaneously claim executable artifact identity
or resident installation. All writers must use the same Namespace validation,
not merely atomic JSON writes. Installation consent is a separate requirement;
validation must never manufacture that consent by deleting inconvenient flags.

## Merge and release gate

Before accepting changed runtime Namespace/image artifacts into a release,
run the read-only gate:

```sh
python3 scripts/check_namespace_authority.py --lumps-dir /path/to/staged/lumps
```

For separate storage, supply `--state` and `--image`. A nonzero result blocks
acceptance. It reports invalid row semantics, complete-body overlaps, missing
provenance, revision drift, or selected-artifact mismatches. It never edits,
regenerates, migrates, or repairs files. It is not a web-server startup gate.
Existing boot-image admission uses the same revision and artifact validator.

The existing `scripts/post-merge.sh` invokes this gate before GitHub
publication when the merged commit changes `server/lumps/`. A failed gate
stops that script before sync; it does not undo an already-created local
commit. Code-only merges do not require silently repairing historical data.
This is not GitHub branch protection, nor a guarantee that every external
push path uses the gate. Release tooling must explicitly require the gate.

Run tests in temporary fixture storage, never against the programmer's saved
library. The focused admission tests are
`tests/boot/test_namespace_authority_gate.py`. Existing test-run mutation guards
remain necessary: detecting semantic invalidity does not authorize tests to
write valid but unrequested Namespace changes.

Historical invalid data requires a reviewed correction describing the exact
affected slots, artifact choices, and placements. Do not relocate objects,
reassign device slots, or alter source merely to make this gate pass.

## Preventing new allocation conflicts

Table-only saves do not generate images or install runtime bytes. They do check
new or changed physical allocations under the same cross-process Namespace lock
as the revision check and publication. Adds, replacements, moves, growth and
Resident-policy changes must fit the complete LUMP allocation, not merely its
access limit. Architectural header, table and Thread reservations also count.

Unchanged historical overlaps do not block unrelated metadata edits or removing
an allocation. Missing or malformed design-only selections remain editable.
An unknown physical size cannot prove free memory and must be resolved before
adding a new physical allocation.

Rejected proposals remain drafts; the IDE neither relocates them automatically
nor installs them into a simulator. Upload installation approval includes the
exact Namespace fingerprint and proposed word address. A concurrent change
requires a fresh review, not an automatic retry with the previous consent.