# LAMBDA Instruction Specification

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

**Status**: Architectural specification. February 14, 2026.

## Overview
LAMBDA is a lightweight, in-scope code application instruction. It is Church's function application (λx.body applied to argument) implemented as a native CM instruction. LAMBDA achieves macro-like code reuse — code exists once in memory, invoked from multiple call sites with near-zero overhead — without code duplication.

LAMBDA is also one of the three **dispatch styles** for abstraction method resolution (see `docs/dispatch-styles.md`). When an abstraction uses LAMBDA dispatch, CR7's code uses `LAMBDA CRn` to jump directly to method bodies — the fastest path for lightweight compute operations like those in SlideRule, Abacus, and Circle.

## Instruction Format
```
LAMBDA CRn
```
- **CRn**: Capability register holding a GT with **X (Execute) permission** pointing to the code body. This is Church's lambda — the GT *is* λx.body.
- **Argument**: Passed in a data register by convention (e.g. DR10). This is Turing's data — the value to operate on. The register is not encoded in the instruction; the caller and body share a calling convention.

## Permission: X, Not E
- **X (Execute)**: Jump to code in the same protection domain. No C-List change, no domain crossing. The code body was already validated when its GT was loaded via mLoad.
- **E (Enter)**: Reserved for CALL — domain crossing with full ceremony (stack frame, C-List switch, mLoad revalidation).
- The distinction is Church's: λ-application within a scope (LAMBDA/X) vs. service invocation across a boundary (CALL/E).

## Execution: Machine-Status Fast Path

### LAMBDA Entry:
1. Check CRn.Type = Inform (01) → FAULT if NULL, Outform, or Abstract
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
   - Tag=0 (CALL frame): pop [E-GT · machine word]; re-derive CR6/CR14 via mLoad using E-GT; check E permission; restore PC from machine word
   - Tag=1 (LAMBDA frame): restore PC only

## Stack Frame 1-Bit Tag

Every frame on the capability stack carries a 1-bit tag:
| Tag | Type | Contents | RETURN behavior |
|-----|------|----------|-----------------|
| 0 | CALL | [E-GT · machine word] — 2 words | Full domain restoration — re-derives CR6, CR14 via mLoad on RETURN |
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

A graphics program needs to clamp RGB values to 0-255 range:

### With a macro (code duplicated 3 times):
```asm
; DR0 = 0 (zero register)
; DR11 = R channel, DR12 = G channel, DR13 = B channel

; --- clamp R inline ---
IADD  DR10, DR11, #0    ; DR10 = R value
MCMP   DR10, DR0        ; compare with 0
BRANCHGE .r_not_neg     ; if >= 0, skip
IADD   DR10, DR0, #0   ; DR10 = 0
BRANCH .r_check_high
.r_not_neg:
.r_check_high:
IADD   DR5, DR0, #255  ; DR5 = 255
MCMP   DR10, DR5        ; compare with 255
BRANCHLE .r_done        ; if <= 255, in range
IADD   DR10, DR0, #255 ; DR10 = 255
.r_done:
IADD  DR11, DR10, #0    ; store clamped R

; --- clamp G inline (identical body, different labels) ---
IADD  DR10, DR12, #0    ; DR10 = G value
MCMP   DR10, DR0
BRANCHGE .g_not_neg
IADD   DR10, DR0, #0
BRANCH .g_check_high
.g_not_neg:
.g_check_high:
IADD   DR5, DR0, #255
MCMP   DR10, DR5
BRANCHLE .g_done
IADD   DR10, DR0, #255
.g_done:
IADD  DR12, DR10, #0    ; store clamped G

; --- clamp B inline (identical body again) ---
IADD  DR10, DR13, #0    ; DR10 = B value
MCMP   DR10, DR0
BRANCHGE .b_not_neg
IADD   DR10, DR0, #0
BRANCH .b_check_high
.b_not_neg:
.b_check_high:
IADD   DR5, DR0, #255
MCMP   DR10, DR5
BRANCHLE .b_done
IADD   DR10, DR0, #255
.b_done:
IADD  DR13, DR10, #0    ; store clamped B

; 10 instructions × 3 channels = 30 instructions in binary.
; No shared body — the assembler emits three full copies.
```

### With CALL (code exists once, heavy overhead):
```asm
; CR8 holds E-GT pointing to clamp_fn (domain crossing required)
; DR0 = 0 (zero register)
; DR11 = R channel, DR12 = G channel, DR13 = B channel

IADD  DR10, DR11, #0    ; DR10 = R value
CALL  CR8, 0x0          ; clamp R — pushes [E-GT · saved-PC] frame, domain cross
IADD  DR11, DR10, #0    ; store clamped R

IADD  DR10, DR12, #0    ; DR10 = G value
CALL  CR8, 0x0          ; clamp G — 10+ cycles overhead again
IADD  DR12, DR10, #0    ; store clamped G

IADD  DR10, DR13, #0    ; DR10 = B value
CALL  CR8, 0x0          ; clamp B — 10+ cycles overhead again
IADD  DR13, DR10, #0    ; store clamped B

; Clamp function body (exists once, entered via CALL):
clamp_fn:
  MCMP   DR10, DR0        ; compare DR10 with 0
  BRANCHGE .not_neg       ; if DR10 >= 0, skip zeroing
  IADD   DR10, DR0, #0   ; DR10 = 0
  BRANCH .check_high
.not_neg:
.check_high:
  IADD   DR5, DR0, #255  ; DR5 = 255
  MCMP   DR10, DR5        ; compare DR10 with 255
  BRANCHLE .done          ; if DR10 <= 255, in range
  IADD   DR10, DR0, #255 ; DR10 = 255
.done:
  RETURN                  ; pops CALL frame (2 words: E-GT + saved PC), restores domain

; 3 invocations × 10+ cycles = 30+ cycles overhead on ceremony alone.
```

