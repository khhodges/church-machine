# CLOOMC ISA Foundation Document

**v1.0 — 2026-05-14**
**CONFIDENTIAL**

> This document records the design session held in May 2026 between the
> original PP250 designer and the Church Machine team. It explains *why*
> each decision was made, not just what the decision is — so that future
> implementors understand the constraints they must respect and the
> principles they must preserve.

---

## 1. Heritage and Distinction

### The PP250 — First Immersive Capability Computer

The PP250 (Plessey UK, 1972) was the first immersive capability computer to
be fielded commercially. It operated for two decades without a single
security breach attributable to the capability model. Every object in the
PP250 was accessed through a hardware-validated descriptor; no program could
reach memory it did not hold a descriptor for. The system survived in
production long enough to accumulate the kind of operational evidence that
turns a theoretical model into a proven engineering discipline.

The Church Machine is the PP250's direct successor. The lineage is not
metaphorical — it is architectural. The PP250 designer is the Church Machine
designer.

### What the Church Machine Inherits

Three things come directly from the PP250:

1. **The capability model.** Every memory access is mediated by a
   hardware-validated token. There is no ambient authority; there is no
   privileged mode that bypasses the check. If you do not hold a valid
   token, you cannot touch the memory.

2. **Hardware-enforced segment descriptors.** The NS table is the direct
   descendant of the PP250's segment table. Each entry describes a region
   of memory — its location, its size, and its current version. The
   hardware recomputes the integrity check on every access and rejects any
   entry that has been tampered with.

3. **The principle that capabilities ARE the IDE.** In the PP250 the
   descriptor table was the system map. In the Church Machine the Namespace
   table, viewed through the IDE, is the complete, live description of
   everything the running system can reach. There is no separate registry,
   no configuration file, no out-of-band channel. The namespace is the
   system.

### What Is New

Three things are new in the Church Machine:

1. **LUMP architecture.** A LUMP is a power-of-2-sized, self-describing
   binary package for a single abstraction — its code, its c-list, and its
   header word in one contiguous block. LUMPs are the packaging and delivery
   system. They did not exist in the PP250. The PP250 loaded segments from
   disk; the Church Machine fetches LUMPs from the IDE, from a tunnel, or
   from the Mum Library. LUMP is how abstractions travel between systems.

2. **CLOOMC ISA.** Capability-Limited / Object-Oriented / Machine-Code is
   the core technology — the instruction set that runs on the Church Machine
   processor. CLOOMC is what is compiled, what is deployed, and what the
   hardware executes. It is not a scripting layer or a bytecode. It is the
   machine code.

3. **Golden Token 32-bit encoding.** The PP250's descriptors were wide
   hardware words. The Church Machine encodes the full capability — slot
   index, revocation sequence, permission bits, bind flag, and type — into
   a single 32-bit word. Every GT is a complete, self-contained capability
   expression that can be validated, forged only with the secret, and
   revoked in O(1) by incrementing a 7-bit counter.

---

## 2. The CLOOMC Capability Model

### Golden Tokens as Symbolic Expressions

A Golden Token is not merely an access key. It is a symbolic expression of
functionality. The 32-bit GT word encodes:

- **What** can be accessed (`slot_id`, 16 bits — the namespace index)
- **How** it can be accessed (`perms`, 6 bits — R, W, X, L, S, E)
- **Whether** this instance is current (`gt_seq`, 7 bits — revocation counter)
- **What kind** of resource it is (`gt_type`, 2 bits — Null, Inform, Outform, Abstract)
- **Whether** it can be propagated (`b_flag`, 1 bit — bind permission)

The permissions are not advisory. The hardware reads the permission bits
before permitting any instruction to proceed. A program that holds only an
E (Enter) GT for an abstraction cannot read the abstraction's data, cannot
write to its c-list, and cannot execute its code directly. It can only call
the abstraction's published entry point. This is capability confinement
implemented in silicon, not in software policy.

### The DNA Hierarchy

A GT hierarchy is a complete, self-describing blueprint of an application's
functional composition. Consider: a thread holds GTs to its abstractions;
each abstraction holds GTs to the abstractions it depends on; those
abstractions hold GTs to their dependencies; and so on down to the hardware
peripherals. The resulting directed graph is the application's DNA — every
function the application can perform is traceable through a chain of
validated GTs from the thread's c-list.

