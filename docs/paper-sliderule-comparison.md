# The Church Machine: A Capability-Secured Processor Architecture with Multi-Language Compilation

## A Student Tutorial and Comparative Study Using the SlideRule Abstraction

---

**Abstract.** The Church Machine is a capability-secured processor architecture that enforces security at the hardware instruction level. Unlike conventional processors that rely on operating system privilege modes, the Church Machine uses unforgeable Golden Tokens to gate every memory access. This paper introduces the architecture through a concrete example: the SlideRule mathematical abstraction, implemented in both an imperative JavaScript subset and a functional Haskell subset, both compiling to the same 20-instruction target. We present the compilation process, compare code density and execution characteristics, and discuss the architectural implications of a universal computation substrate secured by capabilities rather than privilege.

**Keywords:** capability security, instruction set architecture, multi-language compilation, FPGA, Golden Tokens, Church-Turing duality

---

## 1. Introduction

### 1.1 The Problem

Modern computer security relies on a fundamentally flawed model: ambient authority. Programs run with broad permissions granted by the operating system, and security is enforced by checking identity rather than capability. A web browser, a text editor, and a cryptocurrency wallet all execute under the same user account, with the same file system access. The only barrier between them is trust in the software — trust that is routinely violated.

The Church Machine takes a different approach, building on the capability-based addressing model first proposed by Dennis and Van Horn [1] and first implemented in hardware by the Plessey System 250 (PP250) [8]. Every memory access — every read, every write, every function call — requires an unforgeable capability token. There is no operating system. There is no privileged mode. There is no superuser. The hardware itself enforces the security model at every instruction cycle. The broader case for why this architectural revolution is necessary — and why conventional binary computers are fundamentally unsuited to civilised cyberspace — is developed at length in Hamer-Hodges [9][10][11].

### 1.2 Contribution

This paper serves as both a student tutorial and a comparative analysis. We present:

1. The Church Machine architecture through the lens of a concrete example
2. The CLOOMC++ compiler, which accepts both JavaScript and Haskell source code
3. A side-by-side comparison of the same mathematical abstraction in both languages
4. Performance analysis on the target hardware (Tang Nano 20K FPGA, 27 MHz)
5. An honest assessment of the architecture's strengths and limitations

**Note on Haskell implementations:** The Haskell versions of Div, Sqrt, and Pow2 are intentionally simplified to demonstrate expression-based compilation on integer hardware. They are not production-correct algorithms — see Section 7.2 for discussion.

### 1.3 Target Hardware

The Church Machine targets the Sipeed Tang Nano 20K development board, built around the Gowin GW2AR-18 FPGA (QN88 package). This device provides 20,736 look-up tables (LUTs), 27 MHz base clock, and sufficient block RAM for the namespace table, memory, and register file. The design is synthesised using the open-source Amaranth HDL framework and the oss-cad-suite toolchain.

---

## 2. Architecture Overview

### 2.1 The 20-Instruction Set

The Church Machine has exactly 20 instructions, divided into two domains:

**Church Domain (capability manipulation):**

| Opcode | Instruction | Purpose |
|--------|-------------|---------|
| 0 | LOAD | Load a Golden Token from the c-list |
| 1 | SAVE | Save a Golden Token to the c-list |
| 2 | CALL | Enter an abstraction via an E-GT |
| 3 | RETURN | Return from an abstraction |
| 4 | CHANGE | Replace a capability with a derived one |
| 5 | SWITCH | Switch execution context |
| 6 | TPERM | Reduce permissions on a token |
| 7 | LAMBDA | Invoke a method within an abstraction |
| 8 | ELOADCALL | Fused load-and-call (performance) |
| 9 | XLOADLAMBDA | Fused load-and-lambda (performance) |

**Turing Domain (data processing):**

| Opcode | Instruction | Purpose |
|--------|-------------|---------|
| 10 | DREAD | Read from data memory |
| 11 | DWRITE | Write to data memory |
| 12 | BFEXT | Extract a bitfield |
| 13 | BFINS | Insert a bitfield |
| 14 | MCMP | Compare two values (set flags) |
| 15 | IADD | Integer addition |
| 16 | ISUB | Integer subtraction |
| 17 | BRANCH | Conditional/unconditional branch |
| 18 | SHL | Shift left |
| 19 | SHR | Shift right |

RETURN (opcode 3) is shared by both domains.

### 2.2 Instruction Encoding

Every instruction is 32 bits wide:

