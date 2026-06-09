# Church Machine Educational Platform

## Overview
The Church Machine is an educational platform providing a web-based IDE for learning programming, computer architecture, and secure computing using capability-based security with Golden Tokens. It targets the Tang Nano 20K FPGA and supports the Efinix Ti60 F225 and QMTECH Wukong Artix-7 XC7A100T, aiming to make advanced computational concepts accessible to children and various educational contexts through hands-on experience. The project envisions a future where capability-secured processor architectures become mainstream, making this platform a foundational tool for training future developers in secure computing.

## User Preferences
- **Core design principle**: Every improvement must logically abstract implementation details — hide complexity, expose only what matters, make the system easy to understand and use. Raw technical values (addresses, hex words, register numbers) should always be translated into human-readable pet names, labels, or plain-English descriptions wherever they appear in the UI.
- Church Gold dark theme
- Mobile-responsive for parent mode on handsets
- All feature flags True for Tang build
- No separate dynamicObjects — all entries in namespaceObjects
- B (Bind) bit defaults to 0, auto-cleared by CALL
- C-Lists only have E permission, CLOOMC only X or RX
- Phase 1 + 1b + 1c + 1d + 1e: English, JS, Haskell, Symbolic Math (Ada), and Lambda Calculus front-ends implemented; auto-detected by compiler
- Pure Math "Compile Session" button: compiles interactive let-bindings to Church Machine code via symbolic math front-end

## Key Terminology

- **CM** — Church Machine. The Lambda Calculus core of the Church Machine. The hardware execution engine that enforces capability-based security through Golden Tokens.
- **CLOOMC** — Capability-Limited / Object-Oriented / Machine-Code. The assembly language and compiler target for the Church Machine ISA. Source files use the `.cloomc` extension.

## System Architecture
The system integrates an Amaranth HDL-based FPGA hardware with a web IDE (HTML/JS/CSS) and a Flask backend.

**Authoritative Architectural Overview:** `docs/cloomc-foundation.md` is the single document explaining the CLOOMC ISA, the PP250 heritage, the capability model, the reliability model, the Trusted Security Base principle, memory architecture decisions (hardware-forced vs programmer choices vs natural consequences), the old 6-region boot layout and its problems, the 3-LUMP starter kit, and per-board profiles (Ti60 F225 vs XC7A100T). Read this document first when working on the boot image, the memory map, or the ISA.

**UI/UX Decisions:**
The web IDE features ten interactive views (Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Builder, Docs). It includes educational tools like Pure Math calculator, HP-35 Calculator, Abacus, and Slide Rule, all with Church Machine trace. Learning aids comprise a "Math Challenge" sidebar, "History Tab," "Syntax Tab," and a "Visual Namespace Builder" for drag-and-drop deployment topology design. Documentation is presented as an interactive book with educational popups and a global CSS tooltip system. The design is responsive, and editor state, settings, and progress are persisted via localStorage.

**Technical Implementations:**
The architecture uses a scale-free abstraction model with 47 abstractions in 9 layers for security. Capability-based security is enforced by 32-bit Golden Tokens, validated by the mLoad capability validation pipeline (validates version, CRC seal, bounds, and permissions on every capability access). Domain purity strictly separates capabilities from code/data. The multi-language CLOOMC++ Compiler targets a 20-instruction Church Machine ISA, supporting English, JavaScript, Haskell, Symbolic Math, and Lambda Calculus with automatic detection, producing compiled abstractions. Key optimizations include a LAMBDA NIA Cache for leaf lambda execution. The Locator manages on-demand lump loading, and the Navana Master Controller handles Namespace entries and secure deployment. The Instruction Set is optimized for capability-focused and data manipulation operations. The platform supports Efinix Ti60 F225 (full profile), Tang Nano 20K (IoT profile), and QMTECH Wukong Artix-7 XC7A100T (4,860 Kb BRAM / 512 KB namespace; Vivado), using WebSerial for deployment. FPGA Call-Home & Device Management allows FPGAs to register with the IDE, enabling secure remote code deployment and fault-triggered boot diagnostics, with server-side fault logging and MTBF calculation per instruction address.

## External Dependencies
- **Python/Flask:** Backend web server.
- **SQLite:** Local database for server-side persistence.
- **Amaranth HDL:** Hardware description language for FPGA design.
- **localStorage:** Client-side storage for IDE state.
- **oss-cad-suite:** FPGA toolchain for synthesis and programming.
- **GitHub:** Integrated for the Mum Tunnel shared abstraction library and community features.
- **APScheduler:** Background scheduler for daily email reports (persisted in `server/scheduler.db`).
- **Resend:** Transactional email provider for daily progress reports.

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