This has a consequence that is easy to miss: **you cannot add a capability
to a running system without going through the namespace**. There is no
back-channel. If a GT does not exist in the chain, the functionality
it represents is unreachable. Privilege escalation requires minting a new
GT — and minting requires holding Mint's E-GT, which is itself a capability
controlled by the namespace.

### Lambda Calculus Foundation

Every abstraction is a pure function in the lambda calculus sense: it takes
inputs (via its c-list and data registers), produces outputs, and has no
side effects beyond what its capabilities explicitly permit. Composition is
well-formed by construction: if abstraction A holds an E-GT to abstraction
B, then A can call B, and the hardware enforces that the call proceeds
exactly as B's interface specifies — no more, no less.

The CLOOMC instruction set is the operational realisation of this model.
CALL is function application. RETURN is function completion. LAMBDA is
lightweight in-scope application (a function applied within the same
capability domain). LOAD and SAVE are c-list read and write — the
operations that assemble function compositions.

### Mathematical Provability

The type of each token constrains what it can be applied to. An E-GT
constrains the holder to CALL only. An R-GT constrains the holder to DREAD
only. The hardware enforces these constraints at every instruction boundary.
Because the constraints are enforced in hardware and the GT chain is
inspectable (via the namespace), the behaviour of the whole system is
derivable from the parts: if you can see every GT in the chain and you know
the abstraction at each slot, you can predict every operation the system is
capable of performing.

This is not just an academic property. It is the basis for the reliability
model (Section 3): the capability envelope IS the specification, and
deviations from it are detectable faults, not silent corruptions.

### Fail-Safe by Construction

Faults cannot propagate outside the capability envelope. When an abstraction
faults — bad GT, bounds violation, permission denied, integrity check
failure — the fault is contained at the boundary. The hardware fires the
fault handler; the capability chain that led to the fault is preserved in
the fault record; no other abstraction's state is disturbed. This is not
recovery by hope. It is recovery by hardware geometry.

A fault in abstraction B cannot corrupt abstraction A's c-list because A's
c-list is protected by A's lump boundary, which B cannot cross without
holding A's S-GT — and A did not give B that GT. Confinement is structural.

### Dynamic Extension

New abstractions can be loaded, new tokens minted, and new capabilities
distributed without breaking the proven properties of what is already
running. This is possible because the namespace is the authority table: a
new entry in the namespace is a new entry — it cannot forge an entry that
already exists; it cannot inherit permissions from a neighbouring entry; it
is exactly what Mint wrote and nothing else.

---

## 3. The Reliability Model

### The Error Space After Security

Once security is guaranteed — that is, once the capability model is hardware-
enforced and the GT chain is the sole path to any resource — the error space
for a running system collapses to exactly two categories:

1. **Specification error** — the abstraction was told to do something the
   designer did not intend.
2. **Implementation error** — the abstraction was asked to do something
   correct but its code produced the wrong result.

Nothing else is possible. An attacker cannot inject a third category because
the capability envelope prevents it. A bug in one abstraction cannot corrupt
another because the hardware boundary prevents it. This is why the
reliability model can be quantitative.

### Hidden Implementation

Fixing an abstraction is always local. The capability envelope is the
contract — the GT defines what the holder can ask for; the hardware enforces
it; the lump defines what the abstraction does when asked. As long as the
new lump honours the same contract (same entry points, same permission
requirements), any holder of the E-GT will see the fix transparently on
the next CALL. **Regression is impossible by construction**: the new lump
cannot reach anything the old lump could not reach, because both are
confined by the same GT chain.

### The Capability System as Runtime IDE Extension

Every fault carries precise diagnostic information:

- The GT that was being used when the fault occurred
- The permission that was denied (or the check that failed)
- The pipeline stage where the check happened (GT type, gt_seq,
  integrity32, bounds, permission)
- The abstraction slot and label
- The instruction mnemonic

This information is not scraped from a stack trace after the fact. It is
produced by the hardware pipeline as a structural output of the fault
detection mechanism. The IDE captures it. The fault record is as precise
as the hardware can make it — which is very precise.

### MTBF Per Abstraction

Every fault event against an abstraction contributes to its MTBF
(Mean Time Between Failures) measurement. The MTBF is computed per NS
slot: total operational time divided by total fault count. The result is
a quantitative reliability measure for every abstraction in the namespace.

