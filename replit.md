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
- Punt TPERM standardization until Sim-32 mature and ARM market direction clear

## Recent Changes (2026-02-12)

### GT-Literals and Network Transparency (Design Document)
- New doc: `docs/network-transparency.md` — "Network Transparency" (cross-references gt-literals.md)
- GT-Literal (Type=10) = capability-secured handle to a secret value in namespace entry Location/Limit fields
- GT-Literal use cases: RPC tunnel keys, transparent login, session tokens, encryption keys at rest, API key wrapping
- Common pattern: GT is the handle (Version/Index/Permissions/Type), namespace entry holds the secret, MAC protects integrity
- GT Type field (Inform=00, Outform=01, Literal=10, Abstract=11) drives local vs remote behavior
- R on Outform = object fetch via standard HTTPS GET (browser mechanisms: TLS, ETag, Cache-Control)
- W on Outform = modify locally, flush to home URL via standard HTTPS PUT (ETag/If-Match for conflicts)
- E on Outform Abstract = RPC call through GT-Literal encrypted tunnel (Meta Machine to Meta Machine only)
- L, S, X on Outform = TRAP (future-safe extension points, no hardware change needed)
- TRAP vs FAULT distinction: TRAP = recoverable architectural event, FAULT = security violation
- Fetch/flush use standard HTTPS — interworks with existing web servers, CDNs, REST APIs
- Symmetrical: Meta Machine is both client (fetch/flush/RPC) and server (serve/invoke/accept)
- Tunnel revocation via GC sweep of GT-Literal (version bump kills tunnel)
- Design validation tests: `riscv_cap/tests/test_network_transparency.py` (32 tests)
- F (Foreign/Far) permission was for network transparency — now removed from GT but concept lives in Type field

### GT-Literals, Lambda Calculus, and the CLOOMC Value Domain (Design Document)
- New doc: `docs/gt-literals.md` — GT-Literals as Church's value domain in hardware
- Two forms: Direct GT-Literal (30-bit value, no Version/Permissions) and Indirect GT-Literal (namespace-backed handle)
- Direct GT-Literal format: [31:2] Value (30 bits) + [1:0] Type=10 — no mLoad, no MAC, pure value
- Version/Permission bits reclaimed for direct form: 30 bits of value space (~1 billion integers)
- Three new Church instructions: LDL (Load Literal, 1 cycle), STL (Store Literal, 1 cycle), LAMBDA (application, 2 cycles setup)
- LAMBDA CRd, CRbody, CRarg: applies X-permission code body to GT-Literal argument, result in CRd
- LAMBDA uses X permission (same domain, lightweight) vs CALL uses E permission (domain crossing, heavy)
- Lambda calculus connection: GT-Literal = value, Inform = name, Abstract = callable, LAMBDA = application
- Constructive examples: A=B+C (6 cycles vs 15+ via mLoad), square function (6 vs 16+ via CALL), factorial via Y combinator, map function
- Performance: 2-3× speedup over namespace-backed CALL/RETURN for pure computation
- Combinators (I, K, S, Y) as optimization targets: I = register move (1 cycle), K = register copy (2 cycles)
- Security model: structural (LDL/STL/LAMBDA enforce type boundaries) not per-access (no mLoad validation needed)


### GT Permission Reduction: 10 → 6 bits
- Permissions reduced to 6 bits: R, W, X, L, S, E
- M (Meta) is now transient — elevated by instructions (RETURN, CHANGE), not stored in GT
- B (Bind), F (Far), G (Garbage) removed from GT permissions
- G-bit is per-namespace-entry metadata (gBit field), not a GT permission
- Freed 4 bits reallocated: Sim-32 now has Version(7), Index(17); Sim-64 has larger spare field
- All four implementations updated consistently

### Thread Table C-List Snippet: CR0-CR7 Only
- Thread shadow tracks only CR0-CR7 (instruction-addressable registers)
- CR8-CR15 (system registers) excluded from thread table shadow
- Hardware thread_wr_idx narrowed to 3 bits with guard: only updates when CRd <= 7

