# Getting Started with Church Machine Hardware

Every computer you use today runs on an architecture designed in the 1940s.
Programs share a flat memory space. Security is bolted on after the fact.
A single buffer overflow can hand control of the entire machine to an
attacker. We have spent seventy years patching this mistake. The Church
Machine is a different answer: **security built into every memory access,
enforced by the hardware itself.**

The design is governed by the six Laws of the Church-Turing Machine
Model:

1. **Oil and Water** — capabilities and data never mix. Code lives in
   one domain, security tokens live in another. You cannot cast a
   pointer into a capability or forge a token from raw bits. The
   hardware enforces this separation on every cycle.

2. **Double Checking** — every READ and every WRITE must be validated
   by a referenced capability context register. CR14 checks instruction
   fetch. CR12 checks thread lump access. CR5 checks the heap. No
   single point of trust — the machine cross-checks at every boundary.

3. **Distribution not Centralisation** — there is no kernel, no central
   authority, no single process that controls all resources. Each
   abstraction holds exactly the capabilities it needs. Authority is
   distributed to the edge, not hoarded at the centre. No almighty
   network administrator who can bring down millions of machines with
   one misconfiguration. No widespread outages because no single point
   holds all the keys.

4. **Democratic not Dictatorial** — no root user, no superuser, no
   privilege escalation. Every abstraction operates under the same
   rules. The boot firmware itself runs with limited capabilities. No
   entity can override the security model — not even the manufacturer.

5. **Calibrated and Transparent** — every capability carries explicit,
   visible permission bits (R, W, X, L, S, E) and bounds. You can
   inspect exactly what any abstraction is allowed to do. There are no
   hidden permissions, no implicit grants, no ambient authority. What
   you see is what it gets.

