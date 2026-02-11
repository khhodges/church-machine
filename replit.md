# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
This project is a comprehensive simulator for the Church-Turing Meta-Machine (CTMM) capability-based architecture, implementing Kenneth James Hamer-Hodges' failsafe security design with "Golden Tokens" for access control. It integrates concepts from Church's lambda calculus and Turing's computational model to provide a robust and secure execution environment. The simulator aims to foster a deep understanding of capability-based security, secure system design, and foundational computational principles through an interactive web interface.

## User Preferences
- Tooltips positioned below for elements near top of viewport
- Minimal UI with consolidated header controls
- Auto-switching to Dashboard when Reset/Step/Run clicked
- Code persistence in localStorage for session continuity
- Assembly Editor defaults to Access.asm when empty
- Example buttons append code instead of replacing
- Ctrl+Z undoes last code change

## System Architecture

The CTMM simulator provides both a Haskell console interface and a primary web-based visualization. The web interface is built with a Python HTTP server, HTML, CSS, and JavaScript for core simulation logic and UI interactions.

### Core Architectural Concepts

-   **Capability-based Security**: Access control is managed via 64-bit "Golden Tokens" (GTs).
-   **Register Architecture**:
    -   **Context Registers (CR0-CR7)**: Hold Golden Tokens for access rights, with specific roles for CR15 (Namespace root), CR8 (Thread identity), CR7 (Nucleus), and CR6 (current C-List).
    -   **Data Registers (DR0-DR15)**: Hold 64-bit numeric values.
-   **Golden Token Structure**: A 64-bit key comprising Offset, Permissions (R, W, X, L, S, E, B, M, F, G bits), and Spare bits.
-   **Namespace Entry**: A 3-word descriptor for each object (Location, Limit, Seals).
-   **MAC Validation**: Hardware-enforced security check during `LOAD` operations.
-   **Boot Sequence**: A 4-step process for secure CTMM initialization.
-   **Permission Domains (Mutually Exclusive)**:
    -   **Church (Capability)**: L, S (Load/Save Golden Tokens)
    -   **Turing (Data)**: R, W, X (Read/Write data, Execute code)
    -   **Lambda**: E (Enter abstraction)
    -   **Meta**: B, M, F, G (Bound, Machine, Foreign, Garbage collection)
-   **Failsafe Security**: All validation failures use a single FAULT handler.
-   **Deterministic Garbage Collection**: Managed by the G (Garbage) permission bit.

### Web Interface (UI/UX)

The web interface features seven views:

1.  **Dashboard**: Thread View with registers, flags, and boot sequence.
2.  **Namespace Browser**: Visual exploration of the capability namespace.
3.  **Assembly Editor**: Syntax-highlighted code editor for CTMM assembly.
4.  **Capabilities Explorer**: Detailed view and interactive editing of Golden Tokens.
5.  **Instructions**: ARM binary format design reference for CTMM instructions.
6.  **Tutorial**: Interactive lessons on CTMM concepts.
7.  **Code Browser**: Source code viewer.

### Key Features

-   **Built-in Abstractions**: Includes `Boot`, `Threads`, `SlideRule`, `Abacus`, `Circle`, `CapabilityManager`, `DateTime`, and `Lambda`.
-   **Instruction Set**: Comprehensive Church-specific (LOAD, SAVE, LOADX, SAVEX, LDM, STM, CALL, RETURN, CHANGE, SWITCH, TPERM) and Turing-specific (Arithmetic, Logic, Shifts, Compare, Branch, LDI) instructions.
    -   **SWITCH Target Field**: 3-bit field selects destination system register (CR8, CR9, CR10, CR11-14, CR15).
    -   **LOADX/SAVEX**: Atomic load/store with exclusive monitors.
    -   **LDM/STM**: Load/Store Multiple CRs.
    -   **LDI**: Load 22-bit immediate.
    -   **TPERM Presets**: 14 permission preset codes.
-   **Condition Codes**: ARM-style condition flags for conditional execution.
-   **State Persistence**: Automatic saving and restoring using local storage.

### Hardware Implementations

The project includes synthesizable hardware implementations:

-   **SystemVerilog (`verilog/`)**: Full CTMM architecture including register files, permission checking, GC unit, instruction decoder, and core processor logic.
-   **Amaranth HDL (`ctmm_amaranth/`)**: A Python-based HDL implementation of the CTMM, providing an alternative to SystemVerilog.

