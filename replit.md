# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
The Church-Turing Meta-Machine (CTMM) Simulator project develops a comprehensive simulator for a capability-based architecture, integrating Church's lambda calculus and Turing's computational model with failsafe security using "Golden Tokens." Its purpose is to provide an interactive web interface for exploring capability-based security, secure system design, and foundational computational principles. The project aims to advance secure computational models and offer robust tools for learning and practical application, contributing to more secure computational systems.

## User Preferences
- Tooltips positioned below for elements near top of viewport
- Minimal UI with consolidated header controls
- Auto-switching to Dashboard when Reset/Step/Run clicked
- Code persistence in localStorage for session continuity
- Assembly Editor defaults to Access.asm when empty
- Example buttons append code instead of replacing
- Ctrl+Z undoes last code change
- Punt TPERM standardization until Sim-32 mature and ARM market direction clear
- No separate dynamicObjects — all entries live in namespaceObjects (dynamic entries flagged .dynamic = true)
- B (Bind) bit: CALL auto-clears B on all preserved CRs passed to callee — "no bind by default." Allow Bind is the explicit special case via TPERM before CALL. B defaults to 0 on namespace entries.
- C-Lists only have E permission (entered via CALL). CLOOMC only has X or RX (executed via LAMBDA). This rule applies to boot entries too.

## System Architecture

The CTMM simulator provides web-based visualization using a Python HTTP server, HTML, CSS, and JavaScript. It also includes synthesizable hardware implementations in SystemVerilog and Amaranth HDL.

### Core Architectural Concepts

