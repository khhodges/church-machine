# Church Machine IDE — Release History

---

## Fix: POLA cleanup falling through to the wrong C-List view when it empties the block (2026-07-10)

Bug reported right after the POLA button shipped: clicking "⚖ POLA" in the
C-List popup appeared to *add* Golden Tokens (Boot.NS, Boot.Thread, UART_DEV,
LED_DEV, BTN_DEV, TIMER_DEV, SelfTest) instead of removing unused ones.

Root cause: `_removeUnusedCapabilities()` always operates on the editor's own
`capabilities { }` source block, correctly stripping every unreferenced entry.
But `buildContentAsync()`'s Path 0 (source-declared view) only rendered when
`capSrcEntries.length > 0`. When POLA removed *all* entries — a fully correct
cleanup — the resulting empty block fell through that check to Path 1
(live-sim CR6), an unrelated data source showing the boot-hardwired register
c-list. From the user's perspective the popup appeared to swap in a much
longer, unrelated list right after clicking POLA, looking exactly like GTs
had been added.

- **`simulator/clist-viewer.js`** — Path 0 in `buildContentAsync()` now
  renders whenever a `capabilities { }` block is found in source, regardless
  of entry count. An empty block renders an explicit
  `"No capabilities declared in source."` empty-state row instead of falling
  through to Path 1, keeping the popup's data source consistent with what the
  user is editing.
- **Regression tests:**
  - `tests/simulator/sim_clist_pola_cleanup.js` — new scenarios E/F/G extract
    and directly exercise the Path 0 selection logic: non-empty block → Path
    0 with rows, POLA-emptied block → Path 0 with the empty-state message
    (and no leaked live-sim boot capability names), no block at all → falls
    through as before.
  - `tests/e2e/clist_pola_cleanup.spec.js` — new end-to-end case: an
    all-unused capabilities block, once cleaned by POLA, keeps the popup
    title reading "source" (not the live-sim "(CR6)" default) and never shows
    boot-hardwired capabilities in the body.
- **Files changed:** `simulator/clist-viewer.js`, `simulator/index.html`
  (`clist-viewer.js` version tag bump), `tests/simulator/sim_clist_pola_cleanup.js`,
  `tests/e2e/clist_pola_cleanup.spec.js`.

---

## Feature: POLA cleanup button in the C-List viewer (2026-07-10)

Added a "⚖ POLA" (Principle of Least Authority) button to the C-List viewer
popup header in the Code Editor, alongside the existing "+ Add" button.
Clicking it strips capabilities-block entries whose declared name is never
referenced anywhere else in the editor source — the same idea as an unused-
import cleanup, applied to Golden Token capabilities.

- **`simulator/clist-viewer.js`** — `_wrapRows()` now renders the POLA button
  (`data-action="pola-cleanup"`) in all three C-List render paths (source,
  live sim, saved binary). New `_removeUnusedCapabilities()` parses the
  `capabilities { }` block via the existing `_parseCapEntries`, keeps only
  entries whose name appears as a whole word elsewhere in the source, and
  rebuilds the block via `_formatCapBlock`. A new `_showPolaToast()` shows a
  bottom-of-popup confirmation naming the removed capabilities (or an
  informational message when the block is missing, already empty, or already
  fully used). `showViewer()` gained an optional `toastMsg` parameter so the
  toast survives the async re-render it triggers.
- **`simulator/styles-editor.css`** — `.clist-pola-btn` (green-accented,
  matches the existing `.clist-add-btn` styling) and
  `.clist-pola-toast` / `.clist-pola-toast--show` (bottom banner with
  fade/slide transition).
- **Regression tests:**
  - `tests/simulator/sim_clist_pola_cleanup.js` — static wiring checks plus
    functional scenarios: mixed used/unused entries, all-used no-op, no
    capabilities block, empty block. Wired into the `selftest-lump-runs`
    suite in `scripts/run-all-tests.sh`.
  - `tests/e2e/clist_pola_cleanup.spec.js` — Playwright coverage of the full
    click-handler wiring: button renders in the live popup, clicking it
    removes an unused capability and shows a toast, and an all-used C-List is
    a no-op with an informational toast.
- **Files changed:** `simulator/clist-viewer.js`, `simulator/styles-editor.css`,
  `simulator/index.html` (`clist-viewer.js` / `styles-editor.css` version tag
  bumps), `scripts/run-all-tests.sh`, `tests/simulator/sim_clist_pola_cleanup.js`
  (new), `tests/e2e/clist_pola_cleanup.spec.js` (new).

---

## Fix: stale BFEXT/BFINS `pos=N, w=N` syntax re-surfacing via main editor's own localStorage snapshot (2026-07-10)

The earlier BFEXT/BFINS operand-syntax migration (`_migrateBfextBfinsSyntax` in
`simulator/app-lumps.js`) only covered the lump-editor draft (`cm_lump_draft_*`)
and custom user-tab (`church_user_tabs`) persistence paths. It missed a third,
independent persistence path: the main code editor's own generic session
snapshot, `church_editor_code`, saved by `saveEditorState()` and restored by
`loadEditorState()` in `simulator/app-run.js` on every page load — regardless
of which tab (built-in example or custom) is active. Any browser holding a
stale snapshot written back when the disassembler still emitted the old,
never-valid `pos=<N>, w=<N>` syntax kept restoring that broken text on every
reload, indistinguishable from the original "COMPILE FAILED" bug reappearing,
even though the disassembler and the other two migration call sites had
already been fixed.

- **Fix:** `loadEditorState()` now runs the restored `church_editor_code`
  value through `_migrateBfextBfinsSyntax()` before assigning it into the
  editor and re-persists the migrated text, closing the gap.
- **Regression test:** `tests/simulator/sim_editor_bfext_migration.js` —
  exercises the migration helper directly and statically verifies
  `loadEditorState()` calls it, in the correct order, before use. Wired into
  the `selftest-lump-runs` suite in `scripts/run-all-tests.sh`.
- **Files changed:** `simulator/app-run.js`, `simulator/index.html`
  (`app-run.js` version tag bump), `scripts/run-all-tests.sh`,
  `tests/simulator/sim_editor_bfext_migration.js` (new).

---

## IDE v2 Reorganisation — Landing Page, Six-Button Toolbar, NS Three-Tier Display, Learning Mode, Docs Tabs (2026-07-08)

Complete view-layer reorganisation around six named core functions, plus stale-data fixes and Boot3 rename.

### New features

- **Home landing page (`#home`)** — default view on first load; 6-tile Core Functions grid (Hardware · Namespace · Workshop · Code · Simulator · Deploy), Learning Tools section, Documentation section, and a `?learn=1` / `?debug=1` hint footer. `whatsNewModal` no longer auto-pops on startup.
- **Six-button core nav bar** — persistent toolbar row (🔌 Hardware · 🗂️ Namespace · 🧩 Workshop · 📝 Code · ⚙️ Simulator · 🚀 Deploy) with Church Gold active state; hides labels ≤860 px, hides entirely ≤520 px; active state tracked by `switchView()`.
- **NS three-tier display** — `updateNamespace()` now injects coloured tier separator rows: 🔒 Hardware (slots 0–5, red, hardwired at design time), 🥾 Boot (slots 6–10, amber, from boot image), ✏️ Programmer (slots 11+, blue, runtime allocation). Each data row gains a matching tinted background.
- **Learning Mode (`?learn=1`)** — Learn hamburger section (Get Started / Tutorials / Docs / Reference / Mum Tunnel) is hidden by default; `?learn=1` adds `r1-learn-mode` to `<html>` and reveals it. Home hint updated to advertise both `?learn=1` and `?debug=1`.
- **Docs four-tab bar** — ISA Reference · Hardware Guide · CLOOMC++ Guide · API Reference shortcut buttons added above the docs sidebar; `switchDocsTab(tabId)` in `app-shell.js` sets active state and calls `openDocAnchor()` for the matching file.