### Instruction Format (Standardized)

All instructions use a 32-bit format: `[31:27] = Opcode (5 bits)`, `[26:23] = Condition (4 bits)`, `[22] = I-bit`, `[21:0] = Operands (22 bits)`. Only CR0-CR7 are instruction-addressable to prevent privilege escalation; CR8-CR15 are protected, except during the boot sequence.

## Simulator Comparison: Sim-64 (CTMM) vs Sim-32 (RV32-Cap)

This project contains two independent capability-based security simulators. They share the same foundational security philosophy (Golden Tokens, capability registers, permission domains) but differ in architecture, instruction sets, and token width. Changes to one simulator never affect the other.

### Side-by-Side Comparison

| Feature | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|---------|---------------|-------------------|
| **Directory** | `web/` | `riscv_cap/` |
| **Golden Token Width** | 64-bit | 32-bit |
| **GT Format** | Offset + Permissions + Spare | Version(5) + Index(15) + Permissions(10) + Type(2) |
| **Data Registers** | DR0-DR15 (64-bit each) | x0-x31 (32-bit each, RISC-V ABI names) |
| **Capability Registers** | CR0-CR15 (hold 64-bit GTs) | CR0-CR15 (128-bit each, 4×32-bit words) |
| **Base ISA** | Custom CTMM (ARM-style encoding) | RISC-V RV32I (standard RISC-V encoding) |
| **Instruction Width** | 32-bit (5-bit opcode) | 32-bit (7-bit opcode, RISC-V format) |
| **Church Instructions** | LOAD, SAVE, LOADX, SAVEX, LDM, STM, CALL, RETURN, CHANGE, SWITCH, TPERM (11) | CAP.LOAD, CAP.SAVE, CAP.CALL, CAP.RETURN, CAP.CHANGE, CAP.SWITCH (6) |
| **Church Opcode Space** | Dedicated 5-bit opcodes | 4 RISC-V custom opcodes: 0x2B (LOAD), 0x5B (CALL), 0x7B (SAVE), 0x0B (RETURN/CHANGE/SWITCH) |
| **Condition Codes** | ARM-style (N, Z, C, V) on all instructions | None (RISC-V uses explicit branch instructions) |
| **Namespace Entries** | 3 words (Location, Limit, Seals) | 3 × 32-bit words (Location, Limit, VersionSeals) |
| **Max Namespace Entries** | Offset-dependent | 32,768 (15-bit index) |
| **Permission Bits** | R, W, X, L, S, E, B, M, F, G (10 bits) | R, W, X, L, S, E, B, M, F, G (10 bits, same) |
| **GT Type Field** | None (implicit) | 2-bit: Inform, Outform, Literal, Abstract |
| **GT Version Field** | None | 5-bit version tag |
| **MAC Validation** | Yes (hardware-enforced hash) | Simplified |
| **Garbage Collection** | Full Mark-Scan-Sweep with G bit | G bit present in permissions |
| **Web Views** | 7 (Dashboard, Namespace, Assembly, Capabilities, Instructions, Tutorial, Code Browser) | 5 (Dashboard, Namespace, Assembly, Capabilities, Instructions) |
| **Built-in Abstractions** | Boot, Threads, SlideRule, Abacus, Circle, CapabilityManager, DateTime, Lambda | Boot namespace with core objects |
| **Hardware Implementations** | SystemVerilog (`verilog/`) + Amaranth HDL (`ctmm_amaranth/`) | Software simulation only |

### Key Architectural Differences

**Shared Security Principles (both simulators):**
-   Only CR0-CR7 are instruction-addressable (3-bit encoding)
-   System registers CR8-CR15 are protected from direct instruction access
-   SWITCH is the privileged mechanism to write to system registers
-   Permission domains are mutually exclusive (Church: L,S / Turing: R,W,X / Lambda: E / Meta: B,M,F,G)
-   Failsafe security: validation failures route to a single FAULT handler

**Sim-64 (CTMM) Unique Features:**
-   Custom instruction set with ARM-style conditional execution on every instruction
-   Richer Church instruction set (11 vs 6): includes LOADX/SAVEX (atomic), LDM/STM (multiple), TPERM (permission presets)
-   MAC validation for hardware-enforced integrity checking
-   I-bit variants on CHANGE/SWITCH (register vs C-List lookup)
-   Full deterministic garbage collection with Mark-Scan-Sweep cycle
-   Tutorial and Code Browser views for educational use

