# Immortal Software — Why Church Machine Code Never Needs to Change

## The Claim

A Church Machine abstraction, once written and verified, never needs to be patched, updated, or replaced. It can run unchanged for decades — or centuries — because the conditions that force software rewrites on conventional architectures do not exist.

This is not even a new idea. In 1843, Ada Lovelace wrote the first computer program — [Note G](ada-note-g.md), an algorithm for computing Bernoulli numbers on Charles Babbage's Analytical Engine. That program also contained the first known software bug — a sign error in one of the Bernoulli coefficients, likely introduced during transcription (see [ada-note-g.md](ada-note-g.md) for the full 25-operation transcription and the Bromley correction). It was never patched, never updated, never security-audited. Correct the sign error, and the algorithm is 183 years old and still correct. The mathematics has not changed. The algorithm has not decayed. It is, and will forever remain, the longest-serving program in history — because it was written as mathematics, not as platform-dependent code.

The Church Machine is designed so that every abstraction can be written the same way Ada wrote Note G. This is a direct consequence of three architectural properties working together:

1. **Every abstraction is a security block with measured MTBF**
2. **Code is written as pure mathematical functions**
3. **The hardware enforces correctness that software cannot violate**

This document explains why these properties, taken together, produce software with no expiry date.

---

## Part 1: MTBF — Every Block Is Measured

### What MTBF Means on the Church Machine

MTBF — Mean Time Between Failures — is a standard reliability metric from hardware engineering. On the Church Machine, it is applied to every abstraction in the namespace:

```
MTBF = uptime / faultCount
```

- **Uptime** is the time since the abstraction was first activated
- **FaultCount** is the number of capability faults, access violations, or operational errors recorded against that abstraction

An abstraction with zero faults has MTBF = infinity (∞). An abstraction that faults once per hour has MTBF = 1 hour. The Navana Monitor abstraction tracks these metrics continuously and can flag any abstraction whose MTBF drops below a threshold.

### Why This Matters

In conventional software, reliability is measured at the system level — "the server had 99.99% uptime this year." But this tells you nothing about which component is degrading. A single unreliable module can hide inside a system that appears healthy, until it fails catastrophically.

On the Church Machine, reliability is measured **per abstraction**. Every security block in the namespace — from the arithmetic library to the memory allocator to the telephony controller — has its own MTBF. You can see at a glance:

- Which abstractions have never faulted (MTBF = ∞)
- Which are degrading (MTBF decreasing over time)
- Which are the weakest link in the system (lowest MTBF)

This is the same approach used for physical hardware components — each resistor, capacitor, and IC on a circuit board has a rated MTBF, and the system's overall reliability is calculated from the individual component ratings. The Church Machine applies this discipline to software.

### The Reliability Stack

Because abstractions compose through supercalls (one abstraction calling another via capabilities), the MTBF of a composite operation can be derived from its components:

```
System MTBF ≈ 1 / (1/MTBF_A + 1/MTBF_B + 1/MTBF_C + ...)
```

If FixedPointMath has MTBF = ∞ and RationalArith (which calls FixedPointMath) has MTBF = ∞, then any operation composed from both also has MTBF = ∞. The chain of reliability is only as strong as its weakest abstraction — and the system tells you exactly which one that is.

---

## Part 2: Mathematical Code — Functions That Cannot Rot

### Why Conventional Software Decays

Software on conventional architectures degrades over time — not because the bits change, but because the world around it changes:

- **Operating system updates** change system call interfaces, breaking programs that depend on them
- **Library updates** change function signatures, deprecate APIs, introduce incompatible behaviour
- **Security patches** require recompilation against new headers, new linking, new runtime behaviour
- **Hardware changes** require rewriting code that assumed specific memory layouts, word sizes, or instruction sets
- **Dependency chains** mean that updating one library forces updates to everything that depends on it, which forces updates to everything that depends on *those*, cascading through the entire stack

This is why a C program written in 1995 rarely compiles unmodified in 2025. The program hasn't changed — the platform beneath it has.

### Why Church Machine Code Is Immune

A Church Machine abstraction is a pure mathematical function:

```
abstraction FixedPointMath {
    method mulFixed(a, b) = (a * b) / 100
    method divFixed(a, b) = (a * 100) / b
    method addFixed(a, b) = a + b
}
```

This code makes **no references to anything outside itself**:

- No operating system calls
- No library imports
- No file system paths
- No network sockets
- No environment variables
- No global variables
- No hardware-specific memory addresses