### CHANGE Uses CALL Microcode
- CHANGE pushes a call stack frame (CR5/CR6/CR7 + PC) before saving DRs
- Eliminates separate packedPC/pcOffset fields in thread table
- On restore: pops top frame, revalidates CR5/CR6/CR7 through mLoad
- Dormant thread saves: DRs + call stack (with frames maintained by CALL/RETURN)

### Unified PC Save Semantics
- CALL and CHANGE both store the instruction address (not +step)
- RETURN always adds step size: +4 for Sim-32, +1 for Sim-64
- Hardware RETURN: `nia_value = saved_nia + 1`

### RETURN CR6 E-Check + M Elevation
- RETURN checks E permission on saved CR6 GT before mLoad revalidation
- After mLoad succeeds, M is elevated transiently (runtime flag, not GT bit)
- Hardware: CHECK_CR6_E state added between Phase 0 and Phase 1

### PP250 Garbage Collection
- Mark: Set G=1 (gBit) on all namespace entries
- Scan: Walk DNA tree from roots via mLoad; each mLoad access resets G=0
- Sweep: Entries still with G=1 are garbage; version bumped
- Sim-32 gcScan now uses mLoadByIndex for tree walk
- Sim-32 gcScan walks dormant thread call stacks (previously missing)

### Boot Image Builder
- New tool: `riscv_cap/boot_builder.py`
- Constructs namespace table, thread objects, C-Lists, GTs
- Exports as JSON or binary memory image
- Matches simulator's MAC computation (FNV hash with correct offsets)

## System Architecture

The CTMM simulator offers both a Haskell console interface and a web-based visualization. The web interface utilizes a Python HTTP server, HTML, CSS, and JavaScript for simulation logic and UI.

### Core Architectural Concepts

-   **Capability-based Security**: Access control via "Golden Tokens" (GTs).
-   **Register Architecture**:
    -   **Context Registers (CR0-CR7)**: Hold Golden Tokens (instruction-addressable). CR15 for Namespace root, CR8 for Thread identity, CR7 for Nucleus, CR6 for current C-List.
    -   **Data Registers (DR0-DR15)**: Hold 64-bit numeric values (Sim-64) or x0-x31 32-bit (Sim-32).
-   **Golden Token Permissions**: 6 bits — R (Read), W (Write), X (Execute), L (Load), S (Save), E (Enter). M is transient (elevated by microcode). G is per-namespace-entry metadata.
-   **Permission Domains**: Turing (R, W, X), Church (L, S), Lambda (E). M is transient, not a stored permission.
-   **Namespace Entry**: A 3-word descriptor (Location, Limit, Seals) with per-entry gBit for GC.
-   **MAC Validation**: Hardware-enforced security check during `LOAD`. FNV hash MAC computation.
-   **mLoad Master Validation**: Single trusted path for all namespace access — every Church instruction routes through mLoad, which enforces permission check, bounds check, MAC validation, G-bit reset, and thread table shadow update. Golden Rule: mLoad is the sole path for all CR writes across all four implementations.
-   **Boot Sequence**: A 4-step secure initialization process.
-   **Failsafe Security**: All validation failures route to a single FAULT handler.
-   **Deterministic Garbage Collection (PP250)**: Three-phase Mark-Scan-Sweep. Mark sets G=1 on all namespace entries. Scan walks DNA tree via mLoad (resets G=0 on reachable entries). Sweep identifies entries still G=1 as garbage, bumps version.

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
-   **SystemVerilog (`verilog/`)**: Full CTMM architecture with 6-bit permissions.
-   **Amaranth HDL (`ctmm_amaranth/`)**: Python-based HDL implementation with 6-bit permissions.

### Simulator Comparison: Sim-64 (CTMM) vs Sim-32 (RV32-Cap)

