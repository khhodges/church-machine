# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
This project develops a comprehensive simulator for the Church-Turing Meta-Machine (CTMM) capability-based architecture, incorporating Kenneth James Hamer-Hodges' failsafe security design with "Golden Tokens." The simulator integrates concepts from Church's lambda calculus and Turing's computational model to create a secure execution environment. Its primary purpose is to provide an interactive web interface for understanding capability-based security, secure system design, and foundational computational principles. The project aims to advance secure computational models and offer robust tools for both learning and practical application in secure system development.

## User Preferences
- Tooltips positioned below for elements near top of viewport
- Minimal UI with consolidated header controls
- Auto-switching to Dashboard when Reset/Step/Run clicked
- Code persistence in localStorage for session continuity
- Assembly Editor defaults to Access.asm when empty
- Example buttons append code instead of replacing
- Ctrl+Z undoes last code change

## System Architecture

The CTMM simulator offers both a Haskell console interface and a web-based visualization. The web interface utilizes a Python HTTP server, HTML, CSS, and JavaScript for simulation logic and UI.

### Core Architectural Concepts

-   **Capability-based Security**: Access control via 64-bit "Golden Tokens" (GTs).
-   **Register Architecture**:
    -   **Context Registers (CR0-CR7)**: Hold Golden Tokens. CR15 for Namespace root, CR8 for Thread identity, CR7 for Nucleus, CR6 for current C-List.
    -   **Data Registers (DR0-DR15)**: Hold 64-bit numeric values.
-   **Golden Token Structure**: 64-bit key with Offset, Permissions (R, W, X, L, S, E, B, M, F, G bits), and Spare bits.
-   **Namespace Entry**: A 3-word descriptor (Location, Limit, Seals).
-   **MAC Validation**: Hardware-enforced security check during `LOAD`.
-   **mLoad Master Validation**: Single trusted path for all namespace access — every Church instruction routes through mLoad, which enforces permission check, bounds check, MAC validation, and G-bit reset.
-   **Boot Sequence**: A 4-step secure initialization process.
-   **Permission Domains**: Mutually exclusive for Church (L, S), Turing (R, W, X), Lambda (E), and Meta (B, M, F, G) operations.
-   **Failsafe Security**: All validation failures route to a single FAULT handler.
-   **Deterministic Garbage Collection**: G-bit reset on every namespace access via mLoad; three-phase Mark-Scan-Sweep cycle with DNA tree walk (no permission filtering during scan).

### Web Interface (UI/UX)

The web interface provides seven views: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Instructions, Tutorial, and Code Browser. The styling is a dark-themed, IDE-like design.

### Key Features

-   **Built-in Abstractions**: Includes `Boot`, `Threads`, `SlideRule`, `Abacus`, `Circle`, `CapabilityManager`, `DateTime`, and `Lambda`.
-   **Instruction Set**: Custom CTMM instruction set with Church-specific (LOAD, SAVE, LOADX, SAVEX, LDM, STM, CALL, RETURN, CHANGE, SWITCH, TPERM) and Turing-specific (Arithmetic, Logic, Shifts, Compare, Branch, LDI) instructions.
    -   All instructions use a 32-bit format: `[31:27] = Opcode (5 bits)`, `[26:23] = Condition (4 bits)`, `[22] = I-bit`, `[21:0] = Operands (22 bits)`.
    -   Only CR0-CR7 are instruction-addressable to prevent privilege escalation.
-   **Condition Codes**: ARM-style condition flags for conditional execution.
-   **State Persistence**: Automatic saving and restoring using browser local storage.

### Hardware Implementations

The project includes synthesizable hardware implementations in:
-   **SystemVerilog (`verilog/`)**: Full CTMM architecture.
-   **Amaranth HDL (`ctmm_amaranth/`)**: Python-based HDL implementation.

### Simulator Comparison: Sim-64 (CTMM) vs Sim-32 (RV32-Cap)

The project includes two independent capability-based security simulators sharing foundational security philosophies but differing in architecture, instruction sets, and token width.

-   **Sim-64 (CTMM)**: Custom ISA, 64-bit GTs, custom processor, hardware implementations.
-   **Sim-32 (RV32-Cap)**: RISC-V RV32I base ISA, 32-bit GTs, software simulation only. Uses custom RISC-V opcodes for capability instructions.

### RV32-Cap Simulator (Sim-32) Details

This simulator (`riscv_cap/`) uses a Flask web server, `index.html`, `styles.css`, `simulator.js`, `assembler.js`, and `app.js`.

-   **RV32I Base**: Full integer instruction set with x0-x31 data registers.
-   **16 Capability Registers**: CR0-CR15, each 128-bit.
-   **32-bit Golden Token Format**: Version (5 bits), Index (15 bits), Permissions (10 bits), Type (2 bits).
-   **Church Instructions**: Seven instructions (`CAP.LOAD`, `CAP.CALL`, `CAP.SAVE`, `CAP.RETURN`, `CAP.CHANGE`, `CAP.SWITCH`, `CAP.TPERM`) across four RISC-V custom opcodes.
-   **Web Views**: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Instructions, Docs.
-   **MAC Seal Validation**: 27-bit FNV hash seal in `VersionSeals` checked on `LOAD` and `CALL`.
-   **mLoad/mLoadByIndex**: Unified validation path for all Church instructions — validates version, MAC, permissions, and resets G-bit on every namespace access.
-   **Deterministic Garbage Collection**: G-bit reset via mLoad on every access; three-phase Mark-Scan-Sweep cycle with DNA tree walk from registers, call stack, and thread table (no permission filtering during scan); version bump on sweep.

## External Dependencies

-   **Python HTTP Server**: For serving web interfaces.
-   **Haskell GHC**: For the console simulator.
-   **`localStorage`**: Browser API for client-side state persistence.
-   **PostgreSQL**: Database for user accounts and simulator states.
-   **Replit Auth**: For user authentication.
-   **Resend**: For sending welcome emails.