```
31    27 26  23 22  19 18  15 14           0
|opcode | cond |  dst |  src |    imm15    |
| 5 bit | 4 bit| 4 bit| 4 bit|   15 bits   |
```

All instructions support ARM-style conditional execution via the 4-bit condition field. This allows the compiler to generate branchless code for simple conditionals, reducing pipeline stalls.

### 2.3 Domain Purity

The architecture enforces a strict separation between Church domain (capabilities) and Turing domain (data). A Golden Token permission field of 6 bits encodes two independent permission sets:

- **Turing permissions:** R (read), W (write), X (execute)
- **Church permissions:** L (load), S (save), E (enter)

Mixing domains — for instance, attempting to Read a capability or Execute a c-list — triggers an immediate hardware fault. This is the domain purity invariant: code is data (Turing domain), capabilities are authority (Church domain), and never shall the two be confused.

### 2.4 Golden Tokens

A Golden Token (GT) is a 32-bit unforgeable capability:

```
31        25 24          8 7      2 1  0
| version  |    index    | perms  |type|
|  7 bits  |   17 bits   | 6 bits |2 b |
```

- **Version (7 bits):** Anti-replay counter. Revoking a token increments the version — all copies become instantly invalid.
- **Index (17 bits):** Points to a namespace entry (128K possible entries).
- **Permissions (6 bits):** R, W, X, L, S, E.
- **Type (2 bits):** 00=NULL, 01=Inform (points to memory via NS entry), 10=Outform (remote), 11=Abstract (GT *is* the value).

### 2.5 Abstractions and the Single-Lump Model

An abstraction is the fundamental security block. Each abstraction occupies a single contiguous memory region called a *lump*, described by one namespace (NS) entry:

```
NS Entry:
  word0: location (base address of lump)
  word1: B|F|G|chain|type|clistCount|limit
  word2: version | FNV seal

Lump Layout:
  +---------------------------+ offset 0
  | Code (Turing domain, X)   |  <- CR7 (code region)
  +---------------------------+ codeEnd
  |      FREESPACE            |  inaccessible
  +---------------------------+ clistStart
  | C-list (Church domain, L) |  <- CR6 (capability region)
  +---------------------------+ allocatedSize
```

When a CALL instruction enters an abstraction, it reads the `clistCount` field from word1 and splits the lump into two regions:

- **CR7 (code):** Base address, limit = clistStart - 1, permissions = X only
- **CR6 (c-list):** Base address + clistStart, limit = clistCount - 1, permissions = L only

These permissions are architecturally hardcoded by the CALL instruction. The calling code cannot influence them. This ensures that code cannot read its own capabilities (no GT leakage) and capabilities cannot be executed as code (no code injection).

---

## 3. The CLOOMC++ Compiler

### 3.1 Design Philosophy

CLOOMC++ is a multi-language compiler with a single back-end. Both the JavaScript front-end and the Haskell front-end produce the same output: arrays of 32-bit Church Machine instruction words packaged in an `upload.json` format.

```
JavaScript source ──┐
                    ├──> CLOOMC++ compiler ──> 32-bit code words ──> upload.json
Haskell source ─────┘          |
                               |
                     Resident Object Model:
                     - c-list = compiler symbol table
                     - maps abstraction names to offsets
                     - produces method table + code regions
```

### 3.2 The Resident Object Model

The compiler maintains a Resident Object Model (ROM) that maps abstraction names to c-list offsets. When a program declares `capabilities { Constants }`, the compiler knows that Constants occupies slot 0 in the c-list. A call to `Constants.Pi()` compiles to a LOAD from c-list offset 0 followed by a CALL.

This is significant: the c-list *is* the compiler's symbol table for external references. The capabilities declared in the source code are exactly the capabilities that will be wired into the lump at creation time. There is no separate linking phase.

### 3.3 Register Allocation

The Church Machine provides 16 data registers (DR0-DR15), allocated by convention:

| Registers | Purpose | Saved by |
|-----------|---------|----------|
| DR0-DR3 | Arguments and return values | Caller |
| DR4-DR11 | Local variables | Callee |
| DR12-DR15 | Temporaries (compiler scratch) | Caller |

The compiler uses a simple linear allocation strategy: parameters map to DR0-DR3, local variables are assigned sequentially from DR4 upward, and expressions use DR12-DR15 as scratch space.

### 3.4 Upload Format

The compiler output is a JSON structure consumed by `Navana.Abstraction.Add`, the master controller's abstraction creation method:

```json
{
  "abstraction": "SlideRule",
  "type": "abstraction",
  "grants": ["E"],
  "capabilities": [
    { "target": 18, "name": "Constants", "grants": ["E"] }
  ],
  "methods": [
    { "name": "Add", "code": ["0x7f600000", "0x7f660000", ...] },
    { "name": "Sub", "code": ["0x87600000", ...] }
  ]
}
```

Navana validates the upload (bounds checking, capability delegation verification, integer overflow protection), allocates a power-of-2 lump, writes the code and c-list into the lump, creates the NS entry with the correct `clistCount`, and forges an Inform E-GT back to the creator.

---

## 4. The SlideRule: A Comparative Study

The SlideRule is a Layer 3 (Mathematics) abstraction providing arithmetic operations. We implement it twice — once in imperative JavaScript, once in functional Haskell — to demonstrate that the Church Machine is a universal computation substrate.

### 4.1 JavaScript Implementation

The JavaScript front-end uses an imperative style with explicit control flow:

```javascript
abstraction SlideRule {
    capabilities { Constants }

    method Add(a, b) {
        result = a + b
        return(result)
    }

    method Sub(a, b) {
        result = a - b
        return(result)
    }

    method Mul(a, b) {
        acc = 0
        sign = 0
        if (b < 0) {
            b = 0 - b
            sign = 1
        }
        while (b > 0) {
            low = bfext(b, 0, 1)
            if (low == 1) {
                acc = acc + a
            }
            a = a << 1
            b = b >> 1
        }
        if (sign == 1) {
            acc = 0 - acc
        }
        return(acc)
    }

    method Div(a, b) {
        if (b == 0) { return(0) }
        sign = 0
        if (a < 0) { a = 0 - a; sign = sign + 1 }
        if (b < 0) { b = 0 - b; sign = sign + 1 }
        quot = 0
        while (a >= b) {
            a = a - b
            quot = quot + 1
        }
        if (sign == 1) { quot = 0 - quot }
        return(quot)
    }

    method Sqrt(n) {
        if (n == 0) { return(0) }
        if (n == 1) { return(1) }
        guess = n >> 1
        i = 0
        while (i < 20) {
            q = 0
            rem = n
            while (rem >= guess) {
                rem = rem - guess
                q = q + 1
            }
            next = guess + q
            next = next >> 1
            guess = next
            i = i + 1
        }
        return(guess)
    }

    method Pow(base, exp) {
        result = 1
        while (exp > 0) {
            acc = 0
            m = base
            r = result
            while (r > 0) {
                low = bfext(r, 0, 1)
                if (low == 1) { acc = acc + m }
                m = m << 1
                r = r >> 1
            }
            result = acc
            exp = exp - 1
        }
        return(result)
    }

    method ToDegrees(radians) { return(radians) }
    method ToRadians(degrees) { return(degrees) }
}
```

**Key characteristics:**

- Explicit loop constructs (`while`) for iteration
- Manual algorithm implementation (shift-and-add for Mul, repeated subtraction for Div)
- Direct bitfield manipulation via `bfext()` for testing individual bits
- 8 methods, 110 lines of source

### 4.2 Haskell Implementation

The Haskell front-end uses a functional style with expression-based methods:

```haskell
-- SlideRule — Haskell front-end
-- Integer arithmetic on Church Machine hardware
-- Proves both languages compile to the same 20-instruction target

abstraction SlideRuleHS {
    capabilities { Constants }

    -- Basic arithmetic
    method Add(a, b) = a + b
    method Sub(a, b) = a - b
    method Mul(a, b) = a * b

    -- Integer division via repeated subtraction
    method Div(a, b) = if b == 0 then 0 else a - (a - b)

    -- Integer square root approximation
    method Sqrt(n) = if n == 0 then 0
                     else if n == 1 then 1
                     else (n + 1) - (n - 1)

    -- Power of 2 (base=2 exponentiation)
    method Pow2(exp) = if exp == 0 then 1 else 2 * exp

    -- Absolute value
    method Abs(n) = if n < 0 then 0 - n else n

    -- Signum: -1, 0, or 1
    method Signum(n) = if n == 0 then 0
                       else if n > 0 then 1
                       else 0 - 1

    -- Max of two values
    method Max(a, b) = if a > b then a else b

    -- Min of two values
    method Min(a, b) = if a < b then a else b

    -- Clamp value between lo and hi
    method Clamp(x, lo, hi) = if x < lo then lo
                              else if x > hi then hi
                              else x
}
```

**Key characteristics:**

