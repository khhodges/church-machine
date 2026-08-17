# S-IDE v1 — Church Machine Simplified IDE

## Overview
S-IDE v1 is a simplified entry-point IDE built on the Church Machine codebase, published to **khhodges/s-ide-v1** on GitHub. It presents a focused, three-step onboarding experience: Flash the Wukong A7 FPGA, Connect and verify the board calls home, then Write and run a CLOOMC program. Advanced views (Math REPL, Namespace, Pipeline, Trace, GC, etc.) are hidden by default and accessible with `?debug=1` in the URL. The full Church Machine IDE source continues to live in **khhodges/church-machine** (unchanged).

## User Preferences
- Always write full HTTP URLs (e.g. `https://lab.cloomc.org/fpga`), never bare paths like `/fpga`
- **Core design principle**: Every improvement must logically abstract implementation details — hide complexity, expose only what matters, make the system easy to understand and use. Raw technical values (addresses, hex words, register numbers) should always be translated into human-readable pet names, labels, or plain-English descriptions wherever they appear in the UI.
- Church Gold dark theme
- Mobile-responsive for parent mode on handsets
- All feature flags True for Wukong A7 build
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

**Authoritative Architectural Overview:** `docs/cloomc-foundation.md` is the single document explaining the CLOOMC ISA, the PP250 heritage, the capability model, the reliability model, the Trusted Security Base principle, memory architecture decisions (hardware-forced vs programmer choices vs natural consequences), the old 6-region boot layout and its problems, the 3-LUMP starter kit, and the Wukong A7 board profile. Read this document first when working on the boot image, the memory map, or the ISA. For all Wukong A7 hardware setup facts (USB port map, LED pin assignments, APB3 register map, firmware build steps, callhome bridge usage), see `docs/HARDWARE.md`.

**UI/UX Decisions:**
The web IDE features ten interactive views (Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Builder, Docs). It includes educational tools like Pure Math calculator, HP-35 Calculator, Abacus, and Slide Rule, all with Church Machine trace. Learning aids comprise a "Math Challenge" sidebar, "History Tab," "Syntax Tab," and a "Visual Namespace Builder" for drag-and-drop deployment topology design. Documentation is presented as an interactive book with educational popups and a global CSS tooltip system. The design is responsive, and editor state, settings, and progress are persisted via localStorage.

**Technical Implementations:**
The architecture uses a scale-free abstraction model with 47 abstractions in 9 layers for security. Capability-based security is enforced by 32-bit Golden Tokens, validated by the mLoad capability validation pipeline (validates version, CRC seal, bounds, and permissions on every capability access). Domain purity strictly separates capabilities from code/data. The multi-language CLOOMC++ Compiler targets a 20-instruction Church Machine ISA, supporting English, JavaScript, Haskell, Symbolic Math, and Lambda Calculus with automatic detection, producing compiled abstractions. Key optimizations include a LAMBDA NIA Cache for leaf lambda execution. The Locator manages on-demand lump loading, and the Navana Master Controller handles Namespace entries and secure deployment. The Instruction Set is optimized for capability-focused and data manipulation operations. The platform supports the Wukong A7 (XC7A100T), using a USB-Serial bridge for deployment. FPGA Call-Home & Device Management allows FPGAs to register with the IDE, enabling secure remote code deployment and fault-triggered boot diagnostics, with server-side fault logging and MTBF calculation per instruction address.

## External Dependencies
- **Python/Flask:** Backend web server.
- **SQLite:** Local database for server-side persistence.
- **Amaranth HDL:** Hardware description language for FPGA design.
- **localStorage:** Client-side storage for IDE state.
- **oss-cad-suite:** FPGA toolchain for synthesis and programming.
- **GitHub:** Integrated for the Mum Tunnel shared abstraction library and community features.
- **APScheduler:** Background scheduler for daily email reports (persisted in `server/scheduler.db`).
- **Resend:** Transactional email provider for daily progress reports.

## Scheduler Interrupt & Three-Tier Fault Recovery