The function `mulFixed(a, b) = (a * b) / 100` is a mathematical identity. It was true when Alonzo Church published the lambda calculus in 1936. It will be true in 2136. The integers `a` and `b` go in, the integer `(a * b) / 100` comes out. There is nothing external that can change to make this function wrong.

### The Lambda Calculus Guarantee

This is not an accident of good coding style. It is enforced by the architecture:

- **No ambient authority**: A thread can only access what it holds a capability for. An abstraction cannot reach out to "the operating system" or "the file system" because those concepts do not exist in the capability model. If the abstraction doesn't hold a capability for something, it cannot access it.

- **No mutable global state**: There are no global variables. An abstraction's code lump is read-only after loading. State lives in the caller's registers, not in the abstraction. Two calls to the same method with the same arguments will always produce the same result.

- **No implicit dependencies**: In conventional software, a function might silently depend on the system clock, the locale settings, the contents of `/etc/config`, or the state of a database connection pool. On the Church Machine, every dependency is explicit — it must be passed as a parameter or granted as a capability. If the function signature is `mulFixed(a, b)`, then `a` and `b` are the only inputs. Period.

This means Church Machine code satisfies the mathematical definition of a **pure function**: the output depends only on the inputs, and the function has no side effects. Pure functions do not decay because there is nothing to decay *relative to*.

---

## Part 3: Hardware-Enforced Correctness — The Platform Cannot Betray the Code

### The Conventional Platform Problem

Even if you write a perfect function in C, the platform can betray it:

- A buffer overflow in an unrelated module can corrupt your function's stack frame
- A use-after-free in a library can cause your function to read garbage data
- A race condition in another thread can modify shared state mid-computation
- A privilege escalation exploit can inject code into your process
- A compiler optimisation can reorder your instructions in ways that introduce bugs

The function was correct. The platform made it fail. This is why correct software requires constant maintenance — not to fix the software, but to defend it against the platform.

### The Church Machine Platform Guarantee

On the Church Machine, the hardware enforces properties that make platform-induced failures impossible:

| Threat | Why it cannot occur |
|---|---|
| Buffer overflow corrupts your code | Code and data are in separate memory lumps; capabilities carry bounds |
| Use-after-free feeds you garbage | Version-bumped Golden Tokens; mLoad validates every access |
| Race condition modifies your inputs | Each thread has its own register file; abstractions are stateless |
| Privilege escalation injects code | Code lumps are read-only; capabilities are unforgeable |
| Compiler reorders your instructions | The 20-instruction set has defined semantics; no speculative reordering |

This means a Church Machine abstraction does not need defensive code. There are no bounds checks to write, no null pointer guards, no mutex acquisitions, no defensive copies. The hardware provides these guarantees, so the code doesn't have to.

And because the code doesn't contain defensive measures, it doesn't need to be updated when defensive techniques change. A C program that used `gets()` in 1990 needs to be rewritten to use `fgets()` for security. A Church Machine abstraction that was correct in 1990 is still correct — and still secure — because the security comes from the hardware, not from the code.

---

## Part 4: The Implications

### 1. Software Maintenance Costs Approach Zero

The software industry spends the majority of its budget on maintenance — not building new features, but keeping existing code running as platforms change. Estimates range from 60% to 80% of total software cost over its lifetime.

On the Church Machine, the primary causes of maintenance are eliminated:

| Maintenance cause | Conventional | Church Machine |
|---|---|---|
| Security patches | Constant — new vulnerabilities discovered weekly | None — security is hardware-enforced, not software-patched |
| Platform updates | Regular — OS, compiler, library changes break code | None — no platform dependencies to break |
| Dependency updates | Cascading — one update triggers a chain | None — no external dependencies |
| Bug fixes from interference | Ongoing — race conditions, memory errors | None — hardware prevents interference |
| Refactoring for new APIs | Periodic — deprecated APIs must be replaced | None — no APIs to deprecate |

What remains is fixing **logic bugs** — cases where the mathematical function itself is wrong. These are found through testing and MTBF monitoring, fixed once, and then the fix is permanent.

### 2. MTBF Converges to Infinity

In conventional systems, MTBF is an aspiration — you can never be certain that the next operating system update, the next library vulnerability, or the next hardware change won't introduce a new failure mode. MTBF is measured against current conditions, and current conditions change.

