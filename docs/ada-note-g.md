# Ada Lovelace's Note G — Plain-Text Transcription

## Introduction

Ada Lovelace (1815–1852) translated Luigi Menabrea's French memoir on Charles Babbage's proposed Analytical Engine into English, adding a set of her own annotations that ran to nearly three times the length of the original text. The seventh and longest of these annotations — Note G — was published in Taylor's *Scientific Memoirs*, Vol. III, in August 1843. It contains a complete 25-operation program for computing Bernoulli numbers on the Analytical Engine, widely regarded as the first published computer algorithm.

The Analytical Engine was a general-purpose mechanical computer that Babbage designed but never completed. It operated on variable columns (gear stacks labelled V1–V24) and performed one arithmetic operation at a time — addition, subtraction, multiplication, or division — storing each result in one or more columns. Lovelace's Note G program computes B₇, the seventh Bernoulli number in the convention she used (corresponding to B₈ = −1/30 in modern notation), by summing a series of weighted terms through a loop that runs n−2 times. The algorithm requires no division-free shortcut: it derives every Bernoulli coefficient from those already computed, using only the four basic arithmetic operations.

---

## The 25-Operation Table

The table below transcribes all 25 operations from Ada Lovelace's published diagram. Column headings follow her original layout. "Nature" uses her symbols: × (multiply), + (add), − (subtract), ÷ (divide). "Variables acted upon" and "Variables receiving results" use her V-numbered column notation. "Statement of results" gives the algebraic meaning of each step. "Values (n=4)" shows the numeric result when computing B₇, the example she worked through.

**Note on the values column:** Operation 4 is shown with both the published value (9÷7, from the swapped operands Ada printed) and the corrected value (7÷9, per Bromley 1990). All values for Operations 5 onward use the corrected operand order, since tracing the published error forward produces a meaningless result. Where the table uses a normalised notation such as "V21 (B₁)" it is paraphrasing Ada's column references for readability; a note explains any such abstraction.

Ada used superscript prefixes to track how many times a variable column had been written (e.g., ²V₄ means V4 has been assigned twice). That notation is reproduced in the Variables columns where it clarifies which value of a column is being used.

| Op | Nature | Variables acted upon | Variables receiving results | Statement of results | Values (n=4) |
|----|--------|---------------------|-----------------------------|----------------------|--------------|
| 1  | ×      | V2, V3              | V4, V5, V6                 | 2n — result copied to three columns simultaneously | V4=V5=V6=8 |
| 2  | −      | ¹V4, V1             | ²V4                         | 2n − 1               | V4 = 7 |
| 3  | +      | ¹V5, V1             | ²V5                         | 2n + 1               | V5 = 9 |
| 4  | ÷      | ²V5, ²V4            | ¹V11                        | (2n+1) ÷ (2n−1) **[BUG — see annotation below]** | published: 9÷7; corrected: 7÷9 |
| 5  | ÷      | ¹V11, V2            | ²V11                        | A₀ coefficient ÷ 2   | 7/18 |
| 6  | −      | V13, ²V11           | ¹V13                        | 0 − (A₀/2) = −(2n−1)/(2(2n+1)) | −7/18 |
| 7  | −      | V3, V1              | ¹V10                        | n − 1 (loop counter) | V10 = 3 |
| 8  | +      | V2, V7              | ¹V7                         | Set denominator counter = 2 | V7 = 2 |
| 9  | ÷      | ²V6, ¹V7            | ³V11                        | 2n ÷ 2 = first A₁ factor | V11 = 4 |
| 10 | ×      | V21, ³V11           | ¹V12                        | B₁ × A₁ — V21 holds the previously computed B₁ = 1/6 | V12 = 2/3 |
| 11 | +      | ¹V12, ¹V13          | ²V13                        | Running sum += B₁ × A₁ | V13 = 5/18 |
| 12 | −      | ¹V10, V1            | ²V10                        | Decrement loop counter | V10 = 2 |
| 13 | −      | ³V6, V1             | ⁴V6                         | Decrement working variable | V6 = 7 (1st pass) |
| 14 | +      | V1, ¹V7             | ²V7                         | Increment denominator  | V7 = 3 |
| 15 | ÷      | ⁴V6, ²V7            | ¹V8                         | First ratio for coefficient Aₖ | V8 = 7/3 |
| 16 | ×      | ¹V8, ³V11           | ⁴V11                        | Update running coefficient | V11 = 28/3 |
| 17 | −      | ⁴V6, V1             | ⁵V6                         | Decrement again        | V6 = 6 |
| 18 | +      | V1, ²V7             | ³V7                         | Increment denominator again | V7 = 4 |
| 19 | ÷      | ⁵V6, ³V7            | ¹V9                         | Second ratio for coefficient Aₖ | V9 = 3/2 |
| 20 | ×      | ¹V9, ⁴V11           | ⁵V11                        | Aₖ coefficient complete | V11 = 14 |
| 21 | ×      | V22/V23, ⁵V11       | ²V12                        | Bₖ × Aₖ — V22 holds B₃, V23 holds B₅ (Ada stored previously computed Bernoulli numbers in V21–V23; the correct column advances each loop pass) | (uses stored Bₖ) |
| 22 | +      | ²V12, ²V13          | ³V13                        | Running sum += Bₖ × Aₖ | (accumulates) |
| 23 | —      | ²V10, V1            | ³V10                        | Decrement loop counter; if V10 ≠ 0, back to Op 13 | repeats (n−2) times |
| 24 | −      | V24, ³V13           | ²V24                        | B₇ = 0 − accumulated sum | V24 = −1/30 |
| 25 | +      | V1, V3              | ²V3                         | Advance n for next Bernoulli number | V3 = 5 |

**Structural blocks:**

| Block | Operations | Purpose | Executes |
|-------|-----------|---------|----------|
| Setup | 1–7 | Compute A₀, set loop counter | Once |
| First term | 8–12 | Compute B₁ × A₁, accumulate | Once |
| Inner loop | 13–23 | Compute Bₖ × Aₖ for k=2…n−1, accumulate | n−2 times |
| Finalize | 24–25 | Negate sum to get result, advance n | Once |

---

### Operation 4 — Transcribed Exactly as Published

> **Op 4: ÷ — Variables acted upon: ²V5, ²V4 — Result: ¹V11**
> Statement: (2n+1) ÷ (2n−1)

> [!CAUTION]
> **Bug — Operands swapped.** Ada's published table shows the dividend as ²V5 (which holds 2n+1 = 9) and the divisor as ²V4 (which holds 2n−1 = 7), producing 9÷7. The correct computation needed by the algorithm is (2n−1)÷(2n+1) = 7÷9, i.e., the operand order must be reversed. The corrected form is: **÷ V4, V5 → V11**.
>
> This is the bug identified by Allan Bromley (University of Sydney) around 1990 when he studied the original published diagram. It is transcribed here exactly as Ada published it to preserve the historical record.

---

## The Bug

### What Bromley Found

