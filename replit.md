# Church Machine Educational Platform

## Overview

The Church Machine is a capability-secured processor architecture with an educational IDE, targeting the Tang Nano 20K FPGA and supporting the Efinix Ti60 F225. Its core purpose is to provide a web-based integrated development environment for children to learn programming, computer architecture, and secure computing through hands-on experience. The platform uses capability-based security with Golden Tokens, making advanced concepts accessible and engaging for various educational contexts.

## User Preferences

- Church Gold dark theme
- Mobile-responsive for parent mode on handsets
- All feature flags True for Tang build
- No separate dynamicObjects — all entries in namespaceObjects
- B (Bind) bit defaults to 0, auto-cleared by CALL
- C-Lists only have E permission, CLOOMC only X or RX
- Phase 1 + 1b + 1c + 1d + 1e: English, JS, Haskell, Symbolic Math (Ada), and Lambda Calculus front-ends implemented; auto-detected by compiler
- Pure Math "Compile Session" button: compiles interactive let-bindings to Church Machine code via symbolic math front-end

## System Architecture

The system's architecture is composed of an Amaranth HDL-based FPGA hardware, a web IDE built with HTML/JS/CSS, and a Flask backend.

**UI/UX Decisions:**
The web IDE provides ten distinct views (Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Builder, Docs) designed for interactive learning. Key features include educational tools like a Pure Math calculator, HP-35 Calculator, Abacus, and Slide Rule, all with Church Machine trace. Learning aids such as a "Math Challenge" sidebar, "History Tab," and "Syntax Tab" are integrated. A "Visual Namespace Builder" allows drag-and-drop design of deployment topologies. Documentation is structured as a book, and interactive elements such as educational popups and a global CSS tooltip system enhance the user experience. The design is responsive, adapting to various screen sizes, and includes interactive slide-based tutorials. Editor state, settings, and progress are persisted using localStorage.

**Technical Implementations:**
The system employs a scale-free abstraction model with 47 abstractions across 9 layers, serving as security blocks. The Loader abstraction (NS slot 19) provides fault-driven lazy loading: warm/cold abstractions start as NULL at boot and are transparently loaded on first CALL via the lazy load manifest. Circle moved from slot 19 to slot 46. The security model enforces capability-based security using 32-bit unforgeable Golden Tokens with specific permission bits, validated by an 8-step mLoad pipeline (FETCH_LOC / FETCH_LIMIT / FETCH_INTEGRITY / FETCH_SEALS / CHECK_VERSION plus update/complete states). NS entries are 4 words at 16-byte stride: word0_location, word1_limit, word2_integrity (integrity32 check), word3_seals. The CR15 M-window holds a 5-word shadow (XR11=Abstract GT, XR12=NS location, XR13=NS authority, XR14=integrity tag, XR15=0); CALL to an Abstract GT auto-dispatches M-GT fetch states that set this shadow; CALL/RETURN writeback validates XR14==integrity32(XR12,XR13) before committing to CR15. Domain purity strictly separates capabilities from code/data, with every memory access validated by a governing capability context register. The multi-language CLOOMC++ Compiler targets a 20-instruction Church Machine ISA, supporting English, JavaScript, Haskell, Symbolic Math, and Lambda Calculus, with automatic language detection. It produces compiled abstractions for deployment, including specific optimizations for symbolic math operations. The hardware-accurate Lump Header Format ensures consistent memory management between the simulator and FPGA. A LAMBDA NIA Cache optimizes leaf lambda execution by deferring stack frame writes. The Locator handles on-demand lump loading, and the Navana Master Controller manages Namespace entries and secure deployment. The Instruction Set consists of 20 instructions, balancing capability-focused and data manipulation operations. The Namespace Layout is aligned between hardware and simulator. The platform targets both the Efinix Ti60 F225 (full profile) and Tang Nano 20K (IoT profile), with distinct feature sets and build processes. WebSerial is used for deploying compiled programs to the FPGA. An Export Patch and CLI Patcher facilitate standalone deployment. The Mum Tunnel Library provides a GitHub-backed shared abstraction library, and a GitHub Community Hub displays repository statistics and activity. FPGA Call-Home & Device Management enables FPGAs to register and heartbeat with the IDE server via a 23-byte call-home packet (including boot_reason, last_fault, and fault_nia — the faulting instruction address), allowing secure remote deployment of code with full fault-triggered boot diagnostics. A server-side FaultEvent log records every fault-triggered boot, and the IDE computes MTBF per instruction address (Abstraction.Method.Offset), displayed via the Fault Log modal in the Devices panel with colour-coded thresholds. Self-Documenting Abstractions include metadata blocks, and IoT/Full Profile Tagging ensures compatibility and prevents incorrect deployments based on hardware capabilities.

