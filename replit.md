# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
The Church-Turing Meta-Machine (CTMM) Simulator project develops a comprehensive simulator for a capability-based architecture, integrating Church's lambda calculus and Turing's computational model with Kenneth James Hamer-Hodges' failsafe security design using "Golden Tokens." The project's main purpose is to provide an interactive web interface for exploring capability-based security, secure system design, and foundational computational principles. It aims to advance secure computational models and offer robust tools for learning and practical application in secure system development, ultimately contributing to more secure computational models.

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

## System Architecture

The CTMM simulator provides a web-based visualization using a Python HTTP server, HTML, CSS, and JavaScript for simulation logic and UI. It also includes synthesizable hardware implementations in SystemVerilog and Amaranth HDL.

### Core Architectural Concepts

-   **Capability-based Security**: Implemented via "Golden Tokens" (GTs) for access control.
-   **Register Architecture**:
    -   **Context Registers (CR0-CR7)**: Hold Golden Tokens. CR15 for Namespace root, CR8 for Thread identity.
    -   **Data Registers (DR0-DR15)**: Hold 64-bit numeric values (Sim-64) or 32-bit values (Sim-32).
-   **Golden Token Permissions**: 6 bits (R, W, X, L, S, E) defining access rights, with domain purity enforced (Turing xor Church, never both).
-   **Failsafe Security**: All validation failures are routed to a single FAULT handler.
-   **Deterministic Garbage Collection (PP250)**: A three-phase Mark-Scan-Sweep process.
-   **LAMBDA Instruction**: Enables lightweight, in-scope code application with machine-status fast path.
-   **Network Transparency**: Outform GTs support remote resources via HTTPS, with RPC tunnels using cryptographic keys.
-   **Atomic Abstraction Architecture**: No central OS, VM, privileged mode, or superuser. All system services are atomic abstractions accessed via Golden Tokens, with `mLoad` as the single trusted gate.
-   **Three Dispatch Styles**: Abstractions can resolve method calls via Symbolic resolver (high-security), LAMBDA fast-path (performance), or Traditional compiled binary (fastest).
-   **Hardware Implementations**:
    -   **Amaranth HDL — Sim-64 (`ctmm_amaranth/`)**: 64-bit GT, custom ISA, ARM-style decoder, G-bit GC, exclusive monitor (LOADX/SAVEX), block transfer (LDM/STM). ~3,300 lines, 16 modules.
    -   **Amaranth HDL — Sim-32 (`rv32_cap_amaranth/`)**: 32-bit GT, RISC-V RV32I base ISA + Church custom-0 extensions, version-based GC (7-bit version bump), FNV seal integrity, 128-bit CRs (4×32), 32-bit x0–x31 data registers. ~3,150 lines, 18 modules. Standalone implementation — no shared code with Sim-64.
    -   **SystemVerilog (`verilog/`)**: A parallel hardware implementation of the CTMM architecture.

### Web Interface (UI/UX)
The web interface features a dark-themed, IDE-like design with seven views: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Instructions, Tutorial, and Code Browser.

### Key Features
-   **Built-in Abstractions**: Includes `Boot`, `Threads`, `SlideRule`, `Abacus`, `Circle`, `CapabilityManager`, `DateTime`, and `Lambda`.
-   **Instruction Set**: Custom 32-bit CTMM instruction set with Church-specific and Turing-specific operations, including ARM-style condition flags.
-   **State Persistence**: Automatic saving and restoring of state using browser local storage.

### Sim-32 GT Format
-   32-bit Golden Token: Version(7) + Index(17) + Permissions(6) + Type(2)
-   6 permission bits: R, W, X (Turing domain) | L, S, E (Church domain) -- domain purity enforced
-   M (Machine) is transient microcode elevation, never stored in GT
-   B (Bind) and F (Far/Foreign) are namespace entry metadata, not GT permission bits
-   B and F stored in high bits of namespace entry limit word: word1_limit[31]=B, word1_limit[30]=F, word1_limit[16:0]=limit
-   SAVE rule: SAVE writes a GT to a C-List slot only if B is true on the namespace entry AND the C-List capability has S permission. Faults with BIND if B=0, faults with PERM_S if S missing.
-   VersionSeals: Version(7) + FNV Seal(25) for integrity and GC

### Simulator Comparison
-   **Sim-32 (RV32-Cap)**: RISC-V RV32I base ISA, 32-bit GTs, 17-bit index (131K entries), 7-bit version (128 GC generations), software simulation + Amaranth HDL hardware implementation (`rv32_cap_amaranth/`).
-   **Sim-64 (CTMM)**: Custom ISA, 64-bit GTs, custom processor, with hardware implementations in Amaranth HDL and SystemVerilog.

### Unified Server Architecture
Both simulators are served from a single Flask application, providing dedicated routes for each simulator, a test harness, and API endpoints for user authentication and state persistence.

## External Dependencies

-   **Python/Flask**: Used for the unified web server.
-   **Haskell GHC**: Supports the console simulator.
-   **`localStorage`**: Browser API for client-side state persistence.
-   **PostgreSQL**: Database for user accounts and simulator states.
-   **Replit Auth**: For user authentication.
-   **Resend**: For sending welcome emails.