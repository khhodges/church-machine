# Church Machine Security Risk Register

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

> **Status note:** This is a risk register, not a certification or proof. “Resolved”
> means the recorded mitigation was accepted at the time; it does not guarantee
> exploit impossibility. Current shipped hardware is Wukong A7. Tang and Ti60
> statements are historical unless explicitly revalidated against Wukong.

The goal is for each namespace to protect itself so that an actor without a valid,
unrevoked Inform GT and sufficient permissions cannot access it. Claims of
unforgeability, impossibility, or guaranteed isolation require a linked formal
proof or executable adversarial test; otherwise this document records goals,
implemented checks, and residual risks.

## R001: CALL Must Hardcode CR14 and CR6 Permissions When Splitting Lump
- **Severity**: CRITICAL
- **New**: Yes — introduced by single-NS-entry CALL split
- **Layer**: CALL instruction (simulator.js _execCall)
- **Risk**: CALL derives CR14 (code) and CR6 (c-list) from one NS entry. If CALL copies
  permissions from the NS entry into both CRs, domain purity breaks — code could read GTs,
  or c-list could be executed as code.
- **Fix**: CALL hardcodes CR14 permissions to RWX (Turing domain) and CR6 permissions to
  L-only (Church domain). These are architectural invariants, not derived from the GT or NS
  entry. CR14 gets R and W in addition to X because Boot.[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) uses DREAD to load constants
  from data tables appended after HALT in the code region (e.g., Ada Note G's .org/.word
  constants). Domain purity is maintained: CR14 has no Church permissions (L/S/E) and CR6 has
  no Turing permissions (R/W/X). The simulator confirms this: `createGT(... {L:1} ...)` for
  CR6 (simulator.js line 352).
- **Task**: T002
- **Status**: RESOLVED

## R002: Namespace Entry Integrity Is Unkeyed
- **Severity**: MEDIUM
- **New**: No — pre-existing.
- **Layer**: NS Table W2 integrity value
- **Current behavior**: Wukong RTL and the simulator store a 32-bit
  `integrity32(W0, W1)` result in NS-entry W2. The function is
  `ROL32(W0, 7) XOR ROL32(masked_W1, 13) XOR 0xDEADBEEF`; W1's GC and far flags
  are masked. See `hardware/integrity32.py`, `hardware/layouts.py`, and the
  matching simulator implementation.
- **Risk**: `integrity32` is linear, unkeyed, and publicly computable. It catches
  accidental corruption and stale/mismatched metadata but is not a MAC,
  authentication mechanism, or anti-forgery boundary. An actor able to modify an
  NS entry can recompute W2 after changing W0/W1.
- **Mitigation status**: Do not describe W2 as cryptographic authentication.
  Use a keyed construction and a documented key/provisioning model before
  treating malicious namespace-entry modification as prevented.
- **Task**: Review during T001, monitor
- **Status**: OPEN / ACCEPTED RISK

## R003: Boot Raw Write — Single Point of Failure
- **Severity**: LOW
- **New**: Yes — introduced by boot-as-upload-array model
- **Layer**: Boot sequence (simulator.js)
- **Risk**: Boot writes Navana's NS entry directly (mElevation privilege) before Navana.Add
  exists. A bug in seal computation or clistCount encoding here corrupts Navana from the
  start, compromising everything built on top.
- **Fix**: The boot raw write is a small, fixed, auditable code path — one NS entry write.
  Verify statically. Navana's entry is validated by mLoad on every subsequent CALL — a
  corrupt seal is caught immediately on first use.
- **Task**: T009
- **Status**: RESOLVED

## R004: [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)++ Compiler — Incorrect Code Generation
- **Severity**: HIGH (correctness), LOW (security)
- **New**: Yes — compiler is entirely new
- **Layer**: [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)++ compiler (cloomc_compiler.js)
- **Risk**: Compiler bugs could produce code with wrong c-list offsets (capability confusion),
  incorrect branch targets (arbitrary execution within lump), misallocated registers (data
  corruption), or invalid instruction encodings.
- **Security expectation**: Compiler output is still subject to the implemented
  mLoad, CALL, and bounds checks. This reduces the classes of compiler error that
  should cross an object boundary, but no formal proof or complete adversarial
  test suite establishes that compiler bugs can affect correctness only.
- **Fix**:
  - Simple compiler, no optimizations initially
  - Emit compilation manifest (source line to instructions) for auditing
  - Verify Resident Object Model c-list offsets match upload capabilities array exactly
  - Simple register allocation (linear scan, no spilling for Phase 1)
- **Task**: T005, T006
- **Status**: RESOLVED (Phase 1 JS; Phase 1b Haskell deferred)