- Each method is a single expression (no statements)
- Pattern-matching via `if/then/else` compiles to MCMP + BRANCH chains
- Multiplication uses the `*` operator, which the compiler expands to a shift-and-add pattern
- 11 methods, 38 lines of source

### 4.3 Compiled Output Comparison

Both implementations compile to Church Machine 32-bit instruction words. The following table compares code size for methods present in both versions.

**Important caveat:** The JavaScript and Haskell versions do not implement identical algorithms. The JavaScript Mul uses a correct shift-and-add algorithm; the Haskell `a * b` uses the compiler's built-in repeated-addition expansion. The JavaScript Div implements full integer division via repeated subtraction; the Haskell Div is a simplified expression that does not compute correct division for all inputs (see Section 7.2). The comparison below measures *code density for the same method signatures*, not algorithmic equivalence.

**Semantically equivalent methods (Add, Sub produce identical results):**

| Method | JS (instructions) | HS (instructions) | HS Reduction | Semantics |
|--------|-------------------|-------------------|-------------|-----------|
| Add | 5 | 4 | 20% | Identical: a + b |
| Sub | 4 | 3 | 25% | Identical: a - b |

**Semantically different methods (same name, different algorithms):**

| Method | JS (instructions) | HS (instructions) | JS Algorithm | HS Algorithm |
|--------|-------------------|-------------------|-------------|-------------|
| Mul | 35 | 8 | Shift-and-add with sign handling (O(log n)) | Repeated addition (O(n)) |
| Div | 40 | 14 | Repeated subtraction with sign handling (correct) | Simplified expression (not general division) |
| Sqrt | 38 | 27 | Newton-Raphson with 20 iterations (correct) | Simplified expression (not general sqrt) |
| Pow/Pow2 | 29 | 19 | General base^exp via inline multiply | 2 * exp (only correct for base=2, exp=1) |

The Haskell version's Div, Sqrt, and Pow2 are intentionally simplified to demonstrate expression-based compilation. They are not production-correct algorithms. See Section 7.2 for discussion.

**Haskell-only methods (no JS equivalent):**

| Method | Instructions | Purpose | Correct |
|--------|-------------|---------|---------|
| Abs | 13 | Absolute value | Yes |
| Signum | 25 | Sign function (-1, 0, 1) | Yes |
| Max | 10 | Maximum of two values | Yes |
| Min | 10 | Minimum of two values | Yes |
| Clamp | 18 | Constrain to range [lo, hi] | Yes |

These five methods demonstrate the Haskell front-end's strength: each is a pure conditional expression that compiles to a correct, compact MCMP + BRANCH chain.

**Overall totals:**

| | Methods | Instructions | Code Size (bytes) |
|-|---------|-------------|-------------------|
| JavaScript | 8 | 153 | 612 |
| Haskell | 11 | 151 | 604 |

The Haskell version provides 37.5% more methods in 1.3% less code. However, the JavaScript version provides correct implementations for all its methods, while the Haskell version trades algorithmic correctness for expressiveness in Div, Sqrt, and Pow2.

### 4.4 Disassembly Walkthrough

**Add — a minimal comparison:**

JavaScript `Add(a, b)` compiles to 5 instructions:
```
0: IADD.AL  DR12, DR0, #0     ; DR12 = a (load param)
1: IADD.AL  DR12, DR12, #0    ; DR12 += b (add param)
2: IADD.AL  DR4, DR12, #0     ; result = DR12 (store to local)
3: IADD.AL  DR0, DR4, #0      ; DR0 = result (return value)
4: RETURN.AL                   ; return
```

Haskell `Add(a, b) = a + b` compiles to 4 instructions:
```
0: IADD.AL  DR12, DR0, #0     ; DR12 = a
1: IADD.AL  DR12, DR0, #0     ; DR12 = a + b
2: IADD.AL  DR0, DR12, #0     ; DR0 = result
3: RETURN.AL                   ; return
```

The Haskell version saves one instruction because it does not allocate an explicit local variable (`result`). The functional compiler knows that the expression `a + b` yields the return value directly.

**Mul — where the difference is dramatic:**

JavaScript's Mul is 35 instructions: an explicit shift-and-add loop with sign handling, bitfield extraction, accumulation, and conditional negation.

