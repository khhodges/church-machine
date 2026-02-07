# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
This project is a comprehensive simulator for the Church-Turing Meta-Machine (CTMM) capability-based architecture. It implements Kenneth James Hamer-Hodges' failsafe security design, utilizing "Golden Tokens" (64-bit capability keys) for all access control. The system integrates concepts from Church's lambda calculus and Turing's computational model to provide a robust and secure execution environment. The simulator aims to provide a deep understanding of capability-based security, secure system design, and the foundational principles of computation through an interactive web interface. The project envisions providing an interactive web interface for understanding capability-based security, secure system design, and fundamental computational principles.

## Frozen Architecture Decisions

### Permission Domains (Mutually Exclusive)
| Domain | Permissions | Purpose |
|--------|-------------|---------|
| **Church (Capability)** | L, S | Load/Save Golden Tokens from/to C-Lists |
| **Turing (Data)** | R, W, X | Read/Write data, Execute code |
| **Lambda** | E | Enter abstraction (invoke protected service) |
| **Meta** | B, M, F, G | Bound, Machine, Foreign, Garbage collection |

**Rules:**
- L authorizes C-List traversal (loading capabilities)
- S authorizes C-List modification (saving capabilities)
- R, W, X are for data/code operations only - never for capability access
- E is exclusively for entering abstractions - not for loading or data access
- These domains are mutually exclusive by design

### Instruction I-bit Variants
Both CHANGE and SWITCH support I-bit variants:
- **I=0**: Register source (CRs contains capability)
- **I=1**: C-List lookup (CRn[idx] provides capability)

CHANGE creates new thread GT → CR8; SWITCH copies capability → CR8-15.

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
-   **Instruction Set**: Comprehensive set of Church-specific (LOAD, SAVE, LOADX, SAVEX, LDM, STM, CALL, RETURN, CHANGE, SWITCH, TPERM) and Turing-specific (Arithmetic, Logic, Shifts, Compare, Branch, LDI) instructions.
    -   **SWITCH Target Field**: 3-bit field selects destination system register: 0=CR8(Thread), 1=CR9(Interrupt), 2=CR10(DFault), 3-6=CR11-14(future), 7=CR15(Namespace)
    -   **LOADX/SAVEX**: Atomic load/store with per-thread exclusive monitors for lock-free synchronization
    -   **LDM/STM**: Load/Store Multiple CRs with mLoad/mSave security validation
    -   **LDI**: Load 22-bit immediate constant into data register
    -   **TPERM Presets**: 14 preset codes (0=CLEAR, 1=R, 2=RW, 3=X, 4=RX, 5=RWX, 6=L, 7=S, 8=E, 9=B, 10=M, 11=F, 12=G, 13=LS); codes 6-12 follow Lambda permission order (L,S,E,B,M,F,G); codes 14-15 reserved (FAULT)
-   **Condition Codes**: ARM-style condition flags for conditional execution.
-   **State Persistence**: Automatic saving and restoring of simulator state using local storage, with export/import functionality.
-   **Permission Management**: Permission validation rules are implemented with mutually exclusive domains:
    -   **Capability (Church)**: L (Load), S (Save) - Golden Token operations
    -   **Data (Turing)**: R (Read), W (Write), X (Execute) - code/data operations
    -   **Lambda**: E (Enter) - invoke protected abstraction
    -   **Meta**: B (Bound), M (Machine), F (Foreign), G (Garbage) - system permissions
-   **Failsafe Security**: All validation failures use a single FAULT handler for secure error management without information leakage.
-   **Deterministic Garbage Collection**: The G (Garbage) permission bit enables deterministic GC by marking entries during collection cycles. When a valid key accesses a Namespace entry via LOAD, the G bit is reset to FALSE. The "GC Scan" button in the Namespace Browser runs a full Mark-Scan-Sweep cycle over the DNA hierarchy.

## Verilog Hardware Implementation

The `verilog/` directory contains a synthesizable SystemVerilog implementation of the CTMM architecture:

-   **ctmm_pkg.sv**: Package with Golden Token structure, 10 permission bits (R,W,X,L,S,E,B,M,F,G), opcodes, condition codes, fault types, and boot states
-   **ctmm_registers.sv**: Register file implementing CR0-CR15 (context/capability) and DR0-DR15 (data) with special registers for Namespace (CR15), Thread (CR8), C-List (CR6), and Nucleus (CR7)
-   **ctmm_perm_check.sv**: Hardware permission validation with bounds checking, MAC validation, and G bit detection for namespace access
-   **ctmm_gc_unit.sv**: Garbage collection unit implementing Mark-Scan-Sweep phases with G bit state machine
-   **ctmm_decoder.sv**: Instruction decoder for Church (LOAD, SAVE, LOADX, SAVEX, LDM, STM, CALL, RETURN, CHANGE, SWITCH, TPERM) and Turing (arithmetic, logic, branch, LDI) instructions with ARM-style condition code evaluation; exports switch_target[2:0] from [18:16] for system register routing
-   **ctmm_loadx_savex.sv**: Atomic load/store exclusive with 16 per-thread exclusive monitors
-   **ctmm_ldm_stm.sv**: Multiple register load/store with mLoad/mSave security per transfer
-   **ctmm_core.sv**: Top-level processor core integrating all components with boot sequence state machine; SWITCH/CHANGE runtime execution writes to CR8 (target=0) or CR15 (target=7), I-bit variants supported
-   **ctmm_tb.sv**: Testbench for verification

