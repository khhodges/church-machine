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

### The Series Build-up

The three runs form a chain: each run reads Bernoulli numbers produced by its predecessors and writes one new value that the next run will read.

| Run | n | Loop passes | Bernoulli numbers read | Result written to |
|-----|---|-------------|------------------------|-------------------|
| 1st | 2 | 0 | B₁ = 1/6 only | V22 ← B₃ = −1/30 |
| 2nd | 3 | 1 | B₁ = 1/6, B₃ = −1/30 | V23 ← B₅ = 1/42 |
| 3rd | 4 | 2 | B₁ = 1/6, B₃ = −1/30, B₅ = 1/42 | V24 ← B₇ = −1/30 |

This self-referential structure is precisely what makes Note G remarkable. The 25 operations are not a one-off calculation but a reusable program: the same barrel of cards, advanced from n=2 upward, produces every odd Bernoulli number in sequence. Ada made this explicit by labelling V21–V23 as "previously computed" values and by including Operation 25 — which increments V3 (i.e., n) — as the final step, so the Engine is left ready to begin the next computation immediately.

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

V14 and V15 are not assigned by any of the 25 operations in Ada's original table (V15 is used as a scratch register only in the CLOOMC implementation, not in Ada's published diagram). Both columns remain 0 throughout; they are included here for completeness of the V1–V15, V21–V24 range.

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

*Sources:*
*Ada Lovelace, "Notes by the Translator" (Note G), in L.F. Menabrea, "Sketch of The Analytical Engine Invented by Charles Babbage, Esq.," translated with notes by Ada Augusta, Countess of Lovelace, Taylor's Scientific Memoirs, Vol. III, August 1843.*
*Allan G. Bromley, "Babbage's Analytical Engine Plans 28 and 28a — the Programmable Mill," IEEE Annals of the History of Computing, Vol. 12, No. 3, 1990.*