Improvement effort is therefore never wasted. The IDE ranks abstractions
by MTBF. The weakest link is always visible. A developer looking at the
MTBF table knows immediately which abstraction needs attention — not
because someone guessed, but because the hardware counted.

### The Closed Feedback Loop

```
IDE → compile → deploy → fault capture → MTBF ranking → targeted fix → re-deploy
```

This loop is closed by the capability model. Deployment goes through the
namespace (Navana is the sole NS writer). Faults are captured by the
hardware pipeline and reported to the IDE via the call-home mechanism.
MTBF is computed server-side from the fault log. The developer sees the
MTBF table in the IDE, fixes the weakest abstraction, compiles, and
re-deploys. The loop has no gap. Every step is mediated by a capability
that the IDE controls.

---

## 4. The Trusted Security Base (TSB)

### The TSB Principle

The Trusted Security Base is the set of components that must be correct for
the security model to hold. In the Church Machine, the TSB is defined by a
strict rule:

> **Only what is logically prior to the first CLOOMC instruction may be
> in the TSB. Everything else must be a CLOOMC abstraction.**

"Logically prior" means: things the processor needs before it can execute
its first instruction. This includes the processor hardware itself (the
mLoad pipeline, the GT validation logic, the instruction decoder), the boot
ROM that initialises the registers, and the boot image that is present in
RAM when power is applied. Nothing else.

### The Irreducible Minimum

The minimum boot image that satisfies the TSB principle contains exactly
three things:

1. **One Namespace** — the NS table that describes what physical memory
   exists and where. Without a namespace, the processor cannot validate any
   GT. The namespace is logically prior to the first instruction.

2. **One Thread** — the execution context: PC, register file, call stack.
   Without a thread, there is no execution. The thread lump is logically
   prior to the first instruction.

3. **One first Abstraction** — the code the thread starts executing. Without
   a first abstraction, there is nothing to run. The first abstraction is
   logically prior to the first instruction.

These three together form the **3-LUMP Starter Kit** (Section 7).

### Anything Extra Is a Threat

Every component added to the TSB beyond the irreducible minimum is:

- A complexity cost: more to audit, more to get wrong
- An attack surface: more code running before security is fully established
- A conceptual confusion: something that looks like a CLOOMC abstraction
  but is not protected by the capability model

The free slot 2 in the current demo boot image (the historical remnant of
Startup.Config) is an example of a TSB violation: it sits in the boot image
at a fixed address without being either logically prior to the first
instruction or a proper CLOOMC abstraction. It fails the TSB test on both
counts.

### The LUMP Architecture Must Be Supportive, Not Subtractive

The LUMP architecture (packaging, delivery, lazy load) is the mechanism that
allows everything above the irreducible minimum to be a proper CLOOMC
abstraction. Navana, Mint, Memory Manager, the Loader, the GC — these are
all abstractions delivered as LUMPs, loaded lazily on first CALL. They do
not need to be in the TSB. The LUMP architecture is what makes the TSB
small enough to actually audit.

---

## 5. Memory Architecture — Decisions and Constraints

Every value in the boot image is either hardware-forced, an IDE
(programmer) choice, or a natural consequence of the other two. Confusing
these categories leads to incorrect implementations. Each is labelled below.

### Hardware-Forced (Cannot Change Without Silicon Revision)

**Lump sizes are powers of 2, minimum 64 words.**
*Forcing reason:* The mLoad pipeline computes lump boundaries using bit-shift
operations, not addition. Shift registers are simpler, smaller, and faster
than adders. The hardware cannot express "lump starts at 0x0180, ends at
0x0180 + 73" — it can only express "lump starts at 0x0180, size is 2^n".
The minimum exponent corresponds to 64 words (n_minus_6 = 0, so n = 6,
size = 2^6 = 64). This constraint propagates everywhere: every lump must
be placed at an address that is a multiple of its size (power-of-2
alignment).

**cc field is 8 bits: maximum 255 c-list rows per lump.**
*Forcing reason:* The cc (c-list count) field in the lump header is 8 bits
wide — 8 wires on the gate array. You cannot add a ninth wire without a
silicon change. This limits a single lump to 255 capability entries in its
c-list — not the number of NS slots. NS slots are addressed by the GT
`slot_id` field, which is 16 bits (bits [15:0]), allowing up to 65,535
distinct NS slots. cc and NS slot count are independent quantities.