Around 1990, historian of computing Allan Bromley examined the original published diagram in Taylor's *Scientific Memoirs* (1843) in detail. He noticed that Operation 4 — the division that forms the seed of the A₀ coefficient — has its operands in the wrong order.

The algorithm builds a ratio (2n−1)/(2n+1). For the B₇ computation (n=4), that is 7/9 ≈ 0.778. Ada's table as published gives the dividend column as ²V5 (which holds 2n+1 = 9) and the divisor column as ²V4 (which holds 2n−1 = 7), producing 9/7 ≈ 1.286 — the reciprocal of the intended value. Every subsequent term in the accumulation inherits this error, and the final result would be wrong.

### Why It Matters

Lovelace's program is the earliest known example of a complete, published computer algorithm. The bug in Operation 4 means that the program as printed in 1843 would not produce the correct Bernoulli number if executed on a working Analytical Engine. Because Babbage's Engine was never completed, the program was never tested. The error had no practical consequence for 147 years — it sat undiscovered in a Victorian scientific journal, examined by historians and mathematicians who read it as mathematics rather than as executable code to be checked step by step.

The cause is almost certainly a transcription error, either by Ada herself while preparing the table or during typesetting. The algebraic structure of the algorithm is correct throughout — every other step follows consistently from the intended formula. Only the operand order in this one division is inverted.

### The Remarkable Timeline

The program was published in August 1843. Bromley identified the bug around 1990. The gap is approximately 147 years — the longest known interval between the publication of a computer program and the discovery of a bug in it. This record is unlikely ever to be broken.

Bromley's discovery is a reminder that bugs do not require a running machine to exist, and that careful reading of source code — even century-old typeset source code — can reveal errors invisible to the algorithm's author.

---

## How the Pre-loaded Values Are Produced — Abbreviated Traces for n=2 and n=3

The B₇ computation (n=4) opens with V21=1/6, V22=−1/30, and V23=1/42 already present in the Store. These are not arbitrary constants: each is the result of an earlier invocation of the same 25-operation program, run with a smaller value of n. The diagram below shows how three successive runs feed into one another.

```
n=2  →  B₃ = −1/30  (stored into V22 before the n=4 run)
n=3  →  B₅ = 1/42   (stored into V23 before the n=4 run)
n=4  →  B₇ = −1/30  (the run Ada traces in full)
```

B₁ = 1/6 (stored in V21) is the seed value that all three runs share; it is not itself computed by Ada's 25-step program but is instead the well-known closed-form result B₁ = 1/2 · 1/3. The sections below give abbreviated step-by-step traces for n=2 and n=3, showing exactly how V22 and V23 are produced.

---

### Abbreviated Trace — n=2 (computing B₃)

For n=2 the inner loop (Ops 13–23) runs n−2=**0** times, so the execution is a straight sequence of twelve operations followed by the finalisation pair.

**Initial state (n=2 run):**

| Variable | Value | Meaning |
|----------|-------|---------|
| V1  | 1   | Constant 1 |
| V2  | 2   | Constant 2 |
| V3  | 2   | n=2 |
| V21 | 1/6 | B₁ (seed; pre-loaded by hand) |
| V4–V13, V22–V24 | 0 | Working columns, cleared |

**Key computed values:**

| Block | Ops | Variable | Value | How |
|-------|-----|----------|-------|-----|
| Setup | 1   | V4=V5=V6 | 4     | 2×2 |
| Setup | 2   | V4       | 3     | 4−1 = 2n−1 |
| Setup | 3   | V5       | 5     | 4+1 = 2n+1 |
| Setup | 4   | V11      | 3/5   | V4÷V5 (Bromley correction) |
| Setup | 5   | V11      | 3/10  | (3/5)÷2 |
| Setup | 6   | V13      | −3/10 | 0−3/10 = A₀ |
| Setup | 7   | V10      | 1     | 2−1 = n−1 (loop counter) |
| 1st term | 8 | V7  | 2     | denominator counter initialised |
| 1st term | 9 | V11 | 2     | V6÷V7 = 4÷2 (A₁ first factor) |
| 1st term | 10 | V12 | 1/3   | V21×V11 = (1/6)×2 = B₁×A₁ |
| 1st term | 11 | V13 | 1/30  | 1/3+(−3/10) = 10/30−9/30 |
| 1st term | 12 | V10 | 0     | 1−1 → inner loop skipped |
| Finalize | 24 | V24 | **−1/30** | 0−(1/30) |
| Finalize | 25 | V3  | 3     | advance n for next run |

**Result: B₃ = −1/30.** This value is written into V22 before the n=4 run begins.

---

### Abbreviated Trace — n=3 (computing B₅)

For n=3 the inner loop runs n−2=**1** time, using B₃ (−1/30) loaded in V22.

**Initial state (n=3 run):**

| Variable | Value | Meaning |
|----------|-------|---------|
| V1  | 1     | Constant 1 |
| V2  | 2     | Constant 2 |
| V3  | 3     | n=3 |
| V21 | 1/6   | B₁ (seed) |
| V22 | −1/30 | B₃ (result of the n=2 run above) |
| V4–V13, V23–V24 | 0 | Working columns, cleared |

**Key computed values:**

| Block | Ops | Variable | Value | How |
|-------|-----|----------|-------|-----|
| Setup | 1   | V4=V5=V6 | 6     | 2×3 |
| Setup | 2   | V4       | 5     | 6−1 = 2n−1 |
| Setup | 3   | V5       | 7     | 6+1 = 2n+1 |
| Setup | 4   | V11      | 5/7   | V4÷V5 (Bromley correction) |
| Setup | 5   | V11      | 5/14  | (5/7)÷2 |
| Setup | 6   | V13      | −5/14 | 0−5/14 = A₀ |
| Setup | 7   | V10      | 2     | 3−1 = n−1 (loop counter) |
| 1st term | 8 | V7  | 2     | denominator counter initialised |
| 1st term | 9 | V11 | 3     | V6÷V7 = 6÷2 (A₁ first factor) |
| 1st term | 10 | V12 | 1/2   | V21×V11 = (1/6)×3 = B₁×A₁ |
| 1st term | 11 | V13 | 1/7   | 1/2+(−5/14) = 7/14−5/14 |
| 1st term | 12 | V10 | 1     | 2−1 → one loop pass follows |
| Inner loop (pass 1) | 13 | V6 | 5   | 6−1 |
| Inner loop (pass 1) | 14 | V7 | 3   | 2+1 |
| Inner loop (pass 1) | 15 | V8 | 5/3 | V6÷V7 (first ratio for A₂) |
| Inner loop (pass 1) | 16 | V11 | 5   | (5/3)×3 |
| Inner loop (pass 1) | 17 | V6 | 4   | 5−1 |
| Inner loop (pass 1) | 18 | V7 | 4   | 3+1 |
| Inner loop (pass 1) | 19 | V9 | 1   | V6÷V7 = 4÷4 (second ratio for A₂) |
| Inner loop (pass 1) | 20 | V11 | 5  | 1×5 → A₂=5 complete |
| Inner loop (pass 1) | 21 | V12 | −1/6 | V22×V11 = (−1/30)×5 = B₃×A₂ |
| Inner loop (pass 1) | 22 | V13 | −1/42 | −1/6+1/7 = −7/42+6/42 |
| Inner loop (pass 1) | 23 | V10 | 0   | 1−1 → loop exits |
| Finalize | 24 | V24 | **1/42** | 0−(−1/42) |
| Finalize | 25 | V3  | 4    | advance n for next run |