### Fixes (T001 / T002 — stale data)

- `sync_guard.js` now emits `process.exit(1)` on error and prints `OK` on success (sync-guard-tests pass).
- `run-all-tests.sh` includes `check-ns-slot-annotations`.
- `tests/e2e/pet_name_persistence.spec.js` — `CATALOG_LABEL` updated to `"SelfTest"`.
- `tests/e2e/ns_ghost_entries.spec.js` — expected label map updated for slots 0–7.
- `tests/e2e/resident_lumps_tab.spec.js` — `?debug=1` added to `openResidentLumpsTab`.
- **Boot3 rename** — `server/lumps/LEDflash_v1.json` → `Boot3.json`; 5 sidecar fields corrected; `manifest.json` token `00000600` abstraction set to `"Boot3"`; `abstractions.js` / `system_abstractions.js` updated; `_nsLabels` boot-tier map corrected.

### Files changed

`simulator/index.html`, `simulator/app-shell.js`, `simulator/app-memory.js`, `simulator/styles-toolbar.css` (new `.core-nav-bar` block), `simulator/styles-landing.css` (new), `simulator/styles-dashboard.css` (NS tier CSS), `simulator/styles-lumps.css` (docs tab CSS + `docs-layout` height fix), `server/lumps/Boot3.json` (renamed from `LEDflash_v1.json`), `server/lumps/manifest.json`, `simulator/abstractions.js`, `simulator/system_abstractions.js`, `scripts/sync_guard.js`, `scripts/run-all-tests.sh`, three e2e spec files.

### Version tags bumped

`app-shell.js` → `?v=20260708b`, `styles-toolbar.css` → `?v=20260708b`, `styles-dashboard.css` → `?v=20260708b`, `styles-lumps.css` → `?v=20260708b`.

---

## v2.0 ISA opcode-staleness sweep across `server/lumps/` (37 of 108 lumps carried pre-v2.0 opcodes 10–19)

A reusable audit found that 37 of the 108 binaries in `server/lumps/` still encoded
Turing-block opcodes in the old `10–19` range from before the v2.0 ISA renumbering
to `16–25` (see `.agents/memory/v2-format-audit.md` and the PostFlashSelfTest
incident above, which surfaced the first instance of this class of bug).

- **Audit tool (new, reusable):** `scripts/audit_stale_isa_lumps.js` disassembles
  every `.lump` in `server/lumps/`, flags any word whose top-5-bit opcode falls in
  `[10,19]`, and classifies each stale lump as **live** (referenced by a boot slot,
  manifest entry, or app code) or **orphaned** (no live reference — dead weight).
  Run it any time a future ISA renumbering is suspected to have left stale binaries
  behind.
- **`00000600.lump` (active Boot.Abstr save-state) investigated first:** 15 of 17
  words were stale. Rather than patch a save-state binary in place, it was deleted
  outright — `server/boot_image.py`'s loader already falls back safely to a fresh,
  correct trivial 3-word default when no saved Boot.Abstr lump is present, so
  deletion is strictly safer than resurrecting a stale save.
- **24 live-stale lumps fixed:**
  - 2 recompiled from source via `scripts/update-lump.js`: `13ade9a4` (LedControl),
    `4ea370af` (NoteGAssembly) — both had CLOOMC++ sources `update-lump.js` could
    assemble directly.
  - 22 fixed via a new mechanical remap tool, `scripts/remap_stale_isa_opcodes.js`,
    which adds +6 to the top-5-bit opcode of every code word (`word[1..cw]`) whose
    opcode falls in `[10,19]`, leaving c-list/header/all other bits untouched:
    `SlideRule`, `SlideRule (Haskell)`, `Tunnel` (×2), `Keystone` (×2), `Ethernet`,
    `Salvation`, `GT-test`, `selftest-v1.1`, `LED` (×2), `Constants`,
    `EventRouter`, `CapabilityTest`, `NoteGPublishedBug`, `NoteG_v6`,
    `EnglishLoops`, `IntegerOps`, `BernoulliNumbers`, `WordString`, `StringOps`.
    Validated safe via disassembly spot-checks (coherent instruction sequences
    post-remap, including on lumps that were 90%+ stale, e.g. `SlideRule` at
    2602/2652 words, `selftest-v1.1` at ~77%). `update-lump.js` could not recompile
    these because it lacks multi-front-end language auto-detection and fails on
    hand-authored English/Symbolic-Math keyword syntax (`ABSTRACTION`, `PUBLIC`,
    `LET`, `CREATE`, `ADD`, `SET`) — a pre-existing gap in that tool, out of scope
    here.
- **13 orphaned-stale lumps deleted** (`.lump` + sidecar `.json` pairs), all
  superseded-version artifacts with zero live references: `00000600` (counted
  above), `0baf5e0e-v1`, `19d3e599-v1..v4`, `4ea370af-v1`, `5a93ce79-v1`,
  `95a651e7-v1..v4`, `NoteG_v5`.
- **Re-audit confirms 0 live-stale and 0 orphaned-stale lumps remain** (95 total
  lumps on disk after cleanup).
- **Verification:** `python -m pytest tests/lump/test_lump_consistency.py` — 316
  passed. `scripts/run-all-tests.sh --group boot --group lump --group simulator
  assembler-tests` — 19/22 suites passed. The 3 failing suites
  (`lump-binary-tests`, `lump-roundtrip`, `boot-image-matches-sim`) were
  investigated individually and confirmed **pre-existing and unrelated** to this
  sweep:
  - `boot-image-matches-sim`: GT-encoding format mismatches between Python
    `create_gt()` (old bit layout) and JS `createGT()` (v2.0 layout) — an
    explicitly out-of-scope, already-known issue (see
    `.agents/memory/boot-abstr-token-migration.md` Rule 3) — plus several tests
    that still hardcode the pre-migration fixture name `00000300.lump` instead of
    the current canonical `00000600.lump` (Boot.Abstr moved from NS slot 3 to
    slot 6 in an earlier task; those tests were never updated).
  - `lump-binary-tests` (`LLB-02f/g`, `LLB-RBA-0`): `LLB-02` is a fully synthetic
    zero-word HALT test with no lump-file dependency (pre-existing simulator
    HALT-dispatch bug, untouched by this sweep); `LLB-RBA-0` fails on the same
    stale `00000300.lump` fixture-naming issue described above.
  - `lump-roundtrip`: fully synthetic (`assembleLump()`-generated fixtures, no
    disk I/O) — a pre-existing CALL-dispatch bug in `simulator.js`, unrelated to
    any lump binary touched by this sweep.
- **No manifest/sidecar structural changes required** — the remap preserves word
  count, so `cw`/`cc`/`lump_size` were already consistent; the consistency gate
  (`tests/lump/test_lump_consistency.py`, rules R1–R11) passed without edits to
  `manifest.json` beyond the entries removed for deleted orphans.

---

## LUMP viewer shows `???` on every other line of PostFlashSelfTest's Run method (stale duplicate lump + dead hardcoded token)

