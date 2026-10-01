# Role split: acceptance evidence and remaining limits

## Action and authority map

| Role/action | Reviewed inputs | Authorized output | Not implied |
|---|---|---|---|
| Programmer: compile/save | Frozen source and exact LUMP candidate | New artifact revision and its approval/history | Slot assignment, Namespace adoption, simulator load |
| Engineer: save configuration | Explicit draft edits and Namespace fingerprint | Saved design rows | Image generation or execution |
| Engineer: prepare/approve simulation | Exact selected bodies, configuration and reviewed layout | Retained approved simulation Namespace revision | Hardware certification |
| Engineer: reopen/activate | Exact retained approved revision, fresh one-use activation ticket | Stopped simulator with bound image/provenance | Use of current catalog or old shared disk image |
| Tester: build/approve | Exact approved hardware Namespace and retained source inputs | Retained bitstream and evidence | Adoption of new upstream revisions |
| Download/flash | Explicit exact approved output and target | Verified delivery where implemented | Download is not proof of flashing; manual flashing remains separate |

Unselected assignments remain in the design but are not executable image inputs.
Boot selection is not permission to read every artifact in the library. Generated
architectural objects have distinct construction rules.

## Verified milestones

The isolated `test_role_split_retention.py` scenarios exercise real simulation
preparation and immutable revision storage: N1 retains artifact A and its image,
new artifact B and draft N2 do not alter it, and historical tester output remains
bound to N1. These tests do not claim that synthetic bitstream bytes are certified
hardware results.

Approved simulation revisions now retain selected bodies, Namespace rows,
configuration, image and provenance in `RevisionStore`. Pending review still
checks current inputs. After approval, activation/reopen uses retained bytes,
independent of newer or even malformed current drafts. Restart loses temporary
tickets, not approved history. Missing/tampered retained inputs fail closed.

API:
- `GET /api/simulation/history`: retained approved simulation revisions.
- `POST /api/simulation/reopen`, body `{revisionId}`: fresh approved but inactive
  ticket; does not load or execute.
- Existing approve/activate consume `{preparationId, configurationHash}`.
  Activation is one-use; explicit reopen obtains a new ticket.

## Focused regression evidence

- 48 isolated Python checks passed across role retention, real preparation,
  artifact revision storage and table-only Namespace save. Tests use private
  storage; the role-retention fixtures set all four test path overrides.
- `test_editor_roundtrip.js`: 68 passed, zero failed.
- `test_boot_entry_sync.js`: passed after replacing obsolete `NamespacePlan`
  and disk-cache-as-activation assertions with exact marker/fingerprint and
  approved-simulation requirements.
- `test_simulation_execution_isolation.js`,
  `test_simulation_image_binding.js`, and
  `test_simulation_preparation_ui.js`: passed.
- `test_prepare_run_ui.js`: simulator compatibility aliases execute the real
  private-review controller and reach only `/api/simulation/prepare`; review
  does not mutate Namespace rows, clear pin drafts, load, approve or execute.
  Its former shared-publication transaction expectations were replaced with
  this explicit role contract.
- Parent verification reported successful browser artifact-only publication.
  That result is separate from these module-level retention tests.

### Unresolved regression, not excused as a workflow change

`test_fault_recovery.js` reports 284 passes and 35 failures. Re-running the same
test with `simulator.js` from HEAD substituted read-only produced the **identical
35 failing assertions**. The failures cover pending-GT resolution, ELOADCALL
LAZY_RESOLVE, and one fault-message snapshot assertion. They predate this split
but remain genuine unresolved regression evidence. Their architecture
expectations were not weakened or removed.

## Completion limits requiring explicit treatment

- Resolved integration leak: Abstractions now displays the private simulation
  review/approval/activation panel, not shared-image freshness or cache retry
  actions. `savePreparedBootEntry()` and the old cache-retry compatibility alias
  delegate to private preparation only; their shared-publication implementation
  is removed. Fault recovery names the same explicit private lifecycle. Separate
  hardware publication remains explicit and does not load a simulation.
- Retained simulation approval uses the existing project-wide IDE access model;
  this is not a new per-user/multi-tenant authorization system.
- Existing Alice/Mallory design inconsistencies were not repaired. Any repair
  needs its own exact reviewed proposal; test fixture corrections are not user
  data repairs.
- Hardware programming was not performed. Neither retained/downloaded output nor
  a RAM upload acknowledgement proves persistent FPGA installation.

This evidence is not a claim that all repository tests pass or that every
hardware device has been tested. No broad all-tests workflow or live data repair
was used for this verification.