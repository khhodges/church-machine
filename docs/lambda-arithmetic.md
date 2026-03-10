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
| a/b = c/d? | a×d = c×b? | 9/18 = 1/2? → 18 = 18 ✓ |

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

## Further Reading

- The **LC: Slide Rule** example demonstrates fixed-point thinking — its `SineApprox` method returns `sin(θ) × 10` to preserve one decimal place on integer hardware.
- The **LC: Church** example's `divide` method shows the basic integer division that all three techniques build upon.
- The **LC: Pairs** example shows how Church pairs `(a, b)` work — the same encoding used by rational numbers to represent fractions.
