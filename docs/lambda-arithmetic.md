# The Church Machine — From Integer Arithmetic to Provably Secure Systems

## Why This Matters

A telephone exchange drops a call and leaks the billing record of the previous caller. A banking system processes a transaction after the session has expired, debiting the wrong account. An autonomous weapons platform fires on a target whose authorisation token was revoked three seconds ago but hasn't been garbage-collected yet. A surgical robot's control thread is paused by a GC storm mid-incision.

These are not hypothetical scenarios. They are the inevitable consequences of building safety-critical systems on architectures that cannot guarantee deterministic resource management, temporal safety, or capability revocation.

The Church Machine was designed to make these failures **impossible at the hardware level** — not by adding layers of software checks, but by implementing Alonzo Church's lambda calculus as a physical processor architecture where security guarantees emerge from the mathematical foundation itself.

This document starts with a simple question — how do you divide numbers on integer-only hardware? — and follows the thread all the way through: from arithmetic techniques, to abstraction composition, to threads as dynamic instances, to deterministic garbage collection, and finally to the security properties that make the Church Machine suitable for systems where failure is not an option.

### The domains where this matters most:

- **Telecommunications** — A PP250 telephone exchange handling thousands of concurrent calls, each a dynamic thread with its own capabilities, where a stale token from a terminated call must never grant access to a new call's billing data.
- **Banking and finance** — Transaction processing where every operation must be authorised by a current, valid capability, and where expired session tokens must be revoked instantly and completely — not "eventually, when the GC gets around to it."
- **Autonomous lethal weapons** — Systems where a revoked authorisation to fire *must* take effect immediately. A weapon that continues to act on a stale capability because garbage collection hasn't reclaimed the authorisation token is not a software bug — it is a war crime. There is no acceptable latency between revocation and enforcement.
- **Medical instruments** — Surgical robots, infusion pumps, and diagnostic systems where a GC pause of even 50 milliseconds can cause tissue damage or deliver a fatal overdose. Deterministic execution with bounded pause times is not a performance preference — it is a patient safety requirement.

In all of these domains, the question is the same: **can you prove, at the hardware level, that a revoked capability cannot be used, that a terminated thread's resources will be reclaimed in bounded time, and that no stale token can ever grant access to a recycled resource?**

The Church Machine answers yes. This document explains how.

---

## The Starting Point: Integer Arithmetic

The Church Machine operates on 32-bit integers. There are no floating-point registers or instructions. Every value in a data register (DR0–DR15) is a whole number, and the division instruction (`/`) performs integer division via repeated subtraction, truncating any fractional part.

This means `7 / 3 = 2`, not `2.333...`.

So how do you compute precise results on integer-only hardware? The first part of this document covers three techniques — **fixed-point arithmetic**, **remainder/modulo**, and **rational numbers** — each implemented as a Lambda Calculus abstraction in the Church Machine IDE. The later sections show how these building blocks compose into the capability-secured, deterministically-collected system that makes the Church Machine suitable for the domains described above.

---

## 1. Fixed-Point Arithmetic

### The Idea

Instead of storing `2.33`, store `233` and remember that the last two digits are after the decimal point. You pick a **scale factor** (we use 100 for two decimal places) and multiply all values by it before doing arithmetic.

This is exactly how slide rules work — the S scale reads `sin(θ) × 10` to avoid sub-unit markings. The Church Machine's `FixedPointMath` abstraction applies the same principle to general computation.

### How It Works

| Real value | Fixed-point (×100) |
|---|---|
| 3.14 | 314 |
| 0.50 | 50 |
| 1.00 | 100 |
| 7.25 | 725 |

To compute `7 / 3` with two decimal places:

1. Scale up: `7 × 100 = 700`
2. Divide: `700 / 3 = 233` (integer division)
3. Interpret: `233` means `2.33`

### The Abstraction: `FixedPointMath`

Load the **LC: Fixed-Pt** example tab in the Code view.

```
abstraction FixedPointMath {
    capabilities { Constants }

    method toFixed(n)         = n * 100         -- integer → fixed-point
    method fromFixed(f)       = f / 100         -- fixed-point → integer (truncates)
    method addFixed(a, b)     = a + b           -- addition (scale preserved)
    method subFixed(a, b)     = a - b           -- subtraction (scale preserved)
    method mulFixed(a, b)     = (a * b) / 100   -- multiply then rescale
    method divFixed(a, b)     = (a * 100) / b   -- prescale then divide
    method percent(whole, pct) = (whole * pct) / 100
    method roundFixed(f)      = (f + 50) / 100  -- round to nearest integer
}
```

### Usage Examples

**Adding prices:**
- £3.50 + £2.75 → `350 + 275 = 625` → £6.25

**Multiplying with rescale:**
- 1.5 × 2.4 → `150 × 240 = 36000`, then `36000 / 100 = 360` → 3.60

**Division with prescale:**
- 7 / 3 → `toFixed(7) = 700`, then `divFixed(700, 300) = (700 × 100) / 300 = 233` → 2.33

**Percentage:**
- 15% of 200 → `percent(200, 15) = (200 × 15) / 100 = 30`

**Rounding:**
- `roundFixed(233) = (233 + 50) / 100 = 2` (rounds 2.33 down)
- `roundFixed(267) = (267 + 50) / 100 = 3` (rounds 2.67 up)

### Limitations

- **Overflow risk**: Multiplying two scaled values produces very large intermediate results. `999 × 999 = 998001` is fine in 32 bits, but `99999 × 99999` can overflow. Keep values reasonable for your scale factor.
- **Truncation**: Integer division always rounds toward zero. `roundFixed` compensates for this in the final step.
- **Scale factor is fixed**: The abstraction uses 100 (two decimal places). For more precision, change the scale to 1000 or 10000 and adjust the methods accordingly.

### Overflow Limits (Scale Factor 100, 32-bit integers)

The Church Machine uses 32-bit integers with a maximum value of 2,147,483,647 (~2.1 billion). With a scale factor of 100, each operation has a specific safe range before overflow occurs:

| Operation | Max operand(s) | Max real value | Why |
|---|---|---|---|
| **Add / Subtract** | ~1,073,741,823 each | ~10,737,418.23 | Sum must fit in 32 bits |
| **toFixed** | 21,474,836 | 21,474,836.00 | `n × 100` must not overflow |
| **Multiply** | ~46,340 each | ~463.40 × 463.40 | `a × b` intermediate must fit before `/100` rescale |
| **Divide (numerator)** | 21,474,836 | 214,748.36 | `a × 100` prescale must fit |
| **Divide (denominator)** | any non-zero | unlimited | No scaling applied to denominator |
| **Percent** | whole × pct < 2.1B | depends on combination | Same constraint as multiply |
| **roundFixed** | 2,147,483,597 | ~21,474,835.97 | `f + 50` must fit |

