# Flexibility and Decisions

> **DESIGN RATIONALE / NOT SECURITY EVIDENCE.** Statements about inherited
> guarantees or impossible failures are architectural goals, not formal proof of
> the shipped system.

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

## Why Constraints Are a Feature, Not a Bug

---

## 1. The Paradox of Total Freedom

The von Neumann architecture gives you absolute flexibility. Every bit in memory is the same. Instructions and data are the same. A pointer can aim anywhere. A program can overwrite itself, rewrite its own instructions, or treat a floating-point number as a jump address. There are no rules.

This is presented as a strength. It is, in fact, the root cause of most of the problems in computing.

When everything is permitted, nothing is decided. And when nothing is decided, every decision is deferred to the programmer, at runtime, forever. The result is not freedom — it is permanent ambiguity. The system never knows what anything *is*, because anything can be anything.

---

## 2. Three Worlds That Demand Early Decisions

Consider three engineering disciplines:

### 2.1 Chip Pinout Design

When you design an FPGA board — say the Wukong A7 XC7A100T with its FPGA package — you must commit to a pinout. Pin A3 is UART TX. Pin B7 is SPI MOSI. Pin C12 is an LED. These decisions are made before a single line of RTL is written, and they are permanent. The PCB is manufactured around them. The connector is soldered. The test jig is built.

This feels painful. You agonise over whether JTAG needs five pins or four. You wonder if you have allocated enough GPIO for future expansion. You make the decision anyway, because the alternative — leaving it undefined — means you cannot build the board at all.

The result: every engineer who touches the board knows exactly what each pin does. The datasheet is unambiguous. The test procedure is deterministic. The constraint *creates* clarity.

### 2.2 CLOOMC Abstraction APIs

When you define a Church Machine abstraction — a SlideRule, a Registry, a Tunnel — you must commit to an API. The abstraction exposes a fixed number of entry points in its c-list. Entry 0 does one thing. Entry 1 does another. The types of the arguments are fixed. The permissions required are fixed. This is declared before the first line of code is compiled.

Again, this feels restrictive. What if you want to add a method later? What if the interface is wrong? The answer is: you create a new version with a new seal. The old version continues to work unchanged. The constraint forces you to think about the interface *before* you build the implementation, and it forces you to version explicitly rather than silently mutating.

### 2.3 Von Neumann Binary Code

When you write a C program on a conventional computer, you decide almost nothing up front. The function signature is a suggestion, not a contract — a caller can cast the pointer and pass whatever they like. The memory layout is decided by the linker and the allocator, neither of which the programmer controls. The distinction between "code" and "data" is a convention that the hardware does not enforce. A buffer overflow can redirect execution anywhere.

The flexibility is total. The cost is paid later — in debugging, in security patches, in CVEs, in undefined behaviour, in sixty years of escalating complexity to paper over the lack of early decisions.

---

## 3. The Decision Cost Curve

There is a curve that every engineering discipline understands but software has largely ignored:

```
Cost to fix a decision
│
│  ╲
│   ╲
│    ╲      Hardware / CLOOMC
│     ╲╲
│       ╲╲
│         ╲╲_______________
│
│                          ╱╱
│                       ╱╱
│                    ╱╱
│    ___________╱╱     Von Neumann software
│
└──────────────────────────────────────────
  Design    Build    Ship    Maintain
```

In hardware and in capability-secured abstractions, the cost of a decision is highest at design time and drops sharply after that. You pay up front, and then you reap the benefit forever. A pinout, once correct, never causes a field failure. An abstraction API, once sealed, never suffers a type confusion vulnerability.

In von Neumann software, the curve is inverted. Decisions are cheap to make (or avoid) at design time — you just write code and see what happens. But the cost of those non-decisions compounds over time. A missing bounds check costs nothing to skip today and a billion dollars to deal with when it becomes a zero-day exploit ten years later.

---

## 4. What Gets Decided Early

The table below lists decisions that are made early in constrained systems and deferred (or never made) in unconstrained ones:

| Decision | Chip Pinout | CLOOMC Abstraction | Von Neumann |
|----------|------------|-------------------|-------------|
| What is the interface? | Pin assignment table | C-list entry points | Header file (advisory) |
| What are the types? | Voltage levels, protocols | GT permissions, seal | Cast to `void*` |
| What is the boundary? | Package edge | Lump boundary (limit17) | Process boundary (advisory) |
| Who can access what? | Physical wiring | Capability tokens (R0 perms) | ACL (bypassable) |
| What happens on violation? | Electrical fault (immediate) | Hardware trap (immediate) | Undefined behaviour (silent) |
| Can the interface change? | New board revision | New version, new seal | Recompile and hope |

The pattern is clear. In the constrained systems, every row has a definitive answer that is enforced mechanically. In von Neumann, every row has a convention that is enforced by human discipline — which is to say, not enforced at all.

