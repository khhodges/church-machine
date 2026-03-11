# LAMBDA Instruction Specification

**Status**: Architectural specification. February 14, 2026.

## Overview
LAMBDA is a lightweight, in-scope code application instruction. It is Church's function application (λx.body applied to argument) implemented as a single RISC-V custom instruction. LAMBDA achieves macro-like code reuse — code exists once in memory, invoked from multiple call sites with near-zero overhead — without code duplication.

LAMBDA is also one of the three **dispatch styles** for abstraction method resolution (see `docs/dispatch-styles.md`). When an abstraction uses LAMBDA dispatch, CR7's code uses `LAMBDA CRn, x` to jump directly to method bodies — the fastest path for lightweight compute operations like those in SlideRule, Abacus, and Circle.

## Instruction Format
```
LAMBDA CRn, x
```
- **CRn**: Capability register holding a GT with **X (Execute) permission** pointing to the code body. This is Church's lambda — the GT *is* λx.body.
- **x**: Data register holding the argument value. This is Turing's data — the value to operate on.

## Permission: X, Not E
- **X (Execute)**: Jump to code in the same protection domain. No C-List change, no domain crossing. The code body was already validated when its GT was loaded via mLoad.
- **E (Enter)**: Reserved for CALL — domain crossing with full ceremony (stack frame, C-List switch, mLoad revalidation).
- The distinction is Church's: λ-application within a scope (LAMBDA/X) vs. service invocation across a boundary (CALL/E).

## Execution: Machine-Status Fast Path

### LAMBDA Entry:
1. Check CRn.Type = Inform (00) → FAULT if NULL, Outform, or Abstract
2. Check X permission on CRn → FAULT if X bit not set
3. Check LAMBDA-active flag in machine status → FAULT if already set (non-nestable)
4. Save PC+4 to LAMBDA_PC machine status register
5. Set LAMBDA-active flag in machine status
6. Branch to CRn's code address

### RETURN from LAMBDA (fast path):
1. Check LAMBDA-active flag in machine status
2. If set: restore PC from LAMBDA_PC register, clear LAMBDA-active flag
3. Zero stack access — pure machine-status operation

### RETURN from Stack (when CALL intervened):
1. LAMBDA-active flag is NOT set (CALL cleared it)
2. Pop stack frame
3. Check 1-bit tag on frame:
   - Tag=0 (CALL frame): restore CR5+CR6+CR7+PC, check E permission on saved CR6 GT, revalidate
   - Tag=1 (LAMBDA frame): restore PC only

## Stack Frame 1-Bit Tag

Every frame on the capability stack carries a 1-bit tag:
| Tag | Type | Contents | RETURN behavior |
|-----|------|----------|-----------------|
| 0 | CALL | CR5+CR6+CR7+PC+LAMBDA state | Full domain restoration (CR5 carries private instance data) |
| 1 | LAMBDA | PC only | Simple PC restoration |

The tag makes the thread's execution history **self-describing**. When resuming a suspended thread, the stack tells you exactly what kind of return each frame requires. No external metadata needed.

## Non-Nestable Rule

**Rule**: If LAMBDA-active flag is set and a LAMBDA instruction is encountered, FAULT.

**Rationale**: Two concurrent LAMBDA return addresses would require a return stack — hidden hardware state that complicates CHANGE, interrupts, and testing.

## CALL-Mediated Nesting

CALL naturally enables nested LAMBDA by saving and restoring machine status:

```
LAMBDA A       → machine status: LAMBDA_PC=return-to-caller, active=1
  code body A
  CALL ...     → saves {LAMBDA_PC, active=1} to CALL stack frame, clears active flag
    LAMBDA B   → machine status: LAMBDA_PC=return-to-inside-A, active=1
    RETURN     → fast path: restore from machine status (back inside A)
  RETURN       → pops CALL frame, restores {LAMBDA_PC, active=1} from frame
RETURN         → fast path: restore from machine status (back to caller)
```

No special nesting logic designed — it falls out naturally from CALL saving machine status. Uniformity by construction.

## CHANGE and Interrupt Behavior

When **CHANGE** (context switch) occurs during a LAMBDA body:
- Save LAMBDA_PC and LAMBDA-active flag as part of thread context
- The incoming thread's LAMBDA state is restored

When an **interrupt** occurs during a LAMBDA body:
- Same: save LAMBDA_PC and active flag with thread state
- Interrupt handler runs with LAMBDA-active=0 (clean state)
- On return from interrupt, restore LAMBDA state

## Performance Comparison