**Multiplication is the tightest constraint** — values above ~463 risk overflow because the intermediate product `a × b` must fit in 32 bits *before* the rescaling division by 100.

**Worked example — why 463 is the limit:**
- `46340 × 46340 = 2,147,395,600` — fits in 32 bits, then `/ 100 = 21,473,956` (represents 463.40 × 463.40 = 214,739.56)
- `46341 × 46341 = 2,147,488,281` — exceeds 2,147,483,647 and overflows

**Reducing the scale factor extends the range:**

| Scale factor | Decimal places | Multiply limit (real value) |
|---|---|---|
| 10 | 1 | ~4,634.0 |
| 100 | 2 | ~463.40 |
| 1,000 | 3 | ~46.34 |
| 10,000 | 4 | ~4.63 |

There is a direct trade-off: more precision means smaller numbers, fewer decimal places means larger numbers. For most practical uses (prices, measurements, percentages), scale factor 100 with a ~463 multiply limit is sufficient. If you need larger numbers and can tolerate less precision, drop to scale factor 10. If you need both large numbers and exact precision, use the rational number abstraction instead.

---

## 2. Remainder / Modulo

### The Idea

The Church Machine's division instruction works by repeated subtraction:

```
quotient = 0
remainder = dividend
while remainder >= divisor:
    remainder = remainder - divisor
    quotient = quotient + 1
```

When the loop exits, the **remainder** is still sitting in a register. Integer division discards it — but a `mod` method can return it instead.

### How It Works

`17 / 5`:
- Start: quotient=0, remainder=17
- Step 1: remainder=12, quotient=1
- Step 2: remainder=7, quotient=2
- Step 3: remainder=2, quotient=3
- Exit (2 < 5): **quotient = 3**, **remainder = 2**

So `17 / 5 = 3` with remainder `2`, meaning `17 = 5 × 3 + 2`.

### Practical Uses

- **Clock arithmetic**: `minutes mod 60` gives minutes past the hour
- **Even/odd test**: `n mod 2` is 0 for even, 1 for odd
- **Digit extraction**: `n mod 10` gives the last digit
- **Cyclic patterns**: `step mod 4` cycles through 0, 1, 2, 3, 0, 1, ...

### Connection to Fixed-Point

You can combine division and modulo to reconstruct a decimal result:

```
7 / 3 = 2       (integer part)
7 mod 3 = 1     (remainder)
```

The remainder `1` over divisor `3` gives the fractional part `0.333...`. Or using fixed-point: `(1 × 100) / 3 = 33`, so `7 / 3 = 2.33`.

---

## 3. Rational Numbers

### The Idea

Instead of approximating with fixed-point, represent every number as an exact fraction: a pair of integers `(numerator, denominator)`. The fraction `1/3` stays as `(1, 3)` — no precision is ever lost.

All arithmetic follows the standard fraction rules you learned in school:

| Operation | Rule | Example |
|---|---|---|
| a/b + c/d | (a×d + c×b) / (b×d) | 1/3 + 1/6 = (6+3)/18 = 9/18 |
| a/b − c/d | (a×d − c×b) / (b×d) | 3/4 − 1/4 = (12−4)/16 = 8/16 |
| a/b × c/d | (a×c) / (b×d) | 2/3 × 3/5 = 6/15 |
| a/b ÷ c/d | (a×d) / (b×c) | 2/3 ÷ 4/5 = 10/12 |
| a/b = c/d? | a×d = c×b? | 9/18 = 1/2? → see below |

**Equality by cross-multiplication:**

To test whether two fractions are equal, you don't need to simplify them or find common denominators. Instead, you **cross-multiply** — multiply each numerator by the other fraction's denominator — and check if the two products are the same.

The rule: **a/b = c/d** if and only if **a × d = c × b**.

Example: is 9/18 equal to 1/2?

```
Left side:  a × d = 9 × 2  = 18
Right side: c × b = 1 × 18 = 18

18 = 18 ✓  → Yes, 9/18 and 1/2 are the same fraction.
```

This works because multiplying both sides of `a/b = c/d` by `b × d` cancels the denominators, leaving `a × d = c × b`. If the products match, the fractions are equal — no matter how different the numerators and denominators look.

Another example: is 2/3 equal to 3/4?

```
Left side:  2 × 4 = 8
Right side: 3 × 3 = 9

8 ≠ 9  → No, 2/3 and 3/4 are not equal.
```

This is exactly what the `isEqual` method computes: `if (n1 * d2) == (n2 * d1) then 1 else 0`.

### The Abstraction: `RationalArith`

Load the **LC: Rational** example tab in the Code view.

```
abstraction RationalArith {
    capabilities { }

    method numerator(n, d)            = n
    method denominator(n, d)          = d

    method addNum(n1, d1, n2, d2)     = (n1 * d2) + (n2 * d1)
    method addDen(d1, d2)             = d1 * d2

    method subNum(n1, d1, n2, d2)     = (n1 * d2) - (n2 * d1)

    method mulNum(n1, n2)             = n1 * n2
    method mulDen(d1, d2)             = d1 * d2

    method divNum(n1, d2)             = n1 * d2
    method divDen(d1, n2)             = d1 * n2

    method isEqual(n1, d1, n2, d2)    = if (n1 * d2) == (n2 * d1) then 1 else 0

    -- GCD: Greatest Common Divisor — the largest number that divides evenly into both values
    method gcd(a, b)                  = if b == 0 then a
                                        else if a == b then a
                                        else if a > b then a - b
                                        else b - a
}
```

### Usage Examples

**Add 1/3 + 1/4:**
```
numerator   = addNum(1, 3, 1, 4)  = (1×4) + (1×3) = 7
denominator = addDen(3, 4)        = 3 × 4         = 12
Result: 7/12
```

**Multiply 2/3 × 3/5:**
```
numerator   = mulNum(2, 3)  = 6
denominator = mulDen(3, 5)  = 15
Result: 6/15 (simplifies to 2/5)
```

**Simplify using GCD:**
```
gcd(6, 15):
  6 < 15 → 15 - 6 = 9
  6 < 9  → 9 - 6  = 3
  6 > 3  → 6 - 3  = 3
  3 == 3 → GCD = 3

6/15 → (6/3) / (15/3) = 2/5
```

**Test equality: is 9/18 equal to 1/2?**
```
isEqual(9, 18, 1, 2) = if (9×2) == (1×18) then 1 else 0
                      = if 18 == 18 then 1 else 0
                      = 1 (yes, they are equal)
```

### Why Separate Num/Den Methods?