**Result: B₅ = 1/42.** This value is written into V23 before the n=4 run begins.

---

### Abbreviated Trace — n=5 (computing B₉)

For n=5 the inner loop runs n−2=**3** times, using B₃ (−1/30) in V22, B₅ (1/42) in V23, and B₇ (−1/30) in V24. The loop advancement step is extended to `let V22 = V23; let V23 = V24` at the end of each pass, sliding the B-chain window forward so each pass reads the next Bernoulli number.

**Initial state (n=5 run):**

| Variable | Value | Meaning |
|----------|-------|---------|
| V1  | 1     | Constant 1 |
| V2  | 2     | Constant 2 |
| V3  | 5     | n=5 |
| V21 | 1/6   | B₁ (seed) |
| V22 | −1/30 | B₃ (restored from V20 scratch after Run 3 overwrote it) |
| V23 | 1/42  | B₅ (result of Run 2, unchanged by Run 3) |
| V24 | −1/30 | B₇ (result of Run 3) |
| V4–V13, V25 | 0 | Working columns, cleared |

**Key computed values:**

| Block | Ops | Variable | Value | How |
|-------|-----|----------|-------|-----|
| Setup | 1   | V4=V5=V6 | 10    | 2×5 |
| Setup | 2   | V4       | 9     | 10−1 = 2n−1 |
| Setup | 3   | V5       | 11    | 10+1 = 2n+1 |
| Setup | 4   | V11      | 9/11  | V4÷V5 (Bromley correction) |
| Setup | 5   | V11      | 9/22  | (9/11)÷2 |
| Setup | 6   | V13      | −9/22 | 0−9/22 = A₀ |
| Setup | 7   | V10      | 4     | 5−1 = n−1 (loop counter) |
| 1st term | 8 | V7  | 2     | denominator counter initialised |
| 1st term | 9 | V11 | 5     | V6÷V7 = 10÷2 (A₁ first factor) |
| 1st term | 10 | V12 | 5/6   | V21×V11 = (1/6)×5 = B₁×A₁ |
| 1st term | 11 | V13 | 14/33 | 5/6+(−9/22) = 55/66−27/66 = 28/66 |
| 1st term | 12 | V10 | 3     | 4−1 → three loop passes follow |
| Inner loop (pass 1) | 13 | V6  | 9    | 10−1 |
| Inner loop (pass 1) | 14 | V7  | 3    | 2+1 |
| Inner loop (pass 1) | 15 | V8  | 3    | 9÷3 |
| Inner loop (pass 1) | 16 | V11 | 15   | 3×5 |
| Inner loop (pass 1) | 17 | V6  | 8    | 9−1 |
| Inner loop (pass 1) | 18 | V7  | 4    | 3+1 |
| Inner loop (pass 1) | 19 | V9  | 2    | 8÷4 |
| Inner loop (pass 1) | 20 | V11 | 30   | 2×15 → A₂=30 |
| Inner loop (pass 1) | 21 | V12 | −1   | V22×V11 = (−1/30)×30 = B₃×A₂ |
| Inner loop (pass 1) | 22 | V13 | −19/33 | −1+14/33 = −33/33+14/33 |
| Inner loop (pass 1) | advance | V22 | 1/42  | V23 (= B₅) |
| Inner loop (pass 1) | advance | V23 | −1/30 | V24 (= B₇) |
| Inner loop (pass 2) | 13 | V6  | 7    | 8−1 |
| Inner loop (pass 2) | 14 | V7  | 5    | 4+1 |
| Inner loop (pass 2) | 15 | V8  | 7/5  | 7÷5 |
| Inner loop (pass 2) | 16 | V11 | 42   | (7/5)×30 |
| Inner loop (pass 2) | 17 | V6  | 6    | 7−1 |
| Inner loop (pass 2) | 18 | V7  | 6    | 5+1 |
| Inner loop (pass 2) | 19 | V9  | 1    | 6÷6 |
| Inner loop (pass 2) | 20 | V11 | 42   | 1×42 → A₃=42 |
| Inner loop (pass 2) | 21 | V12 | 1    | V22×V11 = (1/42)×42 = B₅×A₃ |
| Inner loop (pass 2) | 22 | V13 | 14/33 | 1+(−19/33) = 33/33−19/33 |
| Inner loop (pass 2) | advance | V22 | −1/30 | V23 (= B₇) |
| Inner loop (pass 2) | advance | V23 | −1/30 | V24 (= B₇) |
| Inner loop (pass 3) | 13 | V6  | 5    | 6−1 |
| Inner loop (pass 3) | 14 | V7  | 7    | 6+1 |
| Inner loop (pass 3) | 15 | V8  | 5/7  | 5÷7 |
| Inner loop (pass 3) | 16 | V11 | 30   | (5/7)×42 |
| Inner loop (pass 3) | 17 | V6  | 4    | 5−1 |
| Inner loop (pass 3) | 18 | V7  | 8    | 7+1 |
| Inner loop (pass 3) | 19 | V9  | 1/2  | 4÷8 |
| Inner loop (pass 3) | 20 | V11 | 15   | (1/2)×30 → A₄=15 |
| Inner loop (pass 3) | 21 | V12 | −1/2 | V22×V11 = (−1/30)×15 = B₇×A₄ |
| Inner loop (pass 3) | 22 | V13 | −5/66 | −1/2+14/33 = −33/66+28/66 |
| Inner loop (pass 3) | 23 | V10 | 0    | 1−1 → loop exits |
| Finalize | 24 | V25 | **5/66** | 0−(−5/66) |
| Finalize | 25 | V3  | 6    | advance n for next run |

**Result: B₉ = 5/66.** This value is written into V25.

---

### The Series Build-up

The four runs form a chain: each run reads Bernoulli numbers produced by its predecessors and writes one new value that the next run will read.

| Run | n | Loop passes | Bernoulli numbers read | Result written to |
|-----|---|-------------|------------------------|-------------------|
| 1st | 2 | 0 | B₁ = 1/6 only | V22 ← B₃ = −1/30 |
| 2nd | 3 | 1 | B₁ = 1/6, B₃ = −1/30 | V23 ← B₅ = 1/42 |
| 3rd | 4 | 2 | B₁ = 1/6, B₃ = −1/30, B₅ = 1/42 | V24 ← B₇ = −1/30 |
| 4th | 5 | 3 | B₁ = 1/6, B₃ = −1/30, B₅ = 1/42, B₇ = −1/30 | V25 ← B₉ = 5/66 |