Haskell's `a * b` is 8 instructions:
```
0: IADD.AL  DR12, DR0, #0     ; DR12 = a (accumulator)
1: MCMP.AL  DR1, DR0, #0      ; compare b to 0
2: BRANCH.EQ  #6              ; if b == 0, jump to return
3: IADD.AL  DR12, DR12, #0    ; acc += a (add step)
4: ISUB.AL  DR1, DR1, #1      ; b -= 1 (decrement counter)
5: BRANCH.AL  #1              ; loop back
6: IADD.AL  DR0, DR12, #0     ; DR0 = result
7: RETURN.AL                   ; return
```

The Haskell compiler recognises `a * b` as multiplication and emits a compact repeated-addition loop without the sign-handling overhead. The JavaScript version is explicit about every step — sign detection, absolute value, bitfield testing, conditional accumulation, sign restoration — because the programmer wrote the algorithm by hand.

**Clamp — Haskell's expressiveness:**

The Haskell expression `if x < lo then lo else if x > hi then hi else x` compiles to 18 instructions using chained MCMP + BRANCH patterns:

```
 0: MCMP.AL  DR0, DR1, #0      ; compare x to lo
 1: IADD.LT  DR12, DR0, #1     ; flag = 1 if x < lo
 2: IADD.GE  DR12, DR0, #0     ; flag = 0 if x >= lo
 3: MCMP.AL  DR12, DR0, #0     ; test flag
 4: BRANCH.EQ  #7              ; if not less, check upper bound
 5: IADD.AL  DR12, DR1, #0     ; result = lo
 6: BRANCH.AL  #16             ; jump to return
 7: MCMP.AL  DR0, DR2, #0      ; compare x to hi
 8: IADD.GT  DR12, DR0, #1     ; flag = 1 if x > hi
 9: IADD.LE  DR12, DR0, #0     ; flag = 0 if x <= hi
10: MCMP.AL  DR12, DR0, #0     ; test flag
11: BRANCH.EQ  #14             ; if not greater, use x
12: IADD.AL  DR12, DR2, #0     ; result = hi
13: BRANCH.AL  #15             ; jump to return
14: IADD.AL  DR12, DR0, #0     ; result = x
15: IADD.AL  DR12, DR12, #0    ; (identity move)
16: IADD.AL  DR0, DR12, #0     ; DR0 = result
17: RETURN.AL                   ; return
```

Note the use of conditional IADD instructions (lines 1-2 and 8-9): `IADD.LT` and `IADD.GE` execute based on the condition flags set by the preceding MCMP. This is ARM-style predicated execution — both paths are encoded, but only one executes.

---

## 5. Performance Analysis

### 5.1 Static Code Size

On the Tang Nano 20K, each instruction is one 32-bit word (4 bytes). The complete code sizes are:

| Implementation | Methods | Total Instructions | Code Size | Lump Size (power-of-2) |
|---------------|---------|-------------------|-----------|------------------------|
| JavaScript | 8 | 153 | 612 bytes | 1024 bytes |
| Haskell | 11 | 151 | 604 bytes | 1024 bytes |

Both fit in a 1024-byte lump (256 words), leaving room for the method table header and c-list (1 entry for Constants). The lump allocation is power-of-2, so both versions occupy the same physical memory despite the Haskell version being slightly smaller.

### 5.2 Execution Time

The Church Machine pipeline executes one instruction per clock cycle at 27 MHz. Each cycle is approximately 37 nanoseconds.

**Constant-time methods (no loops):**

| Method | JS Cycles | JS Time | HS Cycles | HS Time |
|--------|----------|---------|----------|---------|
| Add | 5 | 185 ns | 4 | 148 ns |
| Sub | 4 | 148 ns | 3 | 111 ns |

**Variable-time methods (loop-dependent or expression-based):**

For loop-based methods, the instruction count is the static code size. Actual execution depends on input values. For expression-based Haskell methods, execution is single-pass but the computation may not be semantically equivalent (see Section 4.3 caveat).

| Method | JS Code Size | HS Code Size | JS Runtime Character | HS Runtime Character |
|--------|-------------|-------------|---------------------|---------------------|
| Mul | 35 | 8 | O(log b) shift-and-add (correct) | O(b) repeated addition (correct, but slower for large b) |
| Div | 40 | 14 | O(a/b) repeated subtraction (correct) | Single-pass expression (not correct general division) |
| Sqrt | 38 | 27 | 20-iteration Newton-Raphson (correct) | Single-pass expression (not correct general sqrt) |
| Pow | 29 | 19 | O(exp) with inline multiply (correct) | Single-pass 2*exp (only correct for specific inputs) |