On the Church Machine, once an abstraction reaches MTBF = ∞ (zero faults over its active lifetime), it stays there. The conditions that could introduce new faults — platform changes, dependency updates, security vulnerabilities in the runtime — do not exist. An abstraction that has run fault-free for one year will, barring a logic bug that hasn't been triggered yet, run fault-free for a hundred years.

This is the hardware engineering concept of **burn-in**: components that survive their initial period without failure tend to run indefinitely. The Church Machine applies this to software. An abstraction that has been deployed, tested, and measured at MTBF = ∞ is, for practical purposes, permanent.

### 3. Safety-Critical Certification Becomes Tractable

Certifying software for safety-critical applications (DO-178C for avionics, IEC 62304 for medical devices, ISO 26262 for automotive) is enormously expensive because the certification must be repeated every time the software changes. And on conventional platforms, the software *must* change — security patches, platform updates, and dependency changes force regular recertification.

On the Church Machine:

- The code does not change (no platform dependencies to force updates)
- The security properties are hardware-enforced (no security patches needed)
- The reliability is continuously measured per abstraction (MTBF provides real-time evidence)
- The mathematical purity of the code makes formal verification tractable

A certified abstraction stays certified. The MTBF measurement provides continuous evidence that the abstraction continues to meet its reliability requirements. Recertification is only needed if the abstraction's code is deliberately changed — which, if the function is mathematically correct, it never is.

### 4. The Software Supply Chain Collapses to One Layer

A modern application depends on hundreds or thousands of libraries, each with their own maintainers, release cycles, and vulnerability surfaces. The Log4j vulnerability in 2021 affected virtually every Java application on Earth because one logging library, buried deep in dependency chains, had a flaw. The software supply chain is the largest attack surface in modern computing.

On the Church Machine, there is no software supply chain. Each abstraction is self-contained:

- No imports, no includes, no `require()`, no `pip install`
- Dependencies are expressed as capabilities, not as linked code
- Each abstraction's code is loaded once and verified by the Navana Master Controller
- The MTBF of each abstraction is measured independently

If `RationalArith` calls `FixedPointMath` via a supercall, it does so through a capability — it calls a method on a namespace entry, not a function in a linked library. If `FixedPointMath` were replaced with a malicious version, the replacement would need to pass Navana's validation, and any behavioural change would immediately show up as faults against the calling abstractions, driving their MTBF down.

### 5. The Economics of Software Change Permanently

The conventional software industry is built on the assumption that code is temporary:

- Developers are hired to maintain existing code, not just write new code
- Software licences include annual maintenance fees for updates and patches
- Support contracts exist because software breaks in the field
- Version numbers exist because software must be regularly replaced

If code never needs to change, these economic structures are unnecessary:

- **Development cost is a one-time investment**, not a recurring expense
- **No maintenance contracts** — the code either works (MTBF = ∞) or it doesn't (fix the logic, once)
- **No version treadmill** — version 1.0 is the final version, unless the requirements change
- **No planned obsolescence** — the abstraction outlives the developer who wrote it

This is how mathematics works. The formula for calculating the area of a circle (A = πr²) has not been updated since Archimedes. Ada Lovelace's Bernoulli algorithm has not been updated since 1843. Neither has a version number, a maintenance contract, or a security patch. They are mathematical truths, and they work forever.

Ada proved in 1843 that software can be written this way. The Church Machine is an architecture designed so that every abstraction *must* be written this way — and the MTBF measurement proves, continuously and per-abstraction, that it is working.

---

## Part 5: The Numbers — Investment Savings at Scale

### The Cost of Conventional Software Maintenance

Industry data paints a consistent picture of where software budgets actually go:

| Metric | Value | Source |
|---|---|---|
| Maintenance as share of total software cost | 60–80% | Commonly cited across IEEE, Gartner, and industry surveys |
| Average CVE patches per large enterprise per year | ~20,000 | National Vulnerability Database trends, enterprise reports |
| Mean cost to fix a single production defect | $5,000–$25,000 | Depending on severity, domain, and regulatory burden |
| Percentage of developer time spent on maintenance | ~58% | Stripe/Harris Poll 2018 developer survey |
| Annual cost of technical debt to US companies | ~$85 billion | Stripe estimate, 2018 |

Consider a large enterprise software project — a banking platform, a telecom switching system, or an avionics suite — with a 20-year operational lifetime.

### Conventional Architecture: 20-Year Cost Model