Simulation-only (no FPGA hardware), implemented in JS simulator files only. `fault()` attempts Tier 1 (`.catch` on the faulting NS slot), Tier 2 (`Scheduler.IRQ`), Tier 3 (double-fault → return to boot) before halting; a hidden timer-driven `Scheduler.IRQ` (NS slot 8, IRQ thread at slot 50) also wakes sleeping threads. Full mechanism detail, method indices, and test coverage: `docs/instruction-set.md` § "Three-Tier Fault Recovery", `docs/isa_reference.md` § 9, and CHANGELOG.md.

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
- **Six report sections:** tasks merged today, in progress, queued next, test suite status, Wukong call-home status, cost summary with billing link

## Gotchas / Known Traps

### Adding a new Assembly example tab (MUST DO ALL THREE steps)

1. Add the `<button class="example-tab" ...>` to `simulator/index.html` (in the `#exampleTabsScroll` container).
2. **Also add the `data-example` key to the `langExampleGroups.assembly` array in `simulator/app-compile.js`** (around line 369).
3. **Also add the full source as an inline backtick string inside the `examples` object in `loadExample()` in `simulator/app-run.js`** (just before the closing `};` of the `examples` object, after the last entry). Format: `'key_name': \`...source...\`,`

If step 2 is missed, `app-compile.js` will call `tab.style.display = 'none'` on the button whenever Assembly mode is active. The button will be present in the HTML source and visible to curl, but invisible to the user.

If step 3 is missed, clicking the tab calls `loadExample('key_name')` which looks up `examples['key_name']`, gets `undefined`, and silently does nothing — the editor stays blank with no error.

**Note on `sync-canonical-examples.js`:** this script goes ONE-WAY — it writes from the inline `examples` object in `app-run.js` **out** to `simulator/examples/*.cloomc` files. It cannot inject a new example into `app-run.js` from a file; that must be done manually (step 3).

After all three edits, bump the `app-run.js` version tag in `index.html` (e.g. `?v=20260725a`) so browsers fetch the updated file.

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
| **Dynamic** | `null` | — | `"dynamic"` or absent |
| **NULL** | `null` | — | `"static"` |

A **Dynamic lump** has `ns_slot: null`. The runtime allocates the next free
slot at first use; the slot may change between reboots, but callers hold a GT
(not a slot index) so it is invisible to them. `ns_slot_policy: "dynamic"` is
preferred for clarity but **absent is treated as dynamic** — R9 is retired.

A **NULL lump** also has `ns_slot: null` but never enters the Namespace table.
It is fetched directly by token via the Loader/Tunnel when needed — correct for
data, media, and library lumps that require no callable NS slot. Must declare
`ns_slot_policy: "static"` explicitly to opt into this category.

Canonical example: WordString (ab1e86af).

### Change Control Rules (summary — full rules in CHANGELOG.md)

1. Consistency gate must pass before merge.
2. Every binary recompile that changes cw/cc/lump_size requires same-commit updates to the sidecar JSON and manifest.json.
3. New lump = three files: `.lump` binary + sidecar `.json` + manifest entry.
4. NS slot collisions are not permitted — every static-policy LUMP must have a unique slot.
5. CHANGELOG.md entry required for every structural change.
6. Spec doc version must be bumped when their schema changes.

### Release History

Full LUMP-spec release history (1.0 → 1.2) has moved to `CHANGELOG.md`.

The patch-in-place path (small programs, ≤ maxCW words) is completely unchanged.

## LUMP Developer Tooling

Two scripts keep lump binaries and inline examples from drifting out of sync: `scripts/update-lump.js` (one-command rebuild of a `.lump` binary + sidecar JSON + manifest entry from its `.cloomc` source, with a `--check` drift-detection mode) and `scripts/sync-canonical-examples.js` (keeps inline assembly examples in `simulator/app-run.js` identical to `simulator/examples/*.cloomc`, also with a `--check` mode). Full usage, source-discovery rules, and known-source token table: `docs/lump-tooling.md`.