### With LAMBDA (code exists once, near-zero overhead):
```asm
; CR2 holds GT with X permission pointing to clamp body
; Process R, G, B channels
; DR0 = 0 (zero register)
; DR11 = R channel, DR12 = G channel, DR13 = B channel (working value passed via DR10)

IADD  DR10, DR11, #0    ; DR10 = R value
LAMBDA CR2              ; clamp R (2-3 cycles, zero stack access)
IADD  DR11, DR10, #0    ; store clamped R

IADD  DR10, DR12, #0    ; DR10 = G value
LAMBDA CR2              ; clamp G
IADD  DR12, DR10, #0    ; store clamped G

IADD  DR10, DR13, #0    ; DR10 = B value
LAMBDA CR2              ; clamp B
IADD  DR13, DR10, #0    ; store clamped B

; Clamp body (exists ONCE in memory):
clamp_body:
  MCMP   DR10, DR0        ; compare DR10 with 0
  BRANCHGE .not_neg       ; if DR10 >= 0, skip zeroing
  IADD   DR10, DR0, #0   ; DR10 = 0
  BRANCH .check_high
.not_neg:
.check_high:
  IADD   DR5, DR0, #255  ; DR5 = 255
  MCMP   DR10, DR5        ; compare DR10 with 255
  BRANCHLE .done          ; if DR10 <= 255, in range
  IADD   DR10, DR0, #255 ; DR10 = 255
.done:
  RETURN                  ; fast path: restore PC from machine status
```

**Result**: 3 invocations × 2-3 cycles = 6-9 cycles total overhead. Code exists once. Zero stack access. Macro-like performance with function-like code reuse.

## Constructive Example: Array Processing with Nested LAMBDA

```asm
; Apply "process" function to each array element
; CR3 = GT with X permission pointing to process body
; CR4 = GT with R permission over current input element
; CR5 = GT with W permission over current output element
; CR7 = GT with E permission to a helper abstraction (used inside process body)
; DR1 = remaining element count

loop:
  MCMP   DR1, DR0         ; check remaining count (DR0 = 0)
  BRANCHEQ .done          ; exit when count exhausted
  DREAD  DR10, CR4, #0    ; load current input element
  LAMBDA CR3              ; apply process (fast path)
  DWRITE CR5, DR10, #0    ; store result to current output element
  ISUB   DR1, DR1, #1     ; decrement remaining count
  ; advance CR4/CR5 to next element (iterator updates GTs for next iteration)
  BRANCH loop
.done:

; process body (pointed to by CR3's GT):
process_body:
  ; ... some preprocessing on DR10 ...
  CALL  CR7, 0xF          ; call helper (E-GT in CR7) — saves LAMBDA state to stack
    ; inside helper, we can LAMBDA again:
    ; LAMBDA CR8           ; nested LAMBDA — permitted because CALL cleared the flag
    ; RETURN               ; fast path return from nested LAMBDA
  RETURN                  ; CALL return — restores LAMBDA state from stack frame
  ; ... some postprocessing on DR10 ...
  RETURN                  ; fast path return from outer LAMBDA
```

## The Church-Turing Marriage

| Church's Theory | Church Machine Hardware |
|----------------|---------------|
| λx.body (function definition) | GT with X permission in CRn |
| Argument (bound variable) | Value in data register (DR10 by convention) |
| Application (f applied to x) | `LAMBDA CRn` |
| Result | Value in data register after RETURN |
| Function as first-class value | GT can be passed, stored, shared |
| Referential transparency | Body sees only its argument in DRs, no CR side effects |

The GT *is* the lambda. You can pass it between threads, store it in namespace entries, share it — but you can only execute it if you hold the token with X permission. Church gave us the theory (functions as values, applied to arguments). Turing gave us the machine (registers, memory, sequential execution). LAMBDA unifies them: a Turing machine instruction that performs Church's function application, secured by capability tokens, at near-zero cost.

## Security Properties

1. **X permission required**: The GT must have X permission. Without it, FAULT.
2. **Same domain**: No C-List change, no domain crossing. The body executes in the caller's protection domain.
3. **No CR writes**: LAMBDA body operates on DRs only. CRs are not modified during the body's execution.
4. **mLoad validated**: The GT in CRn was loaded via mLoad at some earlier point. Its code address was validated then. LAMBDA trusts that validation.
5. **FAULT on NULL**: If CRn holds NULL (Type=00), FAULT immediately.
6. **Non-nestable**: Prevents hidden state accumulation.
7. **Self-describing**: Stack frames carry their own type, making the thread's history transparent.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
