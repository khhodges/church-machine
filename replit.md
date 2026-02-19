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
-   **Golden Token Permissions**: 6 bits (R, W, X, L, S, E) defining access rights, with domain purity enforced (Turing xor Church, never both). Data registers (DRn) and Context registers (CRn) are physically separate hardware paths — data can never be confused with Golden Tokens (oil and water). TPERM's primary value is defensive checking of dynamic tokens passed via API before committing to operations that require specific permissions.
-   **Failsafe Security**: All validation failures are routed to a single FAULT handler.
-   **Deterministic Garbage Collection (PP250)**: A three-phase Mark-Scan-Sweep process.
-   **LAMBDA Instruction**: Enables lightweight, in-scope code application with machine-status fast path.
-   **Network Transparency**: Outform GTs support remote resources via HTTPS, with RPC tunnels using cryptographic keys. F (Far) flag distinguishes virtual memory caching (F=0, HTTP GET/PUT) from remote execution (F=1, encrypted tunnel). Remote addresses placed in namespace entry location field at bind time by FamilyRegistry abstraction.
-   **Abstraction C-List Layout**: Hardware-enforced initial condition — every abstraction C-List: slot [0] = NULL (clears CR), slot [1] = Access Code [R,X] (CLOOMC code block, CALL entry point). LAMBDA can move execution to macros in any programmable CR0-CR7.
-   **Atomic Abstraction Architecture**: No central OS, VM, privileged mode, or superuser. All system services are atomic abstractions accessed via Golden Tokens, with `mLoad` as the single trusted gate.
-   **Three Dispatch Styles**: Abstractions can resolve method calls via Symbolic resolver (high-security), LAMBDA fast-path (performance), or Traditional compiled binary (fastest). Method-selector abstractions (SlideRule, Abacus, Circle, DateTime, Mint) use DR0 as method selector via Access code at slot [1]. Lambda provides true reusable macros as separate C-List entries for external LAMBDA use.
-   **Hardware Implementations**:
    -   **Amaranth HDL — Pure Church Machine (`church_machine/`)**: Standalone Church-only processor. Clean 32-bit instruction format: opcode[4] | cond[4] | cr_dst[4] | cr_src[4] | imm[16]. 10 opcodes (8 base + 2 fused): LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA. ARM-style conditional execution (16 condition codes) on all instructions. 16 CRs (128-bit), 16 DRs (32-bit, DR0=zero). No RISC-V encoding overhead, no Turing-domain paths. Fused instructions (`fused_unit.py`): ELOADCALL = micro-sequenced LOAD+TPERM(E)+CALL, XLOADLAMBDA = micro-sequenced LOAD+TPERM(X)+LAMBDA — each with own mLoad instance, CR5 stack support, and fault chain integration. 57% cycle reduction (7→3 steps). FPGA top-level (`top.py`): auto-boot, 2KB Boot ROM, 4KB unified data RAM (namespace+C-list), UART TX debug output (115200 baud), LED status (boot/run/fault). ~4,100 lines, 27 modules, generates 802K synthesizable Verilog (`church_top.v`). Core-only: 729K, 23 modules (`church_core.v`).
    -   **Amaranth HDL — Sim-64 (`ctmm_amaranth/`)**: 64-bit GT, custom ISA, ARM-style decoder, G-bit GC, exclusive monitor (LOADX/SAVEX), block transfer (LDM/STM). ~3,300 lines, 16 modules.
    -   **Amaranth HDL — Sim-32 (`rv32_cap_amaranth/`)**: 32-bit GT, RISC-V RV32I base ISA + Church custom-0 extensions, version-based GC (7-bit version bump), FNV seal integrity, 128-bit CRs (4×32), 32-bit x0–x31 data registers. ~3,150 lines, 18 modules. Standalone implementation — no shared code with Sim-64.
    -   **SystemVerilog (`verilog/`)**: A parallel hardware implementation of the CTMM architecture.

### Web Interface (UI/UX)
The web interface features a dark-themed, IDE-like design with ten views: Dashboard, Namespace Browser, Assembly Editor, Capabilities Explorer, Zoom (Abstraction detail), HP-35 Calculator, Instructions, Tutorial, and Code Browser.
-   **Instructions View Tabs**: Church (capability opcodes), Turing (ARM-style opcodes), Timing (cycle counts), GT Types (Golden Token type system, Abstract GT reference, programmable method-selector security levels, namespace metadata flags, and Abstract GT vs software tokens comparison).