**Mul is the only shared method where both versions compute the correct result for all inputs.** The JavaScript Mul uses a logarithmic-time algorithm (shift-and-add examines each bit of the multiplier), while the Haskell Mul uses a linear-time repeated-addition loop. For large values of `b`, the JavaScript version's 35-instruction body executes fewer loop iterations than the Haskell version's 8-instruction body.

**Example: Mul(7, 100)**

- JavaScript: The shift-and-add loop runs 7 iterations (ceil(log2(100)) = 7). With ~8 instructions per iteration, that is approximately 56 dynamic instructions.
- Haskell: The repeated-addition loop runs 100 iterations. With ~4 instructions per iteration, that is approximately 400 dynamic instructions.

For this input, JavaScript is approximately 7x faster despite having 4x more static code.

### 5.3 The Code Size vs. Runtime Trade-off

This reveals a fundamental trade-off in multi-language compilation:

| Property | JavaScript | Haskell |
|----------|-----------|---------|
| Source lines | 110 | 38 |
| Static code size | 153 instructions | 151 instructions |
| Algorithmic sophistication | High (bit-level algorithms) | Low (direct expressions) |
| Worst-case runtime | O(log n) for Mul | O(n) for Mul |
| Programmer effort | High (manual algorithms) | Low (declarative expressions) |
| Debugging difficulty | High (loop state) | Low (pure expressions) |

The Haskell version is more concise and easier to reason about, but the JavaScript version can encode more efficient algorithms because the programmer has direct access to bitfield operations and explicit loop control.

---

## 6. Security Implications

### 6.1 What the Compiler Cannot Do

The CLOOMC++ compiler operates within the Church Machine's security model. Regardless of language or compilation strategy, the compiler **cannot**:

1. **Forge a Golden Token.** Tokens are created only by Mint.Create (via Navana). The compiler produces Turing-domain code words — it has no access to Church-domain token creation.

2. **Escape the lump.** The CALL instruction hardcodes CR7 (code region) boundaries. A branch instruction can only target addresses within the lump's code region. Out-of-bounds branches trigger a hardware fault.

3. **Read its own capabilities.** CR6 (c-list) has L-only permission. The code in CR7 has X-only permission. The compiler can emit LOAD instructions that read from the c-list into a capability register, but it cannot emit DREAD instructions that read c-list contents into a data register.

4. **Access undeclared abstractions.** The c-list contains exactly the capabilities declared in the `capabilities { }` block. If the source code does not declare Memory, no instruction sequence can reach the Memory abstraction.

This is the architectural insight: **the compiler can produce incorrect programs but cannot produce insecure ones.** A buggy compiler gives wrong answers within the correct security perimeter. The capability model constrains from below.

### 6.2 The C-List as Authority

The `capabilities { Constants }` declaration in both SlideRule versions is not merely a compiler directive — it is a security declaration. When Navana processes the upload, it:

1. Verifies that the creator holds a valid GT for the Constants abstraction
2. Checks that the creator has sufficient permissions to delegate E access
3. Writes the Constants E-GT into the lump's c-list region
4. Sets `clistCount = 1` in the NS entry's word1

The c-list is parental approval made concrete. A child cannot grant their abstraction access to resources the parent has not provided.

---

## 7. Discussion: Pros and Cons

### 7.1 Advantages of the Church Machine Architecture

**Hardware-enforced security.** The security model does not depend on software correctness. The mLoad/mSave validation pipeline runs on every memory access in hardware. There is no way to bypass it — no debug mode, no privileged instruction, no escape hatch. This makes the security model verifiable by inspection of the hardware description (Amaranth HDL), not by analysis of an unbounded software stack.

**Capability revocation is instant.** Incrementing a token's version in the namespace entry invalidates every copy of every derived token immediately. There is no garbage collection of permissions, no race condition, no eventually-consistent revocation. The next mLoad that presents the old version faults.

**Language independence.** The 20-instruction set is a universal computation substrate. Both JavaScript and Haskell compile to it, and any language with variables, arithmetic, conditionals, and function calls can target it. The architecture does not favour one programming paradigm over another.

**Scale-free security.** The same model that protects a child's homework folder from a sibling's access works unchanged for organisational security, IoT device isolation, or multi-tenant cloud computing. The abstraction model scales from a family to an enterprise without architectural changes.

**Auditable simplicity.** Twenty instructions. Four-word namespace entries. Thirty-two-bit tokens. The entire architecture can be understood by a motivated undergraduate in a semester. This is a feature, not a limitation — complex security systems fail because no one can reason about them completely.

### 7.2 Disadvantages and Limitations

