# Church Machine Educational Platform

## Overview

The Church Machine is a capability-secured processor architecture with an educational IDE, designed for the Tang Nano 20K FPGA and supporting the Efinix Ti60 F225. Its primary purpose is to provide a web-based integrated development environment for children to write, compile, test, and deploy Church Machine programs. The platform uses capability-based security with Golden Tokens, making secure programming and computer architecture accessible through hands-on learning for various educational settings.

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

The system comprises hardware (Amaranth HDL for FPGA), a web IDE (HTML/JS/CSS), and a Flask backend.

**UI/UX Decisions:**
The web IDE offers ten views (Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Builder, Docs) with interactive learning tools:
- **Educational Tools:** Includes a Pure Math calculator with a "Compile Session" for converting let-bindings, an HP-35 Calculator (lambda calculus based), a soroban-style Abacus, and a logarithmic Slide Rule, all featuring Church Machine trace.
- **Learning Aids:** A "Math Challenge" sidebar provides grade-appropriate problems, "History Tab" offers contextual stories, and "Syntax Tab" provides language-specific cheat sheets.
- **Builder:** A Visual Namespace Builder for designing deployment topology, allowing drag-and-drop node positioning and dependency wiring.
- **Documentation:** The "Docs" view structures all documents as chapters of "The Church Machine" book, with Prologue and Parts I–X covering architecture, security, runtime, and other key areas.
- **Interactive Elements:** Features educational popups for guides and a global CSS tooltip system for consistent user feedback.
- **Responsive Design:** Panels use draggable dividers and adapt to narrow screens, with tab bars collapsing into a hamburger menu.
- **Tutorials:** Two interactive slide-based tutorials cover architecture, ISA, compiler pipeline, and multi-language abstraction implementations.
- **State Persistence:** Utilizes localStorage for editor state, settings, and progress.