**limit17 is 17 bits.**
*Forcing reason:* The mLoad pipeline contains a 17-bit adder that computes
`base + offset`. The adder is 17 bits wide in the gate array. This means
the maximum addressable offset from any lump base is 2^17 − 1 = 131,071
words. This was chosen deliberately to be 17 (not 16) to give headroom above
the Ti60 F225's 65,536-word address space, making the Ti60 profile a proper
subset of the hardware's capability rather than a tight fit.

**NS table at the top of memory.**
*Forcing reason:* At cold boot, the processor has no stored pointer to the
NS table — it has not yet executed any instruction that could have written
one. The boot ROM computes the NS table address by subtracting
`NS_TABLE_RESERVE` from the total RAM size. This is possible using only the
hardware's knowledge of its own memory size (wired into the chip at
fabrication time). A stored pointer would create a chicken-and-egg problem:
the pointer would have to live somewhere, and the processor would need a
capability to reach it before the namespace is initialised.

**NS_TABLE_RESERVE = 1,024 words.**
*Forcing reason:* The value 1,024 is a fixed constant wired into the boot
ROM: `NS_TABLE_BASE = totalRamWords − 1,024`. This cannot be changed without
rewriting the boot ROM. The arithmetic is 256 entries × 4 words per entry =
1,024. The 256-entry limit is a fixed implementation constant chosen for the
current design — not a consequence of the cc field (which governs c-list rows
per lump, not NS slot count). The stride is 4 words per entry.

### The Programmer Makes Exactly Three LUMPs

The memory architecture is entirely defined by the three foundation LUMPs.
There are no separate configuration parameters. The programmer's choices
are the three LUMP sizes — nothing else.

**NS LUMP size** (NS slot 0, minimum 64 words).
The NS LUMP header encodes `totalNamespaceWords` — the physical memory
envelope for the board. This single value determines the NS table base
(`totalNamespaceWords − 1,024`) and the pool ceiling
(`totalNamespaceWords − 1,025`). The programmer chooses the LUMP size based
on how many NS entries the design will need over its lifetime. Everything
that describes the address space flows from this one header field.

**Thread LUMP size** (NS slot 1, minimum 64 words).
The boot execution context — PC, register file, call stack, heap. The
programmer designs this to any size desired: heap and stack regions are
declared inside the Thread LUMP to whatever depth the application requires.
The only constraint is the hardware minimum of 64 words.

**Application LUMP size** (NS slot 2, minimum 64 words).
The first abstraction the thread calls — on XC7A100T this is the Ethernet
Locator; on Tang Nano 20K this is the UART Locator. Size chosen based on
the method body and c-list of that abstraction.

### Natural Consequences (Not Decisions)

**foundation_end (dynamic pool base).**
Once the three LUMP sizes are known, `foundation_end` is determined
arithmetically: `NS_LUMP_SIZE + THREAD_LUMP_SIZE + APP_LUMP_SIZE`.
In the 3-LUMP starter kit (64 + 256 + 64 = 384 words), `foundation_end =
0x0180`. This is not a choice — it is the sum of the three LUMPs.

**Dynamic pool in the middle.**
Once the top of memory is occupied by the NS table (hardware-forced) and the
bottom is occupied by the foundation lumps (programmer-chosen), the middle
is whatever is left. The dynamic pool is not independently sized. It is the
remainder after the two fixed regions are subtracted from the total.

**Pool ceiling.**
`totalNamespaceWords − NS_TABLE_RESERVE − 1` — the highest word address
the pool allocator can return. On the Ti60 F225: 65,536 − 1,024 − 1 =
64,511. On the XC7A100T: 131,072 − 1,024 − 1 = 130,047. These are
arithmetic, not choices.

---

## 6. The Old Boot Layout — Explained and Superseded

The current demo boot image uses a 6-region layout:

```
Address     Region              Words   Status
────────────────────────────────────────────────────────────
0x0000      NS Lump              64     Necessary — NS root
0x0040      Thread Lump         256     Necessary — boot thread
0x0140      Free slot 2          64     HISTORICAL REMNANT (see below)
0x0180      Boot.Abstr           64     Necessary — first abstraction
0x01C0      Dynamic Pool          ∞     Necessary — allocatable heap
top−0x400   NS Table          1,024     Necessary — capability table
────────────────────────────────────────────────────────────
```

### Problems with This Layout