| Phase | Duration | Annual cost | Total |
|---|---|---|---|
| Initial development | 3 years | $20M/yr | $60M |
| Maintenance & patching | 17 years | $12M/yr | $204M |
| Security incident response | 17 years | $3M/yr | $51M |
| Platform migration (2 cycles) | — | $15M each | $30M |
| Recertification (safety-critical) | 17 years | $2M/yr | $34M |
| Dependency management & testing | 17 years | $4M/yr | $68M |
| **Total 20-year cost** | | | **$447M** |

The initial build represents just **13%** of the total cost. The remaining **87%** is spent keeping the software alive against platform drift, security vulnerabilities, and dependency rot.

### Church Machine Architecture: 20-Year Cost Model

| Phase | Duration | Annual cost | Total |
|---|---|---|---|
| Initial development | 4 years (longer — new paradigm) | $25M/yr | $100M |
| Maintenance & patching | 16 years | $1M/yr (logic bugs only) | $16M |
| Security incident response | 16 years | $0 (hardware-enforced) | $0 |
| Platform migration | — | $0 (no platform dependencies) | $0 |
| Recertification (safety-critical) | 16 years | $0.2M/yr (MTBF monitoring only) | $3.2M |
| Dependency management & testing | 16 years | $0.5M/yr (regression only) | $8M |
| **Total 20-year cost** | | | **$127.2M** |

The initial build is **79%** of the total cost. Ongoing costs drop to **$1.7M/yr** versus **$21M/yr** — a **92% reduction in annual maintenance spend**.

### Where the Savings Come From

| Cost eliminated | Annual saving | Why |
|---|---|---|
| Security patching | $3M | No CVEs — capabilities are hardware, not code |
| Platform migration | $1.5M (amortised) | No OS, no libraries, no API deprecation |
| Dependency updates | $3.5M | No dependency chain — abstractions are self-contained |
| Defensive coding & review | $4M | No buffer checks, no null guards, no mutex logic to audit |
| Recertification | $1.8M | Code doesn't change, so certification doesn't expire |
| Regression testing for patches | $3M | No patches, no regressions |
| Incident response | $3M | Hardware prevents the vulnerability classes that cause incidents |
| **Total annual saving** | **$19.8M** | |

Over 17 operational years: **$336M saved** on a $447M conventional project — a **75% reduction in total lifecycle cost**.

### The Compounding Effect

These savings compound in ways that the simple model understates:

**Developer productivity.** On conventional projects, ~58% of developer time goes to maintenance. On the Church Machine, that time is redirected to building new abstractions. A 50-person team spending 58% of its time on maintenance is effectively a 21-person team building features. Free that 58% and the effective team size more than doubles.

**Opportunity cost.** The $19.8M/yr not spent on maintenance can fund new development. Over 17 years, that's either $336M saved or $336M reinvested — potentially doubling the organisation's software capability without hiring a single additional developer.

**Risk reduction.** Each security patch on a conventional system carries a risk of introducing new bugs. Each platform migration carries a risk of breaking working features. Eliminating these activities doesn't just save money — it eliminates the risk of self-inflicted outages. For safety-critical domains (banking, aviation, medical), avoiding a single catastrophic incident can save more than the entire project budget.

### Breakeven Analysis

The Church Machine architecture requires higher upfront investment:

- **Higher initial development cost:** $100M vs $60M (67% premium). New paradigm, new tooling, developers must learn capability-based thinking.
- **Breakeven point:** The $40M premium is recovered in **2.0 years** of operation at $19.8M/yr savings.

```
Breakeven = Premium / Annual Saving
         = ($100M - $60M) / $19.8M/yr
         = 2.0 years
```

For a 20-year project, the first 2 years of operation recover the premium. The remaining 15 years are pure savings.

### When Could This Happen? — Adoption Timeline

Architectural transitions in computing follow a consistent pattern. New paradigms do not replace old ones overnight — they infiltrate through the domains where the pain is worst, prove themselves, and then spread.

