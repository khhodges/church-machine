# GT-Literals, Lambda Calculus, and the CLOOMC Value Domain

> **Status**: Architectural design document. The GT Type field (Inform, Outform, Literal, Abstract) exists in the simulator's 32-bit GT format. The LDL, STL, and LAMBDA instructions specified here are proposed additions to the RV32-Cap Church instruction set. This document defines the design and provides constructive examples with performance estimates.

## Overview

The GT-Literal (Type = 10) is the **value domain** of the Church-Lambda-Object-Oriented-Meta-Calculus (CLOOMC). It is Church's answer to the question: *what is a value in a capability-secured architecture?*

A value is a fully reduced term — it requires no further evaluation. In CLOOMC, the GT-Literal embodies this principle:

- **Inform** GTs are *names* — they refer to namespace objects and require dereferencing through mLoad (validation: MAC, version, permissions, bounds)
- **Outform** GTs are *remote names* — they refer to network resources and require fetch/flush through HTTPS
- **Abstract** GTs are *functions* — they are callable entry points requiring E permission and domain crossing
- **GT-Literals** are *values* — they are already reduced. No dereferencing, no validation, no domain crossing. Pure data.

This is Church's distinction between values and expressions, enforced by hardware through the 2-bit Type field.

---

## Two Forms of GT-Literal

GT-Literals come in two forms, distinguished by context:

### Direct GT-Literal (Self-Contained Value)

The GT carries the value in its own bits. No namespace entry, no mLoad, no MAC check. The value is the GT.

```
Direct GT-Literal [31:0]:
  [31:2]  Value   (30 bits) — the literal value itself
  [1:0]   Type=10 (2 bits)  — Literal
```

No Version field — there is no namespace entry to cross-check against. Revocation is not meaningful for a direct value; the value exists only while the register holds it.

No Permissions field — the value is self-contained. Access control is structural: whoever holds the CR holds the value. The instructions that create and consume GT-Literals (LDL, STL, LAMBDA) enforce the architectural boundaries.

This gives **30 bits of value space** — integers from 0 to 1,073,741,823 (approximately 1 billion), or signed integers from -536,870,912 to +536,870,911.

**Use cases**: Small integers, loop counters, boolean flags, enumeration values, compact local credentials, hash values, packed bit fields, lambda calculus variables.

### Indirect GT-Literal (Namespace-Backed Handle)

The GT is a handle to a secret value stored in a namespace entry. The standard 32-bit GT format applies:

```
Indirect GT-Literal [31:0]:
  [31:27] Version    (7 bits)  — Cross-checked against namespace entry version
  [26:8]  Index      (17 bits) — Namespace index of the value entry
  [7:2]   Permissions (6 bits) — Access control on the value
  [1:0]   Type = 10  (2 bits)  — Literal
```

The secret value resides in the namespace entry's Location and Limit fields. The MAC seal provides integrity protection. mLoad validates version, MAC, and permissions before access.

**Use cases**: Cryptographic keys (RPC tunnel, data-at-rest encryption), authentication credentials (transparent login), session tokens, API keys, bearer tokens. See [Network Transparency](network-transparency.md) for details on the RPC tunnel key and remote access use cases.

### How the System Distinguishes the Two Forms

The instruction determines the form:

- **LDL** (Load Literal) and **STL** (Store Literal) operate on **direct** GT-Literals. They create and extract 30-bit values without namespace involvement.
- **CAP.LOAD** on a namespace entry with Literal type produces an **indirect** GT-Literal. It goes through mLoad, validating MAC, version, and permissions as usual.
- The **LAMBDA** instruction consumes a **direct** GT-Literal as its argument — the value is immediately available, no dereferencing needed.

---

## Three New Church Instructions

### LDL — Load Literal

Creates a direct GT-Literal in a capability register from an immediate value or data register.

```
LDL CRd, rs1        ; CRd = GT-Literal with Value = rs1[29:0], Type = 10
LDL CRd, imm        ; CRd = GT-Literal with Value = imm, Type = 10
```

**Semantics**: Takes a 30-bit value and wraps it as a GT-Literal. This is the bridge from the Turing domain (data registers) into the Church domain (capability registers) for literal values.

**Performance**: 1 cycle. No namespace access, no mLoad, no MAC computation. Pure register write with type tag.

