# Pet-Name Language Reference

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

The Pet-Name language is a hybrid programming mode in the CLOOMC++ compiler that lets you write readable, high-level expressions mixed freely with raw Church Machine assembly. The compiler automatically resolves math operations and constants to the correct abstraction calls (SlideRule, Abacus, Constants) and manages capability registers behind the scenes.

## Quick Start

```
LOAD led
radius = 5
area = Pi * radius * radius
DWRITE DR1, CR3, 0
HALT
```

The compiler detects pet-name mode automatically when your source contains variable assignments (lines with `=`). No special header or declaration is needed.

---

## Variables and Assignment

Assign a value to a named variable using `=`. Variable names follow standard identifier rules: letters, digits, and underscores, starting with a letter or underscore. Names are case-sensitive.

```
x = 42
height = 100
my_var = 0xFF
```

Variables are allocated to data registers (DR1–DR11) automatically. You do not need to declare types or choose registers — the compiler handles it. Variables in DR1–DR3 are automatically relocated before abstraction calls to protect them from being overwritten by call conventions.

### Numeric Literals

| Format | Example | Notes |
|--------|---------|-------|
| Decimal | `42`, `-7`, `0` | Signed integers |
| Hexadecimal | `0xFF`, `0x1A3B` | Prefix with `0x` |

Full 32-bit values are supported. Large immediates are assembled using multi-instruction sequences (IADD + SHL).

---

## Arithmetic Operators

Standard infix operators are supported. The compiler routes each operation to the appropriate abstraction method automatically.

| Operator | Operation | Routed To |
|----------|-----------|-----------|
| `+` | Addition | Abacus.Add |
| `-` | Subtraction | Abacus.Sub |
| `*` | Multiplication | SlideRule.Multiply |
| `/` | Division | SlideRule.Divide |
| `%` | Modulo | SlideRule.Mod |
| `^` | Exponentiation | SlideRule.Pow |

```
sum = a + b
diff = x - 10
product = width * height
ratio = total / count
remainder = n % 3
power = x ^ 3
```

Operator precedence follows standard rules: `^` binds tightest, then `*`, `/`, `%`, then `+`, `-`. Use parentheses to override:

```
result = (a + b) * c
nested = ((x + 1) * (y - 2)) / z
cube = x ^ 3
```

### Implicit Multiplication

Adjacent values without an operator are treated as multiplication. This lets you write mathematical expressions naturally:

```
area = Pi radius^2          ; same as Pi * radius^2
circumference = 2 Pi radius ; same as 2 * Pi * radius
volume = 4 Pi r^3 / 3       ; same as 4 * Pi * r^3 / 3
result = 2(x + 1)           ; same as 2 * (x + 1)
```

Function calls are not affected: `Sqrt(x)` is still a function call, not `Sqrt * x`.

---

## Built-in Constants

These named constants are available from the Constants abstraction. They can be used anywhere a value is expected — in assignments, in expressions, or as function arguments.

| Name | Value | Abstraction Call |
|------|-------|-----------------|
| `Pi` | 3.14159... (IEEE 754) | Constants.Pi |
| `E` | 2.71828... (IEEE 754) | Constants.E |
| `Phi` | 1.61803... (IEEE 754) | Constants.Phi |
| `Zero` | 0.0 (IEEE 754) | Constants.Zero |
| `One` | 1.0 (IEEE 754) | Constants.One |

Constants work as bare names or with empty parentheses:

```
h = Pi
h = Pi()
area = Pi * r * r
```

---

## Built-in Functions

Functions are called with parentheses and comma-separated arguments. The compiler emits the correct LOAD + CALL sequence to the underlying abstraction.

### One-Argument Functions

| Function | Description | Abstraction |
|----------|-------------|-------------|
| `Sqrt(x)` | Integer square root (floor) | SlideRule.Sqrt |
| `Abs(x)` | Absolute value | SlideRule.Abs |
| `Factorial(n)` | n! | SlideRule.Factorial |
| `Log2(n)` | Floor of log base 2 | SlideRule.Log2 |
| `Signum(n)` | Sign: +1, 0, or -1 | SlideRule.Signum |
| `Sin(x)` | Sine (CORDIC, fixed-point) | SlideRule.Sin |
| `Cos(x)` | Cosine (CORDIC, fixed-point) | SlideRule.Cos |
| `Tan(x)` | Tangent (CORDIC, fixed-point) | SlideRule.Tan |
| `Asin(x)` | Inverse sine | SlideRule.Asin |
| `Acos(x)` | Inverse cosine | SlideRule.Acos |
| `Atan(x)` | Inverse tangent | SlideRule.Atan |
| `ToDegrees(x)` | Radians to degrees | SlideRule.ToDegrees |
| `ToRadians(x)` | Degrees to radians | SlideRule.ToRadians |

### Two-Argument Functions

| Function | Description | Abstraction |
|----------|-------------|-------------|
| `Pow(base, exp)` | Exponentiation (exp >= 0) | SlideRule.Pow |
| `Min(a, b)` | Minimum of two values | SlideRule.Min |
| `Max(a, b)` | Maximum of two values | SlideRule.Max |
| `GCD(a, b)` | Greatest common divisor | SlideRule.GCD |
| `Atan2(y, x)` | Two-argument arctangent | SlideRule.Atan2 |