This self-referential structure is precisely what makes Note G remarkable. The 25 operations are not a one-off calculation but a reusable program: the same barrel of cards, advanced from n=2 upward, produces every odd Bernoulli number in sequence. Ada made this explicit by labelling V21–V23 as "previously computed" values and by including Operation 25 — which increments V3 (i.e., n) — as the final step, so the Engine is left ready to begin the next computation immediately.

The complete four-run chain is implemented as an executable CLOOMC program in `simulator/cloomc/ada_note_g_series.cloomc`. It seeds only V21 = 1/6 by hand, then runs the 25-operation program for n=2, n=3, n=4, and n=5 in sequence. The result of each run is transferred into the next run's Store before execution begins, exactly mirroring the feed-forward structure described above. A scratch register (V20, outside Ada's original V1–V24 layout) holds the computed B₃ and is used to restore V22 before both the n=4 and n=5 runs, compensating for a CLOOMC loop-advance step at the end of each inner loop that would otherwise leave V22 pointing at the wrong Bernoulli number; this workaround is explained in the file header. Comments in the file tie each sub-invocation to the abbreviated traces in the sections above.

---

## Complete Step-by-Step Numerical Trace (n = 4)

This section carries every active variable forward through every execution step of the algorithm for n = 4 (computing B₇ = −1/30). Because Operations 13–23 form a loop that runs n − 2 = **2** times, the physical execution expands to 36 steps. Each row shows the full variable state **after** the named operation completes; unchanged variables retain their previous value.

**Pre-loaded initial state.** The following values are set before Operation 1 runs. V21, V22, and V23 hold previously computed Bernoulli numbers produced by the two earlier runs described above; they are read by this run but never overwritten.

| Variable | Value | Meaning |
|----------|-------|---------|
| V1  | 1      | Constant 1 |
| V2  | 2      | Constant 2 |
| V3  | 4      | n (for B₇) |
| V21 | 1/6    | B₁ (seed value, pre-loaded by hand) |
| V22 | −1/30  | B₃ (produced by the n=2 run — see abbreviated trace above) |
| V23 | 1/42   | B₅ (produced by the n=3 run — see abbreviated trace above) |
| V4–V13, V24 | 0 | Working columns, cleared |

---

### Trace Part A — V1 through V10

Each cell shows the value of that variable column after the operation in that row completes.

| Step | Op | V1 | V2 | V3 | V4 | V5 | V6 | V7 | V8 | V9 | V10 |
|------|----|----|----|----|----|----|----|----|----|----|-----|
| Init | —  | 1 | 2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1    | ×  | 1 | 2 | 4 | **8** | **8** | **8** | 0 | 0 | 0 | 0 |
| 2    | −  | 1 | 2 | 4 | **7** | 8 | 8 | 0 | 0 | 0 | 0 |
| 3    | +  | 1 | 2 | 4 | 7 | **9** | 8 | 0 | 0 | 0 | 0 |
| 4    | ÷  | 1 | 2 | 4 | 7 | 9 | 8 | 0 | 0 | 0 | 0 |
| 5    | ÷  | 1 | 2 | 4 | 7 | 9 | 8 | 0 | 0 | 0 | 0 |
| 6    | −  | 1 | 2 | 4 | 7 | 9 | 8 | 0 | 0 | 0 | 0 |
| 7    | −  | 1 | 2 | 4 | 7 | 9 | 8 | 0 | 0 | 0 | **3** |
| 8    | +  | 1 | 2 | 4 | 7 | 9 | 8 | **2** | 0 | 0 | 3 |
| 9    | ÷  | 1 | 2 | 4 | 7 | 9 | 8 | 2 | 0 | 0 | 3 |
| 10   | ×  | 1 | 2 | 4 | 7 | 9 | 8 | 2 | 0 | 0 | 3 |
| 11   | +  | 1 | 2 | 4 | 7 | 9 | 8 | 2 | 0 | 0 | 3 |
| 12   | −  | 1 | 2 | 4 | 7 | 9 | 8 | 2 | 0 | 0 | **2** |
| 13a  | −  | 1 | 2 | 4 | 7 | 9 | **7** | 2 | 0 | 0 | 2 |
| 14a  | +  | 1 | 2 | 4 | 7 | 9 | 7 | **3** | 0 | 0 | 2 |
| 15a  | ÷  | 1 | 2 | 4 | 7 | 9 | 7 | 3 | **7/3** | 0 | 2 |
| 16a  | ×  | 1 | 2 | 4 | 7 | 9 | 7 | 3 | 7/3 | 0 | 2 |
| 17a  | −  | 1 | 2 | 4 | 7 | 9 | **6** | 3 | 7/3 | 0 | 2 |
| 18a  | +  | 1 | 2 | 4 | 7 | 9 | 6 | **4** | 7/3 | 0 | 2 |
| 19a  | ÷  | 1 | 2 | 4 | 7 | 9 | 6 | 4 | 7/3 | **3/2** | 2 |
| 20a  | ×  | 1 | 2 | 4 | 7 | 9 | 6 | 4 | 7/3 | 3/2 | 2 |
| 21a  | ×  | 1 | 2 | 4 | 7 | 9 | 6 | 4 | 7/3 | 3/2 | 2 |
| 22a  | +  | 1 | 2 | 4 | 7 | 9 | 6 | 4 | 7/3 | 3/2 | 2 |
| 23a  | −  | 1 | 2 | 4 | 7 | 9 | 6 | 4 | 7/3 | 3/2 | **1** |
| 13b  | −  | 1 | 2 | 4 | 7 | 9 | **5** | 4 | 7/3 | 3/2 | 1 |
| 14b  | +  | 1 | 2 | 4 | 7 | 9 | 5 | **5** | 7/3 | 3/2 | 1 |
| 15b  | ÷  | 1 | 2 | 4 | 7 | 9 | 5 | 5 | **1** | 3/2 | 1 |
| 16b  | ×  | 1 | 2 | 4 | 7 | 9 | 5 | 5 | 1 | 3/2 | 1 |
| 17b  | −  | 1 | 2 | 4 | 7 | 9 | **4** | 5 | 1 | 3/2 | 1 |
| 18b  | +  | 1 | 2 | 4 | 7 | 9 | 4 | **6** | 1 | 3/2 | 1 |
| 19b  | ÷  | 1 | 2 | 4 | 7 | 9 | 4 | 6 | 1 | **2/3** | 1 |
| 20b  | ×  | 1 | 2 | 4 | 7 | 9 | 4 | 6 | 1 | 2/3 | 1 |
| 21b  | ×  | 1 | 2 | 4 | 7 | 9 | 4 | 6 | 1 | 2/3 | 1 |
| 22b  | +  | 1 | 2 | 4 | 7 | 9 | 4 | 6 | 1 | 2/3 | 1 |
| 23b  | −  | 1 | 2 | 4 | 7 | 9 | 4 | 6 | 1 | 2/3 | **0** |
| 24   | −  | 1 | 2 | 4 | 7 | 9 | 4 | 6 | 1 | 2/3 | 0 |
| 25   | +  | 1 | 2 | **5** | 7 | 9 | 4 | 6 | 1 | 2/3 | 0 |