| Phase | Timeframe | What happens |
|---|---|---|
| **Research & proof of concept** | Now – 2030 | Simulators (like this IDE), FPGA prototypes, academic papers. The architecture is demonstrated but not in production. |
| **First safety-critical deployments** | 2030 – 2035 | Domains where the cost of failure is extreme adopt first: military command systems, medical device firmware, nuclear plant controllers. These are small codebases where the per-line value of provable correctness justifies the paradigm shift. Regulatory pressure accelerates adoption — certifying bodies begin recognising capability architectures as a compliance pathway. |
| **Telecom and banking adoption** | 2033 – 2040 | The PP250 and similar high-reliability platforms are the natural second wave. Telecom switching (where "five nines" reliability is contractual) and banking (where transaction integrity is existential) adopt the architecture for new systems. Legacy systems continue on conventional architectures but new builds are Church Machine native. |
| **Enterprise mainstream** | 2038 – 2045 | As tooling matures and developer training programmes scale, enterprise software begins adopting the model. The economics become impossible to ignore — competitors running Church Machine architectures spend 75% less on maintenance and ship features twice as fast. |
| **Legacy transition complete** | 2045 – 2060 | The long tail. COBOL took 40 years to fade from dominance. x86 has been the dominant ISA for 45 years and counting. Conventional architectures will persist in legacy systems for decades, but new software — particularly in regulated industries — is predominantly written for capability hardware. |

### The Momentum Question

Sceptics will point out that capability architectures have been proposed before (PP250 1972, CAP computer 1978, iAPX 432 1981, CHERI 2014) without achieving mainstream adoption. What's different this time?

### Hardware Patching vs Full Immersion — The Fundamental Difference

Most capability architectures took a conventional processor and **patched capabilities onto it**. The underlying machine remained a von Neumann architecture with raw memory addresses, mutable global state, and unrestricted control flow. Capabilities were an addition — a security layer bolted on top of hardware that was never designed for it.

| Architecture | Approach | What remained underneath |
|---|---|---|
| **CAP Computer** (Cambridge, 1978) | Added capability registers to a conventional processor | Conventional memory model, conventional instruction set, conventional linking |
| **iAPX 432** (Intel, 1981) | Object-based capability architecture, but implemented as a complex CISC design on top of conventional silicon | x86-era memory model, enormous microcode complexity, catastrophic performance overhead |
| **CHERI** (Cambridge/SRI, 2014–present) | Extended MIPS/RISC-V/ARM with capability pointers — "fat pointers" that carry bounds and permissions | The entire conventional software stack: C, Unix, shared libraries, mutable global state, raw pointers still exist alongside capabilities |

These are all **hardware patches**: the conventional architecture persists, and the capability mechanism is layered on top. This creates three unavoidable problems:

**1. The bypass problem.** If the conventional mechanism still exists alongside the capability mechanism, there is always a path — through a bug, a misconfiguration, or a deliberate exploit — to bypass the capabilities and use the raw hardware directly. CHERI, for example, allows legacy C code to run alongside capability-aware code. The capabilities protect what they cover, but they cannot prevent the uncovered code from corrupting the system. The security boundary is permeable.

**2. The complexity problem.** Bolting capabilities onto an existing architecture means the hardware must support *both* the conventional model *and* the capability model simultaneously. The iAPX 432's microcode was so complex that it ran 5–10× slower than a conventional processor of the same era. CHERI adds capability metadata to every pointer, doubling pointer size and requiring changes throughout the memory hierarchy. The patching approach increases complexity rather than reducing it.

**3. The software stack problem.** A patched architecture still runs conventional software — C compilers, Unix kernels, shared libraries, package managers. The capability mechanism can protect the boundaries between components, but it cannot prevent the components themselves from containing the bugs that capabilities are meant to guard against. You still have buffer overflows inside a C library — you've just added a fence around the library. The bugs persist; only their blast radius is reduced.

### The PP250 — The Pioneer That Got It Right

There is one critical exception to the patching pattern. The **Plessey PP250** (1972) — predating the CAP Computer by six years — was the first capability architecture to take the full immersion approach. It was not a conventional processor with capabilities bolted on. It was a capability machine from the ground up, designed for telecom switching where downtime was measured in lost revenue per second and a stale token from a terminated call must never grant access to a new call's billing data.

The PP250 made design choices that the patching architectures did not:

- **Capabilities were the only access mechanism.** There was no raw memory address mode, no backdoor to conventional addressing. If you didn't hold a capability, you couldn't access the resource. Period.
- **The instruction set was built around capabilities.** Operations assumed capability-mediated access, not flat memory. The hardware did not need a compatibility mode because there was nothing to be compatible with.
- **The architecture served a domain where correctness was non-negotiable.** Telecom switching — thousands of concurrent calls, each a dynamic thread with its own capabilities, real-time deterministic garbage collection to reclaim resources from terminated calls. The PP250 ran in production, in telephone exchanges, handling real traffic.

The PP250 proved that full immersion capability hardware could work, could perform, and could run mission-critical workloads. It was not an academic exercise — it was a production system in one of the most demanding real-time environments in computing.

