# IDE fixture and simplification audit

Date: 2026-10-19

## Scope and immutable boundary

The existing ISA must not change in any way. No instruction encoding, semantics,
permissions, faults or architectural state contract may be changed to make an
example or fixture work. This audit authorizes no implementation changes.

Inspection covered compiler fixtures, selected editor ownership tests, exposed
examples, source-library initialization, Namespace diagnostics and suite wiring.
No application code, fixtures, installed artifacts, live Namespace data or hardware
were changed. Only this report and the standing scope constraint were recorded.
This is not an exhaustive audit of every test, browser journey or hardware path.

## Findings and recommended disposition

| Priority | Finding and evidence | Classification | Recommendation |
|---|---|---|---|
| High | `simulator/test_editor_roundtrip.js`: 43 passes, 5 failures. Its positive source builder supplies bare names such as TestLump and EmptyBody to the current public compiler. | Obsolete fixture | Update positive identities and declarations, preserve exact instruction-word comparisons and deliberate rejection tests. |
| High | `simulator/test_compiler_capability_indices.js`: 22 passes, 20 failures. Bare object/C-list identities, assembly without methods and an expectation that historical Alice source compiles unchanged conflict with current admission. | Obsolete fixtures; remaining failures need reassessment after repair | Correct authored test inputs, never historical saved bytes or compiler checks. Do not assume all 20 failures have one cause. |
| High | `simulator/test_compiler_method_assembly.js:44`: first positive ChangeOperands source aborts on missing canonical dot-name. | Obsolete fixture | Fix source identity while retaining exact CHANGE operand/word assertions. This is not permission to alter CHANGE. |
| High | `simulator/test_retired_opcodes.js:39`: the positive Probe CALL control fails identity validation before subsequent runtime rejection checks. | Obsolete fixture masking coverage | Repair the positive control; retain retired-byte rejection and historical disassembly coverage. |
| High | `simulator/test_js_symbolic_compiler.js:65`: first buildLump call rejects Counter's bare identity and aborts the file. `test_lambda_exec.js:409`: HaskellArith identity causes its sole failure (68 pass). | Obsolete fixtures | Use valid declared fixture identities; distinguish frontend fragment checks from complete admitted LUMP construction. |
| High | `simulator/app-compile.js:3288` still embeds a Mint example with Create(size, perms) delegating to Memory.Allocate and a placeholder Revoke returning zero. `simulator/index.html:1019` exposes it through JS: Mint. It is distinct from the current editable `simulator/cloomc/mint.cloomc`. | Confirmed obsolete user-facing example | Remove competing current-Mint presentation or explicitly archive it. Do not replace it with a claim that the unfinished current Mint works. Coordinate any eventual edit with ongoing Mint work. |
| High | Fresh simulator boot places Namespace object at 0 and Thread at 16 (`simulator.js:3342`), while live Namespace validation requires the object location to equal descriptor-table base 130048 (`simulator.js:4281`). Native boot completes, yet the validation card faults. | Confirmed implementation contradiction, not merely fixture drift | Reconcile the diagnostic against the existing approved contract in a separate change. Do not change layout/ISA or teach the test to accept a false fault. |
| Medium | `test_live_lump_validations.js` expects Thread location zero. Total: 32 pass, 4 fail; Namespace checks also hit the contradiction above. | Mixed obsolete assertion and implementation defect | Correct fixture assumptions separately from Namespace validation. Do not blanket-rebaseline all four failures. |
| Medium | `test_editor_buffer_ownership_races.js:81–86` searches for the exact text `var _openWriteGuard = window._captureEditorWriteGuard`. Production now captures a parent guard and wraps it; checks remain before ownership teardown at `app-lumps.js:8630`. | Confirmed stale structural assertion; race behavior still needs execution | Replace spelling/order searches with behavioral tests using real guards. The failed assertion prevents the subsequent delayed-save probe from running; do not claim that probe passed. |
| Medium | `test_compiler_autodetect.js` loads compiler into a VM without ChurchAssembler; compilation aborts in call diagnostics. | Incomplete harness | Load the real dependency. Review subsequent failures after that correction rather than adding permissive compiler fallbacks. |
| Medium | All five `tests/server/fixtures/*.json` sources are rejected by direct current-compiler probes: three lack declarations and two use bare Adder/Math names. Golden endpoint tests expect success. | Obsolete source fixtures | Repair source contracts before deliberately reviewing regenerated expected bytes. Flask endpoint tests were not run in this audit. |
| Medium | Repository-wide source-only capabilities check reports one violation: `docs/archive/phase-1-expanded-collection/source-drafts/ns-slot-lambda.cloomc` lacks a capabilities block. The scan also traverses generated diagnostic sources. | Scope mixing historical/generated material with current-source checks | Define explicit active, historical and generated categories. Keep separate historical inspection checks; do not rewrite the archive or blindly exempt all failing paths. |
| Medium | Source Library source text is populated by calling example loaders; structural metadata is initialized separately. `app-source-library.js:267` explicitly warns that sources may be unavailable until an example is loaded. | Confirmed coupling; simplification candidate | Extract read-only example data access independent of editor navigation. Preserve navigation guards and user-owned drafts. |
| Medium | `package.json` and `scripts/run-all-tests.sh:237` chain unrelated files with `&&`; early obsolete fixtures suppress later coverage. The workflow synchronization check passes for 80 test workflows. | Coverage visibility limitation, not missing-workflow evidence | Run independent checks with per-file results and aggregate failure; keep dependent integration steps ordered. Use the existing registry rather than introduce a competing one. |
| Low | `test_hex_tab_fill_path.js` passes 19 checks while displaying retired ELOADCALL words. | Intentional historical inspection | Keep and label historical coverage; it does not establish current executable success. |