-   **Capability-based Security**: Implemented via "Golden Tokens" (GTs) for access control, with 6 permission bits (R, W, X, L, S, E) and enforced domain purity (Turing XOR Church).
-   **Register Architecture**: Separated Context Registers (CR0-CR7 for Golden Tokens, CR15 for Namespace root, CR8 for Thread identity) and Data Registers (DR0-DR15 for numeric values).
-   **Failsafe Security**: All validation failures are routed to a single FAULT handler.
-   **Deterministic Garbage Collection (PP250)**: A four-phase Scan-Identify-Clear-Flip process with bidirectional G-bit. GC is a safe Turing abstraction — atomic Turing machine hidden behind a Church-callable namespace entry, entered via CALL, exited via RETURN. PP250 excludes HALT — the machine always returns to the boot sequence instead of halting (zero instruction or empty-stack RETURN triggers reboot, not halt). Namespace and memory persist across reboots (warm reboot).
-   **Safe Turing Abstractions**: Hidden Turing implementations inside Church-callable entries. Church is the armor (interface, security), Turing is the sword inside (implementation, hidden and atomic). Entered only via CALL/LAMBDA with valid GTs, exited only via RETURN.
-   **DATA Objects**: Namespace entries accessed via DREAD/DWRITE Turing instructions with R/W permission checks and bounds validation. DATA objects bridge Church and Turing domains.
-   **Minimal Turing ISA** (inside safe abstractions): DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR + shared RETURN — 11 integer-only instructions, no FP (FP is Church-domain via abstractions).
-   **Unified Address Space**: Memory (MSB 0x00-0xFD), attached devices (MSB 0xFE), and machine register bank (MSB 0xFF) are all segments of one flat address space, all protected by the same GT gate via mLoad. Without the right GT, any address range is unreachable.
-   **Instruction Encoding**: 32-bit: opcode[5] | cond[4] | dst[4] | src[4] | imm[15]. 5-bit opcode supports 20 instructions (10 Church + 10 Turing).
-   **LAMBDA Instruction**: Enables lightweight, in-scope code application with machine-status fast path.
-   **mLoad — Read Gate**: Every read-side instruction goes through mLoad for GT validation (version, seal, bounds) and permission checking. Permission gate table: R→DREAD, W→DWRITE, X→LAMBDA, L→LOAD, S→SAVE(c-list access), E→CALL. M-elevation bypasses permission checks. CR6 (C-List register) has CR6-specific M-elevation: LOAD from CR6 skips L permission check because CALL already validated E on it. All other CRs must have correct permissions for every memory action.
-   **mSave — Write Gate**: Every write to a c-list goes through mSave for source GT validation: version match, seal valid, target C-List bounds check, B=1 (bindable), and F-bit detection on target slot (F=1 means FAR/foreign object requiring HTTP/tunnel access). Symmetric counterpart to mLoad in the TSB.
-   **B (Bind) Bit**: NS entry word1 bit 31. mSave requires B=1 on the source GT before committing to c-list. Defaults to 0 — set only by explicit TPERM with B modifier (e.g., `TPERM CR0, EB`).
-   **Canonical Boot Memory Layout**: Boot Namespace starts at address 0x0000. Slot 0=Boot.NS→CR15 (zero perms, Inform, location=NS_TABLE_BASE 0xFD00 — the namespace root's binary data IS the namespace table itself), Slot 1=Thread→CR8, Slot 2=Boot Abstraction C-List→CR6 (E only, INIT_CLIST) + CALL entry (LOAD_NUC: E-GT→mLoad→CR6, CR6+0 X-GT→mLoad→CR7, PC=0), Slot 3=Boot.CLOOMC (X, discovered at offset 0 of Slot 2), Slot 4+=remaining abstractions (Lambda, SlideRule, …). CR5 is NULL at boot. Hardwired GT for CR15: 0x00000000. All boot CRs pass through mLoad (M-elevation bypasses permission but not bounds/version/seal). Boot phases: IDLE→FAULT_RST→LOAD_NS→INIT_THRD(CR8)→INIT_CLIST(CR6)→LOAD_NUC(CALL)→COMPLETE. CALL semantics: Source E-GT (Inform, not F) → mLoad → CR6; CR6+0 X-GT (Inform, not F) → mLoad → CR7; PC=0. First post-boot instruction is always CHANGE to establish thread context.
-   **GT-Gated Instruction Fetch**: In the simulator, instruction fetch goes through CR7's NS entry (`fetchAddr = CR7.entry.location + PC`) with bounds check against CR7's limit. PC is an offset within the current code object, not an absolute address. CALL sets PC=0 and CR7 to callee's CLOOMC; RETURN restores saved CR7 and PC. Pre-boot uses the boot FSM (no instruction fetch). Hardware Boot ROM uses constant propagation (4520 LUTs, 85%); full SPRAM fetch = 6324 LUTs (119%), does not fit iCE40UP5K.
-   **C-List Permission Enforcement**: C-list slot 0 (CLOOMC) must have X or RX only; slots 1+ must not mix X and E on the same slot (domain purity). Enforced in simulator via `_validateClistSlotPerms()` during LOAD, SAVE, and boot (INIT_CLIST/LOAD_NUC). Boot program uses separate slots for X (slot 1) and E (slot 6), both pointing to NS index 4.
-   **GT Type Field** (2-bit): Specific cases of NULL Golden Tokens (Inform=0, Outform=1, NULL=2, Abstract=3). NOT used for object classification — R/W/X permission bits determine data vs. code access.
-   **Network Transparency**: Outform GTs support remote resources via HTTPS and RPC tunnels.
-   **Atomic Abstraction Architecture**: No central OS, VM, privileged mode, or superuser. All system services are atomic abstractions accessed via Golden Tokens, with `mLoad` as the single trusted gate.
-   **Three Dispatch Styles**: Abstractions can resolve method calls via Symbolic resolver (high-security), LAMBDA fast-path (performance), or Traditional compiled binary (fastest).
-   **Hardware Implementations**:
    -   **Amaranth HDL — Pure Church Machine (`church_machine/`)**: A standalone, Church-only 32-bit processor with a clean instruction format and 10 opcodes, implementing ARM-style conditional execution. Includes fused instructions (ELOADCALL, XLOADLAMBDA) for cycle reduction. Hardware features: CR6-specific L-bypass (LOAD from CR6 skips L check), dual-gate TSB (mLoad with G-bit reset write-back, mSave with version/seal/F-bit checks), LAMBDA fast-path RETURN (zero stack access), PP250 no-halt reboot on empty stack, GC protects Slot 0 (ns_start_index=1), Boot.NS at NS_TABLE_BASE (0xFD00). **Running on physical pico-ice FPGA** (iCE40UP5K-SG48) at 12 MHz, ~2573 LUT4 (49%) / 2 SPRAM + 3 BRAM. UART output verified: "CHURCH v1.0" banner, NIA dump, HALT state, button stepping. 3-second startup delay for RP2040 USB bridge init. **UART data loader**: namespace + c-list reprogrammable via serial upload (`upload.py`) without rebuilding bitstream; auto-boots with built-in defaults if no upload within ~1s. Instruction memory stays in Boot ROM (constant content enables Yosys constant propagation — 2591 LUT4 at 49% vs 6324 LCs / 119% for full SPRAM imem, does not fit). ENABLE_CHANGE_SWITCH tested: Yosys reports 4179 LUT4 but nextpnr expands to 7159 LCs (135%), does not fit iCE40UP5K. CHANGE/SWITCH is simulator-only; boot_rom.py conditionally includes CHANGE based on the flag. Two build targets: `uart_test.py` (UartTestTop, UART-enabled, default) and `pico_ice.py` (ChurchPicoIce, Switch-based init, sim_mode). Compile-time feature flags in types.py: ENABLE_SEAL_CHECK (seal/version validation), ENABLE_FUSED_OPS (ELOADCALL/XLOADLAMBDA), ENABLE_CHANGE_SWITCH (CHANGE/SWITCH instructions), ENABLE_GC (PP250 garbage collector). All default False for minimal iCE40 build; set True for full security semantics. Build: `make -C church_machine all`. Flash: `sudo dfu-util -d 1209:b1c0 --alt 1 --download build/uart_test.bin`. Upload data: `python -m church_machine.upload --port /dev/ttyACM1`.
    -   **Amaranth HDL — Sim-64 (`ctmm_amaranth/`)**: A 64-bit GT system with a custom ISA.
    -   **Amaranth HDL — Sim-32 (`rv32_cap_amaranth/`)**: A 32-bit GT system based on RISC-V RV32I with custom Church extensions.
    -   **SystemVerilog (`verilog/`)**: A parallel hardware implementation of the CTMM architecture.

### Web Interface (UI/UX)
The web interface features a dark-themed, IDE-like design with ten views: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Zoom, HP-35 Calculator, Instructions, Tutorial, and Code Browser. The Instructions View includes tabs for Church opcodes, Turing opcodes, Timing, and GT Types. The Assembly Editor includes a "Download Image" button that exports the simulator's current namespace + c-list as a binary file (`church_image.bin`) for command-line upload via `pico_upload.py --image church_image.bin`, and an "Upload to pico-ice" button for direct WebSerial upload (Chrome/Edge, requires top-level browsing context). The upload protocol is 4-byte LE header + 256 x 4-byte LE data words at 115200 baud. Upload workflow: open serial port first, press pico-ice RP2040 reset button, then send data within ~1 second. The `webserial.js` module handles serial communication; `simulator.js` provides `exportHardwareImage()` to extract data; `pico_upload.py` is a standalone upload script with no project dependencies.

### Key Features
-   **Built-in Abstractions**: Includes `Boot`, `Threads`, `SlideRule`, `Abacus`, `Circle`, `CapabilityManager`, `DateTime`, `Lambda`, `Constants`, `FamilyRegistry`, `Stack`, and `HP35`.
-   **Stack Abstraction**: Church-encoded RPN stack using nested pairs, supporting pure lambda calculus operations.
-   **HP35 Calculator Abstraction**: A pure lambda calculus RPN engine, visually recreated with dependencies on Lambda, Stack, and Constants.
-   **FamilyRegistry Abstraction**: Manages secure machine-to-machine binding and remote endpoint registration.
-   **Constants Abstraction**: Provides physical and mathematical constants as unforgeable Abstract GTs.
-   **Instruction Set**: Custom 32-bit CTMM instruction set with Church-specific and Turing-specific operations, including ARM-style condition flags.
-   **State Persistence**: Automatic saving and restoring of state using browser local storage.
-   **Sim-32 GT Format**: 32-bit Golden Token: Version(7) + Index(17) + Permissions(6) + Type(2).
-   **Pure Church Computer REPL**: Interactive Haskell interpreter demonstrating the Pure Church Lambda Machine with symbolic math and Turing rejection.
-   **Church Machine Web Simulator**: Interactive web-based Pure Church Lambda Machine simulator mirroring the Amaranth hardware, proving computational completeness with zero Turing-domain instructions, and demonstrating pipeline modes (Full, Fused, Chained). Implements unified GT-gated memory model where instruction fetch goes through CR7's NS entry, c-list permission enforcement (CLOOMC=X/RX, slots 1+=E only), and CHANGE as first post-boot instruction pattern.

### Unified Server Architecture
All three simulators (CTMM, RV32, Church) are served from a single Flask application, providing dedicated routes, a test harness, and API endpoints for user authentication and state persistence.

### Patent Documentation
-   **`docs/patent-ctmm-unified.md`**: Consolidated unified patent submission covering all claims from both the original CTMM filing and the Pure Church continuation-in-part, with updated claims for dual-gate TSB (mLoad + mSave), B-bit propagation control, DATA objects, safe Turing abstractions, unified address space, and PP250 deterministic GC. 28 claims total.
-   **`docs/patent-ctmm-lambda.md`**: Original initial patent submission (Claims 1-16).
-   **`docs/patent-church-machine-claims.md`**: Original Pure Church continuation-in-part (Claims 17-23).
-   **`docs/patent-church-machine-email.md`**: CIP filing cover letter to patent attorney.

## External Dependencies

-   **Python/Flask**: Unified web server.
-   **Haskell GHC**: Supports the console simulator and Pure Church Computer REPL.
-   **`localStorage`**: Browser API for client-side state persistence.
-   **PostgreSQL**: Database for user accounts and simulator states.
-   **Replit Auth**: User authentication.
-   **Resend**: For sending welcome emails.