## GitHub Auto-Sync
The codebase is automatically pushed to **khhodges/church-machine** on GitHub so switching machines is seamless — no manual `git push` needed.

- **On every task merge:** `scripts/post-merge.sh` calls `scripts/sync-to-github.sh` immediately after Replit commits the merge.
- **Every 30 minutes:** APScheduler runs `run_code_sync()` from `server/daily_report.py`, which executes `scripts/sync-to-github.sh` in the background. Failures are logged but never interrupt the IDE.
- **On-demand endpoint:** `GET /internal/git-sync` triggers an immediate code push and returns JSON `{success, returncode, output, sha, branch}`. Requires both `GITHUB_PAT` secret and `Authorization: Bearer <REPORT_TOKEN>` header (or `?token=<REPORT_TOKEN>`).
- **Nightly LFS backup (03:00 UTC):** `scripts/sync-lfs-to-github.sh` uploads all LFS-tracked binary assets. Manual trigger: `GET /report/sync-lfs-now` (requires `REPORT_TOKEN`).
- **Status tracking:** Every push records outcome to `server/github-sync-status.json` and the `github_sync_log` table in `server/church_machine.db`.
- **Failure alert email:** `server/github_sync_alert.py` sends a Resend alert on push failure. Opt out with `GITHUB_SYNC_ALERT_EMAIL=0`.
- **Required secret:** `GITHUB_PAT` — classic GitHub PAT with `repo` scope (and `lfs` scope for nightly backup), no expiry.

## Daily Progress Report
An automated daily report emails `sipanticinc@gmail.com` at **05:00 UTC** every day via Resend.