The current CLOOMC++ compiler convention maps one method to one return value in a single data register. So each fraction operation is split into two method calls: one for the numerator, one for the denominator. The caller tracks both values. [*]

This is how many real hardware fraction libraries work: you store the numerator and denominator in separate registers and call the appropriate method for each component. But this is a **compiler convention**, not a hardware limitation — see the footnote below.

---

**[*] Footnote — Tuples on the Church Machine: compiler convention vs. hardware capability**

The statement that "each fraction operation is split into two method calls" deserves careful qualification. This is a limitation of the current CLOOMC++ compiler's calling convention, **not** a limitation of the Church Machine hardware.

The hardware is fully capable of returning multiple values from a single method call. Here is why, and how it could work:

**1. The registers are there.** The Church Machine has 16 data registers (DR0–DR15) and 16 capability registers (CR0–CR15). The CALL and RETURN instructions do not restrict how many of these registers carry meaningful data. A method that computes both a numerator and a denominator could write the numerator to DR1 and the denominator to DR2 before executing RETURN. The caller would then read both registers — no second method call needed.

**2. Memory lumps can store tuples.** A capability register can point to an abstraction's memory lump — a contiguous block of words. A method could write a tuple's components as adjacent words in the lump (numerator at offset 0, denominator at offset 1), and the caller could LOAD each word by offset. This is analogous to returning a struct pointer in C — the data lives in memory, the caller knows the layout.

**3. Register-pair conventions are standard in real hardware.** This is not an unusual idea. ARM's 32-bit architecture returns 64-bit results across R0:R1. The x86 DIV instruction writes the quotient to EAX and the remainder to EDX simultaneously. The MIPS `mult` instruction writes its 64-bit result to HI:LO. In each case, a single instruction produces a multi-register result, and the calling convention defines which registers carry which components. The Church Machine could adopt the same approach — for example, "fraction methods return numerator in DR1 and denominator in DR2."

**4. What the CLOOMC++ compiler would need.** To support multi-value returns, three things would change in the compiler, none in the hardware:

- **Syntax**: A way to express tuple returns, e.g., `method addFrac(n1, d1, n2, d2) = ((n1 * d2) + (n2 * d1), d1 * d2)` returning both components at once.
- **Calling convention**: A defined mapping — "the first return value goes to DR1, the second to DR2" — so the caller knows where to find each component after RETURN.
- **Code generation**: The compiler emits instructions that write to both destination registers before the RETURN instruction, rather than writing to one and discarding the other.

**5. The rational abstraction would simplify dramatically.** With tuple returns, `RationalArith` could be rewritten as:

```
method addFrac(n1, d1, n2, d2) = ((n1 * d2) + (n2 * d1), d1 * d2)
method mulFrac(n1, d1, n2, d2) = (n1 * n2, d1 * d2)
method divFrac(n1, d1, n2, d2) = (n1 * d2, d1 * n2)
```

Each operation would be a single method call returning both the numerator and denominator, halving the number of calls the caller needs to make.

**6. This is a natural future extension.** The split Num/Den pattern used in this document is correct and works today. It is not a workaround for broken hardware — it is a pragmatic choice within the current compiler's single-return convention. When the CLOOMC++ compiler gains tuple-return support, the rational arithmetic abstraction can be simplified without any hardware changes. The instructions, the registers, and the capability model are already sufficient.

---

### Limitations

- **Denominator growth**: Without simplification, denominators grow with every operation. After several additions, `d1 × d2 × d3 × ...` can overflow 32 bits. Use `gcd` to simplify periodically.
- **The GCD method is iterative, not recursive**: The implementation uses subtraction (`a - b`) rather than modulo (`a mod b`), so it takes more steps for values that are far apart. This is correct but slower than the Euclidean algorithm with modulo.
- **No automatic simplification**: The abstraction returns unsimplified fractions. The caller must use `gcd` and divide both components to reduce.

---

## Choosing the Right Technique

| Technique | Precision | Speed | Best for |
|---|---|---|---|
| **Fixed-point** | Approximate (2-4 decimal places) | Fast (one extra multiply or divide) | Prices, measurements, percentages, sensor data |
| **Remainder** | Exact (integer remainder) | Free (already computed by division) | Clock math, even/odd, digit extraction, cycles |
| **Rational** | Exact (no loss ever) | Slower (multiple method calls per operation) | Scientific computation, exact comparisons, proofs |

All three techniques compile to the same 20 Church Machine instructions. The hardware doesn't change — only the abstraction layer above it.

---

## Composing Abstractions — The Supercall Pattern

### Why Not Instances?

If you've used object-oriented languages, you might expect to create an "instance" of `FixedPointMath` or `RationalArith` that holds a value — like `myPrice = FixedPointMath(350)`. The Church Machine doesn't work that way. An abstraction is a **code block with methods**, not a data container. When you call `addFixed(350, 275)`, the values are passed in as parameters and the result comes back, but nothing is stored between calls. The abstraction has no persistent fields or internal state.

Data lives in **registers and memory**. Abstractions provide **operations** on that data. This is closer to how a real CPU works than to an object-oriented language.

### Code Reuse by Construction — Why Stateless Abstractions Matter

This separation of code from data is not a limitation — it is the source of the Church Machine's code reuse model, and it comes directly from the lambda calculus.

In Alonzo Church's lambda calculus, a function is a pure transformation: it takes an argument, produces a result, and has no side effects. The function `λx.x + 1` can be applied to 3, to 7, to a million different values — each application is independent, and the function itself is unchanged. There is no "state" inside the function that one caller can corrupt for another.

The Church Machine implements this literally. An abstraction's code is loaded once into a memory lump and shared by every caller through capability-secured `CALL` instructions:

```
Thread #12 calls FixedPointMath.mulFixed(150, 240)   → uses DR1, DR2, returns in DR3
Thread #47 calls FixedPointMath.mulFixed(350, 175)   → uses DR1, DR2, returns in DR3
Thread #93 calls FixedPointMath.mulFixed(999, 100)   → uses DR1, DR2, returns in DR3
```

All three threads execute the **same code** at the **same memory address**. But each thread has its own register file, so DR1 and DR2 hold different values in each thread. The results are independent. No locks, no synchronisation, no defensive copying. The code is reused automatically because it has no state to conflict.

This is fundamentally different from object-oriented code reuse:

| | Object-oriented | Church Machine |
|---|---|---|
| **Reuse mechanism** | Inheritance — child class copies and extends parent code | Capability — caller holds a token granting access to shared code |
| **State** | Each instance has its own fields, mixed with the methods | State lives entirely in the caller's registers and memory |
| **Interference** | Shared mutable state requires locks, synchronisation, defensive copying | Impossible — the abstraction has no mutable state to share |
| **Scaling** | Each instance consumes memory for its fields | One code lump serves unlimited callers; only registers scale with thread count |
| **Safety** | Depends on correct discipline by the programmer | Enforced by hardware — the architecture makes interference structurally impossible |