Loop pass suffixes: **a** = first pass of the inner loop (V10: 2 → 1), **b** = second pass (V10: 1 → 0).

---

### Trace Part B — V11 through V24

V14 and V15 are not assigned by any of the 25 operations in Ada's original table, nor by the CLOOMC implementation in `ada_note_g.cloomc`. Both columns remain 0 throughout; they are included here for completeness of the V1–V15, V21–V24 range. (The low-level assembly rendering of the same program uses DR14 as a scratch register for multiply/divide subroutines, but that is an assembly implementation detail — see the "How to Verify" section below.)

| Step | Op | V11 | V12 | V13 | V14 | V15 | V21 | V22 | V23 | V24 |
|------|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| Init | —  | 0 | 0 | 0 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 1    | ×  | 0 | 0 | 0 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 2    | −  | 0 | 0 | 0 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 3    | +  | 0 | 0 | 0 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 4    | ÷  | **7/9** | 0 | 0 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 5    | ÷  | **7/18** | 0 | 0 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 6    | −  | 7/18 | 0 | **−7/18** | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 7    | −  | 7/18 | 0 | −7/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 8    | +  | 7/18 | 0 | −7/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 9    | ÷  | **4** | 0 | −7/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 10   | ×  | 4 | **2/3** | −7/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 11   | +  | 4 | 2/3 | **5/18** | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 12   | −  | 4 | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 13a  | −  | 4 | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 14a  | +  | 4 | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 15a  | ÷  | 4 | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 16a  | ×  | **28/3** | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 17a  | −  | 28/3 | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 18a  | +  | 28/3 | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 19a  | ÷  | 28/3 | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 20a  | ×  | **14** | 2/3 | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 21a  | ×  | 14 | **−7/15** | 5/18 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 22a  | +  | 14 | −7/15 | **−17/90** | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 23a  | −  | 14 | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 13b  | −  | 14 | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 14b  | +  | 14 | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 15b  | ÷  | 14 | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 16b  | ×  | **14** | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 17b  | −  | 14 | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 18b  | +  | 14 | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 19b  | ÷  | 14 | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 20b  | ×  | **28/3** | −7/15 | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 21b  | ×  | 28/3 | **2/9** | −17/90 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 22b  | +  | 28/3 | 2/9 | **1/30** | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 23b  | −  | 28/3 | 2/9 | 1/30 | 0 | 0 | 1/6 | −1/30 | 1/42 | 0 |
| 24   | −  | 28/3 | 2/9 | 1/30 | 0 | 0 | 1/6 | −1/30 | 1/42 | **−1/30** |
| 25   | +  | 28/3 | 2/9 | 1/30 | 0 | 0 | 1/6 | −1/30 | 1/42 | −1/30 |

**Arithmetic verification of key steps:**