---

## 5. Concrete Example: Adding a Feature

Suppose you want to add a "square root" operation to a mathematical service.

### 5.1 Chip Pinout Analogy

You designed a board with an ALU that has 4-bit opcode pins. Opcodes 0–7 are assigned. You want to add SQRT as opcode 8. You check: do the pins exist? Yes — 4 bits gives you 16 opcodes, and you have used 8. You assign opcode 8 = SQRT, update the datasheet, and every user of the board knows exactly how to invoke it. The existing opcodes are unchanged. The new opcode is unambiguous.

### 5.2 CLOOMC Abstraction

You have a SlideRule abstraction with c-list entries 0–4 (Add, Sub, Mul, Div, Pow2). You want to add Sqrt. You create a new version of the abstraction with 6 entries. The old version (seal X) still exists and still works. The new version (seal Y) has Sqrt at entry 5. Any code holding a GT to the old version sees exactly the same interface it always did. Any code that needs Sqrt must explicitly acquire a GT to the new version. There is no ambiguity, no silent breakage, no "DLL hell."

### 5.3 Von Neumann

You add a `sqrt()` function to a shared library. Existing callers are not recompiled. Some callers link dynamically and get the new version automatically — but the new version has a different struct layout for the return type, so they crash. Other callers link statically and never see the change. The build system resolves the conflict differently on different platforms. A security patch for `sqrt()` is deployed to some systems but not others. Six months later, a CVE is filed because an attacker discovered that the old calling convention can be exploited to redirect execution.

---

## 6. The Naming Convention as Microcosm

Even naming conventions illustrate this principle. The Church Machine project recently adopted the R0–R3 / W0–W2 convention:

- **R0–R3**: The four 32-bit words of a Capability Register (CR)
- **W0–W2**: The three 32-bit words of a Namespace (NS) entry

This is a small, early decision. It cost a few hours of systematic renaming. But the payoff is permanent: every document, every diagram, every line of code now uses the same vocabulary. "R3" always means the CR seal word. "W1" always means the NS entry's flags-and-limit word. There is no ambiguity. A student reading the handbook six months from now will never wonder whether "word2" means the third word of a CR or the third word of an NS entry, because the question cannot arise.

Von Neumann systems rarely make this kind of decision. Variables are named `temp`, `data`, `buf`, `ptr`. The same struct field means different things in different files. The ambiguity is small in each instance and catastrophic in aggregate.

---

## 7. Why the Loss of Flexibility Is the Point

The objection to early decisions is always the same: "But what if we are wrong?" This is a legitimate concern, and the answer has two parts.

**First:** being wrong early is cheap. A pinout can be revised in the next board spin. An abstraction API can be versioned with a new seal. The cost is bounded and visible. Being wrong late — discovering at deployment that your memory model permits type confusion — is unbounded and often invisible until it is exploited.

**Second:** the act of making the decision forces you to understand the problem. When you must commit to a c-list layout, you must understand what operations the abstraction needs to support. When you must commit to a pinout, you must understand what peripherals the system needs. The decision is not just a constraint on the implementation — it is a forcing function on the design. It prevents you from building something you do not understand.

Von Neumann's gift of total flexibility is, in practice, permission to build things you do not understand and discover the consequences later. The history of computing is largely the history of those consequences.

---

## 8. Development Timelines

The counterintuitive result: constrained systems are faster to develop.

This seems impossible. Surely more decisions means more work? But the work of making decisions is front-loaded and finite. The work of living without decisions is back-loaded and infinite.

A Church Machine abstraction, once its API is defined, can be implemented, tested, sealed, and deployed in a predictable number of steps. The compiler checks the c-list layout against the source. The hardware checks every memory access against the capability. The seal prevents tampering. There is a clear path from "design" to "done," because "done" has a mechanical definition: the sealed abstraction passes its test suite and the hardware enforces its boundaries.

A von Neumann program is never done. It can always be broken by a new input, a new platform, a new compiler optimisation, a new attacker technique. It is "done" only by social convention — someone decides to stop working on it. The security boundary is a hope, not a mechanism. The test suite covers the cases someone thought of, not the cases an attacker will think of.

The difference in timelines is not marginal. It is the difference between engineering and improvisation.

---

## 9. The Cost Tends to Zero

This is the most important consequence of all, and it is provable mathematically.

A sealed CLOOMC abstraction is a *proof*. Not a proof in the informal sense — "we tested it and it seems to work" — but a proof in the mathematical sense. The hardware enforces the preconditions (capability permissions in R0), the postconditions (bounded memory via limit17), and the isolation (no access without a GT). Once the abstraction is sealed and its behaviour is verified against its interface, the proof is complete. It does not expire. It does not degrade. It does not depend on the goodwill of future programmers.

