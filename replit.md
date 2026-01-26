# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
This project is a comprehensive simulator for the Church-Turing Meta-Machine (CTMM) capability-based architecture. It implements Kenneth James Hamer-Hodges' failsafe security design, utilizing "Golden Tokens" (64-bit capability keys) for all access control. The system integrates concepts from Church's lambda calculus and Turing's computational model to provide a robust and secure execution environment. The simulator aims to provide a deep understanding of capability-based security, secure system design, and the foundational principles of computation through an interactive web interface. The project envisions providing an interactive web interface for understanding capability-based security, secure system design, and fundamental computational principles.

## User Preferences
- Tooltips positioned below for elements near top of viewport
- Minimal UI with consolidated header controls
- Auto-switching to Dashboard when Reset/Step/Run clicked
- Code persistence in localStorage for session continuity
- Assembly Editor defaults to Access.asm when empty
- Example buttons append code instead of replacing
- Ctrl+Z undoes last code change

## System Architecture

The CTMM simulator provides both a Haskell console interface and a primary web-based visualization. The web interface is built with a Python HTTP server, HTML for structure, CSS for styling, and JavaScript for core simulation logic and UI interactions.

### Core Architectural Concepts

-   **Capability-based Security**: All access control is managed via "Golden Tokens" (GTs). The Boot C-List is the authoritative source for all GT definitions.
-   **Register Architecture**:
    -   **Context Registers (CR0-CR7)**: Hold Golden Tokens for access rights. CR15 serves as the Namespace root, CR8 for Thread identity, CR7 for the Nucleus (kernel capability), and CR6 for the current C-List.
    -   **Data Registers (DR0-DR15)**: Hold 64-bit numeric values for computation.
-   **Golden Token Structure**: A 64-bit key composed of Offset (index into Namespace Table), Permissions (R, W, X, L, S, E, B, M, F, G bits), and Spare bits. The `M` bit distinguishes hardware-level from software-level permissions, `F` indicates remote URL location, and `G` is the deterministic garbage collection flag.
-   **Namespace Entry**: A 3-word descriptor for each object (Location, Limit, Seals). Namespace objects contain only raw 3-word entries without embedded permissions.
-   **MAC Validation**: Hardware-enforced security check during `LOAD` operations, comparing a calculated hash against the stored MAC.
-   **Boot Sequence**: A 4-step process (Fault Restart, Load Namespace, Initialize Thread, Load Nucleus) to securely initialize the CTMM.

### Web Interface (UI/UX)

The web interface is composed of seven distinct views:

1.  **Dashboard**: Displays Thread View with registers (Church CR0-CR15 and Turing DR0-DR15), condition flags, and boot sequence.
2.  **Namespace Browser**: Visual exploration of the capability namespace, displaying objects, C-List hierarchy, and management tools.
3.  **Assembly Editor**: Syntax-highlighted code editor for CTMM assembly with example programs and output tabs.
4.  **Capabilities Explorer**: Detailed view of Golden Token structure, interactive editing of bit fields, and live MAC validation. Includes Context Register buttons for quick access to GT details.
5.  **Instructions**: ARM binary format design reference with visual bit-field diagrams for Church and Turing instructions.
6.  **Tutorial**: Interactive lessons explaining CTMM concepts, Golden Tokens, permissions, and guided examples.
7.  **Code Browser**: Source code viewer with file tree panel, syntax highlighting, line numbers, search, and navigation tools.

### Key Features

-   **Built-in Abstractions**: Includes `Boot` (root namespace), `Threads` (user identities), `SlideRule` (IEEE 754 float operations), `Abacus` (64-bit integer operations), `Circle` (geometric calculations), `CapabilityManager` (GT creation), `DateTime` (ISO 8601 date/time), and `Lambda` (Church calculus primitives).
-   **CapabilityManager Abstraction**: Creates new Golden Tokens for objects with specific permissions.
-   **Instruction Set**: Comprehensive set of Church-specific (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM) and Turing-specific (Arithmetic, Logic, Shifts, Compare, Branch) instructions.
-   **Condition Codes**: ARM-style condition flags for conditional execution.
-   **State Persistence**: Automatic saving and restoring of simulator state using local storage, with export/import functionality.
-   **Permission Management**: Permission validation rules are implemented, defining categories (Data, Capability, Protected, Meta) and ensuring normalization across all mutation paths.
-   **Failsafe Security**: All validation failures use a single FAULT handler for secure error management without information leakage.
-   **Deterministic Garbage Collection**: The G (Garbage) permission bit enables deterministic GC by marking entries during collection cycles. When a valid key accesses a Namespace entry via LOAD, the G bit is reset to FALSE. The "GC Scan" button in the Namespace Browser runs a full Mark-Scan-Sweep cycle over the DNA hierarchy.

## Verilog Hardware Implementation

The `verilog/` directory contains a synthesizable SystemVerilog implementation of the CTMM architecture:

-   **ctmm_pkg.sv**: Package with Golden Token structure, 10 permission bits (R,W,X,L,S,E,B,M,F,G), opcodes, condition codes, fault types, and boot states
-   **ctmm_registers.sv**: Register file implementing CR0-CR15 (context/capability) and DR0-DR15 (data) with special registers for Namespace (CR15), Thread (CR8), C-List (CR6), and Nucleus (CR7)
-   **ctmm_perm_check.sv**: Hardware permission validation with bounds checking, MAC validation, and G bit detection for namespace access
-   **ctmm_gc_unit.sv**: Garbage collection unit implementing Mark-Scan-Sweep phases with G bit state machine
-   **ctmm_decoder.sv**: Instruction decoder for Church (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM) and Turing (arithmetic, logic, branch) instructions with ARM-style condition code evaluation
-   **ctmm_core.sv**: Top-level processor core integrating all components with boot sequence state machine
-   **ctmm_tb.sv**: Testbench for verification

The hardware captures the architectural concepts; a full execution pipeline would be expanded for production silicon.

## External Dependencies

-   **Python HTTP Server**: Serves the web interface files.
-   **Haskell GHC**: For the console-based simulator backend.
-   **`localStorage`**: Browser API used for client-side state persistence.
-   **PostgreSQL**: Database for storing user accounts and simulator states.
-   **Replit Auth**: For user authentication.
-   **Resend**: For sending welcome emails on user registration.