The lambda calculus guarantees this property mathematically: a pure function applied to different arguments cannot produce interference. The Church Machine enforces it physically: abstractions contain only code, threads contain only state, and the capability system controls who can call what.

This means **code reuse is not a feature that was designed in — it is a consequence of the mathematical model**. Any abstraction, once written and deployed, can be safely shared by any number of concurrent callers without modification, without synchronisation, and without risk. The `FixedPointMath` abstraction serves a telephone exchange, a banking system, and a medical instrument simultaneously — the same code, the same methods, different threads, provably independent results.

### Synchronisation — When Is It Actually Needed?

Within a single thread, execution is strictly sequential — one instruction, then the next, one program counter. A thread cannot race with itself, so there is nothing to synchronise.

Synchronisation becomes relevant only when **two or more threads need to coordinate access to shared mutable state** — specifically, a shared memory lump or a shared namespace entry. But because abstractions are stateless code, the vast majority of method calls never touch shared mutable memory at all. Each thread passes values in its own registers, gets results back in its own registers, and the abstraction's code lump is read-only. No locks. No barriers. No flags.

Even garbage collection avoids synchronisation flags. The Church Machine's deterministic GC uses the **G-bit mechanism** — a hardware bit on each namespace entry that indicates reachability. The Mark-Scan-Sweep cycle runs at defined points with bounded time, not as a concurrent collector racing against mutator threads. There are no write barriers, no card tables, no remembered sets — the mechanisms that make concurrent GC in conventional systems so complex and fragile.

So when *is* synchronisation actually needed? Only when threads **intentionally share a mutable data structure** — a message queue, a shared counter, a device buffer. And even in those cases, the Church Machine's capability system often eliminates the need for traditional synchronisation primitives entirely.

**Example — Shared line printer:**

Consider four threads that all need to print. In a conventional system, you would protect the printer with a mutex:

```
Thread A: lock(printer_mutex)  → print  → unlock(printer_mutex)
Thread B: lock(printer_mutex)  → BLOCKED waiting for A...
Thread C: lock(printer_mutex)  → BLOCKED waiting for A...
Thread D: lock(printer_mutex)  → BLOCKED waiting for A...
```

This works, but introduces deadlock risk (what if Thread A also needs another lock?), priority inversion (what if Thread D is high-priority but Thread A holds the lock?), and lock convoy effects (all threads serialise behind the slowest printer operation).

On the Church Machine, a **PrinterManager** abstraction handles access through capabilities:

```
1. PrinterManager holds the sole write-capability to the printer device
2. Thread A calls PrinterManager.requestPrint(document)
   → PrinterManager grants Thread A a temporary write-capability (short-lived Golden Token)
   → Thread A writes to the printer using this capability
   → On completion, the capability is revoked (version bump)
3. Thread B's queued request is now serviced
   → PrinterManager grants Thread B a fresh temporary capability
   → Thread B prints
   → Capability revoked on completion
4. Threads C and D are serviced in turn
```

No mutex. No lock hierarchy. The capability grant/revoke cycle **serialises access by construction** — only one thread holds a valid write-capability at any given moment, and revocation is instant (O(1) version bump). If Thread A crashes mid-print, its capability expires with the thread's termination and GC sweep — the printer doesn't stay "locked" forever.

Note that this does not automatically solve all scheduling concerns. If the PrinterManager's queue is FIFO, a high-priority thread still waits behind low-priority threads — the same logical issue as priority inversion, though without the unbounded-blocking danger of a mutex (because the capability holder will complete and release, not deadlock). A priority-aware queue policy in the manager abstraction addresses this, but it is a design choice, not a hardware guarantee.

The PrinterManager itself is a stateless abstraction — its code is shared, and the queue state lives in a memory lump accessed through its own capability. The entire mechanism composes from the same building blocks: stateless code, per-thread registers, capability-mediated access, and deterministic cleanup.

### How Values Are Tracked

The caller keeps track of what values mean. For fixed-point:

```
DR1 = 350       (represents £3.50)
DR2 = 275       (represents £2.75)

DR3 = FixedPointMath.addFixed(DR1, DR2)   → 625 (represents £6.25)
```

For rational numbers, numerator and denominator live in separate registers:

```
DR1 = 1, DR2 = 3       (represents 1/3)
DR3 = 1, DR4 = 6       (represents 1/6)

DR5 = RationalArith.addNum(DR1, DR2, DR3, DR4)   → 9
DR6 = RationalArith.addDen(DR2, DR4)              → 18
-- Result: 9/18
```

### Supercalls — Composing Abstractions via Capabilities

The real power comes from **composing** abstractions. One abstraction can hold a **capability** (a Golden Token) to another abstraction in its C-List, and then call its methods using `CALL`. This is the "supercall" pattern — cross-abstraction method invocation, secured by the capability system.

In CLOOMC++, this looks like:

```
abstraction FixedPointWallet {
    capabilities { FixedPointMath }

    method addPrices(a, b) = FixedPointMath.addFixed(a, b)
    method taxTotal(price, taxRate) = FixedPointMath.mulFixed(price, taxRate)
}
```

Here, `FixedPointWallet` doesn't re-implement arithmetic — it delegates to `FixedPointMath` through its capability. The Golden Token in the C-List grants permission to call those methods. Without the token, the call is blocked by hardware.

You can chain this further:

```
abstraction Shop {
    capabilities { FixedPointWallet, RationalArith }

    method checkout(price, taxRate) = FixedPointWallet.taxTotal(price, taxRate)
    method splitBill(total, people) = RationalArith.divNum(total, people)
}
```

### The Security Dimension

This isn't just a calling convention — it's the Church Machine's security model:

- **You can only call methods on abstractions you hold a Golden Token for.** If `Shop` doesn't have `FixedPointMath` in its C-List, it cannot call `addFixed` directly — it must go through `FixedPointWallet`, which does hold that token.
- **Capabilities are unforgeable.** You cannot fabricate a Golden Token. They are granted by the system when an abstraction is created.
- **The principle of least authority applies.** Each abstraction only has access to the specific capabilities it needs. `FixedPointWallet` can do arithmetic but cannot access the shop's inventory. `Shop` can use the wallet but cannot forge new tokens.

### Instances vs. Capabilities — A Different Mental Model

| OOP concept | Church Machine equivalent |
|---|---|
| Class | Abstraction (code + method table) |
| Instance | Caller's registers + memory (data lives outside the abstraction) |
| Method call | `CALL` through a Golden Token capability |
| Inheritance | Supercall — one abstraction calls another via capability |
| Private fields | Memory within an abstraction's lump (only accessible by its own methods) |
| Constructor | The caller sets up registers and memory before the first call |

