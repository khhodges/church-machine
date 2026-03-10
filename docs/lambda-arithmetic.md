# Beyond Integer Division — Arithmetic on the Church Machine

The Church Machine operates on 32-bit integers. There are no floating-point registers or instructions. Every value in a data register (DR0–DR7) is a whole number, and the division instruction (`/`) performs integer division via repeated subtraction, truncating any fractional part.

This means `7 / 3 = 2`, not `2.333...`.

So how do you compute precise results on integer-only hardware? This document covers three techniques — **fixed-point arithmetic**, **remainder/modulo**, and **rational numbers** — each implemented as a Lambda Calculus abstraction in the Church Machine IDE.

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

The Church Machine passes and returns single integer values — there are no tuple return types at the hardware level. So each fraction operation is split into two method calls: one for the numerator, one for the denominator. The caller tracks both values.

This is how real hardware fraction libraries work: you store the numerator and denominator in separate registers and call the appropriate method for each component.

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

## Further Reading

- The **LC: Slide Rule** example demonstrates fixed-point thinking — its `SineApprox` method returns `sin(θ) × 10` to preserve one decimal place on integer hardware.
- The **LC: Church** example's `divide` method shows the basic integer division that all three techniques build upon.
- The **LC: Pairs** example shows how Church pairs `(a, b)` work — the same encoding used by rational numbers to represent fractions.