**Free slot 2 fails the TSB test.**
Slot 2 (address range 0x0140–0x017F) is dead space left behind when
Startup.Config was removed (Task #247). It occupies 64 words in the boot
image at a fixed address. It is not logically prior to the first CLOOMC
instruction (it contains no code or data that the boot sequence needs), and
it is not a CLOOMC abstraction (it has no c-list, no method table, and no
meaningful lump header). It fails the TSB test on both counts. Its only
justification is historical — it was once something, it is now nothing, and
"nothing" should not occupy a fixed reservation in the Trusted Security Base.

**The 3-instruction NUC program is a workaround.**
Boot.Abstr (slot 3) currently contains 3 instructions: CHANGE (switch to
thread context), TPERM (restrict permissions), and CALL (enter the first
user abstraction). These instructions are needed, but they are implemented
as a fixed boot ROM program rather than as a CLOOMC-native construct
authored by the programmer. The NUC_PROGRAM in the hardware boot ROM
conflates the boot sequence with an application demo (the LED blink program
lives in the same NUC_PROGRAM region). These concerns should be separated.

**The NUC_PROGRAM conflates boot sequence with application demo.**
The LED blink demo (NS slot 4, Salvation) is hardwired into the Boot ROM
alongside the boot sequence. A clean design would have the boot sequence
as a minimal, fixed piece of hardware logic and the application as an
ordinary LUMP delivered by the programmer. The current arrangement requires
the hardware to know about the application demo — which is a TSB violation
in spirit if not in letter.

### Path to Correctness

The 3-LUMP model (Section 7) resolves all three problems:

- Slot 2 disappears — the 3-LUMP starter kit has no gaps
- The boot sequence becomes part of the ROM image, not a CLOOMC program
- The application LUMP is the third LUMP, separately authored, cleanly
  separated from the hardware boot logic

The current demo boot image is preserved as-is for simulator compatibility.
Task #1159 and follow-on work will implement the clean image.

---

## 7. The 3-LUMP Starter Kit

The clean model. The bitstream has exactly two parts:

**Part 1 — CLOOMC ISA**: the processor hardware. mLoad pipeline, Golden
Token validation, instruction execution. This never changes once programmed.
Silicon is silicon.

**Part 2 — Read-only RAM image**: exactly three LUMPs.

| # | LUMP | Role | Must be in ROM? |
|---|------|------|-----------------|
| 1 | Namespace LUMP | Total physical memory envelope; start + size; owned under M authority | Yes — logically prior to everything |
| 2 | Thread LUMP | Boot execution context; PC, register file, call stack | Yes — logically prior to first instruction |
| 3 | Application LUMP | First thing the thread calls; content is board-dependent | Yes — the entry point |

On the **XC7A100T** the Application LUMP is the **Locator** — a CLOOMC
abstraction that runs on the FPGA itself, not on the IDE server. The Locator
holds three capabilities in its C-list: an Ethernet GT (for network I/O), a
Mint GT (for installing fetched LUMPs), and a NamespaceWrite GT (for
promoting Outform NS entries to Live). The moment the board is powered, the
thread calls the Locator, which opens the Ethernet link to the IDE. Everything
else (Memory Manager, Mint, Navana, the full catalogue) arrives via lazy load
over that Ethernet connection.

The Ethernet abstraction (NS slot 51) is the transport layer the Locator
uses — a separate, lower-level CLOOMC abstraction that wraps the RMII PHY
hardware on the QMTECH Wukong board. The Locator calls Ethernet.Send /
Ethernet.Receive; the Ethernet abstraction talks to the silicon.

On the **Tang Nano 20K** the transport is UART, and the Application LUMP
is the UART Locator abstraction — structurally identical to the XC7A100T
Locator but holding a UART GT instead of an Ethernet GT.

### Why This Is Correct

The ROM image is not a boot loader. It IS the application in its initial
state. The moment power is applied:

- All three LUMPs have valid headers and valid NS entries
- The hardware can validate any GT against the NS table
- The thread can execute its first CALL

There is no intermediate undefined state. There is no moment when the
system is "booting" in a way that bypasses the capability model. The
capability model is in force from the first clock cycle.

### Everything Else Is Lazy

Above the 3-LUMP foundation, every abstraction is delivered by lazy load:
its NS entry is pre-registered in the Namespace LUMP's c-list (so GTs can
be minted against it immediately), but its lump body is fetched from the
IDE or the Mum Library on first CALL. The Locator abstraction handles the
fetch-inflate-validate-mint sequence transparently. The calling thread sees
no difference between a lazy-loaded abstraction and a resident one — only
a latency cost.

