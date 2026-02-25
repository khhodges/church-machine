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

## System Architecture

The CTMM simulator provides web-based visualization using a Python HTTP server, HTML, CSS, and JavaScript. It also includes synthesizable hardware implementations in SystemVerilog and Amaranth HDL.

### Core Architectural Concepts

-   **Capability-based Security**: Implemented via "Golden Tokens" (GTs) for access control, with 6 permission bits (R, W, X, L, S, E) and enforced domain purity (Turing XOR Church).
-   **Register Architecture**: Separated Context Registers (CR0-CR7 for Golden Tokens, CR15 for Namespace root, CR8 for Thread identity) and Data Registers (DR0-DR15 for numeric values).
-   **Failsafe Security**: All validation failures are routed to a single FAULT handler.
-   **Deterministic Garbage Collection (PP250)**: A four-phase Scan-Identify-Clear-Flip process with bidirectional G-bit. GC is a safe Turing abstraction — atomic Turing machine hidden behind a Church-callable namespace entry, entered via CALL, exited via RETURN.
-   **Safe Turing Abstractions**: Hidden Turing implementations inside Church-callable entries. Church is the armor (interface, security), Turing is the sword inside (implementation, hidden and atomic). Entered only via CALL/LAMBDA with valid GTs, exited only via RETURN.
-   **DATA Objects**: Namespace entries accessed via DREAD/DWRITE Turing instructions with R/W permission checks and bounds validation. DATA objects bridge Church and Turing domains.
-   **Minimal Turing ISA** (inside safe abstractions): DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR + shared RETURN — 11 integer-only instructions, no FP (FP is Church-domain via abstractions).
-   **Unified Address Space**: Memory (MSB 0x00-0xFD), attached devices (MSB 0xFE), and machine register bank (MSB 0xFF) are all segments of one flat address space, all protected by the same GT gate via mLoad. Without the right GT, any address range is unreachable.
-   **Instruction Encoding**: 32-bit: opcode[5] | cond[4] | dst[4] | src[4] | imm[15]. 5-bit opcode supports 20 instructions (10 Church + 10 Turing).
-   **LAMBDA Instruction**: Enables lightweight, in-scope code application with machine-status fast path.
-   **mLoad — Read Gate**: Every read-side instruction goes through mLoad for GT validation (version, seal, bounds) and permission checking. Permission gate table: R→DREAD, W→DWRITE, X→LAMBDA, L→LOAD, S→SAVE(c-list access), E→CALL. M-elevation bypasses permission checks.
-   **mSave — Write Gate**: Every write to a c-list goes through mSave for source GT validation: version match, seal valid, B=1 (bindable), and F-bit detection on target slot (F=1 means FAR/foreign object requiring HTTP/tunnel access). Symmetric counterpart to mLoad in the TSB.
-   **B (Bind) Bit**: NS entry word1 bit 31. mSave requires B=1 on the source GT before committing to c-list. Defaults to 0 — set only by explicit TPERM with B modifier (e.g., `TPERM CR0, EB`).
-   **GT Type Field** (2-bit): Specific cases of NULL Golden Tokens (Inform=0, Outform=1, NULL=2, Abstract=3). NOT used for object classification — R/W/X permission bits determine data vs. code access.
-   **Network Transparency**: Outform GTs support remote resources via HTTPS and RPC tunnels.
-   **Atomic Abstraction Architecture**: No central OS, VM, privileged mode, or superuser. All system services are atomic abstractions accessed via Golden Tokens, with `mLoad` as the single trusted gate.
-   **Three Dispatch Styles**: Abstractions can resolve method calls via Symbolic resolver (high-security), LAMBDA fast-path (performance), or Traditional compiled binary (fastest).
-   **Hardware Implementations**:
    -   **Amaranth HDL — Pure Church Machine (`church_machine/`)**: A standalone, Church-only 32-bit processor with a clean instruction format and 10 opcodes, implementing ARM-style conditional execution. Includes fused instructions (ELOADCALL, XLOADLAMBDA) for cycle reduction.
    -   **Amaranth HDL — Sim-64 (`ctmm_amaranth/`)**: A 64-bit GT system with a custom ISA.
    -   **Amaranth HDL — Sim-32 (`rv32_cap_amaranth/`)**: A 32-bit GT system based on RISC-V RV32I with custom Church extensions.
    -   **SystemVerilog (`verilog/`)**: A parallel hardware implementation of the CTMM architecture.

### Web Interface (UI/UX)
The web interface features a dark-themed, IDE-like design with ten views: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Zoom, HP-35 Calculator, Instructions, Tutorial, and Code Browser. The Instructions View includes tabs for Church opcodes, Turing opcodes, Timing, and GT Types.

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
-   **Church Machine Web Simulator**: Interactive web-based Pure Church Lambda Machine simulator mirroring the Amaranth hardware, proving computational completeness with zero Turing-domain instructions, and demonstrating pipeline modes (Full, Fused, Chained).

### Unified Server Architecture
All three simulators (CTMM, RV32, Church) are served from a single Flask application, providing dedicated routes, a test harness, and API endpoints for user authentication and state persistence.

## External Dependencies

-   **Python/Flask**: Unified web server.
-   **Haskell GHC**: Supports the console simulator and Pure Church Computer REPL.
-   **`localStorage`**: Browser API for client-side state persistence.
-   **PostgreSQL**: Database for user accounts and simulator states.
-   **Replit Auth**: User authentication.
-   **Resend**: For sending welcome emails.