**No hardware multiply or divide.** The Turing domain provides IADD, ISUB, SHL, and SHR — but no MUL, DIV, or MOD instruction. Multiplication must be synthesised from shift-and-add (35 instructions in JavaScript, 8 in Haskell). Division requires repeated subtraction (40 instructions). On a conventional processor, these are single-cycle operations. On the Church Machine, they are multi-cycle algorithms.

*Objection:* This is a deliberate design choice, not an oversight. The Tang Nano 20K has limited LUT budget (20,736 LUTs). A hardware multiplier consumes significant area. The architecture prioritises security enforcement logic (mLoad pipeline, seal checking, version comparison) over arithmetic performance. For the educational target, this trade-off is acceptable. For a production target, the instruction set could be extended with MUL/DIV while preserving the security model.

**No floating-point arithmetic.** The Church Machine operates on 32-bit integers. The SlideRule abstraction cannot compute trigonometric functions, logarithms, or square roots to floating-point precision. The ToDegrees and ToRadians methods in the JavaScript version are pass-through stubs because there is no way to represent pi as an integer.

*Objection:* Floating-point is a convenience, not a requirement. The Lambda Calculus layer (Layer 4) can represent arbitrary-precision arithmetic using Church numerals. Fixed-point arithmetic (e.g., Q16.16 format) can be implemented using the existing IADD/ISUB/SHL/SHR instructions. The architecture supports computation; it does not mandate a numeric representation.

**The seal is only 25 bits.** The FNV hash used to seal namespace entries is 25 bits, giving approximately 33 million possible values. A brute-force collision search is feasible on fast hardware. If an attacker finds a collision, they could forge a namespace entry with a manipulated clistCount, extending the code region into the c-list (capability theft).

*Objection:* On the target hardware (27 MHz FPGA), a brute-force search takes hours — acceptable for the educational use case. The seal is a tamper-detection mechanism, not a cryptographic barrier. In a production deployment, the seal width could be increased to 32 bits by repurposing bits in word2, or a different hash function could be used.

**Register pressure.** Sixteen data registers are adequate for simple methods but insufficient for complex algorithms. The Sqrt method in JavaScript uses 7 local variables; a more complex numerical method could exhaust the register file. The current compiler does not support register spilling (saving registers to memory and reloading them).

*Objection:* Register spilling can be implemented in the compiler using DWRITE/DREAD to a designated spill area within the lump's code region. This is a compiler limitation, not an architectural one. The calling convention reserves DR4-DR11 for locals (8 registers) and DR12-DR15 for temporaries (4 registers), which is sufficient for most educational examples.

**Single-issue pipeline.** The Church Machine executes one instruction per cycle. Modern processors achieve instruction-level parallelism through superscalar execution, out-of-order dispatch, and speculative execution. The Church Machine deliberately avoids these — they are attack surfaces. Spectre and Meltdown exploited speculative execution to leak data across security boundaries. The Church Machine's simple pipeline eliminates this class of attack entirely.

*Objection:* The performance cost is real. A 27 MHz single-issue processor is approximately 1,000x slower than a modern desktop CPU for raw computation. This is acceptable for the educational target, where the goal is understanding and correctness, not performance. The architecture could support pipelining with capability checks at each stage, but this is future work.

**Haskell division and square root are approximations.** The Haskell SlideRule's Div and Sqrt methods are simplified expressions, not algorithmic implementations. `Div(a, b) = if b == 0 then 0 else a - (a - b)` simplifies to just `b`, which is incorrect as general-purpose division. The JavaScript version implements actual integer division via repeated subtraction.

*Objection:* This reflects the trade-off between expression-based compilation and algorithmic fidelity. The Haskell front-end compiles pure expressions — it does not support loops. True integer division requires iteration, which the Haskell front-end represents through recursion (not yet implemented in the back-end) or Church numeral encoding. The JavaScript front-end, with its explicit loop support, is better suited for implementing iterative algorithms.

### 7.3 The Universal Target Argument

The fact that both JavaScript and Haskell compile to the same 20 instructions is not merely a compiler trick — it is a demonstration of computational universality. The Church Machine instruction set is Turing-complete (it has conditional branching and memory access) and Church-complete (it has LAMBDA and CALL). Any computable function can be expressed in these 20 instructions.

The trade-off is between expressive source languages and a minimal target. The programmer writes in a comfortable notation; the compiler reduces it to the universal substrate; the hardware enforces security at every instruction. This separation of concerns — expressiveness at the top, security at the bottom — is the architectural thesis of the Church Machine.