The hardware captures the architectural concepts; a full execution pipeline would be expanded for production silicon.

### Instruction Format (Standardized)

All instructions use a 32-bit format with 5-bit opcodes:
```
[31:27] = Opcode (5 bits)
[26:23] = Condition (4 bits)
[22]    = I-bit (immediate/register mode)
[21:0]  = Operands (22 bits)
```

**Security by Design**: Only CR0-CR7 are instruction-addressable via 3-bit encoding. System registers CR8-CR15 (Thread, Nucleus, C-List, Namespace) are physically unreachable through instruction encoding to prevent privilege escalation.

**Boot Sequence Exception**: The only time CR8 and CR15 can be addressed is during boot:
- CR15 (Namespace): Hardwired GT at offset 0, M permission only
- CR8 (Thread): Hardwired GT at offset 3, M permission only

## Amaranth HDL Implementation

The `ctmm_amaranth/` directory contains a Python-based HDL (Amaranth) implementation of the CTMM architecture, providing an alternative to the SystemVerilog in `verilog/`. All 15 modules elaborate and simulate successfully.

### Module Structure
-   **types.py**: Enums (opcodes, conditions, faults, boot states), permission constants, register indices
-   **layouts.py**: StructLayouts for GoldenToken (64-bit), CapabilityReg (256-bit), NamespaceEntry, CondFlags, ExclMonitor
-   **registers.py**: Register file (CR0-CR15 + DR0-DR15 + condition flags) with word-level and GT-level write ports
-   **decoder.py**: Combinational instruction decoder with ARM-style condition evaluation
-   **perm_check.py**: Permission/bounds/MAC validation (combinational)
-   **gc_unit.py**: Deterministic GC with Mark-Scan-Sweep FSM and G-bit management
-   **mload.py / msave.py**: Trusted micro-routines for capability load/save with multi-step FSMs
-   **load.py / save.py**: Instruction wrappers delegating to mload/msave
-   **call.py / ret.py**: CALL (two-phase mload: C-List→CR6, CR6→CR7) and RETURN (restore CR6/CR7/NIA)
-   **switch.py / change.py**: SWITCH (copy cap to CR8-CR15) and CHANGE (context switch with save/restore loop)
-   **loadx_savex.py**: Atomic load/store exclusive with 16 per-thread monitors
-   **ldm_stm.py**: Load/Store Multiple CRs with priority encoder
-   **core.py**: Top-level integration (registers + decoder + perm_check + GC + boot FSM + ALU)
-   **testbench.py**: Simulation testbench verifying boot sequence, Turing instructions, and fault detection

### Amaranth-Specific Notes
-   Views over StructLayouts require `.as_value()` before slicing (e.g., `view.field.as_value()[:32]`)
-   Signals can only be driven from one clock domain (d.comb OR d.sync, not both)
-   All modules verified: `python -c "from ctmm_amaranth.core import CTMMCore; ..."` elaborates cleanly

## RV32-Cap Simulator (New)

The `riscv_cap/` directory contains a standalone web-based simulator for a RISC-V (RV32I) processor extended with 6 Church capability instructions and 32-bit Golden Tokens.

### Architecture
-   **RV32I Base**: Full integer instruction set (R, I, S, B, U, J types) with x0-x31 data registers
-   **16 Capability Registers**: CR0-CR15, each 128-bit (4 × 32-bit words). CR6=C-List, CR7=Nucleus, CR8=Thread, CR15=Namespace
-   **32-bit Golden Token Format**: [31:27] Version (5 bits), [26:12] Index (15 bits), [11:2] Permissions (G,F,M,B,S,E,L,X,W,R), [1:0] Type (Inform/Outform/Literal/Abstract)
-   **6 Church Instructions**: CAP.LOAD, CAP.SAVE, CAP.CALL, CAP.RETURN, CAP.CHANGE, CAP.SWITCH (using RISC-V custom-0 opcode 0x0B)
-   **Namespace Table**: Up to 32,768 entries, each 3 × 32-bit words (Location, Limit, VersionSeals). Slot address = Index × 3

### File Structure
-   **main.py**: Flask web server (port 5000)
-   **index.html**: Single-page app with 5 views (Dashboard, Namespace, Assembly, Capabilities, Instructions)
-   **styles.css**: Dark-themed IDE-like styling
-   **simulator.js**: Core simulation engine (RV32I + Church instructions, GT helpers, boot sequence, event system)
-   **assembler.js**: Two-pass assembler (RV32I + Church mnemonics, labels, pseudo-instructions)
-   **app.js**: UI controller connecting simulator to web interface

### Running
Workflow "RV32-Cap Simulator" runs `cd riscv_cap && python main.py` on port 5000.

## External Dependencies

-   **Python HTTP Server**: Serves the web interface files.
-   **Haskell GHC**: For the console-based simulator backend.
-   **`localStorage`**: Browser API used for client-side state persistence.
-   **PostgreSQL**: Database for storing user accounts and simulator states.
-   **Replit Auth**: For user authentication.
-   **Resend**: For sending welcome emails on user registration.