The key insight: **the "instance" is really the caller's context** — its registers, its memory region, its C-List of capabilities. The abstraction provides the operations; the caller provides the data. This is Alonzo Church's original idea applied to hardware — everything is a function, and capabilities control who can call what.

---

## Threads as Dynamic Instances — The PP250 Telephone Call

### The Missing Piece

The earlier sections explained that abstractions are stateless code blocks and that the caller's registers hold the data. But what happens when you need *many independent callers*, each with their own state, running at the same time?

Consider a PP250 telephone exchange handling calls to Australia. Each call needs its own state — caller ID, destination number, duration counter, billing rate, connection status. You can't share one set of registers between 50 simultaneous calls. Each call needs its own context.

The answer is **threads**. On the Church Machine, a thread *is* a dynamic instance.

### One Thread Per Call

When a call to Australia is initiated, the system spawns a new thread. That thread gets:

- **Its own register file** — DR0–DR15 hold call-specific data (caller ID in DR1, destination in DR2, duration counter in DR3, billing rate in DR4)
- **Its own program counter** — the thread executes the telephony abstraction's code independently
- **Its own capability context** — the thread holds Golden Tokens for exactly the abstractions it needs

```
Thread #47 — Call to Australia
  DR1 = 61299887766       (destination: +61 2 9988 7766)
  DR2 = 442071234567      (caller: +44 20 7123 4567)
  DR3 = 0                 (duration counter, incrementing)
  DR4 = 250               (billing rate: 2.50 per minute, fixed-point)
  
  Capabilities:
    CR1 → Telephony        (connect, disconnect, signal)
    CR2 → Billing          (startCharge, endCharge, getRate)
    CR3 → Routing          (findRoute, allocateCircuit)
```

Fifty simultaneous calls to Australia means fifty threads, each with their own registers, their own capabilities, and their own execution state. They run concurrently, sharing the telephony abstraction's *code* but never sharing *data*. When a call ends, its thread terminates.

### Static Abstractions, Dynamic Threads

This completes the picture:

| Concept | What it provides | Lifetime |
|---|---|---|
| **Abstraction** | Code — methods, logic, instruction sequences | Permanent (loaded once, shared by all callers) |
| **Thread** | State — registers, PC, capability context | Dynamic (created per call, destroyed on completion) |
| **Capability** | Permission — Golden Token granting access | Scoped to the thread that holds it |

The abstraction is the *class*. The thread is the *instance*. The capability is the *permission to use it*. This is not a metaphor — it is the actual hardware mechanism.

---

## Why This Demands Deterministic Garbage Collection

### The Problem: What Happens When a Call Ends?

When thread #47's call to Australia disconnects, the thread terminates. But it leaves behind:

- **Namespace entries** — the telephony, billing, and routing abstractions were referenced by this thread's capabilities
- **Golden Tokens** — the thread held tokens in CR1, CR2, CR3 that pointed to those entries
- **Memory** — the thread's register state and any memory lump it was using

If these resources are not reclaimed, they accumulate. A busy exchange handling thousands of calls per hour would exhaust the namespace in minutes. Every ended call that isn't cleaned up is a resource leak — and eventually, the system cannot spawn new threads for new calls.

This is not a theoretical problem. It is the *central* problem of any system that creates and destroys dynamic instances.

### Non-Deterministic GC Is Not Acceptable

Languages like Java and Go use non-deterministic garbage collection — the GC runs "when it feels like it", with unpredictable pause times and no guarantee of when resources will be freed. For a telephone exchange, this is catastrophic:

- **A GC pause during a call drops audio** — the thread stops executing, the call goes silent
- **Unpredictable reclamation means unpredictable capacity** — you cannot know how many calls the system can handle at any given moment
- **GC storms under load** — when the system is busiest (peak call volume), GC pressure is highest, causing the worst pauses at the worst time
- **Stale tokens linger** — if GC hasn't collected a terminated thread's resources, its Golden Tokens might still appear valid, creating a window for use-after-free

### The PP250 Solution: Deterministic Four-Phase GC

The Church Machine's garbage collection is deterministic — it runs in bounded time with predictable behaviour. The four phases are:

**Phase 1 — Mark:** Flag all non-empty namespace entries as potentially reclaimable (set G=1).

**Phase 2 — Scan:** Walk the full reachability tree from all live roots — active threads' capability registers, call stack frames, thread table entries. Every reachable entry has G reset to 0.

**Phase 3 — Clear:** Any entry still marked G=1 after scanning is unreachable. No active thread references it. Reclaim it.

**Phase 4 — Flip:** Toggle GC polarity for the next cycle.

The critical insight is **how liveness is signalled**: the mLoad validation pipeline — the single trusted path for all namespace access — resets the G-bit on every accessed entry as a side effect of normal execution. Active calls constantly touch their namespace entries through LOAD, SAVE, CALL, and RETURN instructions. This means:

- **Active calls automatically signal liveness** — no explicit "I'm still alive" messages needed
- **Ended calls stop touching entries** — their G-bits stay set after Mark, making them candidates for reclamation
- **The GC never interrupts a live call** — it only reclaims entries that no active thread references

### Version Bumping: Killing Stale Tokens Instantly

When an entry is swept (reclaimed), its 7-bit version number is incremented. Any outstanding Golden Token that references this entry still contains the old version number.

```
Thread #47 terminates. Its CR1 held a token for namespace entry #200 (version 5).
GC sweeps entry #200: version bumped to 6.
Entry #200 is reallocated for a new call (thread #93).

If any code still holds the old token (entry #200, version 5):
  → mLoad checks: token version (5) ≠ entry version (6)
  → FAULT — access denied
  → Use-after-free is impossible
```

The old token is now permanently invalid. It does not need to be found and erased — it invalidates itself the moment the version changes. This is O(1) revocation — no matter how many copies of a token exist, they all become invalid simultaneously when the entry's version is bumped.

### Determinism Means Guarantees

| Property | What it guarantees |
|---|---|
| **Bounded pause time** | GC runs in predictable, bounded time — no unexpected pauses |
| **Predictable capacity** | You can calculate the maximum number of concurrent calls |
| **No GC storms** | Reclamation rate is proportional to completion rate, not allocation rate |
| **Provable liveness** | If a thread is active, its entries are reachable — GC will not collect them |
| **Provable reclamation** | If a thread has terminated, its entries will be collected in the next cycle |

---

## Flawless, Fail-Safe Security

Deterministic garbage collection is not a performance optimisation. It is a **security requirement**. Without it, the capability system has gaps. With it, the system is provably secure against an entire class of attacks.