- Op 4: V4 ÷ V5 = 7 ÷ 9 = **7/9** ✓ (Bromley correction; Ada's published version: 9 ÷ 7 = 9/7)
- Op 5: (7/9) ÷ 2 = **7/18** ✓
- Op 6: 0 − 7/18 = **−7/18** ✓ (A₀ = (2n−1) / (2(2n+1)) = 7/18)
- Op 9: 8 ÷ 2 = **4** ✓ (A₁ first factor)
- Op 10: (1/6) × 4 = **2/3** ✓ (B₁ × A₁, with B₁ = 1/6 from V21)
- Op 11: 2/3 − 7/18 = 12/18 − 7/18 = **5/18** ✓
- Op 16a: (7/3) × 4 = **28/3** ✓
- Op 20a: (3/2) × (28/3) = 84/6 = **14** ✓ (A₂ complete)
- Op 21a: (−1/30) × 14 = **−7/15** ✓ (B₂ × A₂, using V22 = −1/30)
- Op 22a: −7/15 + 5/18 = −42/90 + 25/90 = **−17/90** ✓
- Op 16b: 1 × 14 = **14** (V8 = 1, so unchanged from pass 1 result)
- Op 20b: (2/3) × 14 = **28/3** ✓ (A₃ complete)
- Op 21b: (1/42) × (28/3) = 28/126 = **2/9** ✓ (B₃ × A₃, using V23 = 1/42)
- Op 22b: 2/9 − 17/90 = 20/90 − 17/90 = **1/30** ✓
- Op 24: 0 − 1/30 = **−1/30** ✓

**Correspondence with `simulator/cloomc/ada_note_g.cloomc`.** The CLOOMC implementation follows this trace directly. The key correspondences are:

- **Op 4** uses `let V11 = V4 / V5` (Bromley correction; V4 = 7, V5 = 9, result = 7/9).
- **Op 10** uses `let V12 = V21 * V11` (V21 = 1/6 = B₁), producing V12 = 2/3.
- **Op 21** uses `let V12 = V22 * V11`, where V22 = −1/30 (B₃) on the first loop pass and V22 = 1/42 (B₅) on the second, after the `let V22 = V23` advancement step at the end of each pass.
- **Op 24** uses `let V24 = 0; let V24 = V24 - V13`, writing the final result to V24 = −1/30.

The trace tables above are the canonical 25-operation Ada trace; they contain exactly Ada's operations and nothing else. The CLOOMC adds one auxiliary statement (`let V22 = V23`) inside the loop body after Op 22, purely for loop encoding: it advances the Bk register so the next iteration reads the correct Bernoulli number, replacing Ada's hand-written column variation. This statement is not part of Ada's 25 operations and does not alter any of the V1–V24 values listed in the trace rows; it only repositions V22 for the following iteration.

---

### Bug Propagation Table — Published vs Corrected (Ops 4–22)

Operation 4 is where the two execution paths diverge. The error introduced by the swapped operands propagates exclusively through V11 (Ops 4–5) and V13 (Ops 6–22); all other variables (V1–V10, V12, V14, V15, V21–V24) are identical in both paths throughout the entire execution.

The table below traces every step between Op 4 and Op 22 where V11 or V13 differ. Steps within that range that are not listed produce the same value in both versions (Ops 7, 8, 10, 12–21 first and second pass, 23). Op 24 is included to show the final divergent result propagated into V24.

| Step | Op | V11 (published — bug) | V11 (corrected) | V13 (published — bug) | V13 (corrected) |
|------|----|-----------------------|-----------------|-----------------------|-----------------|
| 4    | ÷  | **9/7** (= V5 ÷ V4)  | **7/9** (= V4 ÷ V5) | 0 | 0 |
| 5    | ÷  | **9/14**              | **7/18**        | 0 | 0 |
| 6    | −  | 9/14                  | 7/18            | **−9/14**             | **−7/18** |
| 9    | ÷  | **4** (same; reset from V6/V7) | **4** | −9/14 | −7/18 |
| 11   | +  | 4 | 4 | **1/42** | **5/18** |
| 22a  | +  | 14 | 14 | **−31/70** | **−17/90** |
| 22b  | +  | 28/3 | 28/3 | **−139/630** | **1/30** |
| 24   | −  | 28/3 | 28/3 | −139/630 | 1/30 |

**V24 results:** published (buggy) → **139/630 ≈ 0.2206**, corrected → **−1/30 ≈ −0.0333**

**Key observations:**

1. After Op 9 resets V11 by computing V6 ÷ V7 = 8 ÷ 2 = 4 from scratch, the V11 streams **converge** — V11 carries the same value in both versions from Op 9 onward. The bug does not affect any of the Aₖ coefficient arithmetic in Ops 13–20.
2. V13 (the accumulator) **diverges permanently** at Op 6 and remains wrong through every step from Op 6 to Op 22, including both loop passes. The wrong A₀ seed (−9/14 instead of −7/18) shifts every subsequent partial sum.
3. Op 11 (bug): 2/3 + (−9/14) = 28/42 − 27/42 = **1/42** — a coincidence that happens to equal B₅ = 1/42, which could mislead a reader checking intermediate values against known Bernoulli numbers.
4. The final buggy answer, 139/630, is not a recognisable fraction and bears no algebraic relationship to B₇ = −1/30. There is no sense in which the published program "almost" works; the error is categorical.

> **Simulator cross-reference.** The buggy path in this table is executable. Load `simulator/cloomc/ada_note_g_published_bug.cloomc` in the Church Machine IDE and run it to completion. DR24 will read **139/630** — confirming every row of the "V13 (published — bug)" column above. Compare with `ada_note_g.cloomc`, where DR24 reads **−1/30**. See §"Buggy-Path Simulator Variant" below for step-by-step instructions.

---

### Bug Propagation Table — n=2 (computing B₃)

For n=2 the inner loop does not execute (n−2 = 0 passes), so the error introduced by Op 4 has only one opportunity to poison the accumulator: through Op 6 setting V13 to a wrong A₀ seed, which is then shifted once more at Op 11 and carried directly into Op 24.

**Key values for n=2:** V4 = 3 (2n−1), V5 = 5 (2n+1), V6 = 4 (2n).

| Step | Op | V11 (published — bug) | V11 (corrected) | V13 (published — bug) | V13 (corrected) |
|------|----|-----------------------|-----------------|-----------------------|-----------------|
| 4    | ÷  | **5/3** (= V5 ÷ V4)  | **3/5** (= V4 ÷ V5) | 0 | 0 |
| 5    | ÷  | **5/6**              | **3/10**        | 0 | 0 |
| 6    | −  | 5/6                  | 3/10            | **−5/6**              | **−3/10** |
| 9    | ÷  | **2** (same; reset from V6 ÷ V7 = 4 ÷ 2) | **2** | −5/6 | −3/10 |
| 11   | +  | 2 | 2 | **−1/2**              | **1/30** |
| 24   | −  | 2 | 2 | −1/2 | 1/30 |

**V24 results:** published (buggy) → **1/2 = 0.5000**, corrected → **−1/30 ≈ −0.0333**

**Key observations for n=2:**

1. V11 converges at Op 9 for the same reason as in the n=4 run: Op 9 computes V6 ÷ V7 = 4 ÷ 2 = 2 from scratch, discarding the wrong Op 4 quotient entirely.
2. V13 diverges at Op 6 and, with no loop passes to accumulate further terms, the single Op 11 shift is the only additional propagation step. The buggy A₀ seed (−5/6 instead of −3/10) is the entirety of the error.
3. The buggy answer, 1/2, is a recognisable fraction — unlike the n=4 buggy result of 139/630 — which makes it subtly more dangerous as a false intermediate value. A reader who happened to check V24 after a buggy n=2 run might not immediately notice that 1/2 is wrong; −1/30 is a far less intuitive expectation.

---

### Bug Propagation Table — n=3 (computing B₅)

For n=3 the inner loop runs exactly once (n−2 = 1 pass). The bug still seeds V13 with a wrong A₀ at Op 6; the single loop pass then adds a B₃ × A₂ term onto the corrupted accumulator rather than onto the correct partial sum.

**Key values for n=3:** V4 = 5 (2n−1), V5 = 7 (2n+1), V6 = 6 (2n). V22 = −1/30 (B₃, pre-loaded from the n=2 run).

| Step | Op | V11 (published — bug) | V11 (corrected) | V13 (published — bug) | V13 (corrected) |
|------|----|-----------------------|-----------------|-----------------------|-----------------|
| 4    | ÷  | **7/5** (= V5 ÷ V4)  | **5/7** (= V4 ÷ V5) | 0 | 0 |
| 5    | ÷  | **7/10**             | **5/14**        | 0 | 0 |
| 6    | −  | 7/10                 | 5/14            | **−7/10**             | **−5/14** |
| 9    | ÷  | **3** (same; reset from V6 ÷ V7 = 6 ÷ 2) | **3** | −7/10 | −5/14 |
| 11   | +  | 3 | 3 | **−1/5**              | **1/7** |
| 22 (pass 1) | + | 5 | 5 | **−11/30**        | **−1/42** |
| 24   | −  | 5 | 5 | −11/30 | −1/42 |

**V24 results:** published (buggy) → **11/30 ≈ 0.3667**, corrected → **1/42 ≈ 0.0238**

**Arithmetic verification of the divergent steps:**

- Op 4 (buggy): V5 ÷ V4 = 7 ÷ 5 = **7/5**; corrected: 5 ÷ 7 = **5/7**
- Op 11 (buggy): 1/2 + (−7/10) = 5/10 − 7/10 = **−1/5**; corrected: 1/2 − 5/14 = 7/14 − 5/14 = **1/7**
- Op 21 (pass 1): V22 × V11 = (−1/30) × 5 = **−1/6** — *identical in both versions*, because V11 was fully reset by Ops 13–20 and V22 is unchanged
- Op 22 (buggy, pass 1): −1/6 + (−1/5) = −5/30 − 6/30 = **−11/30**; corrected: −1/6 + 1/7 = −7/42 + 6/42 = **−1/42**

**Key observations for n=3:**

1. As in the n=4 case, V11 converges at Op 9 and remains identical in both versions through the entire inner loop (Ops 13–20 recompute V11 from V6 and V7, which are unaffected by Op 4).
2. V13 diverges at Op 6 and stays wrong through Op 22 of the loop pass. Crucially, Op 21 adds the same B₃ × A₂ term (−1/6) to both the buggy and corrected V13 — the loop arithmetic itself is correct; it is simply applied to an already-corrupted accumulator.
3. The buggy answer, 11/30, has no algebraic relationship to B₅ = 1/42.

---

### Connecting the Three Bug Tables — Cascade into the n=4 Run

The three bug-propagation tables share a common structure that reflects the algorithm's design:

| Run | n | V11 bug (Op 4) | V11 convergence | Buggy V13 seed (Op 6) | Correct V13 seed | Buggy V24 | Correct V24 |
|-----|---|----------------|-----------------|------------------------|------------------|-----------|-------------|
| 1st | 2 | 5/3 vs 3/5 | Op 9 (resets to 2) | −5/6 | −3/10 | **1/2** | **−1/30** |
| 2nd | 3 | 7/5 vs 5/7 | Op 9 (resets to 3) | −7/10 | −5/14 | **11/30** | **1/42** |
| 3rd | 4 | 9/7 vs 7/9 | Op 9 (resets to 4) | −9/14 | −7/18 | **139/630** | **−1/30** |

In every run the Op 4 error follows the same path: it corrupts V11 for exactly two steps (Ops 4 and 5), corrupts V13 permanently from Op 6 onward, and then vanishes from V11 when Op 9 recomputes it from V6 and V7. The inner loop arithmetic (Ops 13–20 and Op 21) is identical in both versions in every run, because by the time the loop begins, V11 has been fully corrected and V22 is unaltered. The error lives entirely in the running accumulator V13 from Op 6 to Op 24.

**Does a buggy earlier run cascade into later runs?** Yes, directly. The n=4 run reads V22 = B₃ and V23 = B₅ as pre-loaded constants. If both earlier runs were executed with the published (buggy) Op 4, those slots would contain 1/2 (instead of −1/30) and 11/30 (instead of 1/42) respectively. The n=4 inner loop then computes B₃ × A₂ and B₅ × A₃ using these wrong values: at Op 21a it would multiply 1/2 × 14 = 7 instead of the correct (−1/30) × 14 = −7/15, and at Op 21b it would multiply 11/30 × (28/3) = 308/90 = 154/45 instead of the correct (1/42) × (28/3) = 2/9. The n=4 accumulator would diverge at Op 22a even further from −1/30 than it already does from the Op 4 bug alone. The bugs compound multiplicatively rather than additively, since each wrong Bₖ is scaled by its Aₖ coefficient before entering the sum. In practice the published program, run end-to-end from n=2 through n=4 with Ada's Op 4 as printed, would produce three successive wrong answers — none of them recognisable as Bernoulli numbers.

---

## Connection to the CLOOMC Implementation

The Church Machine simulator includes a working implementation of Ada's Note G algorithm in `simulator/cloomc/ada_note_g.cloomc`. That implementation incorporates the Bromley correction: Operation 4 is written as

```
let V11 = V4 / V5
```

dividing V4 (2n−1) by V5 (2n+1), in the correct order. A comment in the source explicitly flags the discrepancy with Ada's published table:

```
-- NOTE: Ada's published table shows V5/V4 — CORRECTED per Bromley (1990)
```

The variable mapping follows Ada's original exactly: V24 receives the final result, and V21–V23 are pre-loaded with B₁ = 1/6, B₃ = −1/30, B₅ = 1/42 respectively. Operation 10 reads `V21 * V11` for the B₁ × A₁ term; inside the loop, Operation 21 reads `V22 * V11` and the loop body advances V22 ← V23 before each subsequent pass, so B₃ is used on the first loop iteration and B₅ on the second — matching Ada's manually notated column advancement in the original diagram.

The CLOOMC program is written in the Church Machine's Symbolic Mathematics front-end, which maps naturally to the Analytical Engine's one-operation-per-step model: each line corresponds to one row of Ada's table, with each intermediate result explicitly named.

For production use, `SlideRule.Bernoulli(n)` computes any Bernoulli number in a single CALL instruction. The `ada_note_g.cloomc` program exists to preserve Ada's algorithm for historical fidelity — a direct operational translation of the 1843 table into a language the Church Machine can execute, with the one correction that Bromley determined the original required.

---

## How to Verify This Trace Using the CLOOMC Simulator

The trace tables above are hand-computed and analytically verified. This section shows how to run the same computation in the Church Machine simulator and cross-check each trace row against the live register state.

> **CLOOMC vs assembly — rational vs integer arithmetic.**
> The IDE's Code view offers two presets for Ada's Note G:
>
> * **CLOOMC preset** (`ada_note_g.cloomc`, loaded when the editor is in CLOOMC mode) — compiles to *rational-arithmetic* bytecode. Every division produces an exact fraction: Op 4 yields **7/9**, Op 5 yields **7/18**, and the final result in DR24 is **−1/30**. This is the preset described throughout this section.
> * **Assembly preset** (`ada_note_g` in the assembly examples, loaded when the editor is in assembly/raw mode) — runs on the Church Machine's integer-only register file. Division discards the remainder (truncates toward zero). As a result, Op 4 computes **7 ÷ 9 = 0**, every subsequent coefficient is also 0, and DR15 (the assembly rendering's result register) ends at **0**, not −1/30. This is not a defect; it is the expected behaviour of a machine with no rational-number support. The assembly listing demonstrates Ada's 25-operation structure on real Church Machine opcodes, not fractional arithmetic.
>
> All intermediate values, checkpoints, and expected register contents in this "How to Verify" section refer exclusively to the **CLOOMC preset**.