## Patent Figures

45 HTML figures in `docs/figures/` — all use white backgrounds (#ffffff) with dark text/lines for clean printing. Figures cover architecture diagrams, boot sequences, dispatch styles, lambda calculus flows, namespace architecture, I/O addressing, MTBF qualification, and more. PDF patents in `docs/patents/` are regenerated from markdown sources using `tools/md_to_pdf.py` (fpdf-based, no HTML figure embedding).

## Frontend Code Structure

The browser simulator (`simulator/`) is split across multiple files:

**JavaScript modules** (loaded sequentially in `simulator/index.html`):
- `app-shell.js` — hamburger, views, tabs, tooltips, back navigation
- `app-tools.js` — HP-35 calculator, abacus, slide rule, math challenge
- `app-cr-display.js` — CR/DR popup panels, zone scroll, thread layout
- `app-cr-detail.js` — CR detail tabs, c-list display, CR state rendering; `_storeLumpManifest()` now stores `_methods` and `pet_names` for the API tab
- `app-memory.js` — memory hex viewer, page browsing, search; CR detail panel now has an "API" tab (`crdPanel-api`) that renders per-method example blocks with `.pet` preambles
- `app-abstractions.js` — abstraction viewer, NS table, lazy-load manifest
- `app-lumps.js` — lump type selector, lump viewer, lump repo toolbar
- `app-absdetail.js` — abstraction detail panel, MTBF, deploy tab, library
- `app-run.js` — boot flow, stepping, dashboard, gate log, LED strip, fault codes
- `app-compile.js` — editor tabs, CLOOMC compiler, lang-switch, patch
- `app-misc.js` — docs view, reference, init, DOMContentLoaded wiring

**CSS files** (loaded in order):
- `styles-base.css` — CSS reset, variables, colour tokens, layout shell
- `styles-toolbar.css` — top toolbar, sim icon buttons
- `styles-editor.css` — editor, code tabs, breakpoints, run popover
- `styles-dashboard.css` — dashboard tabs, gate log, LED strip, boot steps
- `styles-lumps.css` — lump viewer, hex dump, content badges
- `styles-gatelog.css` — gate log entries and annotations
- `styles-fault.css` — fault display, fault code table
- `styles-tools.css` — HP-35, abacus, slide rule, math challenge, docs

**Simulator core:** `simulator/simulator.js` (~4900 lines) — single `ChurchSimulator` class. The `_clearMWindow(crIdx)` method clears only the M-bit; CR word commits go through `_mwinWriteback()`. The deprecated `writeBack=true` code path and `word4` struct field were removed (Task #448).

## Test Structure

Tests are organised into 6 subdirectories under `tests/`:
- `tests/boot/` — boot image loading, validation, upload/serve endpoints, startup config
- `tests/simulator/` — simulator invariants, DR0 constraints, startup config behaviour
- `tests/mwindow/` — M-window writeback, seal validation
- `tests/gates/` — namespace gate entries, privilege fence, TPERM/XLSE, passkey switch, far-cap fault
- `tests/abstractions/` — abstract GT encoding, DREAD/DWRITE, NS abstract GT, UART dispatch
- `tests/devices/` — outform IoT, BRAM mint writes, UART mux glitch, receive lump CRC

Each subdirectory has a JS harness (`sim_*.js`) alongside its Python test wrappers. JS harnesses use `require('../../simulator/simulator.js')` (two levels up from subdirectory). Python tests derive `ROOT` as `os.path.join(os.path.dirname(__file__), "..", "..")`.

One pre-existing failure: `tests/gates/test_far_cap_fault.py::test_far_cap_fault_f_bit` — CALL F_BIT fault fires as INVALID_OP instead; unrelated to this refactor session.

## Hardware Simulation Tests

Three pytest tests in `tests/devices/test_outform_iot.py` cover the IoT lazy-load pipeline:

- `test_iot_lazy_load_golden` — fast FSM smoke test with mock alloc/mint drivers
- `test_iot_lazy_load_integrated` — integration harness with real watermark allocator + Mint FSM (LibMemory, async reads)
- `test_iot_lazy_load_toplevel` — **primary deliverable (Task #264)**: instantiates `ChurchTangNano20K(iot_profile=True, sim_mode=True, test_mode=True)`, drives UART RX bit-by-bit (16 cycles/bit, 8N1), and asserts NS + c-list writes match expected values

Hardware additions that enable top-level simulation:
- `ChurchCore`: added `outform_start_in / outform_slot_id_in / outform_clist_addr_in / outform_gt_raw_in` test-injection signals
- `ChurchTangNano20K`: added `test_mode` param; `dbg_ns_wr_*`, `dbg_clist_wr_*`, `dbg_outform_busy` debug outputs; `test_outform_*` injection inputs when `test_mode=True and iot_profile=True`
- `tang_nano_20k.py` sim_mode memory migrated from `amaranth.hdl.Memory(transparent=True)` (1-cycle sync read) to `amaranth.lib.memory.Memory(domain='comb')` (async/combinatorial read) to correctly simulate FPGA async BSRAM behaviour and allow Mint FSM to work in simulation

## External Dependencies

- **Python/Flask:** Backend web server.
- **SQLite:** Local database (`server/church_machine.db`).
- **Amaranth HDL:** Hardware synthesis for FPGA design.
- **localStorage:** Client-side state persistence.
- **oss-cad-suite:** FPGA toolchain (yosys, nextpnr-gowin, gowin_pack, openFPGALoader).
- **GitHub:** Integrated for the Mum Tunnel shared abstraction library and community features.

## Build LUMP System

The "Build LUMP" button compiles any CLOOMC++ abstraction and produces a deployable `.lump` binary. The binary is both downloaded to the browser and saved to `server/lumps/` via `POST /api/lumps/save`. Each save produces two files:
- `<token8>.lump` — raw big-endian binary (header + code + freespace + c-list)
- `<token8>.json` — metadata sidecar with: method table (name/offset/length), pet name mappings (DR and CR aliases), MTBF data (clean runs, total runs, status), deployment info (target board, profile, build timestamp), capability list with NS resolution, language, and grants.

Token assignment: from provided token hint, or `ns_slot << 8`, or SHA-256 hash of abstraction name. The manifest (`server/lumps/manifest.json`) is auto-updated on each save. Saved lumps are also loaded into `LAZY_LUMPS` in-memory for immediate serving via `GET /api/lump/<token>`.

## Namespace LUMP Builder

The "New Namespace LUMP" workflow (accessible via "+ Namespace" button in the LUMP Repository toolbar) lets users create Namespace LUMPs (`typ=10`, `cw=0`). The builder form supports:
- App name/ID, base address (hex), size exponent n (6–14), and locator count (cc)
- NS Table slot editor with NULL, Outform, and Bundled entry states
- Outform entries: 64-bit SHA256 hash prefix, locator index, and flags (required/bundle/pinned)
- Bundled entries: select an existing lump from the catalog to include in the output zip

Building POSTs to `POST /api/namespace/build`, which produces a downloadable `<app_name>.namespace.zip` containing `App.bin` (valid Namespace LUMP binary) and `manifest.json`. The namespace lump is also saved to `server/lumps/` and appears in the lump list with an "NS" badge. The detail view for namespace lumps shows app_id, base, n, locator count, and NS Table entries instead of methods/pet names.