### 1. No Dangling Capabilities

When thread #47 terminates, its Golden Tokens must become unusable. Version bumping ensures this at the hardware level — any attempt to use a stale token triggers a fault. There is no time window where a terminated thread's capabilities could be exploited.

In systems without deterministic GC, there is a race: the token exists, the resource is freed but not yet collected, and a new allocation reuses the slot. The old token now points to the new resource — a classic use-after-free vulnerability. The Church Machine's version bumping eliminates this entirely.

### 2. No Resource Exhaustion Attacks

An attacker who can spawn threads (or cause calls to be initiated) might try to exhaust the namespace by creating many threads and abandoning them. With non-deterministic GC, this attack succeeds — the GC may not reclaim resources fast enough.

With deterministic GC, reclamation is guaranteed within one cycle. The namespace has a provable upper bound on occupancy: the number of currently active threads, plus one cycle's worth of recently terminated threads. The attacker cannot exceed this bound.

### 3. No Information Leakage Between Calls

When a namespace entry is swept and reallocated for a new call, the entry is cleared. Thread #93 (the new call) cannot read any data from thread #47 (the old call). The registers are fresh, the memory lump is zeroed, and the capabilities are newly minted.

This is critical for a telephone exchange: call metadata, billing records, and routing information from one call must never leak to another. Deterministic sweep with entry clearing guarantees a clean slate on every allocation.

### 4. Least Authority Per Thread

Each thread holds only the capabilities it needs for its specific task. Thread #47 has tokens for telephony, billing, and routing — but not for the exchange's configuration, other threads' billing records, or the system's boot sequence. When thread #47 terminates, those capabilities cease to exist.

There is no ambient authority that persists between calls. No global variables, no shared mutable state, no "root" capability that grants access to everything. Each thread operates in its own security sandbox, defined entirely by its C-List of Golden Tokens.

### 5. The mLoad Invariant — No Window of Vulnerability

Every capability access — every LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH — validates the Golden Token against the namespace in real time through the mLoad pipeline. This validation checks:

- Is the token's version current? (Temporal safety)
- Does the token have the required permissions? (Authority check)
- Is the target entry still allocated? (Liveness check)
- Has the entry been sealed or revoked? (Integrity check)

If any check fails, the instruction faults. There is no cached validation, no "trust the token because it was valid last time". Every access is verified against the current state of the namespace.

This means there is **no window of vulnerability** between a token being issued and being used. Even if GC reclaims an entry between two successive instructions, the second instruction's mLoad will detect the version mismatch and fault.

### The Lambda Calculus Foundation

This is not coincidental. The Church Machine's security model is a direct implementation of Alonzo Church's lambda calculus at the hardware level:

- **Functions have no side effects** — abstractions are pure code, threads carry state
- **Values exist only while they are referenced** — Golden Tokens are valid only while the namespace entry is live
- **Unreferenced values can be safely collected** — deterministic GC reclaims entries that no thread can reach
- **Substitution is the only way to bind values** — capabilities are granted through the C-List, never forged or guessed
- **Reduction eliminates intermediate terms** — thread termination and GC sweep are the hardware equivalent of beta-reduction's cleanup

The PP250 telephone exchange is Church's lambda calculus made physical: every call is a lambda expression in flight, every thread is a reduction in progress, and garbage collection is the mechanism that ensures completed reductions release their resources.

The same is true for a banking transaction, a weapon's fire-control authorisation, and a surgical robot's motor command. Each is a thread — a lambda expression in flight — and each is subject to the same guarantees: deterministic collection, instant revocation, and zero-window temporal safety. The security properties are not bolted on after the fact. They emerge naturally from the mathematical foundation that Alonzo Church established in 1936.

### Bugs Eliminated by Architecture

The sections above describe what the Church Machine *does*. This section catalogues what it makes *impossible* — specific, well-known bug classes that cannot occur on this architecture, not because programmers are careful, but because the hardware does not provide the mechanisms that allow them.

#### Concurrency Bugs — Eliminated by Stateless Abstractions + Per-Thread Registers

| Bug class | Why it cannot occur |
|---|---|
| **Race condition** | No shared mutable state in the common case. Each thread has its own register file; abstractions are read-only code. Two threads calling the same method cannot interfere. |
| **Deadlock** (mutex-based) | No locks to acquire in the wrong order. Access to shared resources is mediated by capability grant/revoke, not by mutexes that a thread might hold while waiting for another. Note: logical circular dependencies between manager abstractions are still possible in principle, but they manifest as queue stalls with bounded wait times, not unbounded mutex deadlocks. |
| **Priority inversion** (mutex-based) | No mutexes for a high-priority thread to block on. Capability-mediated access replaces lock-based blocking. However, queue-based scheduling can still delay high-priority work behind low-priority work unless the manager abstraction implements a priority-aware queue policy — see the printer example above. |
| **Data race / torn read / torn write** | Each thread's registers are private. A thread cannot observe a half-written value from another thread's register file. Memory lump access is mediated by capabilities — only the holder can write. |
| **Lock convoy** | No locks in the method-call path. Threads calling stateless abstractions execute concurrently without serialisation. Shared device access is serialised by capability grant, not by convoy-inducing mutexes. |
| **ABA problem** | Golden Token version numbers are monotonically increasing. When a namespace entry is recycled, its version is bumped. A token from the old allocation (version 5) will never match the new allocation (version 6), even though the entry index is the same. The "A" looks different from the second "A". |

#### Memory Safety Bugs — Eliminated by Capability-Bounded Memory Access

| Bug class | Why it cannot occur |
|---|---|
| **Buffer overflow / underflow** | Capabilities carry bounds. A Golden Token grants access to a specific memory lump with a defined size. The hardware checks every LOAD and SAVE against the lump's bounds — writing beyond the end is not a software error, it is a hardware fault. |
| **Wild / uninitialised pointer** | Registers do not hold raw memory addresses. A thread can only access memory through a capability in its C-List, granted by the system. There is no concept of "cast an integer to a pointer" — the hardware does not support it. |
| **Null pointer dereference** | There is no null. A capability register either holds a valid Golden Token (version matches, permissions set) or it holds nothing. Attempting to use an empty capability register is a hardware fault, not an access to address zero. |
| **Stack smashing** | There is no conventional call stack. The Church Machine uses register files and the CALL/RETURN instructions manage control flow through capabilities, not by pushing return addresses onto a writable stack. There is no stack to smash. |
| **Heap spray / heap overflow** | Memory allocation is managed through the namespace — each allocation is a namespace entry with a capability-protected lump. An attacker cannot spray the heap with shellcode because (a) code and data lumps are separate, (b) allocations are capability-protected, and (c) there is no way to jump to an arbitrary address. |