6. **Open Source** — the Church Machine is a community project for
   the Information Age. The hardware design, the toolchain, the IDE,
   and the abstraction library are all open. Anyone can inspect the
   security model, verify the implementation, build from source, and
   contribute improvements. No black boxes. No vendor lock-in. The
   architecture belongs to everyone who builds on it. Start at
   [CLOOMC.org](https://cloomc.org).

This is not theoretical. The Church Machine runs on real silicon today,
on two FPGA boards you can buy for the price of a textbook.

---

## The Church-Turing Thesis

In 1936, two mathematicians independently solved the same fundamental
problem — what does it mean for something to be computable? — and
arrived at two radically different answers.

**Alonzo Church** at Princeton published the lambda calculus: a pure
mathematical system where computation is the application of functions to
arguments. There are no variables you can change, no memory you can
overwrite, no side effects. A function takes an input and produces an
output. That is all it can do. The lambda calculus is computation as
mathematics — deterministic, repeatable, and provably correct.

**Alan Turing**, Church's doctoral student, published the Turing machine:
an abstract device with a tape of symbols, a read/write head, and a set
of rules. The machine reads a symbol, writes a symbol, moves left or
right, and changes state. The Turing machine is computation as mechanism
— sequential, stateful, and imperative. It models what a human
calculator does with pencil and paper: read, write, move, decide.

Church and Turing proved that their two models are equivalent in
computational power — anything one can compute, the other can compute.
This equivalence is a mathematical theorem. The broader Church-Turing
thesis — that these models capture everything that is effectively
computable — remains an unproven but universally accepted conjecture.

But equivalence in power does not mean equivalence in consequence.
Turing's model became the blueprint for every computer built since 1945:
a mutable memory, a program counter, instructions that read and write
anywhere. Church's model was set aside as a theoretical curiosity. We
built civilisation's digital infrastructure on the Turing side alone.

The Church Machine reunites both sides. Its instruction set is split
evenly: ten **Turing instructions** (data manipulation, arithmetic,
branching) and ten **Church instructions** (capability operations,
secure entry, lambda creation). The Turing half does the work. The
Church half ensures the work is authorised. Neither half is complete
without the other.

This is why capability faults are not errors — they are the Church side
doing its job. When the machine refuses an unauthorised access, that is
the lambda calculus enforcing mathematical correctness on a physical
machine.

---

## CLOOMC — the Universal Capability Compiler

You do not need to write Church Machine assembly by hand. **CLOOMC++**
(Church Lambda Object-Oriented Machine Compiler) is a multi-language
compiler that targets the 20-instruction Church Machine instruction set.

Write in the language you think in. CLOOMC compiles it to secure,
capability-checked machine code:

- **English** — natural language descriptions compiled to instructions
- **JavaScript** — familiar syntax for web developers
- **Haskell** — pure functional style, natural fit for the Church side
- **Symbolic Math (Ada)** — mathematical expressions with `let` bindings
  and `repeat` loops, honouring Ada Lovelace's Note G (1843)
- **Lambda Calculus** — Church numerals, Boolean logic, pure functions

CLOOMC auto-detects the language. You never need to specify it. Write
a program, click compile, and it produces an `upload.json` containing
the compiled machine words, capability requirements, and self-documentation.

The key insight: regardless of which language you write in, every
compiled abstraction obeys the same six Laws. A JavaScript program and
a Haskell program running on the same Church Machine cannot interfere
with each other — not because of process isolation or virtual memory,
but because the hardware will not permit it.

CLOOMC also generates the capability list automatically. When your code
uses multiply or divide, it detects this and injects a capability
reference to the SlideRule abstraction (a hardware-accelerated
multiply/divide unit). When your code calls another abstraction, it
generates the minimum capability grant required. You get
principle-of-least-privilege by default, not by discipline.

---

## Example: Ada Lovelace's Bernoulli Abstraction

In 1843, Ada Lovelace published Note G — the first computer program
ever written. It computes the seventh Bernoulli number (B7 = −1/30)
on Charles Babbage's Analytical Engine, a machine that was never built.
The algorithm is 183 years old. It has never been patched, never been
updated, never received a security audit. Correct a single
transcription error in the sign of one coefficient, and the algorithm
is still correct today. The mathematics has not changed. The code has
not decayed.

This is the first example of what the Church Machine calls **Immortal
Software** — no CVEs, no patch Tuesday, code that works today works
forever. On the Church Machine, Ada's program runs as a real
abstraction:

```
abstraction NoteG {
    capabilities {
    }

    method compute() {
        -- Initialize Ada's Store columns
        let V1 = 1
        let V2 = 2
        let V3 = 4

        -- Operation 1: multiply V2 * V3
        -- "Multiply 2 by n" = 2 × 4 = 8
        let V4, V5, V6 = V2 * V3

        -- Operation 2: subtract V4 - V1
        -- "2n minus 1" = 7
        let V4 = V4 - V1

        -- Operation 3: add V5 + V1
        -- "2n plus 1" = 9
        let V5 = V5 + V1

        -- Operation 4: divide V4 / V5
        -- "(2n-1)/(2n+1)" = 7/9
        let V11 = V4 / V5

        -- Operation 5: divide V11 / V2
        -- "Divide coefficient by 2"
        let V11 = V11 / V2

        -- Operation 6: accumulator
        let V13 = 0
        let V13 = V13 - V11

        -- Operation 7: loop counter = n - 1 = 3
        let V10 = V3 - V1

        -- Operation 8: denominator counter
        let V7 = V2

        -- Operations 9–23: loop body
        -- Ada's "backing" mechanism — the Engine
        -- returns the barrel to operation 13
        repeat V10 as V10
            let V6 = V6 - V1
            let V7 = V1 + V7
            let V8 = V6 / V7
            let V11 = V8 * V11
            let V6 = V6 - V1
            let V7 = V1 + V7
            let V9 = V6 / V7
            let V11 = V9 * V11
            let V15 = 1
            let V12 = V15 * V11
            let V13 = V12 + V13
        end

        -- Operation 24: B7 = −accumulated sum
        let V15 = 0
        let V15 = V15 - V13

        -- Result: V15 = B7 = −1/30
        -- Ada, 1843: "The Analytical Engine weaves
        -- algebraical patterns just as the Jacquard
        -- loom weaves flowers and leaves."
        halt
    }
}
```

This is written in CLOOMC's Symbolic Mathematics notation — the
language of the Analytical Engine itself. Every multiply and divide
operation compiles to a CALL into the **SlideRule** abstraction
(namespace slot 16), which provides hardware-accelerated arithmetic.
CLOOMC detects the multiply and divide operations and automatically
injects a capability reference to SlideRule. You never need to
request it manually.

### Why this abstraction is immortal

On a conventional computer, the same algorithm would be a C function
or a Python script. It would depend on a compiler, a runtime, an
operating system, a set of libraries — each of which receives security
patches, API changes, and deprecation notices. A program written in
C in 1843 (had C existed) would not compile today without
modification. A Python script from 2010 may not run on Python 3.12.

On the Church Machine, NoteG is a sealed abstraction. It occupies a
measured lump of namespace memory. Its capability list is empty — it
needs nothing from the outside world except SlideRule, which CLOOMC
grants automatically. It has:

- **No dependencies that can change** — SlideRule is a system
  abstraction burned into the namespace at boot. Its interface is
  fixed by the hardware specification.
- **No attack surface** — the abstraction cannot read or write
  anything outside its own lump. An attacker with full control of
  every other abstraction on the machine cannot touch NoteG's
  memory, because they lack a capability to it.
- **No ambient authority** — there is no system call, no file system,
  no network stack, no shared library that could be compromised and
  used as a vector.
- **No CVEs** — a CVE requires a vulnerability that can be exploited.
  When the hardware enforces that no code path can exceed its granted
  capabilities, there is no vulnerability to discover.
- **Measured MTBF** — the Navana Monitor tracks every abstraction's
  Mean Time Between Failures. NoteG, running correctly since
  activation with zero capability faults, has MTBF = ∞.

The same abstraction, with the same binary representation, will
produce the same result on every Church Machine ever built — whether
it is a Tang Nano on a desk today or a Ti60 in a data centre in 2050.
The hardware specification guarantees it.

Ada wrote the first immortal program. She just needed the right
machine to run it on.

### For production: SlideRule.Bernoulli(n)

The NoteG abstraction above preserves Ada's original 25-operation
algorithm for historical fidelity. For production use, the SlideRule
abstraction provides `Bernoulli(n)` as a single CALL instruction
that computes any Bernoulli number B(n) and returns the result as a
fraction (numerator in DR0, denominator in DR1):

```
-- Production: compute B7 in one instruction
LOAD DR0, 7
CALL SlideRule.Bernoulli
-- DR0 = -1, DR1 = 30 → B7 = -1/30
```

Both approaches produce the same mathematical result. The difference
is that NoteG shows the work — 25 operations, exactly as Ada
published them — while SlideRule.Bernoulli encapsulates it.

---

## Why This Matters

Modern software is fragile. A single vulnerability in one library can
compromise millions of machines. We accept this because the underlying
hardware offers no alternative — the CPU will execute whatever instructions
it finds in memory, regardless of who put them there.

The Church Machine eliminates this class of failure entirely. Every
abstraction (the Church Machine term for a program) runs inside a
capability-secured lump of memory. It can only access what it has been
explicitly granted permission to touch. There is no way to forge a
capability. There is no ambient authority. There is no "sudo."

This changes what software can be:

- **Immortal Software** — abstractions that run correctly for decades
  because their security properties are enforced by physics, not policy.
  No patch Tuesday. No CVEs. Code that works today works forever.

- **Zero-Trust by Default** — the 7 Zeroes: no OS, no VM, no hypervisor,
  no privilege rings, no page tables, no TLB, no syscalls. Security is
  not a layer — it is the machine.

- **Network-Transparent Capabilities** — an IoT node can securely receive
  new capabilities over the wire without firmware reflash. A sensor in a
  field and a server in a data center speak the same capability protocol.

- **Composable, Shareable Abstractions** — because every abstraction is
  self-contained and capability-secured, they can be safely shared between
  users, machines, and organisations. The Mum Tunnel Library is the
  beginning of this: a community repository where you publish abstractions
  and others can use them, knowing they cannot exceed their granted
  permissions.

**The progress of civilisation depends on raising the floor of what we
can trust.** The Church Machine raises that floor from "trust nothing"
to "trust the hardware." Every abstraction you write and share makes the
ecosystem stronger. Every capability fault that fires proves the system
works. Every child who learns to program on this machine learns security
as a first principle, not an afterthought.

---

## Step Zero: Start with the IDE — No Hardware Required

You do not need an FPGA to begin. The Church Machine IDE runs entirely
in your browser and includes a full simulator that enforces every one
of the six Laws. Everything you learn in the simulator transfers
directly to real hardware — the instruction set, the capability model,
the security faults, the namespace, the SlideRule — it is all
identical.

**What the IDE gives you right now:**

- **Write code in five languages** — English, JavaScript, Haskell,
  Symbolic Math, or Lambda Calculus. CLOOMC auto-detects the language
  and compiles to the 20-instruction Church Machine instruction set.
- **See every capability register** — click the CRs button to inspect
  all 16 capability registers in real time. Watch CR14 validate
  instruction fetch, CR12 check thread lump access, CR5 guard the
  heap.
- **Trigger real capability faults** — try to read memory you have no
  capability for. The simulator will fault exactly the way the
  hardware does. This is how you learn the security model — by
  running into the walls.
- **Step through instructions** — single-step your abstraction and
  watch each Turing instruction (ADD, SUB, LOAD, STORE, BRANCH) and
  each Church instruction (CALL, RETURN, SENTRY, LAMBDA) execute in
  sequence.
- **Run Ada's Bernoulli program** — load the NoteG example from the
  tutorial menu, compile it, and watch 183-year-old mathematics
  execute on a capability-secured machine.
- **Export to hardware when you are ready** — the Export Patch button
  produces a `.patch` file you can flash to either FPGA with a single
  command.

**Download the IDE and all project resources:**

- [CLOOMC.org](https://cloomc.org) — project home, documentation,
  and community
- [CLOOMC.com](https://cloomc.com) — downloads, approved bitstreams,
  and the Mum Tunnel Library

**The path is simple:** learn in the IDE, experiment until your
abstractions run clean with MTBF = ∞, then plug in a board and flash.
The code you wrote in the simulator runs unchanged on silicon.

[Start the IDE now](https://cloomc.com) — everything below this point
is about hardware, and you can come back to it when you are ready for
a board.

---

## Choosing Your Board

The Church Machine runs on two FPGA boards. Both execute the same
instruction set and enforce the same capability security. The difference
is capacity.

### Efinix Ti60 F225 — Full Profile

The Ti60 is the reference platform. It has room for the complete Church
Machine, including features that push the boundaries of what a
capability-secured processor can do.

| | |
|---|---|
| **FPGA** | Efinix Titanium, 60K LUTs (~14% used) |
| **Clock** | 50 MHz (PLL from 25 MHz crystal) |
| **Memory** | 256 KB SRAM |
| **Price** | ~$300–400 (dev kit); chip alone ~$50 |
| **Best for** | Research, full OS experiments, lambda calculus, garbage collection |

**Full profile features:**
- CHANGE / SWITCH — hardware thread context switching
- LAMBDA — closure creation with NIA cache optimisation
- Fused operations — ELOADCALL, XLOADLAMBDA (load + invoke in one cycle)
- Hardware garbage collection (mark/sweep)
- Capability sealing and validation (SEAL_CHECK)
- Full ChurchOutform deployment protocol (ZIP-compatible)

**Who should choose this:** Researchers, advanced students, and anyone
who wants to explore the complete capability architecture — including
lambda calculus, garbage collection, and multi-threaded secure contexts.

### [Tang Nano 20K](https://www.google.com/search?q=Tang+Nano+20K) — IoT Profile

The [Tang Nano 20K](https://www.google.com/search?q=Tang+Nano+20K) is the educational and IoT platform. It runs a pruned
version of the architecture that fits a smaller, cheaper FPGA while
keeping every security guarantee intact.

| | |
|---|---|
| **FPGA** | Gowin GW2AR-18C, 20K LUTs (~22% used) |
| **Clock** | 27 MHz (direct crystal) |
| **Memory** | 64 KB BSRAM |
| **Price** | ~$3–$20 (Sipeed) |
| **Best for** | Classrooms, IoT nodes, learning, first Church Machine |
| **UART** | On-board FT2232 — just plug in USB-C, no adapter needed |

**IoT profile:** same security, smaller footprint. Removes GC, Lambda,
Change, Switch, ELoadCall, XLoadLambda. Replaces ChurchOutform with a
lean tunnel-hunting protocol (8-byte header, raw STORE, CRC-32). Any
opcode removed from the profile triggers FAULT_OPCODE — the machine
never silently ignores a missing feature.

**Who should choose this:** Parents, children, schools, teachers,
students, educators, IoT builders, and anyone who wants the fastest
path from unboxing to running secure code on real silicon. If you are
new to the Church Machine, start here and learn the language of life
in the Information Age!

### Side-by-Side Comparison

| Feature | Ti60 F225 (Full) | Tang Nano 20K (IoT) |
|---------|-----------------|---------------------|
| LUTs used | ~8,537 / 60K (14%) | ~4,653 / 20K (22%) |
| Clock | 50 MHz | 27 MHz |
| BRAM | 256 KB | 64 KB |
| Price | ~$300–400 (dev kit) | ~$3–$20 |
| UART adapter | External (H14/M14 pins) | Built-in USB-C (FT2232) |
| LEDs | 4 x active-HIGH | 4 x active-LOW |
| LAMBDA instruction | Yes | FAULT_OPCODE |
| Garbage collection | Hardware mark/sweep | FAULT_OPCODE |
| Context switching | CHANGE / SWITCH | FAULT_OPCODE |
| Fused ops | ELOADCALL, XLOADLAMBDA | FAULT_OPCODE |
| Deployment protocol | Full ChurchOutform (ZIP) | ChurchOutformIoT (lean) |
| Toolchain | Efinity IDE (proprietary) | OSS CAD Suite (open source) |
| Capability security | Full Second Law | Full Second Law |
| Instruction set core | 20 instructions | 14 instructions (6 guarded) |
| Build from source | Proprietary tools required | Fully open-source |

Both boards enforce the Second Law identically. An abstraction that runs
on the Tang Nano will run on the Ti60 (the reverse is true only if the
abstraction avoids full-profile instructions).

---

## Getting Started: [Tang Nano 20K](https://www.google.com/search?q=Tang+Nano+20K)

The [Tang Nano 20K](https://www.google.com/search?q=Tang+Nano+20K) is the recommended first board. These steps take you
from unboxing to running your own code on real silicon.

### What you need

- A **[Tang Nano 20K](https://www.google.com/search?q=Tang+Nano+20K)** board (~$3–$20 from Sipeed)
- A **USB-C cable** (data, not charge-only)
- A computer running **Linux** or **ChromeOS** (with Linux container)

### Step 1 — Install the tools

You need **openFPGALoader** to flash the bitstream and **Python 3 +
pyserial** to send code patches over UART.

```bash
# OSS CAD Suite — includes openFPGALoader and all FPGA tools
# Download from: https://github.com/YosysHQ/oss-cad-suite-build/releases
# Extract, then activate:
source ~/oss-cad-suite/environment

# pyserial — for the CLI patch tool
pip3 install pyserial
```

### Step 2 — Download the latest bitstream

Download approved bitstreams and tools from
[CLOOMC.com](https://cloomc.com):

```
church_tang_nano_20k_iot.fs     (bitstream)
patch_fpga.py                   (CLI patcher)
```

Alternatively, from the Church Machine IDE (Replit project):

```
build/church_tang_nano_20k_iot.fs     (bitstream)
tools/patch_fpga.py                   (CLI patcher)
```

If no pre-built `.fs` file exists yet, you will need to build it from
source — see **Building from Source** below, then come back here.

Put both files in a working directory:

```
~/church-fpga/
├── church_tang_nano_20k_iot.fs
└── patch_fpga.py
```

### Step 3 — Plug in and check

Connect the board via USB-C:

```bash
ls /dev/ttyUSB*
```

The FT2232 chip creates two ports:

| Port | Channel | Purpose |
|------|---------|---------|
| `/dev/ttyUSB0` | A (JTAG) | openFPGALoader uses this to flash |
| `/dev/ttyUSB1` | B (UART) | patch_fpga.py sends code here at 115200 baud |

If you get permission errors:

```bash
sudo usermod -aG dialout $USER   # permanent fix (log out and back in)
sudo chmod 666 /dev/ttyUSB*      # quick fix
```

### Step 4 — Flash the bitstream

```bash
cd ~/church-fpga
openFPGALoader -b tangnano20k church_tang_nano_20k_iot.fs
```

Wait for `Done` / `DONE`. The entire flash takes about 10 seconds.

### Step 5 — Check the LEDs

| LED | Pin | Meaning | What you should see |
|-----|-----|---------|---------------------|
| led0 | 15 | Boot/Run | Solid ON — boot complete |
| led1 | 16 | Halt | Blinking — core halted, waiting for code |
| led2 | 19 | Fault | OFF — no capability fault |
| led3 | 20 | Heartbeat | Blinking ~1 Hz — clock alive |

**One solid + two blinking = success.** The Church Machine booted and is
waiting for you to send it code.

---

## Flashing vs Patching — Two Different Things

The IDE workflow has two distinct operations, and it is important to
understand the difference because they do fundamentally different
things.

### Flashing creates the fail-safe computer

When you flash a bitstream (`.fs` file) with openFPGALoader, you are
writing the Church Machine itself into the FPGA. This is the hardware
— the processor, the capability registers, the namespace controller,
the UART, the boot ROM, the security model. After flashing, you have
a real Church Machine running on silicon. It enforces every one of the
six Laws. It will refuse any unauthorised memory access. It will fault
on any capability violation. It is a **fail-safe computer** — a
machine that fails safely by design, not by policy.

You flash once (or whenever a new hardware version is released). The
bitstream does not contain your programs. It contains the machine that
runs your programs.

### Patching adds changeable fail-safe software

When you patch (export a `.patch` file and send it over UART), you are
writing abstractions — programs — into the namespace memory of an
already-running Church Machine. The machine does not change. The
software does.

This is what makes the Church Machine different from every other
computer: **the software you write is also fail-safe.** Not because
you wrote it carefully, but because the hardware will not permit it to
misbehave. Your abstraction runs inside a capability-secured lump. It
can only touch memory it has a capability for. It cannot forge
capabilities. It cannot escape its lump. It cannot interfere with
other abstractions. The hardware guarantees this on every cycle.

And because patching writes into namespace memory over UART, you can
change your software at any time — write a new abstraction, recompile,
export, flash. The machine stays the same. The security stays the
same. Only the software changes, and every version of the software is
automatically fail-safe because the fail-safe computer enforces it.

```
FLASH (once)     →  fail-safe COMPUTER  (the machine itself)
PATCH (anytime)  →  fail-safe SOFTWARE  (your abstractions)
```

The bitstream is the lock. The patch is what you put inside the lock.
The lock never opens for anything without a key.

---

## Writing and Patching Code

This is your everyday workflow: write code in the IDE, compile it in the
simulator, export a patch file, and flash it with one terminal command.

```
IDE ── write ──► Patch (compile) ──► Export Patch ──► patch_fpga.py ──► FPGA
```

### Step 6 — Write your code

1. Open the Church Machine IDE in your browser
2. Click **CRs** in the toolbar
3. Click on a CR — for example, **CR14** (instruction fetch)
4. Click **Edit** to open the code editor
5. Write or modify your Church Machine assembly

### Step 7 — Compile and test in the simulator

Click **Patch**. This assembles your code into binary machine words and
writes them into the simulator memory. This is the compilation step —
it produces the binary that will be sent to the FPGA.

Step through instructions, inspect registers, and check for capability
faults before committing to real hardware. If the assembler reports
errors, fix them and click Patch again.

### Step 8 — Export the patch file

Click **Export Patch**. This packages the compiled binary into a `.patch`
file containing complete UART frames with CRC checksums and a RUN
sentinel, then downloads it.

The log shows a preview for cross-checking:

```
Block 0: Code lump  addr=0x0141  words=7
NS table update included: no

--- Patch Preview ---
  Block 0: addr=0x0141  words=7  CRC=0xD6F7  frame=36 bytes
  RUN sentinel: [0xBE 0xAA] included in file
  File size: 40 bytes

Downloaded: CR14_patch.patch
```

### Step 9 — Flash the patch to the FPGA

```bash
python3 patch_fpga.py /dev/ttyUSB1 CR14_patch.patch
```

```
Church Machine FPGA Patcher
  File   : CR14_patch.patch
  Blocks : 1
  RUN    : yes

  Block 0: addr=0x0141  words=7  CRC=0xD6F7  frame=36 bytes

  Serial : /dev/ttyUSB1 @ 115200 baud

  Block 0: TX 36 bytes  addr=0x0141  words=7  CRC=0xD6F7
           RX echo OK: addr=0x0141  count=7

  Sending RUN sentinel (0xBE 0xAA)...
  RUN sent — core executing from PC=0.

SUCCESS — all blocks patched and verified.
```

Cross-check: the CRC and address values must match between the IDE
preview and the script output.

### Step 10 — Check the LEDs

- **led0** stays solid (boot complete)
- **led1** stops blinking (core now running your code)
- **led2** OFF = no fault, ON = capability fault triggered

To change your code, repeat Steps 6–10: edit, compile, export, flash.
Each cycle takes under a minute.

---

## Getting Started: Efinix Ti60 F225

The Ti60 follows the same write-compile-export-flash workflow, with a
few differences in setup.

### Hardware differences

- The Ti60 dev board does not have an on-board UART-to-USB converter.
  You need an external UART adapter connected to pins H14 (TX) and
  M14 (RX) at 115200 baud.
- LEDs are active-HIGH (opposite polarity to the Tang Nano).
- The toolchain requires the proprietary **Efinity IDE** from Efinix
  for synthesis, place-and-route, and bitstream generation.

### Build and flash

The Ti60 build has two stages: Amaranth-to-Verilog (runs in Replit),
then synthesis through bitstream (runs in Efinity IDE on your machine).

```bash
# Stage 1: Generate Verilog + resource report (in Replit)
./build_ti60.sh build
# Produces: build/church_ti60_f225.v, build/church_ti60_f225.il,
#           build/ti60_resource_report.txt
```

Then on your local machine:

1. Open the Efinity IDE and import `hardware/ti60_f225_project.xml`
2. Add the generated `church_ti60_f225.v` as the top-level source
3. Run the Efinity synthesis, placement, and routing flow
4. Generate the bitstream (`.hex` or `.bit` file)
5. Flash using the Efinity Programmer GUI

Note: unlike the Tang Nano, the Ti60 build cannot use open-source tools
for synthesis and PnR. The `build_ti60.sh` script only prepares the
Verilog — it does not produce a flashable bitstream.

### LED meanings (same signals, opposite polarity)

| LED | Meaning | Ti60 (active-HIGH) | Tang Nano (active-LOW) |
|-----|---------|--------------------|-----------------------|
| Boot/Run | Boot complete | ON | ON |
| Halt | Core halted | ON = halted | ON = halted |
| Fault | Capability fault | ON = fault | ON = fault |
| Heartbeat | Clock alive | Blinking | Blinking |

After flashing, the patching workflow is identical: write code in the
IDE, compile with Patch, export with Export Patch, flash with
`patch_fpga.py` pointing at your UART adapter's serial port.

---

## Share Your Abstractions

The Church Machine is only as powerful as its library of abstractions.
Every abstraction you write and share makes the ecosystem stronger for
everyone.

### The Mum Tunnel Library

The Mum Tunnel is a community repository at
[CLOOMC.com](https://cloomc.com) where you can publish and browse
Church Machine abstractions. Each abstraction includes:

- Compiled code (machine words)
- A capability list (the exact permissions it requires)
- Metadata: author, language, description, tags
- Source code for re-compilation and learning

To publish: compile your abstraction in the IDE, click **Publish to
Library**, and it becomes available to every Church Machine user
worldwide.

To browse: click **Library** in the IDE toolbar. Search by language
(English, JavaScript, Haskell, Symbolic Math, Lambda Calculus), author,
or tags. Import any abstraction directly into your namespace with one
click.

### The Abstraction Challenge

The Church Machine community recognises excellence in three categories:

**Best New Abstraction** — the most useful, elegant, or creative
abstraction published to the Mum Tunnel Library each month. Criteria:
- Solves a real problem (not just a demo)
- Clean capability design (minimum necessary permissions)
- Well-documented with source code included
- Works on both IoT and Full profiles (preferred) or clearly
  states its profile requirement

**Highest Reliability** — the abstraction with the highest demonstrated
Mean Time Between Failures (MTBF). The simulator tracks cycle counts and
fault events. Abstractions that run millions of cycles without triggering
a capability fault earn the highest reliability rating. This is what
Immortal Software looks like in practice.

**Best Educational Abstraction** — the abstraction that best teaches a
concept. The Church Machine exists to make security accessible. An
abstraction that helps a twelve-year-old understand capabilities is
worth more than one that optimises a hash function.

### What the world needs

These abstractions do not exist yet. Someone has to write them:

- **Secure sensor abstractions** — temperature, humidity, pressure
  sensors wrapped in capability-secured interfaces for IoT deployments
- **Network tunnels** — Mum Tunnel implementations for different
  transport layers (BLE, LoRa, TCP)
- **Mathematical libraries** — Church numeral arithmetic, matrix
  operations, signal processing — all capability-secured
- **Protocol handlers** — MQTT, CoAP, HTTP parsers that run inside
  capability lumps with minimum permissions
- **Educational sequences** — step-by-step tutorials that teach
  specific security concepts through live code
- **Device drivers** — LED patterns, button debouncing, display
  controllers, all with proper capability isolation

Every abstraction you publish is a brick in the foundation of a
computing architecture that does not need patching, does not need
antivirus software, and does not give root access to buffer overflows.

**Get on board.** Pick a board. Flash a bitstream. Write an abstraction.
Share it with the world.

---

## Open Source Contributors

The Church Machine is built by its community. The **IDE/Abstractions
Implementation Group** is open to anyone who wants to contribute —
there is no application form, no interview, no gatekeeping. You join
by contributing.

### How to join

1. Download the IDE from [CLOOMC.com](https://cloomc.com)
2. Work through the tutorials and understand the six Laws
3. Submit your first contribution — a bug fix, a new abstraction, a
   documentation improvement, a test case, anything that makes the
   project stronger
4. Your first merged contribution makes you a member

### What you can work on

- **IDE** — simulator accuracy, CLOOMC compiler, code editor, hardware
  bridge, documentation, testing
- **Abstractions** — system libraries, IoT drivers, educational
  tutorials, mathematical functions, protocol handlers
- **Hardware** — Amaranth HDL processor core, new FPGA board support,
  boot ROM, verification and testbenches

### Group rules (summary)

1. The six Laws are not negotiable — no contribution may weaken
   capability enforcement
2. Abstractions must be self-documenting with source, capability list,
   and test cases
3. Minimum capability grants — request only what you need
4. Test before you submit — zero capability faults in the simulator
5. No breaking changes to hardware-visible interfaces without
   discussion first
6. Be kind, be patient — many contributors are students and learners

Full rules and guidance: see
[contributing.md](contributing.md) in the documentation library.

### Recognition

- Every contributor is listed in the project
- Every abstraction in the Mum Tunnel Library carries its author's
  name permanently
- Monthly Abstraction Challenge awards for Best New Abstraction,
  Highest Reliability, and Best Educational Abstraction

The more people who build on the Church Machine, the stronger it
becomes. The architecture belongs to everyone who builds on it.

---

## Building the Bitstream from Source

If you need to modify the hardware design itself — add a peripheral,
change the memory map, adjust the boot ROM — you will need to build
the bitstream from Amaranth HDL source.

### Tang Nano 20K (open-source toolchain)

Everything from Step 1 above, plus ~20 GB of RAM for place and route.

```bash
# 1. Generate Verilog (in Replit)
python3 -m hardware.gen_verilog --iot build

# 2. Synthesize (in Replit)
yosys -p "read_verilog build/church_tang_nano_20k_iot.v; \
          synth_gowin -top top \
          -json build/church_tang_nano_20k_iot.json"

# 3. Download .json and .cst to your local machine

# 4. Place and route (local, needs ~20 GB RAM, 3–5 minutes)
nextpnr-himbaechel \
    --device GW2AR-LV18QN88C8/I7 \
    --json build/church_tang_nano_20k_iot.json \
    --write build/church_tang_nano_20k_iot_pnr.json \
    -o family=GW2A-18C \
    -o cst=hardware/tang_nano_20k.cst \
    --freq 27

# 5. Pack the bitstream
gowin_pack -d GW2A-18C \
    -o church_tang_nano_20k_iot.fs \
    build/church_tang_nano_20k_iot_pnr.json

# 6. Flash
openFPGALoader -b tangnano20k church_tang_nano_20k_iot.fs
```

Or use the Makefile (PnR and pack only — Verilog gen and synthesis must
be done first):

```bash
cp build/church_tang_nano_20k_iot.json hardware/
cd hardware
make tang-iot      # place-and-route + pack
make prog-iot      # flash
```

### Efinix Ti60 F225 (proprietary toolchain)

The Ti60 build requires the Efinity IDE from Efinix. The open-source
Amaranth-to-Verilog step runs in Replit, but synthesis, PnR, and
bitstream generation use Efinity.

```bash
# Generate Verilog + resource report (in Replit)
./build_ti60.sh build

# Then open the project in Efinity IDE and run the full flow
```

---

## Browser Bridge (Alternative Patching Method)

If you prefer to patch directly from the IDE without downloading files,
you can run a bridge script that relays UART between the browser and the
FPGA over HTTPS.

The Export + CLI method above is simpler and more reliable. The bridge
requires self-signed certificates and has known issues on some ChromeOS
configurations.

```
IDE (browser) ──HTTPS──► Bridge (terminal) ──USB/UART──► FPGA
```

### Setup

```bash
# Download server/local_bridge.py from the Replit project
python3 local_bridge.py /dev/ttyUSB1 115200
```

Then in Chrome:

1. Accept the self-signed certificate at `https://penguin.linux.test:8766/status`
   (on native Linux: `https://localhost:8766/status`)
2. Hard refresh the IDE (Ctrl+Shift+R)
3. Click **Bridge** in the toolbar, accept the default URL
4. Use **Patch FPGA** instead of Export Patch — it sends code directly

---

## Troubleshooting

### openFPGALoader: "No device detected"

- Is the USB cable a data cable (not charge-only)?
- Try a different USB port
- On ChromeOS: Settings > Developers > Linux > USB devices — share the
  Tang Nano

### No serial ports in /dev/ttyUSB*

```bash
sudo modprobe ftdi_sio
```

On ChromeOS, share the USB device in Linux settings.

### "Permission denied" on serial port

```bash
sudo usermod -aG dialout $USER   # permanent (log out/in)
sudo chmod 666 /dev/ttyUSB1      # quick fix
```

### "No echo received (0 bytes)"

- Is the FPGA powered with the correct bitstream?
- Are you using the right port? UART = Channel B (usually `ttyUSB1`)
- Try power-cycling the board (unplug and replug USB)

### "Editor is empty"

- Select a CR, then click Edit to load the code
- Export Patch auto-loads existing code if the editor is empty

### LEDs don't change after patching

- Check for "Echo OK" — if missing, the code didn't reach the FPGA
- Check for "RUN sent" — without this, the core stays halted
- If led2 lights up, your code triggered a capability fault

---

## Quick Reference

### First-time setup (Tang Nano 20K)

| Step | Where | What to do |
|------|-------|------------|
| 1 | Local | Install OSS CAD Suite + pyserial |
| 2 | IDE | Download `.fs` bitstream + `patch_fpga.py` |
| 3 | Local | Plug in board, check `ls /dev/ttyUSB*` |
| 4 | Local | `openFPGALoader -b tangnano20k church_tang_nano_20k_iot.fs` |
| 5 | Local | Check LEDs: 1 solid + 2 blinking = OK |

### Everyday code patching (both boards)

| Step | Where | What to do |
|------|-------|------------|
| 6 | IDE | Select CR, click Edit, write code |
| 7 | IDE | Click Patch — compiles code in simulator |
| 8 | IDE | Click Export Patch — downloads `.patch` file |
| 9 | Local | `python3 patch_fpga.py /dev/ttyUSB1 CR14_patch.patch` |
| 10 | Local | Check LEDs + cross-check CRC values |

### Pin reference

| Signal | Tang Nano 20K | Ti60 F225 | Notes |
|--------|--------------|-----------|-------|
| Clock | Pin 4 (27 MHz) | PLL (50 MHz) | |
| UART TX | Pin 69 | Pin H14 | |
| UART RX | Pin 70 | Pin M14 | |
| LED 0 (Boot) | Pin 15 (active-low) | Active-high | |
| LED 1 (Halt) | Pin 16 (active-low) | Active-high | |
| LED 2 (Fault) | Pin 19 (active-low) | Active-high | |
| LED 3 (Heartbeat) | Pin 20 (active-low) | Active-high | |
| Button | Pin 88 (active-low) | USER_PB (active-low) | |