## R005: [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)++ C-List Offset Mismatch
- **Severity**: MEDIUM
- **New**: Yes — compiler maps abstraction names to c-list slots
- **Layer**: Resident Object Model (cloomc_compiler.js)
- **Risk**: If the compiler maps `call(Memory.Allocate(...))` to c-list offset 2 but Memory
  is actually at offset 1, the code LOADs the wrong GT and CALLs the wrong abstraction.
  This is capability confusion — potentially calling a different abstraction with
  attacker-controlled arguments.
- **Fix**: The Resident Object Model must be generated directly from the upload's
  capabilities array. The compiler never guesses offsets — it reads them from the same
  source of truth that Navana uses to populate the c-list.
- **Task**: T005
- **Status**: RESOLVED

## R006: Haskell Closure Variable Capture
- **Severity**: MEDIUM
- **New**: Yes — Haskell front-end compiles closures
- **Layer**: [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)++ Haskell front-end (cloomc_compiler.js)
- **Risk**: Lambda closures capture variables from enclosing scope. If the compiler
  incorrectly captures a reference to a capability register (CRn) instead of a data
  register (DRn), the closure could leak a GT to unprivileged code.
- **Fix**: The compiler must enforce that closures only capture data register values,
  never capability registers. CR access is only through LOAD/SAVE instructions targeting
  the c-list (CR6). The compiler should reject any attempt to capture CRn.
- **Task**: T006
- **Status**: RESOLVED (Haskell front-end enforces data-register-only capture)

## R007: Upload Validation — Integer Underflow / Capability Escalation
- **Severity**: HIGH
- **New**: Yes — Navana processes untrusted uploads
- **Layer**: Navana.Abstraction.Add (system_abstractions.js)
- **Risk**: A malicious or buggy upload could specify:
  - clistCount > allocatedSize causing integer underflow in clistStart (wraps negative)
  - Capabilities targeting abstractions the creator doesn't hold (capability escalation)
  - Code words that when packed overlap with c-list region
  - Zero methods with non-zero code size (inconsistent layout)
- **Fix**: Navana.Abstraction.Add must validate:
  1. codeSize + clistCount <= allocatedSize (no overlap, freespace >= 0)
  2. Each capability target exists AND creator holds sufficient permissions to delegate
  3. clistCount <= 511 (fits in 9 bits)
  4. codeSize < clistStart (method table + code fits below boundary)
  5. Integer overflow/underflow checks on all size arithmetic
  6. allocatedSize is a valid power-of-2
- **Task**: T010
- **Status**: RESOLVED

## R008: Register Spilling / Calling Convention Collision
- **Severity**: MEDIUM
- **New**: Yes — compiler allocates registers
- **Layer**: [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)++ code generator (cloomc_compiler.js)
- **Risk**: The Church Machine has 16 DRs. If the compiler uses DR5 for a local variable
  but DR5 is also used by the calling convention to pass arguments to a CALL, the value
  is silently corrupted. No fault — just wrong computation.
- **Fix**: Define a fixed calling convention:
  - DR0: hardwired zero; DR1-DR3: argument passing / return values (caller-saved)
  - DR4-DR11: local variables (callee-saved)
  - DR12-DR15: temporaries (compiler scratch, caller-saved)
  - Document this in docs/architecture.md
  - Compiler enforces convention in code generation
- **Task**: T005
- **Status**: RESOLVED

## R009: Namespace Isolation — Core Security Goal
- **Severity**: FOUNDATIONAL
- **New**: No — this is the core architecture
- **Layer**: All layers
- **Security goal**: Each namespace (sibling) has its own NS table, Memory region,
  and GT set. The intended checks require a valid, unrevoked Inform GT with
  sufficient permissions for external access, and version changes are intended
  to invalidate copies. This remains a property to test or prove, not a guarantee
  established by this register.
- **How it holds under new changes**:
  - Single NS entry model: implemented bounds and seal checks reduce cross-object access
  - CALL split: CR14 and CR6 use hardcoded domain permissions (R001 mitigation)
  - Compiler output remains subject to capability and bounds checks; completeness is unproven
  - Upload validation: Navana validation is the intended delegation gate (R007 mitigation)
  - Boot: the raw-write path remains part of the trusted computing base (R003 mitigation)
- **Status**: MITIGATED / REQUIRES ADVERSARIAL EVIDENCE

## Resolution Tracking

| Risk | Severity | Task | Status |
|------|----------|------|--------|
| R001 | CRITICAL | T002 | RESOLVED |
| R002 | MEDIUM | T001 | OPEN / ACCEPTED RISK |
| R003 | LOW | T009 | RESOLVED |
| R004 | HIGH/LOW | T005,T006 | RESOLVED (Phase 1) |
| R005 | MEDIUM | T005 | RESOLVED |
| R006 | MEDIUM | T006 | RESOLVED |
| R007 | HIGH | T010 | RESOLVED |
| R008 | MEDIUM | T005 | RESOLVED |
| R009 | FOUNDATIONAL | All | MITIGATED / EVIDENCE REQUIRED |
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