Ada Lovelace understood this in 1843. Her Notes on Babbage's Analytical Engine are the first published algorithm — and they are still correct. Not "correct for their time." Correct. The mathematical reasoning she applied to Bernoulli numbers has not been patched, has not been refactored, has not been the subject of a CVE. She had no IDE, no version control, no test framework, no CI pipeline. She had rigorous mathematical thinking applied to a machine with well-defined constraints. That was enough. It has been enough for 183 years.

This is what the constrained model gives you: *software that participates in mathematical proof rather than resisting it.*

Consider what happens to development cost over time in both models:

**Von Neumann:** Each new program starts from scratch. It inherits no guarantees from the platform. The operating system provides services but not safety — a correct program can be subverted by a buffer overflow in a library it did not write. The cost of the next program is the cost of writing it *plus* the cost of defending it against everything else on the machine. This cost never decreases. It increases, because the attack surface grows with every line of code added to the ecosystem.

**CLOOMC:** Each new abstraction inherits the guarantees of the platform. The hardware enforces memory isolation. The namespace enforces access control. The seal enforces integrity. A correctly sealed abstraction cannot be subverted by a bug in another abstraction — the hardware will trap before the violation reaches it. The cost of the next abstraction is the cost of writing *it*, and only it. The platform's guarantees are not re-earned; they are inherited. And every correct abstraction becomes part of the platform's library, available to the next developer at zero marginal cost.

The cost curve is:

```
Development cost per abstraction
│
│  ╲ ╲ ╲ ╲              Von Neumann
│   ╲  ╲  ╲  ╲          (constant or rising)
│    ╲   ╲   ╲   ╲
│─────╲────╲────╲────╲──────────────
│
│  ╲
│   ╲
│    ╲╲
│      ╲╲╲_______________   CLOOMC
│                            (asymptotic to zero)
└──────────────────────────────────
  1st    10th   100th   1000th
        Abstraction number
```

This is not wishful thinking. It is the direct consequence of two properties:

1. **Composability without re-verification.** When abstraction A is sealed and correct, and abstraction B is sealed and correct, a program that uses both A and B through their capability interfaces is correct with respect to A and B *without re-testing A and B*. In von Neumann, using A and B together requires testing all interactions between them, because neither A nor B can prevent the other from corrupting its memory.

2. **Immortality of verified work.** Ada Lovelace's algorithm does not need to be rewritten for a new compiler, a new OS, or a new CPU — because it is mathematics, not a binary artifact. A sealed CLOOMC abstraction has the same property. Its correctness is a function of its interface and its logic, both of which are immutable once sealed. The hardware changes; the proof does not.

The industrial consequence is profound. In von Neumann computing, the global software industry spends approximately $500 billion per year on maintenance — patching, refactoring, porting, and securing code that was "finished" years ago. This is not a sign of insufficient effort. It is a sign of an architecture that makes finished work impossible. The code is never finished because the platform provides no mechanism to *finish* it. There is always another exploit, another platform migration, another dependency update that breaks the build.

In a capability-secured system, finished means finished. The sealed abstraction is a mathematical object. It can be stored, copied, transmitted, and executed on any conforming hardware, forever. The development cost of the first abstraction is real. The development cost of the thousandth — built on a library of 999 verified, sealed, reusable predecessors — approaches zero.

Ada wrote her algorithm once. It has cost nothing to maintain for nearly two centuries. That is not an accident. It is what happens when you do mathematics instead of improvisation.

---

## 10. Summary

| Property | Unconstrained (von Neumann) | Constrained (Chip / CLOOMC) |
|----------|---------------------------|----------------------------|
| Decision timing | Deferred or never | Early and explicit |
| Interface definition | Advisory (header files, docs) | Mechanical (pins, c-list, seals) |
| Enforcement | Human discipline | Hardware / cryptographic |
| Cost of change | Low early, catastrophic late | Moderate early, negligible late |
| Versioning | Implicit, fragile | Explicit, sealed |
| Development timeline | Unpredictable, back-loaded | Predictable, front-loaded |
| Ultimate quality | Depends on every programmer | Guaranteed by architecture |
| Long-term cost trend | Constant or rising (maintenance forever) | Asymptotic to zero (sealed work is finished) |
| Lifespan of correct code | Until next platform/compiler/exploit | Indefinite (Ada Lovelace: 183 years and counting) |

The lesson is simple and old and persistently ignored: **freedom is not the same as capability, and constraints are not the same as limitations.** A chip pinout constrains your wiring and liberates your engineering. A sealed abstraction constrains your interface and liberates your software from the endless renegotiation of trust. Von Neumann's unconstrained memory model constrains nothing and liberates no one — it merely defers the consequences of uncommitted design to the people least equipped to deal with them: the users.

The Church Machine chooses constraints. That is not a compromise. It is the design.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