### STL — Store Literal

Extracts the 30-bit value from a direct GT-Literal in a capability register into a data register.

```
STL rd, CRs         ; rd = CRs.Value[29:0] (zero-extended to 32 bits)
```

**Semantics**: Takes a GT-Literal and unwraps it into the Turing domain. FAULT if CRs.Type is not Literal (10) — this prevents misinterpreting a capability handle as a value.

**Performance**: 1 cycle. Type check + register read. No namespace access.

### LAMBDA — Lambda Application

Applies a code body to an argument, producing a result. This is Church's function application: `CRd = (λx.body)(arg)`.

```
LAMBDA CRd, CRbody, CRarg
```

- `CRbody` — a GT with **X permission** pointing to executable code (an Inform namespace object). This is the lambda body.
- `CRarg` — a **direct GT-Literal** holding the input value (the bound variable).
- `CRd` — receives the result as a new **direct GT-Literal**.

**Semantics**:

```
1. Check CRbody.Type = Inform (00) or Abstract (11) → FAULT if Literal or Outform
2. Check X permission on CRbody → FAULT if denied
3. Load CRbody into CR7 (code segment) — same as CALL's code loading
4. Bind CRarg as the input (available to the body's instructions)
5. Branch to CRbody's code
6. Body executes, computes result
7. Result written to CRd as a new direct GT-Literal
8. Execution continues after LAMBDA instruction
```

**Key distinction from CALL**:
- CALL uses **E permission** and crosses a protection domain (new C-List, stack frame push). It is the service invocation mechanism.
- LAMBDA uses **X permission** and stays in the **same protection domain** (same C-List, same CR6). It is pure computation. No domain crossing, no stack frame overhead.

**Performance**: 2 cycles for setup + body execution time. The LAMBDA instruction itself (steps 1-5) is 2 cycles — type check, permission check, CR7 load, branch. Compare to CALL at 10+ cycles (stack frame push, C-List switch, mLoad validation, domain crossing).

---

## Constructive Examples

### Example 1: A = B + C (Arithmetic on GT-Literals)

The simplest case: pure arithmetic on literal values, staying in the Church domain.

```asm
; Setup: create GT-Literal values
LDL   CR1, x5          ; CR1 = GT-Literal(5)  — B
LDL   CR2, x6          ; CR2 = GT-Literal(3)  — C

; Extract to Turing domain for arithmetic
STL   x10, CR1         ; x10 = 5
STL   x11, CR2         ; x11 = 3
ADD   x12, x10, x11    ; x12 = 8  (Turing arithmetic)

; Return result to Church domain
LDL   CR0, x12         ; CR0 = GT-Literal(8)  — A = B + C
```

**Cycle count**: 6 cycles total (2× LDL + 2× STL + 1× ADD + 1× LDL)

**Comparison with namespace-backed approach**:
If B and C were stored in namespace entries, the equivalent would require two CAP.LOAD instructions through mLoad (5+ cycles each for MAC check, version check, permission check, namespace lookup), plus the arithmetic, plus a CAP.SAVE to store the result. Total: 15+ cycles.

**Speedup**: ~2.5× faster for simple arithmetic by avoiding mLoad entirely.

### Example 2: Lambda Application — Square Function

Apply a "square" function to a GT-Literal argument.

```asm
; The square function body lives at a namespace entry with X permission
; Assume CR3 holds a GT pointing to the square code body (Inform, X permission)
; CR3 was loaded earlier via CAP.LOAD CR3, CR6, <index>

; Create the argument
LDL   CR1, x7          ; CR1 = GT-Literal(7) — the argument

; Apply: CR0 = square(7) = 49
LAMBDA CR0, CR3, CR1   ; CR0 = GT-Literal(49)

; The square function body (at the code pointed to by CR3):
;   STL   x10, CRarg     ; x10 = 7 (extract argument)
;   MUL   x11, x10, x10  ; x11 = 49
;   LDL   CRd, x11       ; CRd = GT-Literal(49) (return result)
```

**Cycle count**: 1 (LDL) + 2 (LAMBDA setup) + 3 (body: STL + MUL + LDL) = **6 cycles**