**Why didn't it spread?** The PP250 was designed for a specific domain (telecom switching) by a specific company (Plessey) at a time when the broader computing industry was consolidating around the von Neumann model and general-purpose processors. The case for capability hardware was made publicly — at the Sixth ACM Symposium on Operating System Principles (SOSP-6) in November 1977, a Capability Panel chaired by R.S. Fabry (U.C. Berkeley) debated "The Case For and Against." The panellists — Feiertag (SRI), Jones (Carnegie-Mellon), Lampson (Xerox PARC), Needham (Cambridge), Schroeder (Xerox PARC) — were the architects of the centralised OS model. They argued from theory that their systems could detect and prevent any error. Against them, the panellist from ITT Corporation argued from production experience with capability hardware: centralised detection cannot scale, and the only reliable security is architectural. The theorists prevailed. The industry chose centralised operating systems. Forty-eight years and 30,000 CVEs per year later, the theorists have been proved catastrophically wrong. The PP250's lessons were not lost — they were ignored, because the cost of ignoring them had not yet become high enough.

The Church Machine is the PP250's architectural descendant. It takes the same full immersion approach — capabilities as the only mechanism, no conventional hardware underneath, no escape hatch — and extends it with the lambda calculus as the computational model, the Navana Master Controller for abstraction management, and per-abstraction MTBF measurement. What the PP250 proved for telecom in 1972, the Church Machine generalises for all safety-critical computing.

### The Church Machine: Full Immersion — Completing What the PP250 Started

The Church Machine does not patch capabilities onto a conventional architecture. **There is no conventional architecture underneath.** Like the PP250 before it, the design starts from first principles and builds upward — but where the PP250 started from telecom requirements, the Church Machine starts from the lambda calculus:

- **No raw memory addresses.** Memory is organised into lumps (code lumps, data lumps), each accessed exclusively through Golden Tokens. There is no `0x7fff3a20` to dereference. The concept of a pointer does not exist.

- **No mutable global state.** Each thread has its own register file. There are no global variables, no shared memory segments, no environment variables. State is local to the computation that owns it.

- **No conventional instruction set.** The Church Machine has 20 instructions, derived from the operations needed to evaluate lambda calculus expressions and manage capabilities. There is no `MOV`, no `JMP`, no `LOAD` from an arbitrary address. Every instruction operates within the capability model because the capability model is all there is.

- **No conventional software stack.** There is no C compiler, no Unix kernel, no shared libraries, no linker, no package manager. Code is written as lambda calculus abstractions, loaded into code lumps by the Navana Master Controller, and executed within the capability framework. There is no "legacy mode", no "compatibility layer", no escape hatch.

This is the difference between a building with a sprinkler system and a building made of materials that cannot burn. The sprinkler system (hardware patching) mitigates fire damage. The non-combustible building (full immersion) eliminates fire as a category of failure.

| Property | Hardware patching (CAP, iAPX 432, CHERI) | Full immersion (PP250, Church Machine) |
|---|---|---|
| Conventional memory model | Still present — capabilities overlay it | Does not exist — lumps and tokens replace it |
| Raw pointers | Available alongside capability pointers | Concept does not exist in the ISA |
| Legacy code compatibility | Supported — conventional code runs alongside | Not supported — all code operates within the capability model |
| Bypass path to raw hardware | Exists (legacy mode, uncovered code) | Does not exist — there is no raw hardware to reach |
| Complexity trajectory | Increases (two models coexist) | Decreases (one model, minimal instruction set) |
| Software stack | Conventional (C, Unix, libraries) | Eliminated — capabilities are the only interface |
| Security boundary | Permeable — covers what it covers | Total — the capability model is the only execution model |
| Production proven | CAP: academic. iAPX 432: commercial failure. CHERI: research prototype | PP250: production telecom. Church Machine: in development |

### Why This Matters for the Timeline

The failure of CAP (1978), iAPX 432, and CHERI is often cited as evidence that capability hardware cannot succeed commercially. But those architectures were all patching approaches — they were asking: *"How do we add capabilities to a conventional computer?"* The PP250 and the Church Machine ask a different question: *"What does a computer look like if capabilities are the only mechanism?"*

The PP250 answered that question for telecom in 1972 and ran in production for years. It was not a failure — it was a success in a narrow domain that the broader industry chose to ignore. The Church Machine generalises the PP250's answer to all computing, with the lambda calculus providing the mathematical foundation that makes the architecture domain-independent.