### Key Features
-   **Built-in Abstractions**: Includes `Boot`, `Threads`, `SlideRule`, `Abacus`, `Circle`, `CapabilityManager`, `DateTime`, `Lambda`, `Constants`, `FamilyRegistry`, `Stack`, and `HP35`.
-   **Stack Abstraction**: Church-encoded RPN stack using nested pairs. stack = PAIR(top, rest), empty = FALSE. Operations: PUSH, POP, SWAP, DUP, PEEK, CLEAR, DEPTH — all pure lambda calculus.
-   **HP35 Calculator Abstraction**: HP-35 scientific calculator (Hewlett-Packard, 1972) rebuilt as CTMM abstraction. Pure lambda calculus RPN engine. Dependencies: Lambda (Church numerals), Stack (RPN pairs), Constants (Abstract GTs for PI). Visual UI with red LED display, authentic key layout, and real-time lambda calculus trace panel.
-   **FamilyRegistry Abstraction**: Secure machine-to-machine binding. Creates namespace entries with remote endpoint addresses at bind time — no DNS, no IP lookup. Methods: REGISTER (create tunnel key pair), LOOKUP (resolve name to address), BIND (set F=1 B=1, write remote address to namespace entry location field), REVOKE (clear binding), STATUS (query F/B/addr). The capability IS the address.
-   **Constants Abstraction**: Physical and mathematical constants (PI, E, PHI, SQRT2, LN2, LN10, c, h, k_B, N_A, G) as Abstract GTs — unforgeable identity tokens. Present Abstract GT in CR1, CALL Constants, value returned in DR0. Constants never exist as bare data.
-   **Instruction Set**: Custom 32-bit CTMM instruction set with Church-specific and Turing-specific operations, including ARM-style condition flags.
-   **State Persistence**: Automatic saving and restoring of state using browser local storage.

### Sim-32 GT Format
-   32-bit Golden Token: Version(7) + Index(17) + Permissions(6) + Type(2)
-   6 permission bits: R, W, X (Turing domain) | L, S, E (Church domain) -- domain purity enforced
-   M (Machine) is transient microcode elevation, never stored in GT
-   B (Bind) and F (Far/Foreign) are namespace entry metadata, not GT permission bits
-   B and F stored in high bits of namespace entry limit word: word1_limit[31]=B, word1_limit[30]=F, word1_limit[16:0]=limit
-   B and F are cached in CRn word2_limit when mLoad loads a capability — no extra memory read needed at SAVE time
-   SAVE rule: SAVE writes a GT to a C-List slot only if B is true on the namespace entry AND the C-List capability has S permission. Faults with BIND if B=0, faults with PERM_S if S missing.
-   VersionSeals: Version(7) + FNV Seal(25) for integrity and GC

### Simulator Comparison
-   **Sim-32 (RV32-Cap)**: RISC-V RV32I base ISA, 32-bit GTs, 17-bit index (131K entries), 7-bit version (128 GC generations), software simulation + Amaranth HDL hardware implementation (`rv32_cap_amaranth/`).
-   **Sim-64 (CTMM)**: Custom ISA, 64-bit GTs, custom processor, with hardware implementations in Amaranth HDL and SystemVerilog.

