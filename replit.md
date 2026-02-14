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

## System Architecture

The CTMM simulator offers both a Haskell console interface and a web-based visualization. The web interface utilizes a Python HTTP server, HTML, CSS, and JavaScript for simulation logic and UI.

### Core Architectural Concepts

-   **Capability-based Security**: Access control via "Golden Tokens" (GTs).
-   **Register Architecture**:
    -   **Context Registers (CR0-CR7)**: Hold Golden Tokens (instruction-addressable). CR15 for Namespace root, CR8 for Thread identity, CR7 for Nucleus, CR6 for current C-List.
    -   **Data Registers (DR0-DR15)**: Hold 64-bit numeric values (Sim-64) or x0-x31 32-bit (Sim-32).
-   **Golden Token Permissions**: 6 bits — R (Read), W (Write), X (Execute), L (Load), S (Save), E (Enter). M is transient (elevated by microcode on CR, never on GT). G is per-namespace-entry metadata.
-   **Permission Domains**: Turing (R, W, X), Church (L, S), Lambda (E).
-   **M Elevation Rule**: M is never stored in the GT — only on the CR during microcode execution. Microcode elevates M to perform privileged actions (LOAD, SAVE, CHANGE, etc.) then clears it. No user instruction can set, test, or observe M. See `docs/boot-permission-rules.md`.
-   **Boot CR Permissions**: CR15 (Namespace) = M only; CR8 (Thread) = M only; CR6 (C-List) = E only on GT, M elevated on CR by microcode; CR7 (Nucleus) = X (+R if constants).
-   **Namespace Entry**: A 3-word descriptor (Location, Limit, Seals) with per-entry gBit for GC.
-   **MAC Validation**: Hardware-enforced security check during `LOAD`. FNV hash MAC computation.
-   **mLoad Master Validation**: Single trusted path for all namespace access – every Church instruction routes through mLoad, which enforces permission check, bounds check, MAC validation, G-bit reset, and thread table shadow update.
-   **Boot Sequence**: A 4-step secure initialization process.
-   **Failsafe Security**: All validation failures route to a single FAULT handler.
-   **Deterministic Garbage Collection (PP250)**: Three-phase Mark-Scan-Sweep. Mark sets G=1 on all namespace entries. Scan walks DNA tree via mLoad (resets G=0 on reachable entries). Sweep identifies entries still G=1 as garbage, bumps version.
-   **GT Type Field**: 2-bit field classifying GTs as Inform (00, local reference), Outform (01, remote reference), NULL (10, empty/invalid/revoked), or Spare (11, reserved). NULL provides unambiguous initialization, clean revocation, and GC clarity.
-   **LAMBDA Instruction**: Lightweight in-scope code application — `LAMBDA CRn, x` uses X permission (not E), arguments/results in data registers. Machine-status fast path (zero stack access). Non-nestable on its own, nestable via CALL. Self-describing stack frames with 1-bit tag. Macro-like code reuse without duplication.
-   **Domain Separation**: CRs hold capabilities exclusively, DRs hold values exclusively. No mixing ("oil and water"). mLoad is the single gate between domains. LAMBDA bridges them: GT with X permission (Church domain) applies code to values (Turing domain).
-   **Network Transparency**: Outform GTs support remote resources via standard HTTPS for fetch/flush. RPC tunnels use cryptographic keys stored in standard namespace entries (accessed via CAP.LOAD with R permission).
-   **ABI Descriptor**: Cached in namespace entry, maps register architectures between heterogeneous machines (e.g., 64-bit DR0-DR15 to 32-bit x0-x31). Accessed via mLoad with R permission. Cost unmeasurable vs network latency (~50ns vs ~10ms).
-   **"Hello Mum" Canonical Example**: Replaces "Hello World" — `CALL(CONNECT(me, mymother))` = 1 Church instruction + 3 Golden Tokens + 7 Zeroes (zero OS, zero VM, zero privilege, zero superuser, zero unauthorized code execution, zero unauthorized data access, zero containment escape). Escalation paths exploited by malware, ransomware, and AI breakout are structurally eliminated. Full proof-of-concept in `docs/tunnel-messaging-example.md`.
-   **Atomic Abstraction Architecture**: No central operating system, no virtual memory, no privileged hardware mode, no superuser. All system services are atomic abstractions accessed through Golden Tokens. mLoad is the single trusted gate that nobody bypasses.
-   **Thread Table C-List Snippet**: Thread shadow tracks only CR0-CR7 (instruction-addressable registers).
-   **CHANGE/RETURN Semantics**: `CHANGE` uses `CALL` microcode to push a call stack frame. `CALL` and `CHANGE` store the instruction address. `RETURN` adds step size and checks E permission on saved CR6 GT before revalidation.