**Comparison with CALL/RETURN**:
Using CAP.CALL for the same operation: push stack frame (3 cycles), switch C-List via mLoad (5 cycles), execute body (3 cycles), RETURN with revalidation (5 cycles) = **16+ cycles**.

**Speedup**: ~2.7× faster. LAMBDA avoids the domain-crossing overhead because the body executes in the same protection domain with X permission, not E.

### Example 3: Factorial via Y Combinator (Recursive Lambda)

The Y combinator enables recursion without explicit loop instructions. In CLOOMC, this is a chain of LAMBDA applications with GT-Literal values.

```asm
; Factorial of N using recursive LAMBDA application
; CR4 = GT with X permission pointing to factorial body
; The body tests its argument, multiplies, and recurses via LAMBDA

; Compute 5! = 120
LDL   CR1, x5          ; CR1 = GT-Literal(5) — N = 5
LAMBDA CR0, CR4, CR1   ; CR0 = GT-Literal(120) — result of factorial(5)

; Factorial body (recursive):
;   STL   x10, CRarg     ; x10 = N
;   BEQ   x10, x0, base  ; if N == 0, goto base case
;   ADDI  x11, x10, -1   ; x11 = N - 1
;   LDL   CR1, x11       ; CR1 = GT-Literal(N-1)
;   LAMBDA CR2, CR4, CR1 ; CR2 = factorial(N-1) — recursive application
;   STL   x12, CR2       ; x12 = factorial(N-1)
;   MUL   x13, x10, x12  ; x13 = N * factorial(N-1)
;   LDL   CRd, x13       ; return GT-Literal(N * factorial(N-1))
;   B     done
; base:
;   LDL   CRd, 1         ; return GT-Literal(1) — base case
; done:
```

**Cycle count**: 5 recursive calls × ~8 cycles per call = **~40 cycles** for factorial(5)

**Comparison with CALL/RETURN recursion**:
5 recursive calls × 16+ cycles per CALL/RETURN = **80+ cycles**

**Speedup**: ~2× faster. Each recursive step avoids the stack frame and domain-crossing overhead of CALL/RETURN.

### Example 4: Map Function — Apply Lambda to Array

Apply a transformation function to each element of an array, producing GT-Literal results.

```asm
; CR3 = GT with X permission pointing to "double" function body
; x20 = base address of input array (5 elements)
; x21 = base address of output array

; Process each element
ADDI  x22, x0, 5       ; x22 = count = 5
ADDI  x23, x0, 0       ; x23 = index = 0

loop:
  BEQ   x23, x22, done ; if index == count, done
  SLL   x24, x23, 2    ; x24 = index * 4 (word offset)
  ADD   x25, x20, x24  ; x25 = &input[index]
  LW    x26, 0(x25)    ; x26 = input[index]

  ; Apply lambda: output[i] = double(input[i])
  LDL   CR1, x26           ; CR1 = GT-Literal(input[index])
  LAMBDA CR0, CR3, CR1     ; CR0 = GT-Literal(double(input[index]))
  STL   x27, CR0           ; x27 = result value

  ADD   x28, x21, x24  ; x28 = &output[index]
  SW    x27, 0(x28)    ; output[index] = result

  ADDI  x23, x23, 1    ; index++
  B     loop
done:
```

**Cycle count per element**: 1 (LDL) + 2 (LAMBDA setup) + ~2 (double body) + 1 (STL) + ~4 (loop overhead) = **~10 cycles**
**Total for 5 elements**: ~50 cycles

**Comparison with CALL/RETURN per element**: ~20 cycles per element × 5 = **~100 cycles**

**Speedup**: ~2× faster for functional map patterns.

---

## The Lambda Calculus Connection

The GT-Literal and LAMBDA instruction together implement Church's lambda calculus in hardware:

| Lambda Calculus | CLOOMC | Hardware |
|----------------|--------|----------|
| **Value** (fully reduced term) | Direct GT-Literal | 30-bit value in CR, Type = 10 |
| **Variable** (bound name) | CRarg in LAMBDA | GT-Literal register operand |
| **Abstraction** (λx.body) | GT with X permission | Code object in namespace, X bit set |
| **Application** (f x) | LAMBDA CRd, CRbody, CRarg | Branch to body, bind arg, collect result |

### Church's Insight, Enforced by Hardware