This is a harder engineering problem — there is no legacy compatibility, no gradual migration path, no "run your existing C code with added protection." But it is a *simpler* machine. Twenty instructions instead of thousands. No microcode. No compatibility modes. No dual memory models. The hardware is verifiable precisely because it is minimal.

The tradeoff is stark: patching architectures offered backward compatibility at the cost of incomplete security. Full immersion — pioneered by the PP250 and completed by the Church Machine — offers complete security at the cost of backward compatibility. For green-field safety-critical systems — where backward compatibility is worthless but provable security is existential — this is not a tradeoff at all. It is the only rational choice.

**The cost of failure has changed.** In 1981, a buffer overflow was an inconvenience. In 2026, a buffer overflow in a medical device can kill patients, in an autonomous weapons system can cause civilian casualties, in a banking platform can erase billions. The regulatory and liability pressure on software correctness is orders of magnitude higher than it was when previous capability architectures were proposed.

**The tooling gap has closed.** The iAPX 432 failed partly because writing capability-aware code in 1981 was impractical with contemporary tooling. Today, the lambda calculus is well understood, functional programming has entered the mainstream (Haskell, Rust's ownership model, even JavaScript's arrow functions), and formal verification tools are maturing. The Church Machine's 20-instruction ISA is simpler than any mainstream processor — tooling is easier to build, not harder.

**The economic case is now quantifiable.** In 1981, software maintenance costs were poorly understood. Today, they are measured, reported, and dreaded. The 75% lifecycle cost reduction is not an abstract promise — it is an arithmetic consequence of eliminating platform dependencies, security patching, and dependency management. CFOs can model the ROI.

### The Cybersecurity Workforce Crisis — A Problem That Cannot Be Hired Away

The savings calculated above assume you *can* hire the cybersecurity staff needed to maintain conventional software. Increasingly, you cannot.

**The numbers are stark:**

| Metric | Value | Source |
|---|---|---|
| Unfilled cybersecurity positions globally | ~3.5 million | ISC² Cybersecurity Workforce Study, 2024 |
| Workforce gap growth rate | ~12% per year | ISC² trend data, 2020–2024 |
| Average time to fill a cybersecurity role | 6–9 months | CyberSeek / NICE framework data |
| Annual turnover in cybersecurity roles | ~25% | ISACA State of Cybersecurity survey |
| Burnout rate among cybersecurity professionals | ~65% report high stress | ISACA, Tines Voice of the SOC 2024 |
| Median cybersecurity salary (US) | ~$130,000 | US Bureau of Labor Statistics, 2024 |
| Projected global cybercrime cost | $10.5 trillion/yr by 2025 | Cybersecurity Ventures |

The cybersecurity industry is caught in a structural trap: the attack surface grows faster than the workforce. Every new CVE, every new dependency, every platform update creates work that must be done by people who do not exist in sufficient numbers.

**The human cost is real.** Cybersecurity professionals report burnout rates above 60%. A Security Operations Centre (SOC) analyst's daily work consists of triaging thousands of alerts, most of which are false positives generated by the very complexity of conventional software stacks. The human beings doing this work are exhausted, underpaid relative to the responsibility they carry, and leaving the profession faster than new graduates enter it.

**This is not a training problem.** The gap cannot be closed by producing more graduates. The attack surface of conventional software grows exponentially — every new library, every new API, every new microservice adds vulnerability surface area. Training 3.5 million new analysts does not help if the architecture generates 5 million new analyst-hours of work per year.

### What the Church Machine Changes

The Church Machine does not reduce cybersecurity workload. It **eliminates the categories of work** that consume most of a cybersecurity team's time:

| Cybersecurity activity | Hours/yr (conventional, 50-person team) | Hours/yr (Church Machine) | Why |
|---|---|---|---|
| CVE triage and patching | 8,000 | 0 | No CVEs — vulnerability classes don't exist |
| Penetration testing | 4,000 | 400 | Attack surface is the 20-instruction ISA, not a software stack |
| Dependency audit (SCA) | 3,000 | 0 | No dependencies to audit |
| SOC alert triage | 12,000 | 1,000 | Orders of magnitude fewer alert categories — no buffer overflows, no injection, no privilege escalation |
| Incident response | 6,000 | 500 | Incidents are logic errors, not exploits — bounded, traceable, non-escalating |
| Compliance documentation | 4,000 | 1,500 | MTBF provides continuous evidence; no patch history to document |
| Security code review | 5,000 | 0 | No defensive code to review — security is hardware |
| **Total** | **42,000** | **3,400** | **92% reduction** |