- **Report module:** `server/daily_report.py` — generates six-section report and sends via Resend
- **Scheduler:** APScheduler with SQLite job store (`server/scheduler.db`) — survives server restarts
- **Manual trigger:** `GET /report/send-now` — triggers immediately and returns JSON confirmation
- **Cost tracking:** `POST /report/task-run` — records a task agent run in the `report_tracking` table
- **Tracking table:** `report_tracking` in `server/church_machine.db`
- **From address:** Uses `onboarding@resend.dev` (Resend's pre-verified test domain) unless `RESEND_FROM_EMAIL` env var is set to a verified domain
- **Auth:** Both endpoints require `Authorization: Bearer <token>` or `?token=<token>` where the token comes from the `REPORT_TOKEN` env var (set as a Replit secret; a random token is generated at startup if unset)
- **GitHub sync alert opt-out:** Set `GITHUB_SYNC_ALERT_EMAIL=0` (or `false`) to suppress the immediate failure-alert email; sync status is still written to `server/github-sync-status.json` and included in the daily digest. Omitting the var (default) keeps alerts enabled.
- **Six report sections:** tasks merged today, in progress, queued next, test suite status, Ti60 call-home status, cost summary with billing link

## Gotchas / Known Traps

### Adding a new Assembly example tab (MUST DO BOTH steps)

1. Add the `<button class="example-tab" ...>` to `simulator/index.html` (in the `#exampleTabsScroll` container).
2. **Also add the `data-example` key to the `langExampleGroups.assembly` array in `simulator/app-compile.js`** (around line 369).

If step 2 is missed, `app-compile.js` will call `tab.style.display = 'none'` on the button whenever Assembly mode is active (which is the default). The button will be present in the HTML source and visible to curl, but invisible to the user — a very difficult bug to diagnose remotely.

After both edits, bump the `app-compile.js` version tag in `index.html` (e.g. `?v=20260429e`) so browsers fetch the updated file.

### Large Assembly programs — extended-code LUMP (simulator.js `loadProgram`)

The Boot.Abstr lump is only 64 words (≈ 45 usable code words after header and c-list). When an assembled program exceeds that capacity, `loadProgram` now allocates a fresh, properly-sized LUMP at the **extended-code area** (`0x0400`) instead of silently truncating the code:

1. **New-lump size** = next power-of-2 ≥ `1 + words.length + 18` (18 = DEMO_CLIST capacity).
2. **NS slot 3** (Boot.Abstr) word0 is updated to point to `0x0400`; word1 carries the new `limit17` and `cc=0`; word2 is resealed.
3. **CR14** `word1/word2/word3` are updated to match.
4. **CR6** is zeroed so the existing lazy C-List injection in `_applyPendingSimLoad` rebuilds it correctly against the new, larger lump.
5. The `programBaseAddr` display variable in `_applyPendingSimLoad` switches to `slot3Base+1` when the lump has been moved to `≥ 0x0400`, keeping labels correct.

## LUMP Metadata Integrity (Release 1.1)

### Consistency Gate

All lump-related changes are gated by `tests/lump/test_lump_consistency.py`.
Run before every merge touching a `.lump` binary, `manifest.json`, or any
sidecar `<token>.json`. 11 rules — R1 through R11 — cover magic, file size,
manifest presence, orphan sidecars, three-way cw/cc/lump_size agreement,
and ns_slot_policy.

```bash
python -m pytest tests/lump/test_lump_consistency.py -v
```

### NS Slot Assignment — Four Categories

Only **Resident** and **Lazy-load** LUMPs have an assigned slot in the
Namespace table. Dynamic LUMPs take the next free slot on demand. NULL LUMPs
never enter the Namespace table at all.

| Category | `ns_slot` | `boot_resident` | `ns_slot_policy` |
|:---------|:----------|:----------------|:-----------------|
| **Resident** | integer | `true` | `"static"` |
| **Lazy-load** | integer | `false`/absent | `"static"` |
| **Dynamic** | `null` | — | `"dynamic"` |
| **NULL** | `null` | — | absent/`"static"` |

A **Dynamic lump** sets `ns_slot: null` and `ns_slot_policy: "dynamic"`.
The runtime allocates the next free slot at first use; the slot may change
between reboots, but callers hold a GT (not a slot index) so it is invisible
to them.

A **NULL lump** also has `ns_slot: null` but never enters the Namespace table.
It is fetched directly by token via the Loader/Tunnel when needed — correct
for data, media, and library lumps that require no callable NS slot.

Canonical example: WordString (ab1e86af).

### Change Control Rules (summary — full rules in CHANGELOG.md)

1. Consistency gate must pass before merge.
2. Every binary recompile that changes cw/cc/lump_size requires same-commit updates to the sidecar JSON and manifest.json.
3. New lump = three files: `.lump` binary + sidecar `.json` + manifest entry.
4. NS slot collisions are not permitted — every static-policy LUMP must have a unique slot.
5. CHANGELOG.md entry required for every structural change.
6. Spec doc version must be bumped when their schema changes.

### Release History

| Release | Date | Key changes |
|---|---|---|
| 1.2 | 2026-05-15 | Builder ZIP downloads — build log listings now match ZIP contents exactly for all 3 boards (Ti60, Wukong, Tang Nano); stale .edif removed from Ti60 log; local_bridge.py added to Wukong and Tang Nano logs; .v/.json marked conditional for Tang Nano; file-icon map expanded; new zip-contents pytest suite (5 tests). |
| 1.1 | 2026-05-03 | LUMP metadata overhaul — four-category NS slot model formalised (Resident/Lazy-load/Dynamic/NULL), 11-rule consistency gate, Boot.Abstr corrected (cw=17, cc=1, 64 words), 4 test-lump cw/cc corrected, 6 missing sidecars created, orphan 00000003.json removed. |
| 1.0 | 2026-04-29 | Initial documented release. |

The patch-in-place path (small programs, ≤ maxCW words) is completely unchanged.

## Keeping Canonical Examples in Sync (Task #1238)

The inline assembly examples embedded in `simulator/app-run.js` must stay identical to the canonical source files in `simulator/examples/*.cloomc`. The assembler test suite enforces this at test time, but the sync script lets you repair drift immediately when you edit an inline example.

### When to run it

Run the sync script any time you edit an inline example string in `simulator/app-run.js`:

```bash
node scripts/sync-canonical-examples.js
```

This reads every inline example, compares it to the corresponding `simulator/examples/<key>.cloomc` file, and overwrites any file that differs. It exits 0 on success.

### CI guard mode

To check for drift without writing any files (useful in pre-commit hooks or CI):

```bash
node scripts/sync-canonical-examples.js --check
```

Exits non-zero and lists drifted files if any canonical file is out of date.

### Excluded key: `led_dr_test`

`led_dr_test` is a variable reference in `app-run.js` (not a backtick literal), so it cannot be extracted by the sync script:

```javascript
'led_dr_test': _TURING_DR_TEST_SOURCE,
```

Its source (`_TURING_DR_TEST_SOURCE`) is a standalone backtick literal verified separately by EX14–EX15 in `simulator/assembler_test.js`. `led_control` is now a plain backtick literal and is fully synced by the script.

### Relevant files

- `scripts/sync-canonical-examples.js` — the sync script
- `simulator/app-run.js` — source of inline example strings
- `simulator/examples/*.cloomc` — canonical files kept in sync
- `simulator/assembler_test.js` — inline-vs-canonical test suite (EX-*-INLINE tests)