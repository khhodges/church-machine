# CLOOMC ISA Foundation Document

**v1.2 — 2026-07-23**
**CONFIDENTIAL**

This document records the design session held in May 2026 between the original PP250 designer and the Church Machine team, updated by KJHH on June 23rd 2026. It explains *why* important decisions were made, not just what the decision might be — so that future followers of this Church Machine movemext understand the constraints to respect and theprinciples to preserve. It starts with the The Six Laws of CLOOMC a one-page summation of the foundational principles of capability-based computer architecture.

1. The Law of Capability where authority flows through unforgeable Golden Tokens
2. The Law of Namespace Privacy whre every binding lives inside a Golden Token
3. The Law of Delegation were rights are given, and cnnot be seized
4. The Law of Confinement that guarantees computation cannot exceed transparent tokens
5. The Law of Revocation to limit and withdraw any authority previously granted
6. The Law of Integrity using seals to verify granted origin without disclosure 

---

## 1. Heritage and Distinction

### The First Immersive Capability Computer (PP250)

The PP250 (Plessey UK, 1972) was the first immersive capability computer to be sucessfully fielded commercially. It operated for two decades without a single reported security breach to the capability model. Every object in the
PP250 was accessed through a hardware-validated capability key, a descriptor; no program could reach memory it did not hold a descriptor for. The system survived in production and served in the first Gulf War. It accumulated the necessary operational evidence to turn a theoretical model into a proven if incomplete engineering discipline.

The Church Machine is the PP250's direct and architectural complete successor. The lineage is not metaphorical — it is architectural. The key PP250 designer is also after half a century of binary computer failures the Church Machine designer.

### What the Church Machine Perfects

Three things about flawless computation inherited from the PP250:

1. **The capability model.** Every memory access, indeed every machine instruction is mediated
   by one or mode hardware-validated token. There is no ambient authority; there is no
   privileged mode that bypasses the check. If you do not hold a valid
   token, you cannot touch the memory. These laws apply to Boot at the
   instant power is applied

3. **Hardware-enforced capability keys**, promoted to the digital gold of international cyberspace. The NS table is the direct descendant of the PP250's segment table. Each entry describes a region of memory — its location, its size, and its current version. The hardware recomputes the integrity check on every access and rejects any entry that has been tampered with.

4. **The principle that capabilities ARE the IDE.** In the PP250 the
   descriptor table was the system map. In the Church Machine the Namespace
   table, viewed through the IDE, is the complete, live description of
   everything the running system can reach in a distributed, universal cyberspace. There is no separate registry,
   no configuration file, no out-of-band channel. The namespace is the
   system.

### What Is New

Three things are new in the Church Machine:

1. **LUMP architecture — Lazy Unit of Memory Placement — **
   A LUMP is a power-of-2-sized, self-describing
   binary package for a single abstraction — its methods as CLOOMC code, its c-list, and its
   header word in one contiguous block. LUMPs are the packaging and delivery
   system. They did not exist in the PP250. The PP250 loaded segments from
   disk; the Church Machine fetches LUMPs from the IDE, using a CLOOMC tunnel to
   the Mum Library. LUMP is how abstractions are protected and travel between Church Machines.

2. **CLOOMC ISA.** Capability-Limited / Object-Oriented / Machine-Code is
   the core technology — the instruction set that runs on the Church Machine
   processor. Like the Church-Turing thesis CLOOMC is a secure combination of Chutch-Instruction
   encapsulating standard Turing-Instructions, limiting ambient authority to atomic computations.
   CLOOMC is what is compiled, what is deployed, and what the
   hardware executes. It is not a scripting layer or a bytecode. It is the
   machine code.

4. **Golden Token 32-bit encoding.** The PP250's descriptors were 24 bit
   hardware words. The Church Machine encodes the full capability — slot
   index, revocation sequence, permission bits, bind flag, and type — into
   a single 32-bit word. Every GT is a complete, self-contained run-time capability
   expression that can be validated, forged with machine secret, and instantly
   revoked in O(1) by incrementing a 7-bit version counter.

---

## 2. The CLOOMC Capability Model

### Golden Tokens as Symbolic Expressions

A Golden Token is not merely an access key. Like Lambda Calculus it is a symbolic expression of
functionality. The 32-bit GT word encodes:

- **What** can be accessed (`slot_id`, 16 bits — the namespace index)
- **How** it can be accessed (`dom` + `perm[2:0]`, 4 bits — domain selector (0=Turing {X,W,R}, 1=Church {E,S,L}) plus 3-bit permission payload; Turing/Church domains are mutualy exclusive structurally enforced by the `dom` (domain) bit.
- **Whether** this instance is current (`gt_seq`, 7 bits — revocation counter)
- **What kind** of resource it is (`gt_type`, 2 bits — Null, Inform, Outform, Abstract)
- **Whether** it can be propagated (`b_flag`, 1 bit — bind permission)
- **Whether** it targets a far/remote resource (`f_flag`, 1 bit — Far indicator, per-token)

The permissions are not advisory. The hardware reads the permission bits
before permitting any microcoded instruction step to proceed. A program that holds only an
E (Enter) GT for an abstraction cannot read the abstraction's data, cannot
save into its c-list, and cannot execute its code. It can only call one of 
the abstraction's published entry points (a method). This is capability confinement
implemented in silicon, full digital security enforced by hardware not a flaky software policy.

### The DNA Hierarchy and POLA

A GT hierarchy is a complete, self-describing blueprint of an application's
functional composition. Consider: a thread holds GTs to its abstractions;
each abstraction holds GTs to the abstractions it depends on; those
abstractions hold GTs to their dependencies; and so on down to the hardware
peripherals. The resulting directed graph is the application's DNA — every
function the application can perform is traceable through a chain of
validated GTs from the thread's c-list. This is POLA the Principal Of Least Authority
implemented in hardware as a second dimention of security programming.

This has a consequence that is easy to miss: **you cannot add a capability
to a running system without going through the namespace**. There is no
back-channel. If a GT does not exist in the c-list chain, the functionality
it represents is unreachable. Privilege escalation requires minting a new
GT — and minting requires holding Mint's E-GT, which is itself a capability
controlled by the namespace and passcode protected by 'Abstract-GTs.'

### Lambda Calculus Foundation

Every abstraction is a pure function in the lambda calculus sense: it takes
inputs (via its c-list and data registers), produces outputs, and has no
side effects beyond what its capabilities explicitly permit. Composition is
well-formed by construction: if abstraction A holds an E-GT to abstraction
B, then A can call B, and the hardware enforces that the call proceeds
exactly as B's interface specifies — no more, no less.

The CLOOMC instruction set is the operational realisation of this model.
CALL is function application as Alonzo Church intended. RETURN is function completion. LAMBDA is
lightweight in-scope application (a function applied within the same abstraction's
capability domain). LOAD and SAVE are c-list GT-read and GT-write — the
operations that assemble function compositions dynamically, subject to DNA limitations.

### Mathematical Provability

The type of each token constrains what it can be applied to. An E-GT is an API that
constrains the holder to CALL only. An R-GT constrains the holder to DREAD instructions
only. The hardware enforces these constraints at every instruction boundary.
Because the constraints are enforced in hardware and the GT chain is
inspectable (via the namespace), the behaviour of the whole system is
derivable from the parts: if you can see every GT in the chain and you know
the abstraction at each slot, you can predict every operation the system is
capable of performing. An application is a species, reproducable as individual 
independent individuals.

This is not just an academic property. It is the basis for the reliability
model (Section 3): the capability envelope IS the specification, and
deviations from it are detectable faults, not silent corruptions. It follows 
the natural atomic form of natural life that can be civilized democratically. 

### Fail-Safe by Construction

Faults cannot propagate outside the capability envelope. When an abstraction
faults — bad or missing GT, bounds (address) violation, permission denied, integrity check
failure — the fault is contained at the boundary. The hardware fires the
fault; the capability chain that led to the fault is preserved as
the fault record; no other abstraction's state is disturbed. This is not
recovery by hope. It is recovery by hardware geometry and every abstraction has a
calibrated MTBF, Mean Time Between Failure. This is the most important lesson from
PP250, software can be engineered to achieve a reliability requirement.

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

Nothing else is possible, even for GAI. An attacker cannot inject a third category because
the capability envelope prevents it. A bug in one abstraction cannot corrupt
another because the hardware boundary prevents it, and AI is limited to DNA rails. This is why the
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

- The GTs used when the fault occurred
- The permission that was denied (or the check that failed)
- The pipeline stage where the check happened (GT type, gt_seq,
  integrity32, bounds, permission)
- The abstraction, the NS slot and the Pet name label
- The instruction mnemonic

This information is not scraped from a stack trace after the fact. It is
produced by the hardware pipeline as a structural output of the fault
detection mechanism. The hardware captures it and reports the fault record 
to the IDE as a precise as the hardware can make it — which is very precise.

### MTBF Per Abstraction

Every fault event against an abstraction contributes to its MTBF
(Mean Time Between Failures) measurement. The MTBF is computed per Named 
Abstraction: total operational time divided by total fault count. The result is
a quantitative reliability measure for every abstraction in the namespace.

Improvement effort is therefore never wasted. The IDE ranks abstractions
by MTBF. The weakest link is always visible. A developer looking at the
MTBF table knows immediately which abstraction needs attention — not
because someone guessed, but because the events are counted.

### The Closed Feedback Loop

```
IDE → compile → deploy → PC & CLOOMC Instruction fault capture → MTBF ranking by LUMP version → targeted fix → re-deploy
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
   logically synchronous to these first three instruction, LOAD Namespace,
   START Thread, and CALL (run) Abstraction.

These three together form the **3-LUMP Starter Kit** (Section 7).

### Anything Extra Is a Threat

Every component added to the TSB beyond the irreducible minimum is:

- A complexity cost: more to audit, more to get wrong
- An attack surface: more code running before security is guaranteed
- A conceptual confusion: something that looks like a CLOOMC abstraction
  but is not protected by the capability model

### The LUMP Architecture Must Be Supportive, Not Subtractive

The LUMP architecture (packaging, delivery, lazy load) is the mechanism that
allows everything above the irreducible minimum to be a proper CLOOMC
abstraction. Navana, Mint, Memory Manager, the Loader, the GC and the IRQ — these are
all abstractions delivered as LUMPs, loaded lazily on first CALL. They do
not need to be in the TSB. The LUMP architecture is what makes the TSB
small enough to actually audit.

---

## 5. Memory Architecture

The memory architecture is defined entirely by the three foundation LUMPs.
There are no other configuration parameters.

### Hardware Rules

- **Lump sizes** are powers of 2, minimum 64 words. The mLoad pipeline uses
  bit-shifts to find lump boundaries — not addition.
- **NS table** is the NS LUMP — it lives at the top (to grow down) of
  memory. `totalNamespaceWords` is the programmer's choice, encoded in the
  NS LUMP header, set by the IDE.
- **cc field** (8 bits) limits c-list rows to 255 per abstraction. It does not limit
  NS slots — the GT `slot_id` field is 16 bits, allowing up to 65,535 slots.
- **limit17** (17 bits) caps the pool at 131,071 words — enough headroom for the
- target hardware as not a tight fit.

### LUMP Types

The `typ` field (bits [9:8] of the header word) identifies one of three LUMP types:

| `typ` | Type | What it defines |
|-------|------|-----------------|
| `00` | **Abstraction** | Executable CLOOMC code body + freespace + GT c-list |
| `01` | **Namespace object** | Memory size and namespace size |
| `10` | **Thread** | Stack size and heap size |

### The Three Foundation LUMPs

| # | LUMP | NS Slot | Role | Comment |
|---|------|---------|------|-----------------|
| 1 | **NS LUMP** | 0 | `totalNamespaceWords` — the board's physical memory envelope; everything else follows from this one value | Yes — logically prior to everything |
| 2 | **Thread LUMP** | 1 | Any stack and heap size desired; `Thread.CR0` holds the E-GT for the Application LUMP | Yes — logically prior to first instruction |
| 3 | **Application LUMP** | IDE-configured (programmed slot # any valid Abstraction from the tested LUMP repository | First abstraction the thread calls via the GT held by`Thread.CR0`; content is board- and IDE-programmer selected | The application entry point |

Slot 0 and 1 are fixed but all other slots are programmable using the IDE. Slot 2 onward are
a dynamic pool where the programmer can set any slot ( contiguous or random)for Lazy Load of a named Abstraction.
The IDE writes the GT to the IDE Lightneing Bolt Application LUMP into
`Thread.CR0` via `setBootEntrySlot()`.

### What Follows Automatically

```
foundation_end  = NS_LUMP_SIZE + THREAD_LUMP_SIZE = 1280 words (1024 NST + 256 Thread) i.e. 5120 bytes
                = 1024 word (= 256 slots) + 256 word for 5 Thread zones as follows
                (16 DRs + 114 stack + 0 free + 114 heap + 12 GTs) = 256 four byte words

Dynamic pool    = foundation_end  →  totalNamespaceWords − 1

Pool ceiling    = totalNamespaceWords − 1 (header)
                = 131,071 (XC7A100T)
```

Nothing else needs to be set. The programmer engineers the NS LUMP and
Thread LUMP using the IDE. The hardware boot ROM (3 instructions, see Section 6) handles
the rest. Slot 2 onward is the dynamic pool, ehere Thread.CR0 = the Lightning Bolt abstraction.

---

## 6. The Boot Layout

The DMEM image uses a 4-region layout:

```
Address     Region          Words   Status
────────────────────────────────────────────────────────────
top         NS Lump       1,024     max RAM Necessary — NS root
bottom      Thread Lump     256     Necessary — boot thread (slot 1)
top−0x400   NS Table      1,024     Necessary — capability table
────────────────────────────────────────────────────────────
```

The 3-instruction boot ROM program lives in IMEM (separate from DMEM),
starting at byte address 0x0000. It is hardware — not a LUMP, not in the
NS table, not user-visible.

### The 3-Instruction Hardware Boot ROM

The hardware executes exactly three instructions from IMEM on every reset 
or CLOOMC fault detection (update `hardware/boot_rom.py`, `BOOT_PROGRAM`):

```
[0] LOAD   AL, CR15, CR15[0]   — refresh Namespace cap from slot at top 
[1] CHANGE AL, CR12, CR15, #1  — load Boot.Thread (slot 1); establishes CR0–CR11
[2] CALL   AL, CR0,  CR0       — enter Thread.CR0 (IDE-configured Application LUMP)
```

This is the complete boot sequence. There is no intermediate state, no
privilege escalation, and no code outside the capability model. The IDE
configures `Thread.CR0` (via `setBootEntrySlot()` the Lightning Bold Abstraction) before power-on; the
hardware demo pre-loads it with an E-GT for Salvation (slot 4).

### What Was Removed and Why

**First attempt faild and CR8 to 12 incosistencies resolved

---

## 7. The 3-LUMP Starter Kit

The clean simplified 3 instruction specification enforce for simulator and A7 hardware.
The bitstream has exactly two parts:

**Part 1 — CLOOMC ISA**: the processor hardware. mLoad pipeline, Golden
Token validation, instruction execution. This never changes once programmed.
Silicon is silicon.

**Part 2 — Read-only RAM image**: exactly three LUMPs.

| # | LUMP | NS Slot | Role | Must be in ROM? |
|---|------|---------|------|-----------------|
| 1 | Namespace LUMP | 0 | Total physical memory envelope; owned under M authority | Yes — logically prior to everything |
| 2 | Thread LUMP | 1 | Boot execution context; register file, call stack; `Thread.CR0` = E-GT for the Application LUMP | Yes — logically prior to first instruction |
| 3 | Application LUMP | IDE-configured (slot 4 = Salvation on hardware demo) | First thing the thread calls via `Thread.CR0`; board- and IDE-dependent | Yes — the entry point |

**Boot sequence — three hardware ROM instructions then one CALL:**

0.  Hardware Probe IDE Tunnel (online/offline)
1. `LOAD AL, CR15, CR15[0]` — refresh Namespace cap (slot 0) into CR15.
2. `CHANGE AL, CR12, CR15, #1` — load Thread LUMP (slot 1); establishes CR0–CR11 including `Thread.CR0`.
3. `CALL AL, CR0, CR0` — enter `Thread.CR0`, the IDE-configured Application LUMP.

The IDE writes the chosen slot into `Thread.CR0` via `setBootEntrySlot()`
before flashing.

**Slot 2 onward is available for catalog abstractions.
All prior assumptions removed

### Why This Is Correct

The CallHome probe message is minimized and simply registers the CM with a fault recovery message.

The ROM image is not a boot loader. It IS the application in its initial
state. The moment power is applied:

- All three LUMPs have valid headers and valid NS entries
- The hardware can validate any GT against the NS table
- The thread can execute its first CALL

There is no intermediate undefined state. There is no moment when the
system is "booting" in a way that bypasses the capability model. The
capability model is in force from the first clock cycle.

### Everything Else Is Lazy

Beyond the 3-LUMP foundation, every abstraction is delivered by lazy load:
its NS entry is pre-registered in the Namespace LUMP's c-list (so GTs can
be minted against it immediately), but its lump body is fetched from the
IDE or the Mum Library on first CALL. The Locator abstraction handles the
fetch-inflate-validate-mint sequence transparently. The calling thread sees
no difference between a lazy-loaded abstraction and a resident one — only
a latency cost.