In Church's original formulation, the lambda calculus distinguishes between:
- **Values**: Things that are already computed — numbers, booleans, data
- **Expressions**: Things that require evaluation — function applications, variable lookups

The CLOOMC Type field makes this distinction **architectural**:
- Type = 10 (Literal) → **value** → no evaluation needed → direct use
- Type = 00 (Inform) → **name** → requires evaluation (mLoad) → dereferencing needed
- Type = 01 (Outform) → **remote name** → requires evaluation (HTTPS fetch) → network access needed
- Type = 11 (Abstract) → **callable** → requires evaluation (CALL/E) → domain crossing needed

The hardware enforces this at every instruction: the Type field determines the execution path. A GT-Literal skips the entire validation apparatus (mLoad, MAC, version, permissions, namespace lookup) because **a value does not need validation — it simply is**.

### Combinators as Optimization Targets

The classical lambda calculus combinators map naturally to CLOOMC patterns:

| Combinator | Definition | CLOOMC Pattern |
|-----------|-----------|---------------|
| **I** (identity) | λx.x | LAMBDA CR0, CRbody_I, CR1 → CR0 = CR1. Body is a single `LDL CRd, CRarg`. **1 cycle** — optimizable to register move. |
| **K** (constant) | λx.λy.x | Two nested LAMBDAs; the inner body ignores its argument. **2 cycles** — optimizable to single register copy. |
| **S** (substitution) | λf.λg.λx.f(x)(g(x)) | Three nested LAMBDAs with two inner applications. Demonstrates higher-order GT-Literal threading. |
| **Y** (fixed-point) | λf.(λx.f(x x))(λx.f(x x)) | Self-referencing LAMBDA chain — enables recursion without explicit loop instructions. See Example 3 (factorial). |

A hardware implementation could recognize I and K patterns and short-circuit them to single-cycle operations, bypassing the LAMBDA setup entirely.

---

## Performance Summary

| Operation | Cycles | Notes |
|-----------|--------|-------|
| LDL (create GT-Literal) | 1 | Register write with type tag |
| STL (extract value) | 1 | Type check + register read |
| LAMBDA (setup) | 2 | Type check, X permission check, CR7 load, branch |
| LAMBDA (total, simple body) | ~6 | Setup + body execution |
| CAP.LOAD (mLoad path) | 5+ | MAC, version, permission, namespace lookup, CR write |
| CAP.CALL (domain crossing) | 10+ | Stack frame, C-List switch, mLoad, branch |
| CAP.RETURN (domain return) | 5+ | Stack pop, CR revalidation via mLoad |

**Key insight**: Direct GT-Literal operations (LDL, STL, LAMBDA) avoid the mLoad validation path entirely. For pure computation within a single protection domain, this yields a **2-3× speedup** over the namespace-backed CALL/RETURN path. The security is structural — the Type field prevents misuse — rather than per-access validation.

---

## Security Model

### Direct GT-Literals

Security for direct GT-Literals is **structural**, not per-access:

1. **Creation**: Only the LDL instruction can create a GT-Literal. A program cannot forge one from arbitrary bits — the Type field (bits [1:0] = 10) is set by the instruction.
2. **Extraction**: Only the STL instruction can extract the value. It verifies Type = Literal before proceeding — FAULT if the CR holds any other type.
3. **LAMBDA boundary**: The LAMBDA instruction checks X permission on the body GT and Literal type on the argument. A program cannot LAMBDA with an Inform/Outform/Abstract argument or an X-less body.
4. **No escalation path**: A GT-Literal cannot be used as a capability — it has no Version, no Index, no Permissions. Passing it to CAP.CALL or CAP.LOAD will FAULT because the Type field is wrong for those instructions.

### Indirect GT-Literals (Namespace-Backed)

Security for indirect GT-Literals uses the **full mLoad validation path**, identical to any other namespace access:

1. **Version check**: GT version must match namespace entry version
2. **MAC check**: Namespace entry MAC must validate (integrity)
3. **Permission check**: Required permissions must be present on the GT
4. **GC integration**: gBit reset on access, version bump on sweep (revocation)

The two forms are complementary: direct GT-Literals are fast but transient (register lifetime), indirect GT-Literals are validated but persistent (namespace lifetime).
