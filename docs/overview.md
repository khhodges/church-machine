# Church Machine Project Overview

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

> **STATUS:** Wukong A7 is the current hardware target. Security statements in
> this overview describe intended enforcement unless tied to source or executable
> tests; the current unkeyed `integrity32` check is not cryptographic
> authentication or proof of unforgeability.

## What Is This Project?

This project is a **[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) IDE** for Kenneth J Hamer-Hodges' **Church Machine** capability-based security architecture. It includes software design tools to build secure software abstractions each with their own calibrated MTBF, for Industrial Strength Computer Science, free from global cybercrime and Quantum Computer Crypto collapse.

---

## Architectural Principles

The Church Machine enforces these core security invariants:

- **Failsafe Security**: Every validation failure routes to a single FAULT handler. There are no silent failures or undefined behaviors.
- **Golden Tokens**: Implemented capability paths use validated GTs rather than
  exposing raw object addresses to ordinary capability operations.
- **Capability Registers (CR0-CR15)**: 16 capability registers hold Golden Tokens. CR0-CR11 are programmer-accessible via the 4-bit register field. CR12-CR15 are privileged registers — hardware faults on any instruction that encodes them in a register field (exception: DREAD/DWRITE may use CR14 as source).
- **Two Permission Domains (Domain Purity)**: A GT may carry Turing permissions (R, W, X) or Church permissions (L, S, E), but never both. This is enforced in hardware -- any attempt to mix domains raises a DOMAIN_PURITY fault.
  - **Turing (R, W, X)**: Read, Write, and Execute data/code
  - **Church (L, S, E)**: Load, Save, and Enter capabilities/abstractions
- **M Permission -- Transient Only**: M (Machine/Microcode) is never stored in a GT. It exists only as a transient hardware signal during microcode execution, invisible to user instructions.
- **B and F -- Namespace Metadata**: B (Bind) and F (Far/Foreign) are properties of namespace entries, not GT permission bits. B controls whether a capability can be copied; F marks remote resources.
- **C-List Mediation**: LOAD and SAVE operations go through capability-mediated C-Lists, never through raw memory addresses.
- **SWITCH as Privilege Gate**: The only way to write to privileged registers CR12-CR15 is through the SWITCH instruction.
- **mLoad as Sole Trusted Path**: All capability register writes route through the mLoad validation pipeline.

---

## Key Features

| Feature | Detail |
|---------|--------|
| **Golden Token Width** | 32-bit |
| **GT Format** | Slot(16) + Sequence(9) + Type(2) + Domain(1) + Perm(3) + Bind(1) |
| **GT Permission Bits** | 3, interpreted as Turing (X/W/R) or Church (E/S/L) by domain |
| **Permission Domains** | Turing (RWX) xor Church (LSE) — domain purity enforced in hardware |
| **Namespace Metadata** | B (Bind), F (Far) in namespace entry |
| **Data Registers** | DR0-DR15 |
| **Capability Registers** | CR0-CR15 (CR0-CR11 programmer-accessible, CR12-CR15 privileged) |
| **Church Instructions** | LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA |
| **Turing Instructions** | DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR |
| **Max Namespace Entries** | 65,536 (16-bit object_id) |
| **GT Version Field** | 9-bit gt_seq (512 generations) |
| **GT Type Field** | 2-bit: NULL(0), Inform(1), Outform(2), Abstract(3) |
| **Integrity Validation** | 32-bit unkeyed `integrity32(W0,W1)`; mismatch detection, not a MAC |
| **Garbage Collection** | Version bump on sweep; G-bit reset on access |

---

## Directory Structure

```
/
+-- simulator/              Church Machine IDE (web application)
|   +-- index.html          Single-page application
|   +-- app.js              UI controller and examples
|   +-- styles.css          Dark-themed styling
|
+-- server/                 Flask web server
|   +-- app.py              API routes and doc serving
|
+-- docs/                   Project documentation (The Church Machine book)
+-- hardware/               Amaranth HDL (current Wukong A7 plus retained legacy targets)
+-- ctmm_amaranth/          Amaranth HDL hardware implementation
+-- verilog/                SystemVerilog hardware implementation
+-- haskell-sim/            Haskell console simulator
```
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