The Content tab of the PostFlashSelfTest LUMP viewer showed `???` on alternating
lines of the `Run` method disassembly (e.g. `??? 0x7f08c00b  DR1 = DR1 + #11`),
while the surrounding lines were labeled `DREAD` even though their side
annotation read like a subtract (`DR0 = DR0 - DR0`).

- **Root cause:** the user was viewing an **orphaned, stale lump** — token
  `5e1f0081`, abstraction name `PostFlashSelfTest` (capital T) — assembled
  before the v2.0 ISA renumbered the Turing block from opcodes 10–19 to
  16–25 (see `.agents/memory/v2-format-audit.md`). Its raw bytecode still
  carries the *old* opcode values: old `IADD`=15 now falls in the new
  unassigned 10–15 gap → `???`; old `ISUB`=16 collides with the new
  opcode-16 mnemonic `DREAD` → silently mislabeled (correct operand math,
  wrong instruction name). `5e1f0081` was never touched by
  `scripts/build_selftest_lump.js` / `scripts/check_selftest_lump_stale.js`
  because those scripts match on the *current* abstraction name
  `PostFlashSelftest` (lowercase t) — a one-character casing mismatch let
  the old artifact sit undetected in `server/lumps/` and
  `server/lumps/manifest.json` since the lump described earlier in this file
  under "PostFlashSelfTest lump (token `5e1f0081`)".
- **Second, more severe bug found during investigation:** the Dashboard's
  "Run Selftest" button (`runSelftestLump()` in `simulator/app-lumps.js`)
  and its "view LUMP" link (`simulator/app-memory.js`) were hardcoded to a
  *third*, no-longer-existent token, `82f5ef56` — `server/lumps/82f5ef56.lump`
  does not exist on disk at all, so the button 404'd. The canonical, current
  lump (verified byte-for-byte up to date against
  `simulator/examples/post_flash_selftest.cloomc` via
  `node scripts/check_selftest_lump_stale.js`) is token `2570eade`.
- **Fix:** deleted the orphaned `server/lumps/5e1f0081.lump` /
  `5e1f0081.json` and its `manifest.json` entry; repointed the three
  `82f5ef56` references (`app-lumps.js` ×2, `app-memory.js` ×1) to `2570eade`.
- **Verification:** disassembled all 1024 words of `2570eade.lump` with the
  current `simulator/assembler.js` — zero `???` results.
  `tests/lump/test_lump_consistency.py` (322 incl. new checks),
  `tests/simulator/test_selftest_lump_runs.py`, and
  `node scripts/check_selftest_lump_stale.js` all pass.

---

## Ti60 OBBS — Interface Designer reports `ERROR, unusupported device Ti60F225` (wrong `EFXPT_HOME`)