This means the ROM image can be tiny (3 LUMPs, a few hundred words), and
the full system capability is unbounded. The ROM is the security base; the
network is the library.

---

## 8. Board Profiles and Pool GT Values

### Comparison Table

| Field | Ti60 F225 | XC7A100T |
|-------|-----------|----------|
| `totalNamespaceWords` | 65,536 | 131,072 |
| NS_TABLE_BASE | `0xFC00` | `0x1FC00` |
| `NS_TABLE_RESERVE` | 0x400 (1,024) | 0x400 (1,024) |
| `foundation_end` (current 4-region demo) | 0x01C0 (448) | 0x01C0 (448) |
| Pool base | 0x01C0 (448) | 0x01C0 (448) |
| Pool ceiling | 64,511 (`0xFBFF`) | 130,047 (`0x1FBFF`) |
| `limit17` (Memory pool GT) | `0x0FBFF` | `0x1FBFF` |
| Allocatable pool words | ~64,063 (~250 KB) | ~129,599 (~507 KB) |

> **Note:** `foundation_end` is identical on both boards for the current
> 4-region demo layout (NS 64 w + Thread 256 w + free slot 2 64 w +
> Boot.Abstr 64 w = 448 words = 0x01C0). Lump sizes are programmer choices,
> not board choices — a programmer using the same sizes on both boards gets
> the same `foundation_end`. Once Task #1161 removes free slot 2 and
> implements the clean 3-LUMP boot image, the true 3-LUMP foundation_end
> drops to 0x0180 (384 words = NS 64 w + Thread 256 w + Application 64 w)
> on both boards.

### Why limit17 Matters

`limit17` is the single value in the Memory Manager's pool GT that must
change when retargeting to a new board. Everything else is either:

- Hardware-forced (same on all boards): `NS_TABLE_RESERVE`, minimum lump
  size, alignment rules
- Identical by programmer choice: `foundation_end`, lump sizes
- Arithmetically derived: pool base, pool ceiling

The `limit17` value in the pool GT is the upper bound of the dynamic pool:
the largest word address the Memory Manager is permitted to allocate from.
On the Ti60 it is `0x0FBFF` (64,511). On the XC7A100T it is `0x1FBFF`
(130,047). When the programmer retargets from Ti60 to XC7A100T, they update
this one value and the Memory Manager immediately sees the larger pool — no
other change is required.

This is the practical consequence of the hardware forcing: because the NS
table is at a fixed offset from the top of memory (hardware-forced), and
because lump sizes are powers of 2 (hardware-forced), the only variable is
the total memory size — and `limit17` is exactly the field that encodes it.

### NS_TABLE_BASE Computation

On any board:

```
NS_TABLE_BASE = totalNamespaceWords − NS_TABLE_RESERVE
              = totalNamespaceWords − 1,024
```

Ti60 F225:   65,536 − 1,024 = 64,512 = `0xFC00`
XC7A100T: 131,072 − 1,024 = 130,048 = `0x1FC00`

The boot ROM does not read this from a register. It computes it by
subtracting 1,024 from the wired-in total RAM size. No stored pointer.
No chicken-and-egg. No boot failure mode from a corrupted NS pointer.

---

## See Also

- [`foundation-lump-design.md`](foundation-lump-design.md) — Authoritative rules for foundation lump design, programmer-controlled boot image steps, and the IDE role
- [`boot-rom-layout.md`](boot-rom-layout.md) — Specific demo boot ROM layout (IMEM map, NUC_PROGRAM, DEMO_NAMESPACE, DEMO_CLIST)
- [`ctmm-memory-map.md`](ctmm-memory-map.md) — Authoritative CM memory map with NS table, lump headers, and per-board profiles
- [`locator.md`](locator.md) — Absent-lump fetch protocol; lazy load lifecycle
- [`architecture.md`](architecture.md) — Church Machine ISA overview, GT format, register architecture
- [`golden-tokens.md`](golden-tokens.md) — GT format and MAC rules
- [`namespace-security.md`](namespace-security.md) — Namespace integrity model
- [`plan-lazy-load.md`](plan-lazy-load.md) — Lazy loading design and Loader abstraction
- [`network-transparency.md`](network-transparency.md) — Outform GT network access and RPC tunnel model

---

*Confidential — Kenneth Hamer-Hodges — May 2026*