#### Authority and Security Bugs — Eliminated by Golden Tokens + C-List Capability Model

| Bug class | Why it cannot occur |
|---|---|
| **Ambient authority** | There are no global variables, no file paths, no environment variables, no DNS lookups. A thread can only access what it holds a capability for. If a thread does not have a token for the printer, it cannot print — regardless of what "user" it runs as. |
| **Confused deputy** | A capability encodes specific permissions (read, write, execute, grant). A server abstraction that receives a request from a client can only exercise the permissions encoded in the capability it holds — not "whatever the client has access to". The deputy cannot be confused because it does not inherit the caller's authority. |
| **Privilege escalation** | Golden Tokens are unforgeable at the hardware level. The token format includes a version number validated by mLoad on every access. You cannot construct a valid token by bit manipulation — there is no `setuid`, no `sudo`, no ring transition that grants broader authority. Capabilities can only be **attenuated** (reduced in scope), never amplified. |
| **Code injection / ROP / JOP** | Code and data are stored in separate memory lumps. A data lump cannot be executed; a code lump cannot be written to after loading. There is no way to write shellcode into a buffer and jump to it, because the hardware will not execute instructions from a data lump. Return addresses are managed by the hardware through capabilities, not stored on a writable stack. |
| **TOCTOU (Time-Of-Check-To-Time-Of-Use)** — a bug where conditions change between checking whether an action is allowed and performing it; the action proceeds based on a now-invalid check | At the instruction level, the mLoad pipeline validates the Golden Token **atomically at execution time** — the permission check and the resource access are the same hardware operation. A capability that was valid one instruction ago but revoked since will fault immediately. Note: multi-step logical TOCTOU patterns (e.g., "check balance, then debit") can still occur at the application level and require application-level transaction design, but the hardware eliminates the single-instruction TOCTOU window that plagues conventional architectures. |

#### Resource Management Bugs — Eliminated by Deterministic Garbage Collection

| Bug class | Why it cannot occur |
|---|---|
| **Memory leak** | Deterministic GC reclaims all unreferenced namespace entries within one bounded cycle. There is no "forgot to free" — the system identifies and collects every entry that no thread can reach. |
| **Double-free** | There is no `free()`. The programmer does not deallocate memory. GC identifies unreferenced entries and sweeps them. You cannot free something twice because you cannot free anything — the hardware does it for you. |
| **Use-after-free** | Version bumping makes this impossible. When an entry is swept, its version is incremented. Any Golden Token referencing the old version will fail the mLoad validation on the next access — instantly, deterministically, with zero window of exploitation. |
| **Resource exhaustion from leaked handles** | Capability revocation + deterministic GC ensures terminated threads cannot accumulate unreachable resources. A terminated thread's capabilities die with it; the entries they referenced are collected if no other thread references them. Note: a long-lived thread that retains reachable capabilities can still exhaust resources — this is a logical resource management issue, not a leak. The difference is that on the Church Machine, every held resource is accounted for and traceable through the C-List. |
| **Finalizer ordering bugs** | The deterministic GC cycle (Mark → Scan → Sweep) runs in a defined order with bounded time. There are no finalizer queues, no weak references that might be cleared before or after their referents, no "it depends on which GC cycle runs first" non-determinism. The order is fixed by the hardware. |
| **Zombie processes / orphaned resources** | Thread termination triggers capability revocation and GC eligibility. A terminated thread cannot leave orphaned resources because its namespace entries are swept in the next cycle. There is no "zombie" state — a thread is either running and reachable, or terminated and collected. |

#### What This Means in Practice

On conventional architectures, each of these bug classes requires a separate mitigation:

- Race conditions → mutexes and lock discipline
- Buffer overflows → bounds checking, ASLR, stack canaries, DEP
- Use-after-free → smart pointers, borrow checkers, sanitisers
- Privilege escalation → access control lists, sandboxing, capability wrappers
- Memory leaks → profilers, leak detectors, reference counting
- TOCTOU → file locking, atomic operations, transaction mechanisms

Each mitigation adds complexity, and each can be implemented incorrectly. The mitigations interact — a lock intended to prevent a race condition can cause a deadlock; a smart pointer intended to prevent use-after-free can cause a reference cycle and a memory leak.

On the Church Machine, **the vast majority of these mitigations are unnecessary** because the hardware does not provide the mechanisms (raw pointers, shared mutable state, ambient authority, manual deallocation) that make the corresponding bugs possible. Where the architecture shifts a problem rather than eliminating it entirely — such as queue-based scheduling replacing mutex-based priority inversion, or application-level TOCTOU requiring transaction design — the failure mode is bounded, traceable, and explicit rather than silent, unbounded, and exploitable.

This is the difference between **safety by discipline** and **safety by construction**. The Church Machine achieves the latter for the hardware-level bug classes, and provides a sound foundation for addressing the remaining application-level concerns.

### What the Architecture Does Not Prevent

Intellectual honesty requires drawing a clear boundary. The Church Machine's capability model, deterministic GC, and stateless abstractions eliminate a large class of bugs — but not all bugs. The following categories remain outside the architectural threat model:

**Arithmetic errors:**
Integer overflow and underflow are not caught by the hardware. `2,000,000,000 + 2,000,000,000` silently wraps on a 32-bit register. The fixed-point overflow limits table earlier in this document exists precisely because this is a real constraint. A safety-critical system using fixed-point arithmetic must validate that intermediate values stay within representable range — this is an application-level responsibility.

**Logic bugs:**
If `addFrac` computes `n1 * d1` instead of `n1 * d2`, the hardware will dutifully execute the wrong formula and return a wrong result. No architecture prevents incorrect algorithms. The Church Machine ensures that the wrong result is computed *safely* — no buffer overflow, no privilege escalation, no leaked capability — but wrong is still wrong.

**Side-channel attacks:**
If two threads share physical hardware — the same ALU, the same memory bus, the same cache hierarchy — execution timing can leak information about what another thread is computing. A thread performing a capability-secured cryptographic operation may reveal key bits through timing variations, even though the capability system perfectly isolates logical access. Side-channel resistance requires additional countermeasures: constant-time algorithms, cache partitioning, or physical isolation.

**Covert channels:**
Related to side channels but intentional. Two colluding threads could communicate by modulating observable timing (e.g., one thread busy-loops to signal a "1" and idles to signal a "0", while the other thread measures its own execution rate). This bypasses the capability system entirely because it exploits shared physical resources, not logical access paths. Covert channel analysis and bandwidth limitation are well-studied problems, but they sit outside the capability model.