## Additional verification in this pass

Nine additional Node test files were run independently so earlier failures could
not hide later files:

| File under simulator/ | Exit result |
|---|---|
| test_editor_restore_containment.js | Pass |
| test_editor_buffer_ownership_races.js | Fail: stale source-text assertion |
| test_editor_writer_guards.js | Pass |
| test_draft_exact_text.js | Pass |
| test_default_editor_navigation_authority.js | Pass |
| test_owner_transition_reconciliation.js | Pass |
| test_prepare_run_ui.js | Pass |
| test_boot_execution_freshness_warning.js | Pass |
| test_compiler_method_assembly.js | Fail: positive fixture identity |

These are targeted Node checks, not browser end-to-end proof.

Commands also run:

- `node scripts/check-run-all-tests-sync.js`: pass, 80 test workflows represented.
- `node scripts/check-capabilities-blocks.js --glob '**/*.cloomc' --source-only`:
  one archived-source violation.

The 25 inline source entries in loadCLOOMCExample were extracted without invoking
the loader and compiled in isolation with an empty registry. All 25 returned
errors. This is a triage signal, **not 25 confirmed broken browser examples**:
some need live method conventions, some have file-backed overrides, and one
explicitly preserves a published bug. Bare identities and unsupported statements
are actionable source evidence; missing method conventions require a correctly
configured follow-up test. No source was installed or executed by this probe.

The standalone JS/symbolic and autodetection filenames are absent from
package.json, .replit and run-all-tests.sh direct references. This does not prove
they are never invoked indirectly; coverage registration needs explicit review.

## Simplification boundaries

The active IDE catalog must be subordinate to the selected Namespace: derive
membership and exact LUMP selections from that Namespace, not from a manifest,
example inventory or latest-revision index. Consolidated source lookup is only
lookup infrastructure. Optional library/examples must remain distinct from
installed membership and must never substitute artifacts automatically.

Safe candidates for small follow-up changes:

1. Shared valid positive-fixture builders using the real compiler/assembler,
   keeping explicitly malformed cases independent.
2. Behavior-based editor tests instead of exact variable spellings and comments.
3. A read-only source catalog with explicit current/draft/historical status;
   source enumeration must not require changing editor ownership.
4. One suite inventory and independent result collection.
5. Remove stale redirect commentary where the code now performs comparison only,
   after checking the actual branch behavior.

Do not collapse source drafts, compiled candidates, saved immutable binaries,
Namespace assignments and running images into one mutable object. They have
different ownership and freshness contracts. Consolidate duplicated access and
presentation logic only after proving those distinctions remain intact.

Do not remove safety checks merely because they appear twice: client diagnostics,
server admission and runtime authorization protect different boundaries.
Do not replace native simulator tests with handwritten instruction emulators.

## Recommended sequence

1. Restore trustworthy fixture/harness coverage without application changes.
2. Resolve the Namespace diagnostic contradiction against the unchanged ISA.
3. Separate current examples from historical/draft examples, beginning with Mint.
4. Decouple source enumeration from editor navigation.
5. Consider broader state/UI consolidation only with ownership, exact-artifact
   and execution-freshness evidence.

No broad refactor or ISA change is recommended. Browser interaction testing,
complete file-backed example compilation, endpoint golden tests, full live
save/load/run coverage and exhaustive hardware conformance remain outside the
completed audit.