### Loading the Program

1. Open the Church Machine IDE.
2. Click the **Code** tab in the toolbar.
3. Click the **Ada Note G** preset tab (labelled "Ada Note G" in the example row). This loads `simulator/cloomc/ada_note_g.cloomc` directly. Alternatively, paste the contents of that file into the editor.
4. Click **Assemble**. The status bar should confirm a successful compilation with no errors and report the number of assembled words.
5. Click **Run** (or **Run to HALT**) to execute the program to completion. The simulator halts on the `halt` instruction at the end of `compute()`.

The CLOOMC Symbolic Mathematics front-end compiles to rational-arithmetic bytecode. All intermediate results are exact fractions — no floating-point rounding occurs at any step.

### Console Output

When the run completes without faults, the simulator's console area shows a single status line:

```
Boot complete. Ran N steps. Done.
```

where *N* is the total instruction count (the exact number varies with the CLOOMC compiler version). If the console instead shows `Faulted.`, a security or arithmetic fault occurred — check the fault log in the Dashboard view. If it shows `Max steps reached`, the loop did not terminate, which indicates a coding error in the loop counter logic.

The IDE automatically switches to the **Dashboard** view on clean completion, where the register values can be read directly.

### Expected State at HALT

When the program halts, open the **Dashboard** view and inspect the data registers. The key values, matched to the final row of each trace section, are:

| Variable | Dashboard register | Expected value | Trace row |
|----------|--------------------|---------------|-----------|
| V10 | DR10 | **0** | Step 23b — loop counter exhausted after 2 passes |
| V13 | DR13 | **1/30** | Step 22b — accumulated sum before negation |
| V24 | DR24 | **−1/30** | Step 24 — final result B₇ |
| V3  | DR3  | **5** | Step 25 — n incremented ready for B₉ |

V24 = −1/30 is the result Ada computed on paper in Note G. Any other value in DR24 indicates either a wrong Op 4 operand order (if the result is ≈ 139/630, the Bromley bug is present) or a coding error elsewhere.

### Checking Intermediate Steps

To verify individual trace rows, use the **Step** button or set a breakpoint after any single `let` statement. The following checkpoints correspond to key rows in the trace tables:

| After executing… | Check | Expected | Trace row |
|------------------|-------|----------|-----------|
| Op 4 (`let V11 = V4 / V5`) | DR11 | **7/9** | Step 4, Part B |
| Op 5 (`let V11 = V11 / V2`) | DR11 | **7/18** | Step 5, Part B |
| Op 6 (`let V13 = V13 - V11`) | DR13 | **−7/18** | Step 6, Part B |
| Op 9 (`let V11 = V6 / V7`) | DR11 | **4** | Step 9, Part B |
| Op 10 (`let V12 = V21 * V11`) | DR12 | **2/3** | Step 10, Part B |
| Op 11 (`let V13 = V12 + V13`) | DR13 | **5/18** | Step 11, Part B |
| Op 16a (`let V11 = V8 * V11`, 1st loop pass) | DR11 | **28/3** | Step 16a, Part B |
| Op 20a (`let V11 = V9 * V11`, 1st loop pass) | DR11 | **14** | Step 20a, Part B |
| Op 21a (`let V12 = V22 * V11`, 1st loop pass) | DR12 | **−7/15** | Step 21a, Part B |
| Op 22a (`let V13 = V12 + V13`, 1st loop pass) | DR13 | **−17/90** | Step 22a, Part B |
| Op 21b (`let V12 = V22 * V11`, 2nd loop pass) | DR12 | **2/9** | Step 21b, Part B |
| Op 22b (`let V13 = V12 + V13`, 2nd loop pass) | DR13 | **1/30** | Step 22b, Part B |
| Op 24 (`let V24 = V24 - V13`) | DR24 | **−1/30** | Step 24, Part B |

### Note on Variable Numbering: V15 and the Assembly Rendering

The trace table caption in Part B notes that "V15 is used as a scratch register only in the CLOOMC implementation." That remark was written against an earlier draft of the implementation and no longer applies to the current file. **`ada_note_g.cloomc` does not assign V15.** DR15 (= V15 in Ada's numbering) remains 0 throughout the entire execution, exactly as shown in the trace table column.

The source of the confusion is the low-level assembly rendering of the same algorithm, which appears as the `ada_note_g` preset in the IDE's **Code** view when the editor is in assembly mode. That rendering maps Ada's 25 operations onto raw Church Machine instructions using integer arithmetic, and it requires an extra scratch register — **DR14** — for the multiply and divide subroutine loops (since the Church Machine has no MUL or DIV opcodes; multiplication and division are done by repeated IADD/ISUB). In that assembly rendering:

- **DR14** = scratch loop counter for the multiply/divide subroutines (no Ada equivalent; purely an implementation artefact)
- **DR15** = the final result, corresponding to Ada's **V24**

The DRn registers in the assembly rendering do not follow Ada's V-numbering beyond DR1–DR13. DR14 and DR15 are an artefact of fitting Ada's 25 operations plus the necessary multiply/divide loops into the machine's 16-register file. The CLOOMC symbolic front-end hides this entirely: it uses Ada's V-names directly and compiles to rational arithmetic, so V24 receives the final result with no V15 involvement at any point.

**Summary:** when running `ada_note_g.cloomc` in the CLOOMC simulator, ignore DR15 — it is always 0. The result is in **DR24** (= V24), matching Ada's original diagram.

---

## Buggy-Path Simulator Variant

The file `simulator/cloomc/ada_note_g_published_bug.cloomc` is an executable companion to the Bug Propagation Table above. It is structurally identical to `ada_note_g.cloomc` except that **Operation 4 retains Ada's published operand order** (`let V11 = V5 / V4` instead of the Bromley-corrected `let V11 = V4 / V5`). Every other operation is unchanged.

Running this file lets you observe the wrong result directly in the simulator and verify each row of the Bug Propagation Table against live register values.

### Loading and Running the Buggy Variant

1. Open the Church Machine IDE.
2. Click the **Code** tab in the toolbar.
3. Click the **Ada: Note G — Published Bug** preset button. This loads `ada_note_g_published_bug.cloomc` directly into the editor with one click — no manual copy-paste required.
4. Click **Assemble**. The status bar should confirm successful compilation with no errors.
5. Click **Run** (or **Run to HALT**) to execute to completion.

### Expected State at HALT — Buggy Version

When the program halts, open the **Dashboard** view. The registers that diverge from the corrected run are:

| Variable | Dashboard register | Buggy value | Corrected value | Bug Propagation Table row |
|----------|--------------------|-------------|-----------------|---------------------------|
| V11 (after Op 4) | DR11 | **9/7** | 7/9 | Step 4 |
| V11 (after Op 5) | DR11 | **9/14** | 7/18 | Step 5 |
| V13 (after Op 6) | DR13 | **−9/14** | −7/18 | Step 6 |
| V13 (after Op 11) | DR13 | **1/42** | 5/18 | Step 11 |
| V13 (after Op 22a) | DR13 | **−31/70** | −17/90 | Step 22a |
| V13 (after Op 22b) | DR13 | **−139/630** | 1/30 | Step 22b |
| V24 (final) | DR24 | **139/630** | −1/30 | Step 24 |

DR24 = 139/630 ≈ 0.2206 confirms that Ada's published table, executed literally, would not have produced the correct Bernoulli number. All other registers — DR1–DR10, DR12, DR21–DR23 — are identical to the corrected run; the bug propagates exclusively through DR11 (Ops 4–8) and DR13 (Ops 6–24).

### Intermediate Checkpoints — Buggy Version

To step through the divergence interactively, set breakpoints after the following statements:

| After executing… | Check | Expected (buggy) | Correct value |
|------------------|-------|-------------------|---------------|
| Op 4 (`let V11 = V5 / V4`) | DR11 | **9/7** | 7/9 |
| Op 5 (`let V11 = V11 / V2`) | DR11 | **9/14** | 7/18 |
| Op 6 (`let V13 = V13 - V11`) | DR13 | **−9/14** | −7/18 |
| Op 11 (`let V13 = V12 + V13`) | DR13 | **1/42** | 5/18 |
| Op 22a (1st loop pass) | DR13 | **−31/70** | −17/90 |
| Op 22b (2nd loop pass) | DR13 | **−139/630** | 1/30 |
| Op 24 (`let V24 = V24 - V13`) | DR24 | **139/630** | −1/30 |

Note that Op 9 resets DR11 from V6/V7 = 8/2 = 4 in both versions, so the divergence in DR11 is confined to Ops 4–8. From Op 9 onward the Aₖ coefficient arithmetic proceeds identically; only the accumulated sum in DR13 remains wrong.

---

*Sources:*
*Ada Lovelace, "Notes by the Translator" (Note G), in L.F. Menabrea, "Sketch of The Analytical Engine Invented by Charles Babbage, Esq.," translated with notes by Ada Augusta, Countess of Lovelace, Taylor's Scientific Memoirs, Vol. III, August 1843.*
*Allan G. Bromley, "Babbage's Analytical Engine Plans 28 and 28a — the Programmable Mill," IEEE Annals of the History of Computing, Vol. 12, No. 3, 1990.*
