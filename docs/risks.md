# Church Machine Security Risk Register

The goal: each namespace protects itself. A private digital shadow is achieved when no
external actor can reach inside a namespace without holding a valid, unrevoked Inform GT
with sufficient permissions. Every risk below is tracked to resolution.

## R001: CALL Must Hardcode CR7 and CR6 Permissions When Splitting Lump
- **Severity**: CRITICAL
- **New**: Yes — introduced by single-NS-entry CALL split
- **Layer**: CALL instruction (simulator.js _execCall)
- **Risk**: CALL derives CR7 (code) and CR6 (c-list) from one NS entry. If CALL copies
  permissions from the NS entry into both CRs, domain purity breaks — code could read GTs,
  or c-list could be executed as code.
- **Fix**: CALL hardcodes CR7 permissions to RWX (Turing domain) and CR6 permissions to
  L-only (Church domain). These are architectural invariants, not derived from the GT or NS
  entry. CR7 gets R and W in addition to X because Boot.CLOOMC uses DREAD to load constants
  from data tables appended after HALT in the code region (e.g., Ada Note G's .org/.word
  constants). Domain purity is maintained: CR7 has no Church permissions (L/S/E) and CR6 has
  no Turing permissions (R/W/X).
- **Task**: T002
- **Status**: RESOLVED

## R002: Seal Strength — 25-bit FNV Hash
- **Severity**: MEDIUM
- **New**: No — pre-existing. Consequence now worse because clistCount manipulation could
  cross domain boundaries.
- **Layer**: NS Table seal (word2 bits 0-24)
- **Risk**: The FNV seal is 25 bits (33 million values). A brute-force search is feasible
  on fast hardware. If an attacker finds a collision, they could forge an NS entry with a
  manipulated clistCount, extending CR7's limit into the c-list region (capability theft).
- **Fix**: On Tang Nano 20K at 27MHz, brute-force takes hours — acceptable for the target.
  In the simulator (JavaScript at GHz speed), consider rate-limiting seal checks or using
  a stronger hash. Long-term: increase seal to 32 bits by repurposing word2 layout.
- **Task**: Review during T001, monitor
- **Status**: ACCEPTED (acceptable for target hardware)

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

## R004: CLOOMC++ Compiler — Incorrect Code Generation
- **Severity**: HIGH (correctness), LOW (security)
- **New**: Yes — compiler is entirely new
- **Layer**: CLOOMC++ compiler (cloomc_compiler.js)
- **Risk**: Compiler bugs could produce code with wrong c-list offsets (capability confusion),
  incorrect branch targets (arbitrary execution within lump), misallocated registers (data
  corruption), or invalid instruction encodings.
- **Key insight**: The compiler CANNOT break security — only correctness. The capability
  model constrains from below. mLoad + CALL + bounds checking still enforces the lump
  boundaries. A buggy compiler gives wrong answers within the correct security perimeter,
  not security breaches. The c-list IS the authority — if it doesn't contain a GT, no
  compiler bug can conjure one.
- **Fix**:
  - Simple compiler, no optimizations initially
  - Emit compilation manifest (source line to instructions) for auditing
  - Verify Resident Object Model c-list offsets match upload capabilities array exactly
  - Simple register allocation (linear scan, no spilling for Phase 1)
- **Task**: T005, T006
- **Status**: RESOLVED (Phase 1 JS; Phase 1b Haskell deferred)

## R005: CLOOMC++ C-List Offset Mismatch
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
- **Layer**: CLOOMC++ Haskell front-end (cloomc_compiler.js)
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
- **Layer**: CLOOMC++ code generator (cloomc_compiler.js)
- **Risk**: The Church Machine has 16 DRs. If the compiler uses DR5 for a local variable
  but DR5 is also used by the calling convention to pass arguments to a CALL, the value
  is silently corrupted. No fault — just wrong computation.
- **Fix**: Define a fixed calling convention:
  - DR0-DR3: argument passing / return values (caller-saved)
  - DR4-DR11: local variables (callee-saved)
  - DR12-DR15: temporaries (compiler scratch, caller-saved)
  - Document this in docs/architecture.md
  - Compiler enforces convention in code generation
- **Task**: T005
- **Status**: RESOLVED

## R009: Namespace Isolation — The Core Guarantee
- **Severity**: FOUNDATIONAL
- **New**: No — this is the core architecture
- **Layer**: All layers
- **Guarantee**: Each namespace (sibling) has its own NS table, its own Memory region,
  its own set of GTs. No external actor can reach inside without a valid, unrevoked
  Inform GT with sufficient permissions. The parent's c-list is the parental approval.
  Revoking a GT (incrementing version) instantly cuts access — all copies become invalid.
- **How it holds under new changes**:
  - Single NS entry model: each abstraction's lump is bounded by sealed NS entry — safe
  - CALL split: CR7 and CR6 have hardcoded domain permissions — safe (R001 RESOLVED)
  - CLOOMC++ compiler: cannot forge GTs, cannot escape lump bounds — safe
  - Upload validation: Navana validates all capability delegation — safe (R007 RESOLVED)
  - Boot: one raw write for Navana, all else through Navana.Add — safe (R003 RESOLVED)
- **Status**: SECURE (all contingencies resolved)

## Resolution Tracking

| Risk | Severity | Task | Status |
|------|----------|------|--------|
| R001 | CRITICAL | T002 | RESOLVED |
| R002 | MEDIUM | T001 | ACCEPTED |
| R003 | LOW | T009 | RESOLVED |
| R004 | HIGH/LOW | T005,T006 | RESOLVED (Phase 1) |
| R005 | MEDIUM | T005 | RESOLVED |
| R006 | MEDIUM | T006 | RESOLVED |
| R007 | HIGH | T010 | RESOLVED |
| R008 | MEDIUM | T005 | RESOLVED |
| R009 | FOUNDATIONAL | All | SECURE |