### Web Interface (UI/UX)

The web interface provides seven views: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Instructions, Tutorial, and Code Browser. The styling is a dark-themed, IDE-like design.

### Key Features

-   **Built-in Abstractions**: Includes `Boot`, `Threads`, `SlideRule`, `Abacus`, `Circle`, `CapabilityManager`, `DateTime`, `Lambda`, and `Mint`.
-   **Mint Abstraction**: General-purpose capability forge at NS offset 12 (0xC000). Four functions: GT_MINT (create domain-pure GT — Turing [RWX] or Church [LSE], never both), GT_RESTRICT (derive subset perms), GT_REVOKE (bump version to invalidate all copies), GT_INSPECT (read GT metadata). Enforces RWX/LSE mutual exclusivity. Complements CapabilityManager which only creates Data [RWX] or C-List [LSE].
-   **Instruction Set**: Custom CTMM instruction set with Church-specific and Turing-specific instructions. All instructions use a 32-bit format. Only CR0-CR7 are instruction-addressable.
-   **Condition Codes**: ARM-style condition flags for conditional execution.
-   **State Persistence**: Automatic saving and restoring using browser local storage.

### Hardware Implementations

The project includes synthesizable hardware implementations in SystemVerilog (`verilog/`) and Amaranth HDL (`ctmm_amaranth/`) for the CTMM architecture.

### Simulator Comparison: Sim-64 (CTMM) vs Sim-32 (RV32-Cap)

-   **Sim-64 (CTMM)**: Custom ISA, 64-bit GTs, custom processor, hardware implementations.
-   **Sim-32 (RV32-Cap)**: RISC-V RV32I base ISA, 32-bit GTs, software simulation only. Uses custom RISC-V opcodes for capability instructions. Includes a Flask web server for its interface.

### Boot Image Builder

A tool (`riscv_cap/boot_builder.py`) constructs namespace tables, thread objects, C-Lists, and GTs, exporting them as JSON or binary memory images, matching the simulator's MAC computation.

### Unified Server Architecture

Both simulators are served from a single Flask application (`unified_server.py`) on port 5000:
-   `/` — Landing page with links to both simulators
-   `/ctmm/` — CTMM Simulator (Sim-64, custom ISA, full auth/DB features)
-   `/rv32/` — RV32-Cap Simulator (Sim-32, RISC-V RV32I base)
-   `/api/*` — CTMM API routes (user auth, state persistence, landing content)
-   `/auth/*` — Replit Auth routes

The CTMM app (`web/`) is the Flask base with database/auth. RV32-Cap (`riscv_cap/`) is mounted as a Blueprint at `/rv32/`. The workflow runs `.pythonlibs/bin/python unified_server.py` (using the venv's Python 3.11 to match installed packages).

## External Dependencies

-   **Python/Flask**: Unified web server for both simulators.
-   **Haskell GHC**: For the console simulator.
-   **`localStorage`**: Browser API for client-side state persistence.
-   **PostgreSQL**: Database for user accounts and simulator states.
-   **Replit Auth**: For user authentication.
-   **Resend**: For sending welcome emails.