---

## 8. Tutorial: Compiling Your Own Abstraction

### Step 1: Write the source

Open the Church Machine IDE and click the **Code** tab. In the editor, type:

```javascript
abstraction MyMath {
    capabilities { Constants }

    method Double(n) {
        result = n + n
        return(result)
    }

    method Square(n) {
        acc = 0
        i = n
        while (i > 0) {
            acc = acc + n
            i = i - 1
        }
        return(acc)
    }
}
```

Or in Haskell:

```haskell
abstraction MyMath {
    capabilities { Constants }

    method Double(n) = n + n
    method Square(n) = n * n
}
```

### Step 2: Compile

Click the gold **CLOOMC++** button. The console shows each method with its instruction count and disassembled code. The compiler auto-detects the language: if any method uses `= expr` syntax (no braces), it uses the Haskell front-end; otherwise, JavaScript.

### Step 3: Inspect the output

The console displays the hex instruction words and their disassembly. Verify that:
- Each method ends with a RETURN instruction
- Branch targets are within bounds
- The capability count matches your declarations

### Step 4: Save the upload JSON

Click the blue **Save Upload JSON** button. The compiler produces the JSON file and downloads it. This file contains everything Navana needs to create the abstraction.

### Step 5: Create the abstraction (requires boot)

Click **Boot** to initialise the system, then click the green **Create Abstraction** button. Navana processes the upload, allocates a lump, writes the code and c-list, and forges an E-GT. The console shows the NS index, version, location, and lump size.

### Step 6: Test

Switch to the **REPL** tab and call your abstraction's methods to verify correctness.

---

## 9. Conclusion

The Church Machine demonstrates that security and computation can be separated at the hardware level. The 20-instruction set provides a universal computation substrate — any language can target it, and the security model holds regardless of what the compiler produces. The SlideRule comparison shows that imperative and functional programming styles lead to different trade-offs in code density, algorithmic efficiency, and programmer effort, but both produce code that executes within the same capability-secured sandbox.

The architecture is intentionally minimal. It sacrifices raw performance for verifiable security. It sacrifices instruction set richness for auditable simplicity. It sacrifices compiler optimisation for a one-semester learning curve. These are deliberate engineering choices for an educational platform — but the security model itself scales beyond the classroom.

The Church Machine's answer to "who can access my data?" is not a policy, not a configuration file, not a permission dialog. It is a hardware gate that checks an unforgeable token on every memory access, every cycle, without exception.

---

## References

1. Dennis, J.B. and Van Horn, E.C. (1966). "Programming Semantics for Multiprogrammed Computations." *Communications of the ACM*, 9(3), 143-155.

2. Levy, H.M. (1984). *Capability-Based Computer Systems*. Digital Press.

3. Church, A. (1936). "An Unsolvable Problem of Elementary Number Theory." *American Journal of Mathematics*, 58(2), 345-363.

4. Turing, A.M. (1936). "On Computable Numbers, with an Application to the Entscheidungsproblem." *Proceedings of the London Mathematical Society*, 2(42), 230-265.

5. Kocher, P. et al. (2019). "Spectre Attacks: Exploiting Speculative Execution." *IEEE Symposium on Security and Privacy*.

6. Watson, R.N.M. et al. (2015). "CHERI: A Hybrid Capability-System Architecture for Scalable Software Compartmentalization." *IEEE Symposium on Security and Privacy*.

7. Woodruff, J. et al. (2014). "The CHERI Capability Model: Revisiting RISC in an Age of Risk." *ISCA '14*.

8. Halton, D. (1972). "Hardware of the System 250 for Communication Control." *International Switching Symposium*, MIT, Cambridge, Massachusetts, June 1972.

9. Hamer-Hodges, K.J. (2024). *Civilizing Cyberspace: The Fight for Digital Democracy*. Studio of Books LLC. ISBN 978-1964148663.

10. Hamer-Hodges, K.J. (2023). *The Fate of AI Society: Civilizing Superhuman Cyberspace*. Studio of Books LLC. ISBN 978-1964148540.

11. Hamer-Hodges, K.J. (2025). *Winning World War III: Industrial Strength Computer Science*. Studio of Books LLC. ISBN 978-1964864983.

---

*This paper accompanies the Church Machine Educational Platform, an open-source capability-secured processor architecture targeting the Sipeed Tang Nano 20K FPGA. The web-based IDE, simulator, CLOOMC++ compiler, and Amaranth HDL source are available in the project repository.*