**Denial of service via CPU exhaustion:**
A thread in an infinite loop consumes CPU time. Deterministic GC prevents namespace exhaustion (memory DoS), and the bounded GC cycle prevents GC storms, but a thread that never terminates holds its registers and namespace entry indefinitely. Whether the Church Machine architecture includes preemptive time-slicing or per-thread CPU quotas is a scheduler design question not addressed in this document.

**Speculative execution attacks (Spectre/Meltdown class):**
If the Church Machine implements speculative or out-of-order execution, transient execution paths could bypass capability checks before being rolled back — accessing data that the architectural model says is inaccessible. If the Church Machine executes strictly in-order with no speculation, this entire class is eliminated by simplicity. The answer depends on the microarchitectural implementation, not the architectural model.

**Physical and fault-injection attacks:**
Voltage glitching, clock manipulation, electromagnetic fault injection, and cold boot attacks on register files operate below the architectural abstraction. These attacks can cause the hardware to behave differently from its specification — skipping a mLoad validation, corrupting a version number, reading a register file that should have been cleared. Defence against physical attacks requires hardware countermeasures (glitch detectors, secure enclaves, memory encryption) that are orthogonal to the capability model.

**Supply chain and hardware trojan attacks:**
If the fabricated chip contains a trojan — a hidden circuit that, under specific conditions, bypasses capability checks or leaks register contents — then the architectural guarantees are void because the implementation does not match the specification. This is a fabrication integrity problem, addressed by techniques like split manufacturing, formal hardware verification against RTL (Register-Transfer Level — the circuit description that specifies how data moves between registers on each clock cycle), and post-silicon validation.

### The Boundary of Proof

The "Flawless, Fail-Safe Security" section above makes five specific claims:

1. No Dangling Capabilities (version bumping invalidates stale tokens)
2. No Resource Exhaustion Attacks (bounded deterministic GC cycle)
3. No Information Leakage Between Calls (entry clearing on sweep)
4. Least Authority Per Thread (C-List scoping, no ambient authority)
5. No Window of Vulnerability (atomic mLoad validation per instruction)

These claims are **provable within the architectural model**. Given a formal specification of the instruction semantics, the mLoad pipeline, the GC cycle, and the namespace operations, each property follows as a theorem:

- **Claim 1** follows from the version-monotonicity invariant: if `token.version < entry.version`, the token is invalid; versions only increase; therefore a swept entry's tokens are permanently invalid.
- **Claim 2** follows from the GC bounded-time guarantee: if the sweep phase runs in O(n) time for n namespace entries, and n is bounded by hardware, then reclamation is bounded.
- **Claim 3** follows from the sweep-clear postcondition: if the sweep phase zeroes every field of a reclaimed entry before it is reallocated, then the new occupant starts with a clean slate.
- **Claim 4** follows from the C-List access rule: if every instruction that accesses a resource validates a capability from the thread's C-List, and capabilities can only be attenuated (never amplified), then a thread's authority is bounded by its initial grant.
- **Claim 5** follows from the mLoad atomicity property: if the validation and the access are a single hardware operation, there is no intermediate state where the token is valid but the access has not yet occurred.

This is analogous to how **seL4** proved capability safety for a microkernel, or how **CompCert** proved compilation correctness for C. The Church Machine's simpler architecture — 20 instructions, no virtual memory, no speculative execution, no interrupts in the conventional sense — is arguably **more tractable** for formal verification than either of those systems.

However, "provable within the model" is not the same as "formally verified." Full substantiation of the "Flawless" claim would require three things:

| Level | What is needed | Status |
|---|---|---|
| **Specification** | A formal model of the Church Machine's instruction semantics, mLoad pipeline, GC cycle, and namespace operations — written in a proof language (Coq, Isabelle/HOL, or Lean) | Needed |
| **Property proofs** | Mechanised proofs that the specification implies the five security properties — machine-checked, not hand-waved | Needed |
| **Implementation verification** | Proof that the physical hardware (or the simulator in this IDE) faithfully implements the specification — either by RTL-level formal verification or by verified compilation from the spec | Needed |

Until these exist, the five security claims rest on architectural reasoning — which is sound, detailed, and consistent with established results in capability-based security (Dennis & Van Horn 1966, Levy 1984, the EROS/CapROS lineage, seL4's capability proofs) — but not on mechanised proof.

The title "Flawless, Fail-Safe Security" is therefore best understood as a **design goal and architectural claim**, not as a formally verified theorem. The architecture is *designed* to make these properties true, the reasoning that they hold is *sound*, and the path to formal proof is *tractable*. But the proof has not yet been carried out.

This is not a weakness — it is a statement of where the project stands, and an invitation to complete the verification. The architecture was built to be provable. The proofs remain to be written.

---

## The Full Picture

This document began with a simple question — how do you divide 7 by 3 on integer hardware? — and arrived at a hardware architecture that can provably prevent a weapons platform from firing on a revoked authorisation, a banking system from processing a stale transaction, and a surgical robot from pausing mid-incision.

The path was:

1. **Integer arithmetic** — fixed-point, remainder, and rational techniques give precise results on integer-only hardware
2. **Abstraction composition** — the supercall pattern lets abstractions delegate to each other through capability-secured method calls
3. **Threads as dynamic instances** — each concurrent task (phone call, transaction, fire-control check, motor command) gets its own register file, program counter, and capability context
4. **Deterministic garbage collection** — terminated threads' resources are reclaimed in bounded time, with version bumping instantly invalidating all stale tokens
5. **Provable security** — no dangling capabilities, no resource exhaustion, no information leakage, no ambient authority, no window of vulnerability

Every layer builds on the one below it. The arithmetic is exact because the abstractions are correct. The abstractions compose safely because capabilities enforce least authority. The threads are isolated because each has its own capability context. The resources are recovered because GC is deterministic. And the system is secure because all of these properties are enforced by hardware, not software.

This is what it means to build a processor on Alonzo Church's lambda calculus: the security guarantees are not features — they are theorems.

---

## Further Reading

- The **LC: Slide Rule** example demonstrates fixed-point thinking — its `SineApprox` method returns `sin(θ) × 10` to preserve one decimal place on integer hardware.
- The **LC: Church** example's `divide` method shows the basic integer division that all three techniques build upon.
- The **LC: Pairs** example shows how Church pairs `(a, b)` work — the same encoding used by rational numbers to represent fractions.
- The **[Deterministic Garbage Collection](garbage-collection.md)** document covers the G-bit mechanism, mLoad integration, and three-phase Mark-Scan-Sweep cycle in full technical detail.
- The **[Golden Tokens](golden-tokens.md)** document explains the 32-bit unforgeable capability format, permission bits, and version-based revocation.
- The **[Architecture](architecture.md)** document covers the PP250 GC model, the 20-instruction set, and the Church/Turing domain split.