| | Macro | CALL | LAMBDA |
|---|-------|------|--------|
| Code copies | N copies (one per use) | 1 copy | 1 copy |
| Overhead per use | 0 (inline) | 10+ cycles | 2-3 cycles |
| Stack access | None | Full frame push/pop | None (fast path) |
| Domain crossing | No | Yes (E permission) | No (X permission) |
| Code reuse | No (duplication) | Yes | Yes |
| Binary size | Bloated | Compact | Compact |

LAMBDA = macro's speed + function's code reuse.

## Constructive Example: Clamp Function

The following examples use Sim-32 RISC-V register naming (x0-x31, MV, BGE, BLE, LI, J) which maps to the Church Machine's data register conventions. In Sim-64, these would be DR0-DR15 with Church Machine mnemonics (IADD, MCMP, BRANCH, etc.).

A graphics program needs to clamp RGB values to 0-255 range:

### With a macro (code duplicated 3 times):
```asm
; Each use copies ~6 instructions. 3 channels = 18 instructions in binary.
```

### With CALL (code exists once, heavy overhead):
```asm
; 10+ cycles overhead per invocation. 3 channels = 30+ cycles wasted on ceremony.
```

### With LAMBDA (code exists once, near-zero overhead):
```asm
; CR2 holds GT with X permission pointing to clamp body
; Process R, G, B channels

MV    x10, x20          ; x10 = R value
LAMBDA CR2, x10         ; clamp R (2-3 cycles, zero stack access)
MV    x20, x10          ; store clamped R

MV    x10, x21          ; x10 = G value
LAMBDA CR2, x10         ; clamp G
MV    x21, x10

MV    x10, x22          ; x10 = B value
LAMBDA CR2, x10         ; clamp B
MV    x22, x10

; Clamp body (exists ONCE in memory):
clamp_body:
  BGE   x10, x0, .not_neg
  MV    x10, x0
  J     .check_high
.not_neg:
.check_high:
  LI    x5, 255
  BLE   x10, x5, .done
  LI    x10, 255
.done:
  RETURN                  ; fast path: restore PC from machine status
```

**Result**: 3 invocations × 2-3 cycles = 6-9 cycles total overhead. Code exists once. Zero stack access. Macro-like performance with function-like code reuse.

## Constructive Example: Array Processing with Nested LAMBDA

```asm
; Apply "process" function to each array element
; CR3 holds GT with X permission pointing to process body
; process body itself calls a helper via CALL, then applies a transform via LAMBDA

loop:
  LW    x10, 0(x20)       ; load element
  LAMBDA CR3, x10          ; apply process (fast path)
  SW    x10, 0(x21)        ; store result
  ADDI  x20, x20, 4
  ADDI  x21, x21, 4
  BNE   x20, x22, loop

; process body:
process_body:
  ; ... some preprocessing ...
  CALL  CR4                ; call helper — saves LAMBDA state to stack
    ; inside helper, we can LAMBDA again:
    ; LAMBDA CR5, x10      ; nested LAMBDA — permitted because CALL cleared the flag
    ; RETURN               ; fast path return from nested LAMBDA
  RETURN                   ; CALL return — restores LAMBDA state
  ; ... some postprocessing ...
  RETURN                   ; fast path return from outer LAMBDA
```

## The Church-Turing Marriage

| Church's Theory | CTMM Hardware |
|----------------|---------------|
| λx.body (function definition) | GT with X permission in CRn |
| Argument (bound variable) | Value in data register x |
| Application (f applied to x) | `LAMBDA CRn, x` |
| Result | Value in data register after RETURN |
| Function as first-class value | GT can be passed, stored, shared |
| Referential transparency | Body sees only its argument in DRs, no CR side effects |

The GT *is* the lambda. You can pass it between threads, store it in namespace entries, share it — but you can only execute it if you hold the token with X permission. Church gave us the theory (functions as values, applied to arguments). Turing gave us the machine (registers, memory, sequential execution). LAMBDA unifies them: a Turing machine instruction that performs Church's function application, secured by capability tokens, at near-zero cost.

## Security Properties

1. **X permission required**: The GT must have X permission. Without it, FAULT.
2. **Same domain**: No C-List change, no domain crossing. The body executes in the caller's protection domain.
3. **No CR writes**: LAMBDA body operates on DRs only. CRs are not modified during the body's execution.
4. **mLoad validated**: The GT in CRn was loaded via mLoad at some earlier point. Its code address was validated then. LAMBDA trusts that validation.
5. **FAULT on NULL**: If CRn holds NULL (Type=10), FAULT immediately.
6. **Non-nestable**: Prevents hidden state accumulation.
7. **Self-describing**: Stack frames carry their own type, making the thread's history transparent.