**Technical Implementations:**
- **Abstraction Model:** A scale-free model where 45 abstractions across 9 layers function as security blocks.
- **Security Model (Second Law of the CTMM):** Based on 32-bit unforgeable Golden Tokens with specific permission bits and a 7-step mLoad pipeline for capability handling. Domain purity strictly separates capabilities and code/data. **Every memory read and write is validated by a governing capability context register**: CR14 governs instruction fetch (mLoad X), CR12 governs all thread lump stack operations (mLoad R for header reads, mLoad W for frame writes and CR home slot writes), CRsrc governs lump header reads in LOAD/SAVE/ELOADCALL/XLOADLAMBDA. Simulator helper methods `_threadRead`/`_threadWrite` gate CR12 accesses; `_capRead` gates arbitrary CRn accesses. Only boot/kernel paths and NS infrastructure use direct memory access (M-elevated). **Hardware enforcement**: CALL checks CR5 R-perm + null and CR12 null in `CHECK_CR5_CR12` state before stack reads/writes; RETURN checks CR5 R+W perms + null and CR12 null in `CHECK_CR5_CR12` state before heap/stack frame access; CHANGE checks outgoing CR12 null before SAVE_DR writes, and incoming CR12 null before FETCH_THREAD_HDR read. CR12/CR13/CR15 are M-elevated machine registers with perms always =0 — null-checked only, no R/W/X/L/S/E perm bits required. DREAD/DWRITE have inline R/W perm + bounds checks. Fetch uses CR14 code fence (bounds validated per-cycle, X-perm validated once at CALL/CHANGE time).
- **Compiler:** The CLOOMC++ Compiler is a multi-language compiler targeting the 20-instruction Church Machine instruction set, supporting English, JavaScript, Haskell, Symbolic Math, and Lambda Calculus. It auto-detects language and outputs `upload.json` for abstraction deployment. The Symbolic Math (Ada) front-end emits `LOAD CR0, CR6, <slot>; CALL CR0` with encoded register operands in the CALL imm field for `*` and `/` operators, dispatching to the SlideRule abstraction (NS Slot 16). SlideRule is auto-injected into capabilities when multiply/divide operators are found. The CALL imm encoding packs method index, left register, and right register into 12 bits with a 0x4000 flag, eliminating register moves and preserving all variable registers. DR3 remains the legacy method selector convention for manual assembly. The Symbolic Math front-end supports multi-target `let` assignment (`let V4, V5, V6 = expr` compiles to expr + IADD copies) and `repeat N as counter` / `end` loop blocks (compiles to ISUB+MCMP+BRANCH GT post-test loop). The `ada_note_g.cloomc` program uses both features to express Ada Lovelace's Note G (1843) in ~25 operations; it compiles to 39 words and executes in 52 steps producing B7 = -12 in integer arithmetic.
- **Lump Header Format (hardware-accurate):** Every abstraction slot starts with a 32-bit header at word 0: `magic(5)|n_minus_6(4)|cw(13)|typ(2)|cc(8)`. Boot.Abstr has a 256-word lump (n_minus_6=2, cw=17, cc=12), giving 243 words of code capacity. C-list is at the physical end (words 244–255), freespace fills words 18–243. Slot locations use a running offset based on actual lump sizes (Thread=256, Boot.Abstr=256, others=64) to avoid overlaps in flat memory. Both the simulator BOOT_NUC step and `_execCall` derive CR14 (X capability) and CR6 (L capability) simultaneously from this single header word, matching FPGA behaviour. `_fetchInstruction` applies +1 offset so PC=0 fetches the first instruction after the header. Patch (injectCRCode) has a bounds check: refuses to write if code exceeds lumpSize-cc-1 words.
- **LAMBDA NIA Cache (Leaf Lambda Optimisation):** LAMBDA defers its stack frame write to a cache (`lambdaCachedFrame`) instead of writing to thread lump memory immediately. If a CALL, ELOADCALL, CHANGE, or nested LAMBDA occurs inside the lambda body, `_flushLambdaCache()` writes the deferred frame to memory before proceeding. If RETURN pops the lambda frame while the cache is still active (leaf lambda — no nested calls), the frame is discarded with zero memory traffic. This matches the hardware pipeline's NIA cache behaviour.
- **Locator (Absent-Lump Protocol):** Handles on-demand lump loading triggered by `LOAD` instructions, fetching, verifying, and validating lumps securely.
- **Navana Master Controller:** Manages Namespace entries, abstraction creation, allocation, and secure deployment, acting as the sole writer and enforcing security constraints with PassKey access control for device drivers.
- **Instruction Set:** Comprises 20 instructions, evenly split between Church (capability-focused) and Turing (data manipulation) sets, supporting ARM-style conditional execution.
- **Namespace Layout (hardware ↔ simulator aligned):** NS 0=Boot.NS, 1=Thread, 2=Boot.Abstr, 3=(empty), 4=Salvation, 5=Navana, 6=Mint, 7=Memory, 8=Scheduler, 9=Stack, 10=DijkstraFlag, 11=UART, 12=LED, 13=Button, 14=Timer, 15=Display. Boot c-list[0–3] are boot-internal (firmware-only); c-list[4–11] are user-visible and match between hardware (boot_rom.py DEMO_CLIST) and simulator (simulator.js HW_DEVICE_SLOTS). BOOT_PROGRAM B:04 loads Salvation E-GT from c-list[4].
- **Hardware Target:** Primary: Efinix Ti60 F225 (full profile, ~8,537 LUTs / 14.2% of 60K). Secondary: Tang Nano 20K (IoT profile). Tang Nano 20K confirmed pin mapping: clk=4, uart_tx=69, uart_rx=70, LEDs=15/16/19/20 (active-low), push_button=88. UART runs at 115200 baud via FT2232 Channel B (ttyUSB1). Boot banner "CHURCH TN20K-IoT v1.0" confirmed on real silicon. Full profile enables CHANGE/SWITCH, SEAL_CHECK, FUSED_OPS, GC, Lambda, and full Outform with ZIP backward compat. IoT profile (`iot_profile=True`) removes GC, Lambda, Change, Switch, ELoadCall, XLoadLambda and replaces ChurchOutform with ChurchOutformIoT — a lean tunnel-hunting protocol (8-byte header: 4B payload_len + 4B CRC-32, ~9 FSM states, active capability discovery, raw STORE only, no DEFLATE/RLE). IoT nodes can securely receive new capabilities over the network without firmware reflash. Build: Ti60 full → `./build_ti60.sh` or `make -C hardware ti60`; Tang IoT → `python -m hardware.gen_verilog --iot build` + `make -C hardware tang-iot`. IoT profile produces ~44.9% smaller Verilog (19K lines vs 34K, 17 modules vs 31).
- **WebSerial:** Used for deploying compiled programs to the Tang Nano 20K FPGA.
- **Export Patch + CLI Patcher:** `exportPatchFile()` in app.js exports a `.bin` patch file (CHPF format v1) containing pre-compiled PATCH_LUMP blocks. `tools/patch_fpga.py` is a standalone CLI script that reads these files and sends them to the FPGA over UART — no bridge, no browser needed. CRC-16/CCITT verification on both sides.
- **Mum Tunnel Library:** A GitHub-backed shared abstraction library with API endpoints for browsing, retrieving, and publishing abstractions.
- **Self-Documenting Abstractions:** Each `upload.json` includes a `doc` block with metadata, auto-generated from compiler output.

## External Dependencies

- **Python/Flask:** Backend web server.
- **SQLite:** Local database (`server/church_machine.db`).
- **Amaranth HDL:** Hardware synthesis for FPGA design.
- **localStorage:** Client-side state persistence.
- **oss-cad-suite:** FPGA toolchain (`yosys`, `nextpnr-gowin`, `gowin_pack`, `openFPGALoader`).
- **Ti60 Build Flow:** `./build_ti60.sh` or `make -C hardware ti60` generates synthesis-ready Verilog (`build/church_ti60_f225.v`), RTLIL, and a resource report (`build/ti60_resource_report.txt`). Design fits comfortably within Ti60 F225 (~14% LUTs, ~9% FFs, ~4% BRAM).
- **GitHub:** Integrated for the Mum Tunnel shared abstraction library and project management.