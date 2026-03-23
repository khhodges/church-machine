# Church Machine Educational Platform

## Overview

The Church Machine is a capability-secured processor architecture with an educational IDE, designed for the Tang Nano 20K FPGA. Its primary purpose is to provide a web-based integrated development environment where children can write, compile, test, and deploy Church Machine programs. The architecture employs capability-based security with Golden Tokens, allowing for secure and scalable use from family/school settings to larger organizations. This platform aims to make computer architecture and secure programming accessible through a hands-on, interactive learning experience.

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

The system is composed of hardware (Amaranth HDL for FPGA), a web IDE (HTML/JS/CSS), and a Flask backend.

**UI/UX Decisions:**
The web IDE features ten views (Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Builder, Docs) and incorporates interactive learning tools:
- **Pure Math:** A calculator with a "Compile Session" feature for converting let-bindings to Church Machine code. Includes a symbol picker button (summation icon) on the input line that opens a categorized dropdown (Greek, Arithmetic, Sets, Logic, Calculus, Physics, Lambda) for inserting mathematical symbols at cursor position.
- **HP-35 Calculator:** A pure lambda calculus implementation of the 1972 HP-35 scientific calculator, including RPN engine and Church numeral operation tracing.
- **Abacus:** A soroban-style abacus with digital readout and Church Machine trace for operations.
- **Slide Rule:** A logarithmic slide rule with draggable scales and trace of Church Machine operations.
- **Math Challenge:** A sidebar providing grade-appropriate problems with hints and dual-domain explanations (Turing/Church).
- **Builder:** Visual Namespace Builder for designing deployment topology — three-level hierarchy of Cyberspace (computers on SVG canvas), Computer (namespace slots), and Namespace (abstraction drop zone for upload.json files). Includes topology export, drag-and-drop node positioning, and dependency wiring between abstractions. Implemented in `simulator/builder.js`.
- **History Tab:** Dynamic historical stories related to the active math tool, encouraging contextual learning.
- **Syntax Tab:** Quick-reference cheat sheet for the currently selected language, auto-updates on language change.
- **Subjects:** Settings page displays 8 subject cards (English, JavaScript, Haskell, Symbolic Math, Lambda Calculus, Assembly, Math Tools, Security). Each card opens a lesson list; clicking a lesson navigates to the editor with starter code or the relevant view/tab.
- **Responsive Design:** Panels often use a 50-50 split with draggable dividers, adapting to narrow screens. Tab bars (.math-mode-tabs, .sidebar-tabs) auto-collapse overflowing tabs into a hamburger (☰) dropdown when panels are resized via dividers. Docs view on mobile: clicking a document collapses the sidebar (`.docs-sidebar-collapsed`), scrolls to the content panel, and shows a "Back" button (`.docs-back-btn`) to return to the file list.
- **Docs Book Structure:** The Docs sidebar organises all documents as chapters of "The Church Machine" book. The chapter ordering is defined in `BOOK_CHAPTERS` in `server/app.py`. The API returns `chapters` (grouped) alongside flat `docs`. The frontend renders chapter group headers (`.docs-chapter-title`, gold uppercase) with numbered items (`.docs-chapter-num`, e.g. "1.1", "2.3"). Any uncatalogued `.md` files appear in an "Appendix" group. Prologue + Parts I–X: Prologue (1936→PP250→SOSP-6→Church Machine arc), Introduction, Architecture, Security, Runtime, Networking, Lambda Calculus, Immortal Software, The Civilisation Case, Hardware Implementation, Patents & Proposals.
- **Popups:** Educational popups for welcome, math guide, and individual tool guides enhance the learning experience.
- **Tooltips:** Global CSS tooltip system using `data-tooltip` attribute on all buttons (100 total in `simulator/index.html`). Dark-themed tooltips (#1b2d45 background, #3a86ff border) with consistent "LABEL — Description" format. Uses `::after` pseudo-element; `.tooltip-below` modifier for elements near top edge. No `title` attributes on tooltip'd buttons (prevents double tooltips). HP-35 calculator buttons also use `data-tooltip` (set in `hp35.js`).
- **Tutorials:** Two interactive slide-based tutorials in the Tutorial view. "Church Machine Study" (`simulator/sliderule_tutorial.js`, 7 slides) covers architecture, ISA, compiler pipeline, and the Lump Library/Locator deployment model. "CLOOMC++ Languages" (`simulator/cloomc_tutorial.js`, 8 slides) walks the SlideRule abstraction implemented in all six front-ends (English, JavaScript, Haskell, Symbolic Math, Lambda Calculus, Machine Code) with a final comparison slide. The active tutorial is selected via buttons; `activeTutorial` in `app.js` controls which is rendered.
- **State Persistence:** Utilizes localStorage for editor state, settings, progress, and dismissals.

**Technical Implementations:**
- **Abstraction Model:** A scale-free model where each of 45 abstractions across 9 layers functions as a security block with MTBF tracking.
- **Security Model:** Based on 32-bit unforgeable Golden Tokens with specific permission bits (R, W, X, L, S, E) and a 7-step mLoad pipeline for robust capability handling. Domain purity ensures strict separation between capabilities (Church domain) and code/data (DATA domain).
- **NS Entry and Lump Layout:** Defines the structure of Namespace entries and memory lumps for abstractions. Lumps are power-of-2 allocated (minimum 32 words). Code at offset 0, c-list at allocSize-clistCount, freespace between. Boot.Abstr (NS[2]) is a combined slot holding both boot code and C-List GTs using the clistCount split. NS[3] is empty (was Boot.CLOOMC, now merged). C-List[0] is NULL (was Boot.CLOOMC GT).
- **Self-Documenting Abstractions:** Every upload.json includes a `doc` block with author, date, language, description, tags, method signatures, capabilities, and sourcePreview. Auto-generated from compiler output and student settings. Displayed in the Abstractions view detail panel.
- **Mum Tunnel Library:** GitHub-backed shared abstraction library. Server API (`/api/library/browse`, `/api/library/get/<path>`, `/api/library/publish`) pushes/reads from a GitHub repo. UI: Library modal with search, language filter, card grid, import/publish. Requires `GITHUB_TOKEN` environment variable.
- **CLOOMC++ Compiler:** A multi-language compiler targeting the 20-instruction Church Machine instruction set. It supports English, JavaScript, Haskell, Symbolic Math (Ada Lovelace's notation), and Lambda Calculus front-ends. The compiler auto-detects language from source syntax (lambda detection uses anchored `-- LAMBDA CALCULUS` header or `λx.` dot notation to disambiguate from Haskell's `\x ->` arrow syntax). Outputs `upload.json` format (see `docs/json-information.md`) for abstraction deployment.
- **Locator (Absent-Lump Protocol):** On-demand lump loading triggered by `LOAD` against an Outform GT (`typ=11`). Hardware fires the Absent event and invokes the Locator as a secure subroutine CALL in the same thread (no thread park, no scheduler transfer). The Locator fetches `lump.zip` via NetworkIO, reads the ZIP local file header to derive `n`, pre-allocates the lump region, inflates, verifies CRC-32, and calls `Mint.Lump(base, n)` to validate and write the Live NS slot. Outform NS slots (Words 1–3) hold a 96-bit IDE token; Live NS slots hold `base`, `gt_seq+limit_offset`, and `CRC-16`. Eviction restores the Outform state by writing the saved IDE token back. See `docs/locator.md`.
- **Navana Master Controller:** Acts as the sole writer for Namespace entries, managing abstraction creation, allocation, and secure deployment by validating uploads and enforcing security constraints. Implements PassKey access control for device drivers: threads present a PassKey (ABSTRACTION GT, type=3) to Navana, which validates it and returns an E-perm device driver abstraction. PassKey GT index field encodes device selector (bits 15:8) and permission mask (bits 7:4). Device registry built at Init by scanning NS slots 11-15 (UART, LED, Button, Timer, Display). LED driver E-perm abstraction dispatches Set/Clear/Pattern/Get via DR0/DR1. MintPassKey requires M-elevation. Full audit trail in Gate Log.
- **Instruction Set:** Comprises 20 instructions, evenly split between Church (capability-focused) and Turing (data manipulation) sets, all supporting ARM-style conditional execution.
- **Hardware Target:** The Tang Nano 20K FPGA (Gowin GW2AR-18) is the primary hardware target, with all features enabled (CHANGE/SWITCH, SEAL_CHECK, FUSED_OPS, GC). It uses specific pins for UART, LEDs, and buttons.
- **WebSerial:** Used for deploying compiled programs to the Tang Nano 20K FPGA.

## GitHub Integration — Two-Repo Structure

### Repos
- **khhodges/cloomc-project** (cloomc.org) — Open-source platform: IDE, simulator, compiler, hardware designs, shared library. Free for all educational use.
- **khhodges/cloomc-foundation** (cloomc.com) — Commercial gateway: documentation, licensing info, curriculum package details.

### Three-Tier Licensing
1. **Free Platform (GPL-3.0):** Core IDE, simulator, CLOOMC++ compiler, shared library, and CTMM hardware designs — free for all students, parents, teachers, schools (K-12), IB programmes, universities, homeschool, and non-profit academic research.
2. **Curriculum Packages (Paid Add-Ons):** Structured courseware for O-Levels, A-Levels, IB, 11+, GCSE, AP — sold separately, built on the free platform.
3. **Commercial License:** For-profit use requires separate commercial license from CLOOMC Technologies LLC. Contact: SIPanticINC@gmail.com.

### Environment Secrets
- `GITHUB_TOKEN` — Fine-grained PAT with Contents read/write permission for both repos
- `GITHUB_LIBRARY_REPO` — Defaults to `khhodges/cloomc-project` (set in code)
- `GITHUB_FOUNDATION_REPO` — Set to `khhodges/cloomc-foundation` (set in code)

### GitHub API Endpoints
- `GET /api/library/repo-url` — Returns library repo URL
- `GET /api/library/browse` — Browse shared abstractions in `library/` directory
- `GET /api/library/get/<path>` — Get a specific abstraction JSON
- `POST /api/library/publish` — Publish an abstraction to `library/<language>/<name>.json`
- `POST /api/github/export-simulator` — Push all simulator files to `simulator/` in cloomc-project

### GitHub Repo Structure (cloomc-project)
```
LICENSE                  — GPL-3.0 with three-tier preamble
README.md                — Project overview with licensing
index.html               — cloomc.org landing page
library/README.md        — Shared abstraction library (Mum Tunnel)
library/<lang>/<name>.json — Published abstractions
simulator/               — Full IDE (exported via Push to GitHub button)
hardware/                — Amaranth HDL designs (future)
```

### Export to GitHub
The Dashboard view has a "Push to GitHub" button that triggers `POST /api/github/export-simulator`, pushing all simulator files (`.js`, `.html`, `.css`, `.svg`) to `simulator/` in cloomc-project with a README containing clone-and-run instructions.

## External Dependencies

- **Python/Flask:** Powers the web server backend.
- **SQLite:** Used as the local database (`server/church_machine.db`).
- **Amaranth HDL:** Employed for hardware synthesis of the FPGA design.
- **localStorage:** Used for client-side state persistence within the web IDE.
- **oss-cad-suite:** Provides the FPGA toolchain, including `yosys`, `nextpnr-gowin`, `gowin_pack`, and `openFPGALoader`.

## FPGA Build Package

The IDE includes a "Download FPGA Package" button in the Code tab Install toolbar that generates a downloadable ZIP containing:
- Pre-generated Verilog (`church_tang_nano_20k.v`) from Amaranth HDL
- Pre-synthesised Yosys JSON netlist (`church_tang_nano_20k.json`) for Gowin GW2AR-18
- Pin constraints (`tang_nano_20k.cst`) and `Makefile`
- `BUILD.md` with two-command instructions: `make pnr pack` then `make prog`

The endpoint `GET /api/download/fpga-package` runs Amaranth elaboration and Yosys synthesis on demand (takes ~30-60s). The user unzips locally and only needs OSS CAD Suite for the final place-and-route + bitstream packing step. The `hardware/hw_types.py` module (renamed from `types.py` to avoid shadowing Python's stdlib `types` module) defines all Church Machine opcodes, permission bits, GT types, and fault codes.