After the PYTHONPATH fix below, Interface Designer actually ran instead of silently no-op'ing — but then failed immediately with `ERROR, unusupported device Ti60F225 in Interface Designer` (the misspelling is Efinity's own), for a device name used consistently everywhere else in the repo (project XML, `peri.xml`'s `device_def="Ti60F225"`, and every other build script — including MAP synthesis, which succeeded).

- **Root cause:** `efx_run_pt_unified.py`'s device check calls `DeviceService.is_device_exists()`, which calls `get_device_map_file()`. That function reads `os.environ["EFXPT_HOME"]` and builds `"$EFXPT_HOME/db/devicemap.csv"`. The real file lives at `$EFINITY_HOME/pt/db/devicemap.csv` — confirmed present on the build host — but six of the seven OBBS scripts exported `EFXPT_HOME` as the *plain* Efinity root (e.g. `EFXPT_HOME="$EFINITY"`), missing the `/pt` suffix. With the wrong root, `os.path.exists(tmp_csv)` is `False`, `get_device_map_file()` silently returns `""`, and `is_device_exists()` always returns `False` regardless of whether the device is real — producing the bogus "unsupported device" error for a perfectly valid one. `hardware/soc_combined/build_and_flash.sh` already had the correct value (`EFXPT_HOME=$EFINITY_HOME/pt`), matching Efinity's own `bin/setup.sh` (`export EFXPT_HOME=$EFINITY_HOME/pt`) — confirming the fix and explaining why that one script never hit this bug.
- **Fix:** Corrected the `EFXPT_HOME` export in all six affected scripts to end in `/pt`: `run_efx_pnr.sh`, `run_efx_map.sh`, `run_full_build.sh`, `run_efx_pgm.sh`, `build_b4.sh`, `build_ti60.sh`. No Efinity source patching required — this is a plain repo-side environment-variable bug.
- **Tests:** `scripts/test_build_guard.sh` new Section I asserts every OBBS script that exports `EFXPT_HOME` ends the assignment in `/pt`. 102/102 assertions passing.
- **Docs:** `BUILD_SOC_CM.md` new Troubleshooting subsection documents the symptom, root cause, and fix.

---

## Ti60 OBBS — Interface Designer silently no-ops on missing `device` package (PYTHONPATH gap)

A real build (2026-07) passed Step -1 (all headless patches SKIP/OK, per the P1-optional fix below) but then Step 0 (Interface Designer) produced an empty `interface.log`, exited 0, and never wrote `.interface.csv` — no crash, no traceback, nothing actionable in the logs.

- **Root cause:** `efx_run_pt_unified.py` (in `$EFINITY_HOME/scripts/`) does `from device.service import DeviceService`, but the `device` package physically lives under `$EFINITY_HOME/pt/bin/device/`, not alongside `efx_run_pt_unified.py`. This OBBS deliberately never sources Efinity's own `bin/setup.sh` (it calls `exit` in non-interactive shells, which would kill the build script), so the `PYTHONPATH` entry `setup.sh` would normally provide is never set. The import then fails with `ModuleNotFoundError: No module named 'device'` — confirmed by reproducing it directly (`python3 -c "import efx_run_pt_unified"` from `$EFINITY_HOME/scripts/`). `efx_run.py`'s own code wraps that import in a bare `except ImportError`, logs a one-line warning to its log file only (not stdout/stderr), and returns as if the step succeeded — a genuinely new failure mode, distinct from the previously-documented "exits non-zero but still writes the CSV" pattern.
- **Fix:** `run_efx_pnr.sh` now exports `PYTHONPATH="$EFINITY/pt/bin${PYTHONPATH:+:$PYTHONPATH}"` alongside its other headless env vars (`EFINITY_USER_DIR_INI`, `EFXPT_HOME`), before Step 0 runs. No Efinity source patching required — this is a plain missing search path in an otherwise-complete install, not a broken/incomplete one.
- **Tests:** `scripts/test_build_guard.sh` new Section H statically asserts `run_efx_pnr.sh` exports this `PYTHONPATH` and that the export appears before the Interface Designer invocation. 95/95 assertions passing.
- **Docs:** `BUILD_SOC_CM.md` new Troubleshooting subsection "Interface Designer silently no-ops" documents the symptom, root cause, and fix.

---

## Ti60 OBBS — P1 headless patch made best-effort/optional (false hard-failure on a real build)

A real build (2026-07) hard-failed at `apply_efinity_headless_patches.py`'s P1 step with `ANCHOR_MISSING`, blocking the whole PnR run even though P2, P3, and P4-5 all succeeded.

- **Root cause:** P1's anchor (`for clkmux_inst in pll_reg.get_all_pll():`) assumed every Efinity 2026.1 sub-build has an unguarded PLL-registry loop in `clkmux_rule_adv.py`. Full-file evidence from the failing build showed this specific sub-build already null-checks `pll_reg`/`checker.design.pll_reg` on every PLL-related code path (`ClkMuxRulePLLMultConnection.check()`, `check_dyn_mux_input_pll_outclk()`, etc.) — the crash P1 exists to prevent cannot occur there, so there was nothing to patch, but the script still treated the missing anchor as a fatal error.
- **Fix:** added a `required` flag to the `Patch` class (default `True`). P1 is now `required=False`, matching the existing best-effort P6: when its anchor is absent, `apply()` prints `SKIP` (not `FAIL`) and returns success, and `check()` treats `ANCHOR_MISSING` as OK. P2, P3, and P4-5 remain required — a missing anchor there still hard-fails and names the file, since those crash paths are still order-of-execution accurate on the machines seen so far.
- **Tests:** `scripts/test_build_guard.sh` Section G — G3 now simulates version drift on a *required* patch (P2/`clock_rule_adv.py`) to prove hard-failure still works; new G3b simulates a missing anchor on optional P1 and asserts exit 0, a `SKIP` message, and that the other required patches still apply. 92/92 assertions passing.
- **Docs:** `BUILD_SOC_CM.md`'s patch section updated to state P2/P3/P4-5 are required while P1/P6 are best-effort/optional.

---

## Ti60 OBBS — Interface Designer silently fails headless (missing Efinity source patches)

After the INIT_0 guard fix, MAP synthesis passed cleanly, but Place & Route's Step 0 (Interface Designer) then failed: `ERROR: Interface Designer did not produce .../church_soc_cm.interface.csv — cannot proceed.` — with no further detail, because `build_ti60_bitstream.sh` pipes `run_efx_pnr.sh`'s output through `tail -8`.

- **Root cause:** PT Unified's `check_design()` validates HSIO GPIO clock rules that crash headless (PLL/OSC registries are never populated without a GUI session) before Interface Designer ever writes the `.interface.csv`. `hardware/soc_combined/BUILD_SOC_CM.md` already documented the 5 required Efinity-installation patches, but only as manual copy-paste Python snippets hardcoded to `/home/sipantichijk/efinity/2026.1/...` — a different machine/user than the current build host (`root@...`, `$HOME` = `/root`), so even a careful manual run would silently touch nothing.
- **Fix — automated, idempotent patcher:** new `scripts/apply_efinity_headless_patches.py` resolves the Efinity install root the same way every other OBBS script does (`$EFINITY_HOME` else `~/efinity/2026.1`, or `--root` for tests), applies the 5 patches with sentinel-based idempotency (`church-headless-patch-v1`) and `py_compile` verification with automatic rollback on failure, and hard-fails naming the exact file if an anchor no longer matches (signals Efinity version drift instead of a silent no-op). Also includes best-effort optional P6 (`efx_run_pt_unified.py`'s post-design-check `return PTFlowRunnerStatusCode.ERROR`), applied only when unambiguous.
- **Corrected a latent doc bug:** the doc's own Patch 4 used an `if True:` bypass that never actually calls `check_design()` at all, leaving IO config state unpopulated and producing a structurally incomplete LPF (see `.agents/memory/ti60-headless-lpf.md`, already disproven in an earlier incident). The new patcher implements the correct version: call `check_design()`, swallow the exception, then always proceed to `__gen_report`/`__gen_constraint`.
- **Fix — wired into the pipeline, not just documented:** `run_efx_pnr.sh` now runs `apply_efinity_headless_patches.py --apply` as Step -1, before Interface Designer, on every invocation (self-healing, safe to re-run).
- **Fix — diagnostics survive truncation:** `run_efx_pnr.sh`'s Interface Designer failure path now dumps a grep digest (`error|fail|exception|traceback`) of `outflow/interface.log` before exiting; `build_ti60_bitstream.sh`'s Step 4 tail was widened from `tail -8` to `tail -30` so that digest is no longer swallowed — closing the exact "please paste the log" round-trip described in the "Self-diagnosing build output" entry below.
- **Tests:** `scripts/test_build_guard.sh` Section G (16 assertions: virgin apply, idempotent re-apply with checksum comparison, simulated version-drift anchor failure, `--check` mode both states, mixed pre-patched state) exercises the patcher against a synthetic fixture tree — no real Efinity installation required. 88/88 assertions passing.
- **Doc cleanup:** `BUILD_SOC_CM.md`'s "5 one-time patches" section now points at the script instead of hardcoded manual snippets; all `/home/sipantichijk/...` paths in that section removed.

---

## Ti60 OBBS — INIT_0 guard blind to Efinity 2026.1 netlist format

`check_bram_init_zero.sh` (the post-MAP guard that aborts before Place & Route if the Sapphire firmware BRAM was synthesised with all-zero content) went blind the moment `run_efx_map.sh` was pointed at Efinity 2026.1 for synthesis: it reported `could not parse INIT_0 value` for all four lanes and failed the build even when `patch_sapphire_init.py` had run correctly and the firmware WAS embedded.

- **Root cause:** the guard's regex only understood one INIT_0 shape — a quoted hex string, e.g. `INIT_0("0000...")` — which is how older Efinity map.v output represented BRAM initial content. Efinity 2026.1's `efx_map` emits a `verific`-generated netlist where the same attribute appears unquoted, as a sized Verilog literal inside a long inline comment: `/* verific EFX_ATTRIBUTE_CELL_NAME=EFX_RAM10, ..., INIT_0=256'h0000... */`. The old regex found no quoted hex substring in that comment and reported every lane as unparseable, which the guard (correctly, given what it could see) treated as a failure.
- **Fix:** `check_bram_init_zero.sh` now tries the legacy quoted-string format first, then falls back to parsing the unquoted `<width>'<radix><digits>` Verilog literal format (`'h`, `'b`, `'o`), stripping the radix prefix before checking for all-zero. Both formats are covered by synthetic fixtures in `scripts/test_build_guard.sh` Section B (69 assertions total across all guards).
- **Lesson:** an Efinity toolchain version bump can silently change netlist *comment* syntax, not just command-line behavior — see `.agents/memory/efinity-version-split.md`. Any guard that greps synthesis output for attribute values should be format-tolerant or explicitly re-validated against a fresh sample after every Efinity version change, not just re-run.

---

## Ti60 OBBS (One-Build-Bitstream-Script) Consolidation

Root-caused and fixed the v2.3-vs-v2.4 stale-firmware-banner incident plus a callhome bridge JSON-concat bug on serial reconnect. There is now exactly ONE canonical build pipeline and ONE firmware build location, with self-tests that catch stale data at each step instead of only surfacing as a wrong version string on a physical board.

- **Root cause:** `run_efx_map.sh` used to rebuild firmware a second time from an untracked `$SOC_DIR/firmware` copy, silently overwriting the correctly-patched `sapphire.v` that `build_ti60_bitstream.sh` had just deployed — two firmware build locations, one of them stale.
- **Fix — single build location:** `build_ti60_bitstream.sh` now rsyncs (`--delete`) the repo firmware sources into `$SOC_DIR/firmware` as an explicit step, verified byte-identical with `scripts/check_firmware_sha_sync.sh`. `run_efx_map.sh` no longer rebuilds or re-patches firmware — Step 0a is a read-only freshness self-test only, and hard-fails (`exit 1`) on direct invocation unless called via the OBBS (`_OBBS_RUN=1`/`ALLOW_DIRECT=1`).
- **Fix — single pipeline:** `run_full_build.sh` is now a thin wrapper (tmux session, git pull, Efinity env, confirm prompt) that delegates the entire MAP/PNR/PGM sequence to `build_ti60_bitstream.sh`. Legacy hex filename `church_soc_cm.hex` is still written alongside `church_ti60_f225.hex` for backward compatibility with `flash_and_monitor.sh` and `server/app.py`.
- **Fix — banner can no longer drift from source:** the boot banner in `hardware/soc_combined/firmware/main.c` used to be a hardcoded `"CHURCH Ti60 SoC+CM v2.4\r\n"` literal, independent of the `FW_MAJOR`/`FW_MINOR` `#define`s used everywhere else (including the CALLHOME JSON) — the exact root cause of the incident. It is now emitted digit-by-digit from `FW_MAJOR`/`FW_MINOR` at runtime, so the two can never disagree again.
- **Fix — callhome bridge reconnect bug:** `callhome_bridge.py::_reader_thread()` now discards its partial read buffer on `SerialException` before reconnecting, so a truncated line from before a USB drop can no longer concatenate with post-reconnect data and fail JSON parsing.
- **New self-tests (all runnable without real FPGA hardware — synthetic fixtures only):**
  - `scripts/check_firmware_sha_sync.sh` — sha256-compares `$SOC_DIR/firmware` against the repo firmware dir; catches drift, missing files, and stray files.
  - `scripts/check_fw_banner_matches_defines.sh` — fails if a hardcoded literal banner version ever disagrees with `FW_MAJOR`/`FW_MINOR` again.
  - `scripts/check_sapphire_symbol_bins_fresh.sh` — sha256-compares the four Sapphire ROM `$readmemb` symbol bins in `$SOC_DIR/work_syn/` against the freshly-built repo copies. EFX_MAP resolves `$readmemb` bare filenames relative to `--work_dir` (`work_syn/`), not the project root — a stale/missing bin there is invisible to every other guard (sapphire.v itself still looks correctly patched). `build_ti60_bitstream.sh` deploys the bins into `work_syn/` right after patching sapphire.v and runs this guard immediately after; `run_efx_map.sh` Step 0a re-checks it read-only before MAP starts.
  - `scripts/test_ti60_uart.py --expect-fw=MAJ.MIN` — physical-hardware smoke test now asserts the board's CALLHOME-reported firmware version against the version that was just built; `build_ti60_bitstream.sh`'s `--flash` step passes this automatically.
  - `scripts/test_callhome_bridge_reconnect.py` — regression test for the reconnect JSON-concat bug.
  - Fixtures for all three new guards live in `scripts/test_build_guard.sh` (Sections C, D, and E); all registered in `scripts/run-all-tests.sh` under the `checks` group.
- **Follow-up fix — CM DMEM BRAM double-patch bug (same bug class):** `run_efx_map.sh` Step 0b unconditionally called the legacy `patch_cm_bram.py` ($readmemb byte-lane technique, confirmed broken on Efinity 2026.1) *after* `build_ti60_bitstream.sh` Step 2.5 had already patched the same file with the newer, correct `gen_cm_dmem_direct.py` (explicit `cm_dmem_bram` EFX_RAM10 instantiation). `patch_cm_bram.py`'s "already patched" sentinel is a bare `'readmemb' in src` substring check that false-positived on a comment `gen_cm_dmem_direct.py` leaves behind, then crashed (`cannot parse depth`) trying to find `dmem_b0` declarations that no longer existed. Fixed the same way as the banner incident: Step 0b is now a read-only self-test (`scripts/check_cm_dmem_bram_fresh.sh`), not a second patch call. New guard has 6 fixtures in `scripts/test_build_guard.sh` Section F. See `.agents/memory/obbs-single-patch-location.md` for the general bug-class writeup.
- **Follow-up fix — sapphire.v patch guard false-positive (mtime-vs-content mismatch):** `check_sapphire_patch_fresh.sh` used to compare `mtime(sapphire.v)` against every firmware `.c`/`.h` file. But `patch_sapphire_init.py`'s `$readmemb` block only ever references *bare filenames* (never firmware bytes), so the block text is byte-identical across every rebuild — `patch_sapphire_init.py` correctly no-ops once already patched and never touches `sapphire.v`'s mtime again. Any later, unrelated mtime bump on a firmware source (git pull, touch, clock skew) then made the guard report `GUARD FAIL: sapphire.v patch is stale` forever, even though the content was 100% correct — blocking every build after the first. Fixed by making the guard content-based: it now checks that `sapphire.v` contains the canonical bare-filename `$readmemb` call for all 4 `ram_symbol0..3` lanes, instead of comparing timestamps. Call sites (`build_ti60_bitstream.sh`, `run_efx_map.sh` Step 0a) now pass only `<sapphire.v>` (firmware-dir argument dropped — no longer needed). `scripts/test_build_guard.sh` Section A rewritten with virgin/stub/partial/fully-patched fixtures (7 assertions), including a regression test proving a newer firmware mtime no longer breaks a correctly-patched file.
- **Fix — MAP synthesis KeyError on fresh droplets:** `run_efx_map.sh` invokes `efx_run.py --flow map`, which raises `An exception occurred: 'EFINITY_USER_DIR_INI'` on headless servers unless that var (and `EFXPT_HOME`) is exported — `run_efx_pnr.sh`/`run_efx_pgm.sh` already exported it, `run_efx_map.sh` never did. Fixed by adding the same export there. See `.agents/memory/efinity-headless-pnr.md`.
- **Follow-up fix — same KeyError still fires after export, PLUS a hidden stale-VDB bug (two bugs, one error message):** exporting the var did not stop the crash — synthesis logs proved `efx_run.py --flow map` raises the identical `EFINITY_USER_DIR_INI` KeyError from an internal cleanup path *after* `map : PASS` and after `outflow/<circuit>.vdb` is already written (same tolerated-crash class as the Interface Designer step in `run_efx_pnr.sh`). `run_efx_map.sh` now checks for a freshly-written VDB instead of trusting `efx_run.py`'s exit code, and only hard-fails (dumping the synthesis log tail) if no fresh VDB exists. Separately, `run_efx_pnr.sh` was passing `--vdb_file top.vdb` — a stale, unrelated file left over from a disproven older assumption that `efx_run.py` couldn't run headless at all — instead of the `outflow/<circuit>.vdb` that MAP actually produces; PnR would have silently packed an old netlist. Fixed by pointing `run_efx_pnr.sh` at `outflow/<circuit>.vdb` with an explicit existence check before Place & Route runs.
- **Self-diagnosing build output (closing the remote-debug loop):** the recurring pain point across all these OBBS incidents was diagnosing failures on a remote build machine (`root@ubuntu-...`) with no direct access — every round of debugging cost a full back-and-forth of "please run this and paste the output." Two changes remove that cost going forward: (1) `build_ti60_bitstream.sh` now prints the exact commit hash/date (and flags local uncommitted changes to the build scripts) in its banner on every run, so "did you pull the fix?" is answered by the output itself, never a follow-up question; (2) `check_sapphire_patch_fresh.sh`'s failure output now dumps the actual `ram_symbol*` lines it found in `sapphire.v` (or notes if none exist at all) directly in the terminal, so a single pasted failure is self-diagnosing instead of requiring a second round-trip to inspect the file. General principle for future guards: a failing check should always print enough of the actual vs. expected state to diagnose from the failure message alone.

---

## Scheduler Interrupt & Three-Tier Fault Recovery (Task #1077)

Simulation-only (no FPGA hardware). Implemented in JS simulator files only.

- **Structured fault record:** `fault()` now populates `faultCode`, `faultingMnemonic`, `involvedGT`, `pipelineStage`, `faultingAbstractionSlot`, `faultingAbstractionLabel`, `tier`, `catchInvoked`, `irqInvoked`, `tier3Recovery` on every fault entry.
- **Three-tier recovery:** `fault()` attempts Tier 1 (`.catch` method on faulting NS slot), Tier 2 (`Scheduler.IRQ` via `_fireSchedulerIRQ`), Tier 3 (double-fault `→ _returnToBoot`) before halting. Default behaviour (halt) preserved when no handlers are registered.
- **Scheduler.pause:** New method (index 4) arms `irqState.timerArmed/timerDeadline`; suspends calling thread.
- **Scheduler.IRQ:** New method (index 5, NS slot 8). Hidden ELOADCALL — wakes sleeping threads on TIMER fire or attempts fault recovery on FAULT escalation.
- **Timer check in step():** Before each instruction fetch, if `bootComplete && timerArmed && !irqActive && stepCount >= timerDeadline`, a hidden Scheduler.IRQ is injected.
- **NS slot 50:** `Scheduler.IRQ.Thread` — fixed boot-image slot for the IRQ thread.
- **ChurchSimulator static constants:** `FAULT_CODES`, `SCHEDULER_NS_SLOT=8`, `SCHEDULER_IRQ_NS_SLOT=50`.
- **Fault Popup:** Recovery section added — shows tier, .catch/IRQ invocation, HW code, mnemonic, pipeline stage, GT.
- **Tests:** `simulator/test_fault_recovery.js` — 6 suites, 38 assertions covering all three tiers, pause, and flag-set wake.
- **Docs:** `docs/instruction-set.md` Section "Three-Tier Fault Recovery"; `docs/isa_reference.md` Section 9.

---

## LUMP Spec — Builder ZIP Downloads (2026-05-15)

Build log listings now match ZIP contents exactly for all 3 boards (Ti60, Wukong, Tang Nano): stale `.edif` removed from the Ti60 log; `local_bridge.py` added to Wukong and Tang Nano logs; `.v`/`.json` marked conditional for Tang Nano; file-icon map expanded; new zip-contents pytest suite (5 tests).

---

## Release 1.3 — 2026-05-16

### GT format — dom+perm3 compression, f_flag per-token, TPERM EXACT

- **GT bit layout** — compressed 6-bit logical perms (`perms[5:0]`) into 4 bits using
  Turing/Church mutual exclusion: `dom[27]` (0=Turing, 1=Church) + `perm[30:28]` (3-bit payload).
  Freed bits allocated to `f_flag[25]` (Far indicator, per-token) and `spare[26]` (reserved zero).
  Old hardcoded word `0x40800002` → `0x48800002` (`dom=1`, Church E-perm).
- **TPERM EXACT** (preset 14) — bit-exact 32-bit identity check: `CRd.word0 == CRs.word0`.
  Sets Z=1 on match, Z=0 on mismatch. Never faults — pure comparison operator for credential
  pinning. Documented in `docs/instruction-set.md` and `docs/isa_reference.md`.
- **NS Word 1 f_flag removed** — `packNSWord1` / `writeNSEntry` / `packLimitWord` in
  `simulator/simulator.js` no longer carry or set the f_flag bit (bit[30]); it is now
  permanently reserved (always 0) in NS Word 1, matching hardware `ctmm_cap_amaranth/layouts.py`
  (`reserved: unsigned(13)` absorbing the former f_flag). Per-token f_flag lives exclusively
  in the GT word at bit[25].
- **Files changed**: `hardware/layouts.py`, `hardware/hw_types.py`, `hardware/boot_rom.py`,
  `hardware/core.py`, `hardware/perm_check.py`, `ctmm_cap_amaranth/layouts.py`,
  `ctmm_cap_amaranth/types.py`, `ctmm_cap_amaranth/perm_check.py`, `ctmm_cap_amaranth/tperm.py`,
  `simulator/simulator.js`, `server/boot_image.py`, `docs/golden-tokens.md`,
  `docs/isa_reference.md`, `docs/instruction-set.md`, `docs/ctmm-memory-map.md`,
  `docs/cloomc-foundation.md`.

### Ethernet abstraction — NS slot 51 added to boot catalog

- **Boot fault fixed**: `INIT_ABSTR mLoad(Ethernet) failed: namespace index 51 out of bounds`.
  Ethernet (token `00003300`, ns_slot 51, static) was present in `manifest.json` but absent from
  `DEFAULT_ABSTRACTION_CATALOG` in `server/boot_image.py` and `_getAbstractionCatalog()` in
  `simulator/simulator.js`. The boot image therefore allocated only 51 NS entries (slots 0–50),
  making slot 51 unreachable.
- **Fix**: added `("Ethernet", {E:1}, False)` at index 51 of `DEFAULT_ABSTRACTION_CATALOG`
  (`server/boot_image.py`; assert updated 51→52) and the matching entry
  `{ label: 'Ethernet', perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false }` at position 51
  of `_getAbstractionCatalog()` (`simulator/simulator.js`). Boot image now allocates 52 NS
  entries (slots 0–51); nsCount = 52 on load.
- **All test suites remain green**: assembler-tests 913/913, boot-image-matches-sim 6/6,
  fault-recovery-tests 192/192, lump-consistency 126/126, e2e-tests 19/19,
  hardware-sim ALL PASSED.

### PostFlashSelfTest lump (token `5e1f0081`)

- **New floating lump**: `server/lumps/5e1f0081.lump` — 1024-word lump packaging all 81
  post-flash hardware self-tests (Sections A–L of `simulator/examples/post_flash_selftest.cloomc`).
  Token `5e1f0081`, `ns_slot: null`, `ns_slot_policy: "dynamic"`, `cw=512`, `cc=8`.
- **C-list**: slot 3 = E-GT (`0x48810000`, Church dom=1 E-perm), slot 7 = X-GT (`0x40810000`,
  Turing dom=0 X-perm). Matches `LOAD CR2, CR6, 3` and `LOAD CR1, CR6, 7` in the assembly.
- **Method**: `Run()` (offset 0, length 512 words). Returns DR0=0 on full pass; DR0=N (1–81)
  identifies first failing test.
- **Sidecar**: `server/lumps/5e1f0081.json`. Manifest entry added to `server/lumps/manifest.json`.
- **Consistency gate**: lump-consistency 126/126 passed (R1–R12 including the new token).

### Service abstraction c-lists (Task #971)

- **Single-authority model encoded in boot image**: 14 service abstractions (Salvation, Navana,
  Mint, Memory, Scheduler, Stack, DijkstraFlag, Display, Abacus, GC, Thread, Billing,
  TuringMemory, ChurchMemory) now have valid lump headers (`cw=0`, `cc>0`) and correctly
  populated c-list GT tails written into the boot image at cold-boot time.
- **`SERVICE_CLIST_DEFS` table** added to `server/boot_image.py` (line 230) — maps each
  service slot to its POLA-minimum list of capability descriptors (Inform GTs or Abstract GTs).
  `generate_boot_image()` iterates the table after the NS-loop, writes each lump header + c-list
  tail, and corrects NS entry `word1` (`lim17 = lump_size − cc − 1`) and `word2` (seal).
- **Mirrored in `simulator/simulator.js`** `_initNamespaceTable()` — parallel
  `SERVICE_CLIST_DEFS` array at line 1198 uses the same format; applied after the main NS loop
  and Boot.Abstr setup.
- **Authority hierarchy**: Navana (5) sole NS writer — holds R|W token to namespace lump;
  Memory (7) sole physical allocator — calls GC (44) under pressure; Mint (6) sole GT lifecycle
  manager — delegates NS writes to Navana. All other service abstractions reach these three
  exclusively through E-calls.
- **`server/lumps/boot-image.bin` regenerated** to reflect all new c-lists.
- **Files changed**: `server/boot_image.py`, `simulator/simulator.js`,
  `server/lumps/boot-image.bin`.
- **All tests green**: boot-image-matches-sim 6/6, boot-image-loads-and-boots 5/5,
  lump-consistency 299/299, e2e-tests 44/44.

### Keystone lump cc fix (token `50789581`)

- **Dual-file drift corrected**: `server/lumps/50789581.lump` had `cc=0` in its binary header
  (word[0] = `0xF8005800`) while the address-named reference copy `00002000.lump` correctly
  has `cc=2`. This caused the lump viewer CC chip to display `0` for Keystone despite the
  sidecar and manifest recording `cc=2`.
- **Fix**: updated `50789581.lump` binary word[0] from `0xF8005800` → `0xF8005802` (cc: 0→2);
  updated `50789581.json` sidecar `cc: 0 → 2`; updated `manifest.json` entry for token
  `50789581` `cc: 0 → 2`.
- **Files changed**: `server/lumps/50789581.lump`, `server/lumps/50789581.json`,
  `server/lumps/manifest.json`.
- **Consistency gate**: lump-consistency 299/299 passed including R5/R6 three-way cw/cc/lump_size
  agreement for token `50789581`.

---

## Docs 1.2.1 — 2026-05-20

### TPERM documentation correction pass (Release 1.2 definitive design)

Documentation-only correction across four files to match the definitive
Release 1.2 TPERM preset table encoded in `hardware/hw_types.py`.

**Changes**:

- `docs/instruction-matrix.md` — TPERM verification bullet rewritten: codes
  10–12 now described as unconditionally reserved (RSV3/RSV4/RSV5,
  FAULT `TPERM_RSV`); code 13 = FRAME; code 14 = EXACT; code 15 = RSV1.
  Preset table rows 10–15 updated with correct names and rationale.
  B-modifier hardware gap noted in the bullet.

- `docs/instruction-set.md` — Faulting paragraph corrected from
  "codes 11–12 and 15" to "codes 10–12 and 15". Preset table rows 10/11/12
  renamed from LE/SE/LSE to RSV3/RSV4/RSV5. "E isolation" explanatory
  paragraph rewritten: the isolation rule is a **GT creation** rule (enforced
  by Mint and domain-purity checks), not a TPERM preset rule; the former
  LE/SE/LSE names were a design-history artefact.

- `docs/church-instructions.md` — Faulting paragraph corrected from
  "codes 11–15" to "codes 10–12 and 15". B-modifier hardware gap note added:
  bit 4 of the preset field is recognised by the assembler and simulator but
  the hardware decoder currently reads only 4 bits — B-modifier clears the
  GT B-bit in software only until the field is widened to silicon.

- `docs/isa_reference.md` (section A.7) — Rows 0x0A / 0x0B / 0x0C renamed
  from "— (E isolation: LE/SE/LSE)" to RSV3/RSV4/RSV5 with description
  "unconditionally reserved".

No code, binary, or test changes.

---

## Docs 1.2 — 2026-05-15

### Documentation corrections (audit items H-2 and M-1)

- **H-2 — Max lump size** (`docs/Lump-Architecture.md`): corrected Release 1
  maximum from n ≤ 14 (16 384 words) to **n ≤ 13 (8 192 words)**, matching
  `MAX_EXP = 13` in `simulator/app-lump-editor.js`. n = 14 is now explicitly
  noted as architecturally reserved. Mint validation gate updated accordingly
  (`n-6 ≤ 7`). Boot.NS (n = 14, pre-synthesised system lump) separated into
  its own table as a system-level exception not subject to the user size gate.
- **M-1 — mLoad step count** (`replit.md`, `docs/mload.md`): removed the
  "8-step" fixed step count from `replit.md`; replaced with a functional
  description. Added a supersession note to `docs/mload.md` stating that the
  Release 1 PDF `ctmm-r1-10-mload.pdf` title "Five-step capability validation
  pipeline" is superseded — no specific step count is part of the architecture
  definition.

---

## Release 1.2 — 2026-05-14

### Summary

NS table integrity fix. Removes illegal pool NS entries (slots 50-63) written
by a previous task agent, rewrites Constants.Add() to return a plain data value
(not a malformed GT), adds Constants.Get(), and introduces AbstractGTManager as
the correct home for Abstract GT lifecycle tracking.

### Foundational rules enforced

1. NS table is **only** for Inform (gtType=1) and Outform (gtType=2) abstractions.
2. GTs live in c-lists (CRs at runtime, lump c-list area at rest). Never in the NS table.
3. Abstract GT pool memory is internal to AbstractGTManager; no NS entries pierce it.
4. `writeNSEntry()` now rejects gtType=3 (Abstract GT) with a hard fault.

### Changes

#### Simulator JS (scope: no FPGA binaries touched)

| File | Change |
|---|---|
| `simulator/boot_uploads.js` | Removed `pool-W` capability from Constants c-list boot entry; added `Get` method stub |
| `simulator/simulator.js` | Removed pool block from `lazyLoad()` that wrote NS slots 50-63; added `writeNSEntry()` guard (rejects gtType=3); Node.js shim for `AbstractGTManager`; instantiates `abstractGTManager` in constructor |
| `simulator/system_abstractions.js` | Rewrote `Constants.Add()` to Pi pattern (returns plain integer data value, not malformed GT); added `Constants.Get()` method |
| `simulator/app-run.js` | Fixed two import-path field defaults (undefined → 0); clamped localStorage restore to valid range |
| `simulator/app-lumps.js` | Updated pool display section for new Constants.Add/Get interface |
| `simulator/abstract_gt_manager.js` | **New file.** `AbstractGTManager` class — Map keyed by 7-bit `gt_seq`; `createAtoken`, `get`, `release`, `live`, `GC` methods; never touches NS table |

#### Metadata (00001200 / Constants)

| File | Change |
|---|---|
| `server/lumps/00001200.json` | `Add`/`Get` method descriptions updated; `pool_w`/`pool_ns_base`/`pool_size` fields removed; `cc` stays 2 (matches binary header — slot 1 is NULL GT after boot) |
| `server/lumps/manifest.json` | Same pool field removals; `Get` method entry added; `cc` stays 2 |

#### Documentation

| File | Change |
|---|---|
| `docs/plans/ns-table-integrity.md` | New plan doc — foundational rules, AbstractGTManager spec, all 9 fixes |

### Test results

| Suite | Before | After |
|---|---|---|
| lump-consistency | 106 passed | **106 passed** |
| assembler-tests | 862 passed | **862 passed** |
| boot-image-matches-sim | 6 passed | **6 passed** |
| boot-image-loads-and-boots | **5 failed** (pool wrote NS slot 50, pushing nsCount to 51) | **5 passed** |
| fault-recovery-tests | 192 passed | **192 passed** |

---

## Release 1.1 — 2026-05-03

### Summary

LUMP metadata integrity overhaul. Establishes automated consistency gate,
formalises the floating-lump concept as a first-class architectural pattern,
and introduces formal change control (this document).

### Changes

#### Metadata corrections

| File | Change |
|---|---|
| `manifest.json` — TestBoundary (00006000) | `cw` 0 → 1, `cc` 0 → 9 (was stale; binary had real code and 9 c-list slots) |
| `manifest.json` — TestLazy (00006100) | `cw` 0 → 1 (binary had a LOAD instruction) |
| `manifest.json` — TestConsistent (00006200) | `cw` 0 → 1, `cc` 0 → 1 (binary had real code + live LED Abstract GT in c-list) |
| `manifest.json` — TestInconsistent (00006300) | `cw` 0 → 1, `cc` 0 → 1 |
| `manifest.json` — WordString (ab1e86af) | `cw` 281 → 294 (manifest was 13 words behind the compiled binary) |
| `00006000.json` sidecar | `cw` 0 → 1, `cc` 0 → 9 |
| `00006100.json` sidecar | `cw` 0 → 1 |
| `00006200.json` sidecar | `cw` 0 → 1, `cc` 0 → 1 |
| `00006300.json` sidecar | `cw` 0 → 1, `cc` 0 → 1 |

#### File removals

| File | Reason |
|---|---|
| `server/lumps/00000003.json` | Orphan sidecar. Described a historical 256-word, cc=18 Boot.Abstr that no longer exists. No matching `.lump` on disk. Server already ignored it in favour of `00000300.json`. |

#### New sidecar files created

Six manifest entries had no per-lump `.json` sidecar. Sidecars created:
`00000c00.json` (LED), `00001000.json` (SlideRule), `00001001.json` (SlideRule (Haskell)),
`00001f00.json` (Tunnel), `00130000.json` (Loader), `00002000.json` (Keystone).

#### Schema additions (manifest.json)

| Field | Applies to | Meaning |
|---|---|---|
| `variant_group` | SlideRule, SlideRule (Haskell) | Both share `"variant_group": "sliderule"`. Two entries may claim the same `ns_slot` if and only if they share a non-null `variant_group`. The boot image installs exactly one at a time; the other is an alternative implementation. |
| `ns_slot_policy` | WordString | `"ns_slot_policy": "dynamic"` — formally declares the floating-lump pattern (see Architecture section below). |

#### Architecture: floating lumps formalised

A **floating lump** is a lump with `ns_slot: null` and `ns_slot_policy: "dynamic"`.
It has no fixed NS slot at boot. The Loader fetches its binary on first use,
Mint allocates an ephemeral NS slot, and the lump is installed there. The slot
number may differ between runs. The caller holds a GT — not a slot number —
so the slot's ephemerality is invisible to callers.

WordString (ab1e86af) is the prototype. Any abstraction that is not on the
cold-boot critical path should be a floating lump to conserve NS table space.

Slot-assignment rule (machine-enforceable):

| `ns_slot` | `ns_slot_policy` | Classification |
|---|---|---|
| integer | absent | Boot-resident — fixed slot, placed by boot image generator |
| `null` | `"dynamic"` | Floating — allocated by Mint on first use; may be evicted |
| `null` | absent | **Error** — caught by R9 in the consistency test |

#### Automated consistency gate

New test file: `tests/lump/test_lump_consistency.py`

Eleven rules enforced on every run:

| Rule | What it checks |
|---|---|
| R1 | Every `.lump` has valid header magic (0x1F) |
| R2 | File size in words == header-declared lump_size |
| R3 | Every `.lump` token has a manifest.json entry |
| R4 | No orphan sidecar `.json` without a matching `.lump` |
| R5 | manifest.cw / cc / lump_size == binary header |
| R6 | sidecar.cw / cc / lump_size == binary header |
| R7 | sidecar fields agree with manifest where both exist |
| R8 | No duplicate ns_slot values unless all claimants share a `variant_group` |
| R9 | ns_slot=null entries carry `ns_slot_policy: "dynamic"` |
| R10 | Every manifest entry with lump_size has a `.lump` file on disk |
| R11 | Every manifest entry with lump_size has a sidecar `.json` on disk |

#### Documentation updates

`docs/CM_LUMP_SPECIFICATION.md`, `docs/Lump-Architecture.md`, and
`docs/json-information.md` bumped from v1.0 to v1.1. Floating-lump concept
and updated schema fields added to all three.

---

## Release 1.0 — 2026-04-29

Initial documented release.

- Lump binary format specified: header word `[31:27]=magic [26:23]=n-6 [22:10]=cw [9:8]=typ [7:0]=cc`.
- manifest.json schema defined covering `token`, `abstraction`, `ns_slot`, `lump_size`, `cw`, `cc`, `methods`, `grants`, `capabilities`.
- Boot image generator (`server/boot_image.py`) producing 65 536-byte image with NS table at `memory.length - 0x400`.
- Boot-resident lumps: Boot.Abstr (NS[3]), LED (NS[12]), Constants (NS[18]), Loader (NS[19]), Tunnel (NS[31]), Keystone (NS[32]).
- Test lumps: TestBoundary (NS[96]), TestLazy (NS[97]), TestConsistent (NS[98]), TestInconsistent (NS[99]).
- WordString (ab1e86af) present in repository with `ns_slot: null` (undocumented floating pattern).
- Editor source persistence implemented (localStorage auto-save per NS slot).

---

## Change Control Rules — effective Release 1.1

The following rules apply to every commit touching a lump binary, manifest,
or sidecar from this release onwards. No exceptions.

### Rule 1 — Consistency gate must pass

`tests/lump/test_lump_consistency.py` must pass (all 11 rules, zero failures)
before any lump-related change is merged.

To run locally:
```bash
python -m pytest tests/lump/test_lump_consistency.py -v
```

### Rule 2 — Binary change requires metadata update

Any recompilation or hand-edit of a `.lump` binary that changes `cw`, `cc`,
or `lump_size` MUST be accompanied by:

1. An update to the matching `<token>.json` sidecar.
2. An update to the `manifest.json` entry for that token.
3. Both changes in the same commit as the binary.

### Rule 3 — New lump requires three files

Adding a new lump to the repository requires:

1. `<token>.lump` — the binary.
2. `<token>.json` — the sidecar (at minimum: token, abstraction, ns_slot or ns_slot_policy, lump_size, cw, cc, grants).
3. An entry in `manifest.json`.

If the lump is floating (no fixed boot slot), `ns_slot` must be `null` and
`ns_slot_policy` must be `"dynamic"`.

### Rule 4 — NS slot collision requires variant_group

If two lumps claim the same `ns_slot` (alternative implementations), both
entries MUST carry the same non-null `variant_group` string. The consistency
test (R8) enforces this.

### Rule 5 — CHANGELOG entry required

Every structural change — new lump, binary rebuild, schema field addition,
metadata correction — MUST add an entry to this file under the current
release heading before the change is considered complete.

### Rule 6 — Spec documents bump version

If a change affects the manifest schema, the lump header format, or the
floating-lump policy, the version line in the affected spec document
(`CM_LUMP_SPECIFICATION.md`, `Lump-Architecture.md`, `json-information.md`)
must be bumped to the new release number.