### Special Return

| Function | Description | Notes |
|----------|-------------|-------|
| `Bernoulli(n)` | B(n) as exact rational | DR1 = numerator, DR2 = denominator |

### Examples

```
root = Sqrt(144)
d = GCD(48, 18)
f = Factorial(6)
angle = Atan2(y, x)
result = Pow(2, 10)
biggest = Max(a, b)
```

Functions are case-insensitive: `sqrt(144)`, `SQRT(144)`, and `Sqrt(144)` all work.

Functions can be nested in expressions:

```
hypotenuse = Sqrt(x*x + y*y)
clamped = Min(Max(value, 0), 255)
```

---

## Capability Loading (LOAD PetName)

To load a capability (Golden Token) from the thread's c-list by name, use `LOAD` followed by the pet name:

```
LOAD SlideRule
LOAD Constants
LOAD led
```

This finds the named abstraction's GT in the c-list, allocates a free capability register (CR1–CR11, excluding reserved CR0, CR6, CR12–CR15), and emits a `LOAD CRn, CR6, #offset` instruction.

Once loaded, the pet name can be used in subsequent raw assembly lines and will be substituted with the allocated CR:

```
LOAD SlideRule
CALL SlideRule       ; compiles to: CALL CR2
```

Note: For expression-based programs, you do not need explicit `LOAD` instructions. The compiler automatically loads required capabilities when it encounters operators or function calls.

---

## Mixing with Raw Assembly

The defining feature of the pet-name language is seamless mixing of high-level expressions with raw Church Machine assembly. Any line that starts with a known assembly mnemonic is passed through to the assembler. Pet-name variables and loaded capabilities are automatically substituted with their register names.

### Supported Assembly Mnemonics

LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA, DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, SHL, SHR, HALT, NOP

All conditional branch variants are supported: BRANCH, BRANCHEQ, BRANCHNE, BRANCHCS, BRANCHCC, BRANCHMI, BRANCHPL, BRANCHVS, BRANCHVC, BRANCHHI, BRANCHLS, BRANCHGE, BRANCHLT, BRANCHGT, BRANCHLE, BRANCHNV.

### Register Substitution

Pet-name variables in assembly lines are automatically replaced with their allocated register:

```
counter = 10
ISUB counter, counter, #1     ; compiles to: ISUB DR4, DR4, #1
BRANCHNE -1
```

### Labels

Assembly labels work normally in the raw assembly portions:

```
x = 5
loop: ISUB x, x, #1
BRANCHNE loop
```

### Full Hybrid Example

```
LOAD led
r = 2
area = Pi * r * r

; Write result to LED device
IADD DR1, DR0, #1
DWRITE DR1, led, 0

; Blink loop
loop: IADD DR3, DR0, #3
      IADD DR2, DR0, #3
delay: ISUB DR2, DR2, #1
      BRANCHNE delay
      ISUB DR3, DR3, #1
      BRANCHNE delay
DWRITE DR0, led, 0
BRANCH loop
```

---

## Comments

Three comment styles are supported:

```
; Semicolon comments (assembly style)
// Double-slash comments (C style)
-- Double-dash comments (Haskell/SQL style)
```

---

## How It Works — Behind the Scenes

When you write `area = Pi * r * r`, the compiler:

1. Allocates a data register for `r` (e.g. DR4) and loads the value 2
2. Calls `Constants.Pi` — loads the Constants GT from the c-list into a capability register, sets the method index, and issues CALL
3. Saves the Pi result to a temporary register
4. Calls `SlideRule.Multiply` with Pi and r as arguments
5. Saves the intermediate result
6. Calls `SlideRule.Multiply` again with the intermediate result and r
7. Moves the final result into the register allocated for `area`

Capability registers are loaded only once per abstraction — if SlideRule is called twice, the GT is loaded into its CR on the first call and reused on the second.

### Register Allocation

| Registers | Purpose |
|-----------|---------|
| DR0 | Always zero (hardware) |
| DR1–DR3 | Call arguments and return values (protected before calls) |
| DR4–DR11 | General-purpose pet-name variables |
| CR0 | Reserved (return capability) |
| CR1–CR5, CR7–CR11 | Available for abstraction GTs |
| CR6 | Reserved (c-list base pointer) |
| CR12–CR15 | Reserved (thread stack, interrupt handler, code register, namespace root) |

### Automatic Protections

Variables stored in DR1–DR3 are automatically relocated to higher registers before any abstraction call, since CALL conventions use DR1–DR3 for argument passing and return values. You do not need to worry about register clobbering.

---

## Limitations

- Maximum 11 user variables per program (DR1–DR11)
- Maximum ~8 simultaneous abstraction capabilities (CR1–CR5, CR7–CR11, excluding reserved)
- No control flow constructs (if/else, while, for) — use raw assembly branch instructions
- No string or floating-point literals — use Constants abstraction for IEEE 754 values
- Integer arithmetic only for operators; floating-point is handled internally by abstraction methods
- All code compiles into a single method named `run`
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
