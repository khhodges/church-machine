# Dispatch Styles: Three Ways to Resolve Method Calls

**Status**: Architectural specification. February 16, 2026.

## Overview

When a caller invokes a method on an abstraction, CR6 switches to that abstraction's C-List (containing symbolic method names) and CR14 switches to its nucleus code. The nucleus in CR14 must resolve the symbolic name to an executable code block. The architecture does not mandate a single dispatch mechanism — it provides three styles with different security/performance tradeoffs.

The abstraction's creator chooses the style. Different abstractions in the same system can use different styles. The caller never knows which style is used — they just call a method on an abstraction and get a result.

## Style 1: Symbolic Resolver (High-Security)

### How It Works

CR14 contains a dispatcher — a code object that reads the method name from CR6's C-List and resolves it to a code block at runtime. The method names in CR6 are **symbolic** (capability entries with names like "Mint", "GC", "Lookup"), not code addresses.

### Dispatch Flow

1. Caller does `CALL(Abstraction.Method(args))`
2. CR6 switches to the abstraction's C-List
3. CR14 switches to the abstraction's dispatcher code
4. Dispatcher reads the method index from the call
5. Dispatcher looks up the symbolic entry in CR6
6. Dispatcher resolves the symbol to a code block (internal jump table)
7. Code block executes, operates on DR arguments
8. RETURN restores caller's CR6 and CR14

### Properties

| Property | Value |
|----------|-------|
| Security | Highest — caller never sees code addresses |
| Performance | Moderate — runtime symbol resolution |
| Isolation | Maximum — implementation fully hidden behind symbols |
| Use case | Sensitive operations, system services, security-critical abstractions |

### Example: Hello Mum

The Hello Mum example uses symbolic dispatch for `CALL(Thread.Mint(type, size, access))`:

```
Caller:
  CALL(Thread.Mint(type, size, access))

Thread's CR14 dispatcher:
  1. Reads method index → resolves "Mint" symbol from CR6
  2. Checks thread's resource budget
  3. Internally loads Namespace from self (CR5)
  4. Delegates to Namespace.Mint
  5. Returns new GT in CR0
```

The caller has no visibility into whether Mint is local code, a delegation to the Namespace, or a chain of three abstraction calls. Complete encapsulation.

## Style 2: LAMBDA Fast-Path

### How It Works

CR14 contains code that uses the LAMBDA instruction to jump directly to method bodies. LAMBDA uses X permission (not E), operates in the same protection domain, and uses machine-status registers instead of the stack. Near-zero overhead.

### Dispatch Flow

1. Caller does `CALL(Abstraction.Method(args))` — standard CALL ceremony
2. CR6 switches to the abstraction's C-List
3. CR14 switches to the abstraction's code object
4. Code loads the method GT from CR6 (GT has X permission)
5. `LAMBDA CRn, x` — jumps to method body
6. Method body operates on DRs, no CR changes
7. RETURN — fast path via machine-status register (no stack pop)
8. Outer RETURN restores caller's CR6 and CR14

### Properties

| Property | Value |
|----------|-------|
| Security | Medium — same domain, no CR writes |
| Performance | Fastest — 2-3 cycles per LAMBDA, zero stack access |
| Isolation | Moderate — code runs in caller's domain |
| Use case | Lightweight compute functions, arithmetic, utility operations |

### Example: SlideRule / Abacus / Circle

The compute abstractions use LAMBDA for their methods:

```asm
; SlideRule.Multiply using LAMBDA
; CR2 holds GT with X permission pointing to multiply body

MV    DR1, <operand_a>
MV    DR2, <operand_b>
LAMBDA CR2, DR1         ; jump to multiply body (2-3 cycles)
; DR1 now holds result
```

Code exists once in memory. Each invocation costs 2-3 cycles. No stack frame. Macro-like speed with function-like code reuse.

## Style 3: Traditional Compiled Binary

### How It Works

CR14 contains a conventional compiled code object — a single binary with standard method offsets. Methods are reached via computed offsets from the code base address. This is the familiar programming model: call a function at a known offset.

### Dispatch Flow

1. Caller does `CALL(Abstraction.Method(args))`
2. CR6 switches to the abstraction's C-List
3. CR14 switches to the compiled binary
4. Entry point dispatches to the method via offset table
5. Method executes as conventional code
6. RETURN restores caller's CR6 and CR14

### Properties

| Property | Value |
|----------|-------|
| Security | Standard — conventional code execution |
| Performance | Fast — direct jumps, no runtime resolution |
| Isolation | Standard — method offsets visible in binary |
| Use case | General application code, familiar programming model |

### Example: Access.asm

The default Access.asm example uses traditional binary dispatch:

```asm
; Access.asm — standard compiled code
; CR14 points to this code object
; Methods accessed via conventional call/return at known offsets

entry:
    ; Standard instruction execution
    MOV DR1, 42
    ADD DR1, DR1, DR2
    ; ...
```

This is the most familiar model — the capability framework wraps it, but the internal dispatch is traditional.

## Comparison

| | Symbolic Resolver | LAMBDA Fast-Path | Traditional Binary |
|---|---|---|---|
| CR14 contains | Dispatcher/resolver | Code with LAMBDA instructions | Conventional compiled binary |
| Method resolution | Runtime symbol lookup | Direct X-permission jump | Offset from base address |
| Security level | Highest | Medium | Standard |
| Performance | Moderate | Fastest (2-3 cycles) | Fast |
| Stack usage | Full CALL ceremony | Zero (machine-status) | Standard |
| Caller visibility | Sees nothing — only symbols | Sees nothing — standard CALL | Sees nothing — standard CALL |
| Best for | System services, Mint, crypto | Arithmetic, utilities | General application code |
| Simulator example | Hello Mum | SlideRule, Abacus, Circle | Access.asm |

## The Key Insight

All three styles present the **same interface to the caller**: `CALL(Abstraction.Method(args))`. The caller cannot tell which style is used. CR6 holds the method names, CR14 holds the code — how CR14 resolves those names is an implementation detail hidden inside the abstraction. That's the power of encapsulation through capabilities.
