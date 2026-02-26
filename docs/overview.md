# CTMM Project Overview

## What Is This Project?

This project implements simulators for Kenneth James Hamer-Hodges' **Church-Turing Meta-Machine (CTMM)** capability-based security architecture. The CTMM is a hardware architecture that enforces failsafe security through **Golden Tokens** -- unforgeable capability keys that mediate all access to system resources. Named after Alonzo Church and Alan Turing, the architecture integrates lambda calculus principles (controlled access through abstraction) with Turing's computational model (data processing and execution).

The project contains two independent simulators that share the same foundational security philosophy but differ in instruction set architecture, token width, and implementation details. Each simulator swims in its own private space -- changes to one never affect the other.

---

## The Two Simulators

### Sim-32 (RV32-Cap) -- Primary Implementation

Located in the `riscv_cap/` directory, Sim-32 extends the standard RISC-V RV32I instruction set with capability-based security. It uses 32-bit Golden Tokens with 6 permission bits (R, W, X, L, S, E), a 7-bit version field for GC invalidation, and a 17-bit namespace index supporting 131,072 entries. The web interface provides six views: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Instructions, and Docs.

### Sim-64 (CTMM)

Located in the `web/` directory, Sim-64 is the original CTMM simulator. It uses a custom ARM-style instruction set with 64-bit Golden Tokens. The web interface provides seven views: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Instructions, Tutorial, and Code Browser. Hardware implementations exist in SystemVerilog (`verilog/`) and Amaranth HDL (`ctmm_amaranth/`).

---

## Shared Architectural Principles

Both simulators enforce the same core security model:

- **Failsafe Security**: Every validation failure routes to a single FAULT handler. There are no silent failures or undefined behaviors.
- **Golden Tokens**: All access rights are embodied in unforgeable capability keys. No raw memory addressing is permitted.
- **Capability Registers (CR0-CR15)**: 16 capability registers hold Golden Tokens. CR0-CR7 are instruction-addressable via 3-bit encoding. CR8-CR15 are system registers, protected from direct instruction access.
- **Two Permission Domains (Domain Purity)**: A GT may carry Turing permissions (R, W, X) or Church permissions (L, S, E), but never both. This is enforced in hardware -- any attempt to mix domains raises a DOMAIN_PURITY fault.
  - **Turing (R, W, X)**: Read, Write, and Execute data/code
  - **Church (L, S, E)**: Load, Save, and Enter capabilities/abstractions
- **M Permission -- Transient Only**: M (Machine/Microcode) is never stored in a GT. It exists only as a transient hardware signal during microcode execution, invisible to user instructions.
- **B and F -- Namespace Metadata**: B (Bind) and F (Far/Foreign) are properties of namespace entries, not GT permission bits. B controls whether a capability can be copied; F marks remote resources.
- **C-List Mediation**: LOAD and SAVE operations go through capability-mediated C-Lists, never through raw memory addresses.
- **SWITCH as Privilege Gate**: The only way to write to system registers CR8-CR15 is through the SWITCH instruction.
- **mLoad as Sole Trusted Path**: All capability register writes route through the mLoad validation pipeline.

---

## Quick Comparison

| Feature | Sim-32 (RV32-Cap) | Sim-64 (CTMM) |
|---------|-------------------|---------------|
| **Directory** | `riscv_cap/` | `web/` |
| **Golden Token Width** | 32-bit | 64-bit |
| **GT Format** | Version(7) + Index(17) + Perms(6) + Type(2) | Offset(32) + Spare(23) + Type(2) + G(1) + Perms(6) |
| **GT Permission Bits** | 6 (R, W, X, L, S, E) | 6 (R, W, X, L, S, E) |
| **Permission Domains** | Turing (RWX) xor Church (LSE) | Turing (RWX) xor Church (LSE) |
| **Namespace Metadata** | B (Bind), F (Far) in namespace entry | TBD |
| **Base ISA** | RISC-V RV32I | Custom ARM-style encoding |
| **Data Registers** | x0-x31 (32-bit each) | DR0-DR15 (64-bit each) |
| **Capability Registers** | CR0-CR15 (128-bit, 4x32-bit words) | CR0-CR15 (64-bit GTs) |
| **Church Instructions** | 7 (CAP.LOAD, CAP.SAVE, CAP.CALL, CAP.RETURN, CAP.CHANGE, CAP.SWITCH, CAP.TPERM) | 11 (LOAD, SAVE, LOADX, SAVEX, LDM, STM, CALL, RETURN, CHANGE, SWITCH, TPERM) |
| **Max Namespace Entries** | 131,072 (17-bit index) | Offset-dependent |
| **GT Version Field** | 7-bit (128 generations) | None (G-bit mechanism) |
| **GT Type Field** | 2-bit: Inform, Outform, NULL, Abstract | 2-bit: Inform, Outform, NULL, Abstract |
| **MAC Validation** | 25-bit FNV seal in VersionSeals | Hardware-enforced hash |
| **Garbage Collection** | Version bump on sweep; G-bit reset on access | G-bit cleared on LOAD access |
| **Hardware Implementations** | Software simulation only | SystemVerilog + Amaranth HDL |

---

## Directory Structure

```
/
+-- riscv_cap/              Sim-32 (RV32-Cap) web simulator
|   +-- index.html          Single-page application
|   +-- simulator.js        Core simulation engine (RV32I + Church)
|   +-- assembler.js        Two-pass assembler
|   +-- app.js              UI controller
|   +-- styles.css           Dark-themed styling
|   +-- main.py             Flask web server (port 5000)
|
+-- web/                    Sim-64 (CTMM) web simulator
|   +-- index.html          Single-page application
|   +-- simulator.js        Core simulation engine
|   +-- app.js              UI controller
|   +-- styles.css           Dark-themed styling
|   +-- app.py / server.py  Python HTTP server
|   +-- images/             UI assets
|
+-- ctmm_amaranth/          Amaranth HDL hardware implementation (Sim-64)
+-- verilog/                SystemVerilog hardware implementation (Sim-64)
+-- CTMM/                   Haskell console simulator (Sim-64)
+-- docs/                   Project documentation
```

---

## Independence

The two simulators are fully independent codebases. Each swims in its own private space -- changes to one never affect the other. Only one web simulator can be active on port 5000 at a time.