A conventional enterprise needs a cybersecurity team of 20–25 people. The Church Machine needs 2–3 — and their work is fundamentally different. Instead of fighting fires, they monitor MTBF dashboards, review abstraction designs for logic correctness, and validate capability graphs. The work is proactive, measurable, and sustainable.

### The Strategic Implication

Organisations face a choice:

**Option A: Compete for scarce cybersecurity talent.** Pay escalating salaries, accept high turnover, tolerate understaffing, and hope that the people you can hire are fast enough to keep up with the vulnerability surface your conventional architecture generates.

**Option B: Eliminate the demand.** Adopt an architecture that does not generate the vulnerability classes that consume 92% of cybersecurity labour. Redeploy the 20-person security team as 2 people doing meaningful, sustainable work — and reassign the other 18 to building features.

Option A is the current industry default. It is also a losing strategy: the gap between cybersecurity demand and supply widens every year, and no amount of salary increase can conjure analysts who do not exist.

Option B is not available on conventional architectures. It requires hardware that prevents the vulnerability classes at the silicon level. The Church Machine is designed to be that hardware.

**The cybersecurity workforce crisis is not a problem to be solved. It is a symptom of an architecture that generates unbounded security work.** The solution is not more firefighters — it is a building that cannot catch fire.

---

## Part 6: What Could Still Go Wrong

Intellectual honesty requires stating the limits:

**Logic bugs persist.** If `mulFixed` computes `(a * b) / 10` instead of `(a * b) / 100`, the hardware will faithfully execute the wrong formula forever. Mathematical code is immortal — but wrong mathematical code is immortally wrong. This is why MTBF monitoring matters: a logic bug that produces incorrect results will eventually manifest as a fault in the calling abstraction, driving its MTBF down and flagging the problem.

**Requirements change.** The formula `mulFixed(a, b) = (a * b) / 100` is correct for scale-factor 100. If the business decides to switch to scale-factor 1000 (three decimal places instead of two), the abstraction needs a new version. This is not decay — it is a new requirement. The old version remains correct for what it was designed to do.

**Hardware can fail.** A cosmic ray flipping a bit in a register, a power supply fluctuation corrupting a computation, a manufacturing defect in the chip — these are physical failures, not software failures. They are addressed by hardware redundancy (ECC memory, triple modular redundancy, watchdog timers), not by software updates.

**Integer overflow is silent.** The Church Machine operates on 32-bit integers. An abstraction that computes `2,000,000,000 * 3` will silently overflow. The code is mathematically correct for unbounded integers but not for 32-bit ones. The developer must validate that inputs stay within representable range — this is a design constraint documented in the fixed-point overflow limits table.

---

## Conclusion

The Church Machine does not achieve immortal software through any single feature. It achieves it through the **absence of the forces that kill software on conventional architectures**:

| Force that kills software | Church Machine response |
|---|---|
| Platform changes | No platform dependencies |
| Security vulnerabilities | Security enforced by hardware, not software |
| Dependency updates | No external dependencies |
| Shared state corruption | Stateless abstractions, per-thread registers |
| API deprecation | No APIs — capabilities are the interface |
| Compiler/toolchain changes | 20-instruction ISA with fixed semantics |

What remains is mathematics. And mathematics does not decay.

An abstraction is a pure function. A pure function is a mathematical truth. A mathematical truth has no version number, no expiry date, and no maintenance contract. It simply works — today, tomorrow, and for as long as the hardware can execute it.

The MTBF measurement proves it. The lambda calculus guarantees it. The hardware enforces it.

### Getting Started

The Church Machine is an open source design, available on GitHub. Individuals can try it for free. Universities can teach it for free. Industry requires a licence for commercial deployment. The architecture that makes software immortal should be accessible to everyone who wants to learn — and accountable when deployed at scale.

---

## Further Reading

- The **[Lambda Arithmetic](lambda-arithmetic.md)** document covers fixed-point, remainder, and rational techniques — examples of mathematical functions that will never need updating.
- The **[Bugs Eliminated by Architecture](lambda-arithmetic.md#bugs-eliminated-by-architecture)** section catalogues the specific failure modes that the hardware makes impossible.
- The **[Abstraction Catalog](abstractions.md)** shows every abstraction in the system with its current MTBF.
- The **[Architecture](architecture.md)** document explains the MTBF measurement model, the 20-instruction ISA, and the Navana Master Controller.
