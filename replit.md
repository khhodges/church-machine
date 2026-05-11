# Church Machine Educational Platform

## Overview
The Church Machine is an educational platform providing a web-based IDE for learning programming, computer architecture, and secure computing using capability-based security with Golden Tokens. It targets the Tang Nano 20K FPGA and supports the Efinix Ti60 F225, aiming to make advanced computational concepts accessible to children and various educational contexts through hands-on experience. The project envisions a future where capability-secured processor architectures become mainstream, making this platform a foundational tool for training future developers in secure computing.

## User Preferences
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

**UI/UX Decisions:**
The web IDE features ten interactive views (Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Builder, Docs). It includes educational tools like Pure Math calculator, HP-35 Calculator, Abacus, and Slide Rule, all with Church Machine trace. Learning aids comprise a "Math Challenge" sidebar, "History Tab," "Syntax Tab," and a "Visual Namespace Builder" for drag-and-drop deployment topology design. Documentation is presented as an interactive book with educational popups and a global CSS tooltip system. The design is responsive, and editor state, settings, and progress are persisted via localStorage.

**Technical Implementations:**
The architecture uses a scale-free abstraction model with 47 abstractions in 9 layers for security. Capability-based security is enforced by 32-bit Golden Tokens, validated by an 8-step mLoad pipeline. Domain purity strictly separates capabilities from code/data. The multi-language CLOOMC++ Compiler targets a 20-instruction Church Machine ISA, supporting English, JavaScript, Haskell, Symbolic Math, and Lambda Calculus with automatic detection, producing compiled abstractions. Key optimizations include a LAMBDA NIA Cache for leaf lambda execution. The Locator manages on-demand lump loading, and the Navana Master Controller handles Namespace entries and secure deployment. The Instruction Set is optimized for capability-focused and data manipulation operations. The platform supports Efinix Ti60 F225 (full profile) and Tang Nano 20K (IoT profile), using WebSerial for deployment. FPGA Call-Home & Device Management allows FPGAs to register with the IDE, enabling secure remote code deployment and fault-triggered boot diagnostics, with server-side fault logging and MTBF calculation per instruction address.

## External Dependencies
- **Python/Flask:** Backend web server.
- **SQLite:** Local database for server-side persistence.
- **Amaranth HDL:** Hardware description language for FPGA design.
- **localStorage:** Client-side storage for IDE state.
- **oss-cad-suite:** FPGA toolchain for synthesis and programming.
- **GitHub:** Integrated for the Mum Tunnel shared abstraction library and community features.
- **APScheduler:** Background scheduler for daily email reports (persisted in `server/scheduler.db`).
- **Resend:** Transactional email provider for daily progress reports.

## Daily Progress Report (Task #759)
An automated daily report emails `sipanticinc@gmail.com` at **05:00 UTC** every day via Resend.

- **Report module:** `server/daily_report.py` — generates six-section report and sends via Resend
- **Scheduler:** APScheduler with SQLite job store (`server/scheduler.db`) — survives server restarts
- **Manual trigger:** `GET /report/send-now` — triggers immediately and returns JSON confirmation
- **Cost tracking:** `POST /report/task-run` — records a task agent run in the `report_tracking` table
- **Tracking table:** `report_tracking` in `server/church_machine.db`
- **From address:** Uses `onboarding@resend.dev` (Resend's pre-verified test domain) unless `RESEND_FROM_EMAIL` env var is set to a verified domain
- **Auth:** Both endpoints require `Authorization: Bearer <token>` or `?token=<token>` where the token comes from the `REPORT_TOKEN` env var (set as a Replit secret; a random token is generated at startup if unset)
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
variant_group uniqueness, and ns_slot_policy.

```bash
python -m pytest tests/lump/test_lump_consistency.py -v
```

### Floating Lump Pattern

A **floating lump** sets `ns_slot: null` and `ns_slot_policy: "dynamic"` in
manifest.json. Mint allocates an ephemeral NS slot on first use via the
Loader/Tunnel fetch path. The slot number may change between runs but is
invisible to callers (who hold a GT, not a slot index). Floating is the correct
default for any abstraction not on the cold-boot critical path.

Canonical example: WordString (ab1e86af).

### Variant Group

Two manifest entries may claim the same `ns_slot` only if they carry the same
non-null `variant_group` string. Example: SlideRule + SlideRuleHS share
`ns_slot: 16` and `variant_group: "sliderule"`.

### Change Control Rules (summary — full rules in CHANGELOG.md)

1. Consistency gate must pass before merge.
2. Every binary recompile that changes cw/cc/lump_size requires same-commit updates to the sidecar JSON and manifest.json.
3. New lump = three files: `.lump` binary + sidecar `.json` + manifest entry.
4. NS slot collision → `variant_group` required on all claimants.
5. CHANGELOG.md entry required for every structural change.
6. Spec doc version must be bumped when their schema changes.

### Release History

| Release | Date | Key changes |
|---|---|---|
| 1.1 | 2026-05-03 | LUMP metadata overhaul — floating-lump pattern formalised, variant_group introduced, 11-rule consistency gate, Boot.Abstr corrected (cw=17, cc=1, 64 words), 4 test-lump cw/cc corrected, 6 missing sidecars created, orphan 00000003.json removed. |
| 1.0 | 2026-04-29 | Initial documented release. |

The patch-in-place path (small programs, ≤ maxCW words) is completely unchanged.