This means the ROM image can be tiny (3 LUMPs, a few hundred words), yet
the full system capability is unbounded. The ROM is the security base; the
network is the library.

---

## 8. Board Profiles and Pool GT Values

### Comparison Table

| Field | Removed Ti60 F225 | XC7A100T |
|-------|-----------|----------|
| `totalNamespaceWords` | delete 65,536 | 131,072 |
| `foundation_end` (NS + Thread only) |delete 0x0140 (320) | 0x0140 (320) |
| Application LUMP Thread.CR0 | 


### Why limit17 Matters

`limit17` is the single value in the Memory Manager's pool GT that must
change when retargeting to a new board. Everything else is either:

- Hardware-forced (same on all boards): minimum lump size, alignment rules
- Identical by programmer choice: `foundation_end`, lump sizes
- Arithmetically derived: pool base, pool ceiling

The `limit17` value in the pool GT is the upper bound of the dynamic pool:
the largest word address the Memory Manager is permitted to allocate from.
If the programmer retargets from XC7A100T, they update
this one value and the Memory Manager immediately sees the new pool — so no
other change is required.

This is the practical consequence of the design: because lump sizes are
powers of 2 (hardware-forced) and the pool runs to `totalNamespaceWords − 1`,
the only variable when retargeting is the programmer's `totalNamespaceWords`
choice — and `limit17` is exactly the field that encodes it.