### Pure Church Computer REPL (`Church/`, `churchMachine.hs`)
Interactive Haskell interpreter demonstrating the Pure Church Lambda Machine. GHCi acts as the lambda reducer; all computation goes through exactly six Church-domain instructions with Golden Token capability checking on every step.
-   **Instruction Pipeline**: Every `Call(Abstraction.Method, args...)` executes: LOAD (namespace lookup, L permission) → TPERM (verify E) → CALL (enter scope, save context) → LOAD (C-List slot, L permission) → TPERM (verify X) → LAMBDA (Church reduction) → RETURN (restore scope).
-   **Symbolic Math**: Ada Lovelace-style notation — write `let x = 3 + 5`, `let y = sqrt(x)`, `n * n_plus_1` — translated to Church-domain calls. One operation per line, each mapped to one 7-step security pipeline. Operators: `+`, `-`, `*`, `/`, `%`, `^`. Functions: `sqrt()`, `log()`, `exp()`, `pow()`, `succ()`, `pred()`.
-   **Variables**: `let` bindings store named intermediate results (Lovelace Note G style). `ANS` holds last result. `VARS` shows all. `CLEAR` resets.
-   **Program Files**: `RUN Church/bernoulli.church` executes `.church` files. Bernoulli example computes 1²+2²+3²+4²=30 two ways.
-   **Modules**: `Church/Types.hs` (GTs, permissions, faults), `Church/Primitives.hs` (Church-encoded arithmetic), `Church/Machine.hs` (six instructions with capability checking), `Church/Abstractions.hs` (Lambda and SlideRule C-Lists), `Church/REPL.hs` (interactive interpreter with symbolic math, variables, and Turing rejection).
-   **Turing Rejection**: Any Turing-domain instruction (ADD, MOV, CMP, B, LDR, etc.) produces a FAULT — the instructions don't exist in this architecture.
-   **Run**: `./churchMachine` or `ghci -i. churchMachine.hs` then type `main`.

### Church Machine Web Simulator (`church_sim/`)
Interactive web-based Pure Church Lambda Machine simulator at `/church/`. Faithfully mirrors the `church_machine/` Amaranth HDL hardware implementation in JavaScript, proving computational completeness with zero Turing-domain instructions.
-   **Files**: `simulator.js` (core machine model with fused instructions), `assembler.js` (Church assembly parser, 10 opcodes), `pipeline.js` (3-mode security pipeline visualizer), `repl.js` (symbolic math REPL with pipeline mode switching), `tutorial.js` (4-phase Bernoulli tutorial), `app.js` (view management), `styles.css`, `index.html`.
-   **6 Views**: Dashboard (registers/GT display), Assembly Editor, Namespace Browser, Pipeline Visualizer, Tutorial, REPL.
-   **Machine Model**: 16 CRs (128-bit), 16 DRs (32-bit, DR0=zero), 32-bit GT format, 10 opcodes (8 base + 2 fused), ARM-style condition codes.
-   **10 Opcodes**: LOAD(0), SAVE(1), CALL(2), RETURN(3), CHANGE(4), SWITCH(5), TPERM(6), LAMBDA(7), ELOADCALL(8), XLOADLAMBDA(9).
-   **Fused Instructions**: ELOADCALL = LOAD+TPERM(E)+CALL in one cycle. XLOADLAMBDA = LOAD+TPERM(X)+LAMBDA in one cycle. Same security checks, 57% fewer cycles (3 vs 7).
-   **Programmable Abstractions**: Chainable abstractions accept method sequence programs (e.g., "MUL,ADD,DIV"). Single ELOADCALL enters scope, N×XLOADLAMBDA executes methods, one RETURN. Up to 84% cycle reduction for multi-method sequences.
-   **3 Pipeline Modes**: Full 7-step (educational foundation), Fused 3-step (ELOADCALL+XLOADLAMBDA+RETURN), Chained (programmable abstraction with method sequence).
-   **Symbolic Math REPL**: `let x = 3 + 5`, `let y = sqrt(x)` — translated to Church-domain CALL sequences. Pipeline mode switching (full/fused/chained). Let bindings, ANS, VARS, CLEAR.
-   **4-Phase Bernoulli Tutorial**: Progressive discovery of optimization — Phase 1: Full 7-step pipeline (63 cycles), Phase 2: Fused instructions (27 cycles, 57% reduction), Phase 3: Programmable abstraction chain (10 cycles, 84% reduction), Phase 4: Side-by-side comparison with cycle bars. All phases compute 1²+2²+3²+4²=30 via Ada Lovelace's Note G formula n(n+1)(2n+1)/6.

### Unified Server Architecture
All three simulators are served from a single Flask application (`unified_server.py`), providing dedicated routes (`/ctmm/`, `/rv32/`, `/church/`), a test harness (`/test/`), and API endpoints for user authentication and state persistence.

## External Dependencies

-   **Python/Flask**: Used for the unified web server.
-   **Haskell GHC 9.4**: Supports the console simulator and the Pure Church Computer REPL (`churchMachine.hs`).
-   **`localStorage`**: Browser API for client-side state persistence.
-   **PostgreSQL**: Database for user accounts and simulator states.
-   **Replit Auth**: For user authentication.
-   **Resend**: For sending welcome emails.