The project includes two independent capability-based security simulators sharing foundational security philosophies but differing in architecture, instruction sets, and token width.

-   **Sim-64 (CTMM)**: Custom ISA, 64-bit GTs, custom processor, hardware implementations.
-   **Sim-32 (RV32-Cap)**: RISC-V RV32I base ISA, 32-bit GTs, software simulation only. Uses custom RISC-V opcodes for capability instructions.

### RV32-Cap Simulator (Sim-32) Details

This simulator (`riscv_cap/`) uses a Flask web server, `index.html`, `styles.css`, `simulator.js`, `assembler.js`, and `app.js`.

-   **RV32I Base**: Full integer instruction set with x0-x31 data registers.
-   **16 Capability Registers**: CR0-CR15, each 128-bit.
-   **32-bit Golden Token Format**: Version (7 bits), Index (17 bits), Permissions (6 bits: R,W,X,L,S,E), Type (2 bits).
-   **Church Instructions**: Seven instructions (`CAP.LOAD`, `CAP.CALL`, `CAP.SAVE`, `CAP.RETURN`, `CAP.CHANGE`, `CAP.SWITCH`, `CAP.TPERM`) across four RISC-V custom opcodes.
-   **Web Views**: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Instructions, Docs.
-   **MAC Seal Validation**: 25-bit FNV hash seal in `VersionSeals` checked on `LOAD` and `CALL`. Version field is 7 bits.
-   **mLoad/mLoadByIndex**: Unified validation path for all Church instructions — validates version, MAC, permissions, resets G-bit (namespace entry gBit), writes to destination CR, and updates thread table shadow (CR0-CR7 only) on every namespace access. Golden Rule: mLoad is the sole path for all CR writes. Hardware mLoad supports `sub_direct` mode for direct GT validation (skips C-List fetch, used by RETURN).
-   **Thread Table Shadow (Trusted C-List Snippet)**: mLoad updates Thread[CRd] for CR0-CR7 only (instruction-addressable registers) on every CR write, keeping the thread's CR slots continuously current. CALL/RETURN keep stack frames current. CHANGE save side only needs to save data registers + call stack.
-   **CHANGE Context Switch**: Pushes call stack frame (CR5/CR6/CR7 + CHANGE instruction PC) via CALL microcode before saving DRs. CRs already current via mLoad shadow; stack frames already current via CALL/RETURN. L permission on C-List authorizes thread GT fetch. Boot exception: initial hardwired thread GT.
-   **RETURN Revalidation**: RETURN checks E permission on saved CR6 GT, routes saved CR5/CR6/CR7 GTs through mLoad's direct mode (`sub_direct=1`) for namespace revalidation against CR15, catching recycled entries (use-after-free prevention). M elevated transiently on CR6 after successful revalidation.
-   **Deterministic Garbage Collection (PP250)**: G-bit (per namespace entry, not GT permission) reset via mLoad on every access; three-phase Mark-Scan-Sweep cycle with DNA tree walk from registers, call stack, dormant thread call stacks, and thread table (no permission filtering during scan); version bump on sweep.
-   **Boot Image Builder**: `riscv_cap/boot_builder.py` — offline tool to construct namespace table, thread objects, C-Lists, GTs as binary/JSON memory images.

### Dormant Thread Object Structure

-   **Sim-32**: x0-x31 (32 registers including x0) at offsets 0-31, call stack (with CR5/CR6/CR7 + PC frames), CR0-CR7 shadow maintained by mLoad
-   **Sim-64**: DR0-DR15 at offsets 0-15, packed PC+indicators at offset 16, call stack, CR0-CR7 shadow maintained by mLoad

## External Dependencies

-   **Python HTTP Server**: For serving web interfaces.
-   **Haskell GHC**: For the console simulator.
-   **`localStorage`**: Browser API for client-side state persistence.
-   **PostgreSQL**: Database for user accounts and simulator states.
-   **Replit Auth**: For user authentication.
-   **Resend**: For sending welcome emails.