**Sim-32 (RV32-Cap) Unique Features:**
-   Standard RISC-V RV32I base ISA (widely understood, toolchain compatible)
-   32 general-purpose data registers (vs 16 in CTMM)
-   GT includes Version (5-bit) and Type (2-bit) fields for richer token metadata
-   Church instructions encoded in RISC-V custom opcode space (clean ISA extension)
-   Simpler, more focused instruction set (6 core Church operations)

### Independence

These simulators are fully independent codebases:
-   **Sim-64 files**: `web/` directory (HTML/CSS/JS) + `verilog/` (SystemVerilog) + `ctmm_amaranth/` (Amaranth HDL)
-   **Sim-32 files**: `riscv_cap/` directory only (Python server + HTML/CSS/JS)
-   Only one web simulator can be active on port 5000 at a time
-   Currently active: **Sim-32 (RV32-Cap)** via workflow "RV32-Cap Simulator"

## RV32-Cap Simulator (Sim-32) Details

The `riscv_cap/` directory contains the standalone web-based Sim-32 simulator.

### Architecture
-   **RV32I Base**: Full integer instruction set (R, I, S, B, U, J types) with x0-x31 data registers
-   **16 Capability Registers**: CR0-CR15, each 128-bit (4 × 32-bit words). CR6=C-List, CR7=Nucleus, CR8=Thread, CR15=Namespace
-   **32-bit Golden Token Format**: [31:27] Version (5 bits), [26:12] Index (15 bits), [11:2] Permissions (G,F,M,B,S,E,L,X,W,R), [1:0] Type (Inform/Outform/Literal/Abstract)
-   **6 Church Instructions across 4 opcodes**:
    -   **0x2B (LOAD)**: J-type, `CAP.LOAD CRd, CRs, index` — loads capability from namespace into CR. CRs must have L permission.
    -   **0x5B (CALL)**: J-type, `CAP.CALL CRs` — protected call. Pushes CR5+CR6+CR7+PC to call stack. Sets callee CR6 with M-bit, CR7 from abstraction. Clears CR5.
    -   **0x7B (SAVE)**: J-type, `CAP.SAVE CRsrc, CRdst, index` — saves capability to namespace. CRdst must have S permission.
    -   **0x0B (custom-0)**: R-type, funct3 selects: 000=RETURN, 001=CHANGE, 010=SWITCH, 011=TPERM
-   **TPERM**: `CAP.TPERM rd, CRs` — Tests GT permissions, validity, type, and stack indicators. Result in rd: [9:0]=permission bits, [10]=stackFrames, [11]=stackSpace, [12]=valid, [14:13]=type.
-   **Stack Indicators**: Two 1-bit flags set automatically by CALL/RETURN microcode. `stackSpace`=1 means room for another CALL. `stackFrames`=1 means at least one frame to RETURN from. CALL FAULTs on stack overflow. Visible on Dashboard.
-   **CR5 Save Area**: Programmer-controlled register for call frame data. Hardware pushes/restores CR5 on CALL/RETURN.
-   **Call Stack**: Internal stack stores {CR5, CR6, CR7, PC} frames. RETURN restores and sets M-bit on CR6.
-   **CHANGE**: Full atomic thread swap — saves current x0-x31, CR0-CR8, PC to thread table, loads target thread context. CR9-CR15 unchanged. Requires E (Enter) permission.
-   **Thread Table**: Stores complete thread contexts indexed by GT namespace index. Created on first CHANGE.
-   **Register Clearing**: Software responsibility — caller clears before CALL, callee clears before RETURN. Not hardware-enforced.
-   **Permission Domain Separation**: Church (L,S) and Turing (R,W,X) bits are mutually exclusive on the same GT. CR5 with L,S can hold a GT with R,W inside (layered save area).
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

-   **Python HTTP Server**: For serving the web interface.
-   **Haskell GHC**: For the console simulator.
-   **`localStorage`**: Browser API for client-side state persistence.
-   **PostgreSQL**: Database for user accounts and simulator states.
-   **Replit Auth**: For user authentication.
-   **Resend**: For sending welcome emails.