---

## PP250 Fault Recovery

### The Invariant: no assumed state after a fault

The PP250 design makes **no distinction** between cold boot and fault recovery. Both paths execute the full boot ROM sequence. This is not a simplification — it is a security requirement.

A fault may have been caused by CR15 itself (a corrupted, expired, or wrong-permissions Golden Token). Resuming with the same CR15 would fault again immediately. The namespace may also be in a half-written state if the fault occurred during a CALL or BIND that was updating a slot. Any other assumed state inherited from the crashed context is, by definition, untrusted.

Therefore:

- The full boot ROM sequence runs unconditionally on every recovery.
- Every Golden Token is re-minted from the trusted boot image.
- Every namespace slot is rebuilt from scratch.
- CR15 is always loaded from the boot image — never inherited.
- `boot_complete` is only asserted after all capability state is re-established.

### Why recovery is still fast

The speed advantage of PP250 fault recovery over a cold power-on is purely mechanical — **the FPGA bitstream does not need to be reloaded from SPI flash**. Cold boot requires the configuration controller to stream the bitstream from SPI flash into the FPGA fabric (~100–500 ms). After that, BRAM is initialised from the bitstream and the boot ROM runs.

On fault recovery the FPGA is already configured and the BRAM already holds the boot image. The firmware asserts `boot_start`, the boot ROM re-executes (~20 CLOOMC instructions at 25 MHz ≈ a few microseconds), and `boot_complete` re-asserts. The firmware detects this on the next poll and resumes the monitor loop. The full sequence from `boot_start` pulse to a valid `boot_complete` is measured in single-digit milliseconds — dominated by firmware polling granularity, not hardware execution time.

| Stage | Cold boot | PP250 fault recovery |
|---|---|---|
| FPGA bitstream load from SPI flash | ✔ ~100–500 ms | ✗ already configured |
| BRAM initialised from bitstream | ✔ | ✔ already holds boot image |
| Boot ROM executes (full, unconditional) | ✔ | ✔ |
| CR15 re-established from boot image | ✔ | ✔ |
| Namespace rebuilt from scratch | ✔ | ✔ |
| Firmware polling overhead | ✔ | ✔ (smaller window) |

### Firmware implementation

The firmware's `pp250_fault_recovery()` function (in `hardware/soc_combined/firmware/main.c`) asserts `CM_CTRL_PRESSED` for 5 ms, then polls `CM_STATUS_BOOT_COMPLETE` at 1 ms intervals for up to 10 ms. The 5 ms assertion time is conservative margin — the hardware only needs the pulse for a few clock cycles. The 10 ms poll window is likewise generous; boot ROM execution completes in microseconds, and the firmware detects it on the next 1 ms poll tick.

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
