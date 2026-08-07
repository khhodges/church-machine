# Quick Start

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

You do not need an FPGA to begin. The Church Machine IDE runs entirely
in your browser and includes a full simulator that enforces every one
of the Six Laws of CLOOMC (see reference material later). Everything you learn in the simulator transfers
directly to real hardware — the instruction set, the capability model,
the security faults, the namespace, the SlideRule — it is all
identical.

**What the IDE gives you right now:**

- **Write code in five languages** — English, JavaScript, Haskell,
  Symbolic Math, or Lambda Calculus. CLOOMC auto-detects the language
  and compiles to the 20-instruction Church Machine instruction set.
- **See every capability register** — click the CRs button to inspect
  all 16 capability registers in real time. Watch CR14 validate
  instruction fetch, CR12 bound the thread lump stack, CR5 guard the
  heap.
- **Trigger real capability faults** — try to read memory you have no
  capability for. The simulator will fault exactly the way the
  hardware does. This is how you learn the security model — by
  running into the walls.
- **Step through instructions** — single-step your abstraction and
  watch each Turing instruction (ADD, SUB, LOAD, STORE, BRANCH) and
  each Church instruction (CALL, RETURN, LAMBDA) execute in
  sequence.
- **Run Ada's Bernoulli program** — load the NoteG example from the
  tutorial menu, compile it, and watch 183-year-old mathematics
  execute on a capability-secured machine.
- **Export to hardware when you are ready** — the Export Patch button
  produces a `.patch` file you can flash to either FPGA with a single
  command.

**The path is simple:** learn in the IDE, experiment until your
abstractions run clean with MTBF = ∞, then plug in a board and flash.
The code you wrote in the simulator runs unchanged on silicon.

**Project resources:**

- [CLOOMC.org](https://cloomc.org) — project home, documentation,
  and community
- [CLOOMC.com](https://cloomc.com) — downloads, approved bitstreams,
  and the Mum Tunnel Library

---

## Step 1 — Write your code and boot the simulator

### Toolbar icon reference

![Church Machine toolbar](/simulator/toolbar-icons.png)

| Icon | Button | What it does |
|------|--------|------|
| ↺ | **Boot** (yellow) | Reset and run the boot sequence |
| 👣 | **Step** (green) | Execute one instruction |
| 🚶 | **Walk** | Animate step-by-step execution |
| 🏃 | **Run** (green) | Execute until halt, fault, or breakpoint |
| ● | **Breakpoint** | Toggle a breakpoint at the current address |
| ⚡ | **Fault** (yellow) | Recall the fault report |

> Hover any icon for its tooltip.

You do not need a board to start. Open the Church Machine IDE in your
browser and begin writing code immediately.

1. Open the Church Machine IDE
2. Click the **Boot** button in the toolbar — the simulator controls every capability register, loads the namespace, and puts the core
   into HALT, just like real hardware. You now have a running Church
   Machine in your browser.
3. Click **CRs** in the toolbar to see the capability registers
4. Click on a CR — for example, **CR14** (instruction fetch)
5. Click **Edit** to open the abstraction creator
6. Write or modify your Church Machine assembly

## Step 2 — Compile, inspect, and test

Click **Compile** to assemble your code into binary machine words. The
compiled output appears in the **CR14** view — this shows you exactly
what the Church Machine will execute at runtime. Use it to verify your
code and add breakpoints by clicking the **●** button at any address
before running.

Click **Patch** to write the compiled words into the simulator memory.
The simulator enforces every one of the six Laws — the same capability
checks that run on real silicon.

Use **Step** 👣 to execute one instruction at a time, **Walk** 🚶 to
animate execution, or **Run** 🏃 to execute until halt, fault, or
breakpoint. Inspect registers and check for capability faults. If the
assembler reports errors, fix them and click Patch again. Everything
you see in the simulator transfers directly to hardware — the
instruction set, the security model, the faults.

**You can stay here as long as you want.** The simulator is the full
Church Machine. When you are ready for real silicon, continue to
Step 3.

---

## Choosing Your Board

The Church Machine runs on two FPGA boards. Both execute the same
instruction set and enforce the same capability security. The difference
is capacity.

### [Efinix Ti60 F225](https://www.digikey.com/en/products/detail/efinix-inc/TI60F225C-DK/15672425) — Full Profile

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
| **Price** | ~$3–$20 |
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

- A **[Tang Nano 20K](https://www.google.com/search?q=Tang+Nano+20K)** board (~$3–$20)
- A **USB-C cable** (data, not charge-only)
- A computer running **Linux** or **ChromeOS** (with Linux container)

### Step 3 — Download the official bitstream and flash your Church Machine

When you are ready for real hardware, plug in the Tang Nano 20K via
USB-C and flash the official release. This is the fastest way to get a
working Church Machine on silicon — no toolchain installation, no
synthesis, no build steps. Just download, flash, and go.

> **Why the official release?** The FPGA package on CLOOMC.com contains
> a pre-built, tested bitstream. You do not need to install Yosys,
> nextpnr, or any FPGA toolchain to use it. Advanced users who want to
> modify the hardware itself can build from source — see
> *Building from source* later in this guide.

**Download the FPGA package:**

Open the Church Machine IDE, go to **Builder**, select **Tang Nano 20K**,
and click **Download FPGA Package**. Or download from
[CLOOMC.com](https://cloomc.com).

**Install the flasher** (one time):

```bash
# openFPGALoader — the only tool you need for the official release
# https://github.com/YosysHQ/oss-cad-suite-build
source ~/oss-cad-suite/environment

# pyserial (for the bridge and patch tools)
pip3 install pyserial
```

**Extract and flash:**

```bash
mkdir -p ~/church-fpga && cd ~/church-fpga
unzip church-nano-package.zip
chmod +x flash.sh bridge.sh
./flash.sh
```

`flash.sh` detects the pre-built bitstream and flashes it directly
with openFPGALoader. It stops on the first error with a diagnostic
hint, and ends with a success checklist telling you what to look for.

The ZIP contains the bitstream, constraints, `flash.sh`, `bridge.sh`,
`local_bridge.py`, and `BUILD.md`.

---

**Building from source** (advanced alternative):

If you want to modify the Church Machine hardware or build the
bitstream yourself, install the full OSS CAD Suite (Yosys, nextpnr,
gowin_pack) and run:

```bash
make pnr pack    # nextpnr + gowin_pack
make prog        # openFPGALoader
```

This is only needed if you are changing the Verilog. For writing and
deploying abstractions, the official release is all you need.

### Step 4 — Check the USB ports

```bash
ls /dev/ttyUSB*
```

The BL616 chip creates two ports:

| Port | Channel | Purpose |
|------|---------|---------|
| `/dev/ttyUSB0` | JTAG | openFPGALoader uses this to flash |
| `/dev/ttyUSB1` | UART | Bridge / code patches at 115200 baud |

If you get permission errors:

```bash
sudo usermod -aG dialout $USER   # permanent fix (log out and back in)
sudo chmod 666 /dev/ttyUSB*      # quick fix
```

### Step 5 — Verify success (100% checklist)

When the bitstream finishes flashing, the Church Machine boots
automatically. The boot ROM initialises every capability register,
loads the namespace, and puts the core into HALT — waiting safely
for you to send it code.

**LED checklist:**

| LED | Pin | Signal | Expected |
|-----|-----|--------|----------|
| led0 | 15 | Boot/Run | Solid ON — boot complete |
| led1 | 16 | Halt | Blinking — core halted, waiting for code |
| led2 | 19 | Fault | OFF — no capability fault |
| led3 | 20 | Heartbeat | Blinking ~1 Hz — clock alive |

**100% success = all four of these are true:**

1. **led0 solid ON** — boot ROM ran to completion
2. **led1 blinking** — core is halted (ready for code)
3. **led2 OFF** — no capability fault
4. **led3 blinking** — 27 MHz clock is running, heartbeat active

**One solid + two blinking = success.** The Church Machine booted and is
waiting for you to send it code.

**Serial verification (optional):**

```bash
python3 local_bridge.py --monitor /dev/ttyUSB1
```

You should see the boot banner followed by a 13-byte call-home packet
(magic `0xCE11`).

### Troubleshooting — Failure Diagnostic Table

If something is wrong, find your symptom below:

| Symptom | Cause | Fix |
|---------|-------|-----|
| 0 LEDs lit | Flash failed or wrong board selected | Re-run `./flash.sh`; check USB cable is data-capable |
| 1 solid + 0 blinking | Clock not running (bad bitstream) | Rebuild from IDE Builder |
| 1 solid + 1 blinking only | led3 missing from port list | Stale Verilog — click Build in IDE and re-download |
| 2 blinking + 0 solid | Unexpected state | Report with serial log |
| 3 LEDs correct but serial blank | Wrong serial port | Use `/dev/ttyUSB1` (UART), not `/dev/ttyUSB0` (JTAG) |
| 3 LEDs + serial OK but no call-home | Bridge not running or wrong IDE URL | Run `./bridge.sh --ide=URL`; verify URL matches your IDE |
| Board in Devices panel but offline after 90s | Heartbeat lost (USB disconnect) | Reconnect USB; restart bridge |
| "Cell ledN not found" in nextpnr log | Stale Verilog (old build) | Click Build in IDE, re-download ZIP |
| Permission denied on /dev/ttyUSB* | User not in dialout group | `sudo usermod -aG dialout $USER` then log out/in |

### Step 6 — Connect to the IDE and deploy code

After flashing, connect the board to the Church Machine IDE so you can
deploy code from the browser.

**Single board:**

```bash
cd ~/church-fpga
./bridge.sh --ide=https://cloomc.org
```

`bridge.sh` auto-detects the serial port and launches `local_bridge.py`.
The board sends a call-home packet; the bridge registers it with the IDE.
Your board appears in the **Devices** panel within seconds.

**Multiple boards (IoT deployment):**

1. Plug your Tang Nano 20K boards into a USB hub (all use the same
   bitstream — flash each one with the same `.fs` file)
2. On the machine with the USB hub, run one bridge per board:

```bash
python3 local_bridge.py /dev/ttyUSB1 --ide=https://cloomc.org
python3 local_bridge.py /dev/ttyUSB3 --ide=https://cloomc.org
python3 local_bridge.py /dev/ttyUSB5 --ide=https://cloomc.org
```

3. Each board boots, sends a call-home packet, and appears in the IDE

**Deploying code:**

1. Open the IDE and go to **Devices** (from the hamburger menu)
2. You will see each connected board with its status (online/offline),
   board type badge, firmware version, and boot count
3. Click **Deploy** on any board to push a compiled abstraction to it
4. Select the program (from the editor or a saved namespace entry)
5. Click **Confirm** — the IDE sends BEEF-framed data through the
   bridge to that specific board's FPGA
6. The board verifies the CRC, writes to BRAM, and starts execution
7. Use **Deploy All** to push the same program to every online board

**What the call-home packet does:**

When a board boots with the current bitstream, it sends a 13-byte
registration packet over UART: magic header (0xCE11), board type,
firmware version, and an 8-byte device UID. The bridge detects this,
sends an acknowledgment (0xCE22), and registers the board with the
IDE server. A 60-second heartbeat keeps the board marked as online.

```
Board powers on → Boot ROM → Banner → Call Home → HALT (waiting)
                                          ↓
Bridge detects 0xCE11 → ACK 0xCE22 → Register with IDE server
                                          ↓
                              Board appears in Devices panel
```

**Labelling boards:**

Each board has a label field in the Devices panel. Type a name
(e.g. "Kitchen sensor", "Classroom #3", "Front door") to identify
your boards when managing multiple devices.

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

### Patching is a one-click operation

On a conventional computer, deploying software is anxious work. You
test, review, stage, canary, roll back if something breaks. You need
all of this ceremony because the machine itself offers no guarantees —
any program can corrupt any memory, call any system call, and crash
any other process.

On the Church Machine, **the six Laws extend from the IDE into the
runtime.** The IDE enforces them at compile time: CLOOMC validates
capability requirements, checks bounds, generates minimum-privilege
grants, and produces correct UART frames with CRC checksums. The
hardware enforces them at execution time: every instruction fetch is
checked by CR14, every thread stack bounded by CR12, every heap access by
CR5. There is no gap between what the IDE promises and what the
machine delivers.

This means patching is a **one-click operation.** Click Patch in the
IDE. The abstraction is compiled, validated, framed, checksummed, and
sent to the FPGA. When it arrives, the hardware loads it into the
namespace and begins execution under full capability enforcement. If
the code attempts anything it was not granted permission to do, the
machine faults — safely, immediately, visibly. There is no "deploy
and pray." There is no rollback procedure. There is no canary. The
machine will not permit the code to misbehave, so you do not need
to worry about whether it will.

Write. Click. Run. The Laws hold from editor to silicon.
[See it in action](https://cloomc.com/oneclick).

```
FLASH (once)     →  fail-safe COMPUTER  (the machine itself)
PATCH (one click) → fail-safe SOFTWARE  (your abstractions)
```

The bitstream is the lock. The patch is what you put inside the lock.
The lock never opens for anything without a key.

---

## Abstraction, MTBF, and Reuse

### What an abstraction is

Every piece of software you write for the Church Machine is an
**abstraction** — a named, capability-secured unit of logic with its
own namespace slot, its own capability list, and one or more callable
methods. An abstraction is not a library, a module, or a package. It is
a logical entity that lives in the namespace, cannot be forged, and can
only be reached through a capability you have been explicitly granted.

> To see how a namespace evolves from raw hardware registers into a
> rich, application-level vocabulary, read the
> [Namespace Vocabulary Tutorial](namespace-vocabulary-tutorial.md).

This changes what software means. When you call `SlideRule.Sin`, you are
not jumping to an address — you are presenting a capability to the
hardware. The hardware checks it. If the check fails, it faults. If it
passes, execution enters the abstraction under the permissions it was
granted, and no others. When the method returns, your capability
registers are exactly as they were before the call. The callee cannot
modify your state. The hardware guarantees this on every cycle, at full
speed.

### MTBF = ∞

Mean Time Between Failures on the Church Machine is not a statistic
about hardware reliability. It is a property of your software design.

A Church Machine abstraction has MTBF = ∞ when it never triggers a
capability fault and never halts abnormally under normal operation. This
is achievable — not just as an aspiration, but as a demonstrable,
measurable fact. The simulator tracks cycles between faults. When that
counter reaches millions of cycles without a single fault, you have
evidence. When you can show by inspection that your abstraction touches
only what it was explicitly granted, you have a proof.

MTBF = ∞ is the target the IDE is designed to help you reach:

- The **Fault** button shows you every capability violation — the
  moment it happens, with full context.
- The **CRs** panel shows every active capability at every step.
- The **CLOOMC** compiler checks your grants at compile time before
  the abstraction ever runs.

When your abstraction runs clean in the simulator — zero faults across
millions of cycles — it will run clean on silicon. Not because you were
careful, but because the machine cannot permit it to misbehave. The
transition from simulator to hardware is not a leap of faith. It is a
proof carried in silicon.

### Reuse as the engine of progress

Every abstraction you verify is a foundation for the next one.

When you build on `SlideRule`, you do not re-verify trigonometry — you
inherit the hardware's enforcement of SlideRule's capability contract.
When you call `Navana.Add`, you do not re-verify namespace writes. You
present a capability, the hardware checks it, and you proceed on solid
ground.

This is compounding progress. In conventional computing, each new layer
of software inherits every unfixed bug in every layer below it — thirty
years of CVEs are the evidence. On the Church Machine, each new layer
inherits only the **capability grants** from layers below. The
composition of fail-safe components is still fail-safe. Not by policy,
not by code review — by hardware enforcement on every instruction.

The practical consequence: as the Mum Tunnel Library grows, the cost of
writing a new abstraction falls. The first person who writes a verified
sensor driver does the hard work. Everyone who builds on it afterwards
gets the security for free. Verified bricks become verified walls.
Verified walls become verified buildings.

**Write once, verify once, reuse forever.** That is how you accelerate
progress in the Information Age. That is what fail-safe computer science
looks like when it compounds.

### How to aim for MTBF = ∞ in practice

1. **Request minimum permissions.** Your abstraction should ask for
   exactly the capabilities it needs and no more. Minimum grants shrink
   the attack surface and make faults easier to interpret.

2. **Let the hardware tell you when you are wrong.** A capability fault
   is not a crash — it is a precise, logged diagnostic. Read it, fix
   the grant, run again. The machine is your test suite.

3. **Run millions of cycles before you ship.** The simulator is free and
   fast. Cycle counts cost nothing in the IDE. Drive your fault counter
   to zero across every input class your abstraction will see.

4. **Build on verified components.** Every abstraction in the Mum Tunnel
   Library was verified by its author. When you call it, you are not
   betting on their code — you are relying on the hardware's enforcement
   of the capability contract they published.

5. **The goal is a quiet Fault light.** The led2 on your board (Fault)
   should never light up in normal operation. If it does, you have a
   capability problem — and the simulator will show you exactly what it
   is before you ever touch the board.

---

## Writing and Patching Code

This is your everyday workflow. Because the IDE constraints and the
six Laws extend continuously into the runtime, the whole cycle is a
single confident action — not a multi-stage deployment pipeline.

```
IDE ── write ──► Patch (one click) ──► FPGA runs under full capability enforcement
```

### Step 7 — Export the patch file

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

### Step 8 — Flash the patch to the FPGA

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

### Step 9 — Check the LEDs

- **led0** stays solid (boot complete)
- **led1** stops blinking (core now running your code)
- **led2** OFF = no fault, ON = capability fault triggered

To change your code, repeat Steps 1–2 then 7–9: edit, compile, export,
patch. Each cycle takes under a minute.

---

## Getting Started: Efinix Ti60 F225

The Ti60 is the full Church Machine — every feature, maximum memory,
research-grade capability security. It is slightly larger and more
expensive than the Tang Nano, but it is not harder to use. You still
need only three things to get started.

### What you need

| What | Where to get it |
|------|-----------------|
| **Efinix Ti60 F225 dev kit** | [Digi-Key](https://www.digikey.com/en/products/detail/efinix-inc/TI60F225C-DK/15672425) — ~£250 |
| **USB-C cable** (data, not charge-only) | Any electronics shop |
| **Google Chrome or Microsoft Edge** | Already on your computer |

That is it. No compiler. No toolchain. No special software.
The Church Machine IDE runs in your browser and does everything else.

> **Note for parents and teachers:** The Ti60 is the research board.
> If you are buying for a child or classroom just starting out,
> the **Tang Nano 20K** (~£5) does exactly the same things and costs
> much less. Start there. Upgrade to the Ti60 when you want the full
> architecture — lambda calculus, garbage collection, and multi-threaded
> secure contexts.

---

### Step 3 — Download the official bitstream from the IDE

You do not need to build anything. The Church Machine IDE has already
compiled and tested the Ti60 bitstream for you. Just download it.

1. Open the **Church Machine IDE** in Chrome or Edge
2. Click the **Builder** tab (the hard hat icon in the toolbar)
3. Select **Ti60 F225** from the board menu
4. Click **Download FPGA Package**

A ZIP file downloads to your computer. It contains everything —
the bitstream, the bridge script, and a `flash.sh` helper.

---

### Step 4 — Install the flasher (one time, takes two minutes)

You need one small open-source tool to get the bitstream onto the board.
It is free and takes about two minutes to install.

**On Linux or ChromeOS (Linux container):**

```bash
# Download the OSS CAD Suite (contains openFPGALoader)
# https://github.com/YosysHQ/oss-cad-suite-build/releases
# Download the latest release for your OS, then:
tar -xf oss-cad-suite-*.tgz
source oss-cad-suite/environment
```

**On Windows:** Download OSS CAD Suite for Windows from the same page —
it includes openFPGALoader as `openFPGALoader.exe`.

You only do this once. After that, flashing is a single command.

---

### Step 5 — Plug in and flash

1. Plug the Ti60 into your computer with the USB-C cable
2. Check it appeared:

```bash
ls /dev/ttyUSB*
# You should see /dev/ttyUSB0 and /dev/ttyUSB2
```

3. Extract the ZIP and flash:

```bash
mkdir -p ~/church-ti60 && cd ~/church-ti60
unzip ~/Downloads/church-ti60-package.zip
chmod +x flash.sh
./flash.sh
```

`flash.sh` finds the board automatically and flashes it.
The whole thing takes under a minute.

**Permission error?** Run this once, then log out and back in:
```bash
sudo usermod -aG dialout $USER
```

---

### Step 6 — Check the lights

When the flash finishes, the Church Machine boots on its own.
Look at the four LEDs on the board:

| LED | What you should see | What it means |
|-----|---------------------|---------------|
| **LED 0** | Solid ON | Boot finished — Church Machine is running |
| **LED 1** | Blinking | Core is ready and waiting for your code |
| **LED 2** | OFF | No problems — all capability checks passing |
| **LED 3** | Blinking | Clock running — the machine is alive |

**One solid, two blinking, one off = success.**

If LED 2 is on, something went wrong. Try flashing again with `./flash.sh`.
If it still lights up, see the troubleshooting table below.

---

### Step 7 — Connect to the IDE and see your board

Run the bridge script to connect the Ti60 to the Church Machine IDE:

```bash
cd ~/church-ti60
./bridge.sh --ide=https://cloomc.org
```

Go back to the IDE, click **Devices** in the menu, and your Ti60
will appear — labelled **Ti60 F225**, showing its firmware version
and the number of times it has booted.

You can give it a friendly name: click the name field and type
something like "My Ti60" or "Lab Board 1".

That is it. The Church Machine is running on real silicon and talking
to the IDE. Now write some code, click **Deploy**, and watch it run.

---

### What success looks like

```
Board boots → prints greeting banner over USB
           → sends CALLHOME packet to IDE
           → LED 0 on, LED 1 blinking, LED 2 off, LED 3 blinking
           → appears in IDE Devices panel
           → ready for your first program
```

The smoke test that proves everything is working:

```bash
python3 ../../scripts/test_ti60_uart.py --port=/dev/ttyUSB2 --timeout=30
```

All four checks should say **PASS**:

```
[PASS]  GREETING: SoC boot greeting present
[PASS]  BOOT_COMPLETE: CM boot_complete: 1 line seen
[PASS]  NIA_LINES: At least one NIA=0x... line seen
[PASS]  CALLHOME_JSON: At least one valid CALLHOME JSON line seen
OVERALL: PASS
```

---

### Troubleshooting

| What you see | What to try |
|--------------|-------------|
| No LEDs at all | Check USB cable is data-capable (not charge-only) |
| All LEDs on solid | Flash failed — run `./flash.sh` again |
| LED 2 (Fault) on | Capability fault during boot — reflash the official bitstream |
| Board not in Devices panel | Check `./bridge.sh` is running; verify IDE URL |
| `/dev/ttyUSB*` not found | Try a different USB port; check `lsusb` for the board |
| Permission denied | `sudo usermod -aG dialout $USER` then log out and back in |
| Smoke test GREETING fails | Run test again — greeting re-prints every ~100 seconds |

### LED meanings (same signals, opposite polarity to Tang Nano)

| LED | Ti60 (lights when HIGH) | Tang Nano (lights when LOW) |
|-----|-------------------------|-----------------------------|
| Boot/Run | ON = boot complete | ON = boot complete |
| Halt | Blinking = waiting for code | Blinking = waiting for code |
| Fault | OFF = no fault | OFF = no fault |
| Heartbeat | Blinking = clock alive | Blinking = clock alive |

After flashing, writing and deploying code is identical to the Tang Nano —
write in the IDE, click **Deploy**, and your abstraction runs on the Ti60
under full capability enforcement. The code you tested in the simulator
runs unchanged on silicon.

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

- **IDE** — simulator accuracy, CLOOMC compiler, abstraction creator, hardware
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

The build has two phases. The first phase runs in the IDE. The second
phase runs on your local machine because it requires more RAM than a
cloud container provides and physical USB access to flash the board.

### Phase 1 — Build in the IDE (both boards)

The IDE Builder tab handles Verilog generation and Yosys synthesis
for you. No terminal commands needed.

1. Open the **Builder** tab in the IDE
2. Select your board (Tang Nano 20K or Ti60 F225)
3. Click **Build** — this runs Amaranth elaboration and Yosys
   synthesis (typically 20–60 seconds)
4. When the build completes, click **Download FPGA Package** — this
   downloads a ZIP containing everything you need for phase 2

**What the ZIP contains (Tang Nano 20K):**

| File | Purpose |
|------|---------|
| `church_tang_nano_20k.json` | Yosys netlist (synthesis output) |
| `church_tang_nano_20k.v` | Synthesisable Verilog |
| `tang_nano_20k.cst` | Pin constraints |
| `Makefile` | Build targets for PnR + flash |
| `flash.sh` | One-command build + flash script |
| `bridge.sh` | Connect board to IDE after flashing |
| `local_bridge.py` | Serial bridge server (used by bridge.sh) |
| `BUILD.md` | Instructions, LED pinout, diagnostics |

**What the ZIP contains (Ti60 F225):**

| File | Purpose |
|------|---------|
| `church_ti60_f225.v` | Synthesisable Verilog |
| `church_ti60_f225.edif` | Yosys EDIF netlist |
| `ti60_f225.isf` | Pin constraints (Efinity IDE) |
| `BUILD.md` | Instructions for phase 2 |

If you prefer terminal commands (advanced users), you can run the
same steps manually:

```bash
# Tang Nano 20K
python3 -m hardware.gen_verilog --iot build
yosys -p "read_verilog build/church_tang_nano_20k_iot.v; \
          synth_gowin -top top \
          -json build/church_tang_nano_20k_iot.json"
```

### Phase 2 — Place, route, and flash (local machine)

Phase 2 requires your local machine for two reasons: place and route
needs ~20 GB of RAM, and flashing requires a USB cable to the board.

#### Tang Nano 20K (open-source toolchain)

Extract the ZIP downloaded from the IDE, then:

```bash
# 1. Place and route (~20 GB RAM, 3–5 minutes)
nextpnr-himbaechel \
    --device GW2AR-LV18QN88C8/I7 \
    --json church_tang_nano_20k_iot.json \
    --write church_tang_nano_20k_iot_pnr.json \
    -o family=GW2A-18C \
    -o cst=tang_nano_20k.cst \
    --freq 27

# 2. Pack the bitstream
gowin_pack -d GW2A-18C \
    -o church_tang_nano_20k_iot.fs \
    church_tang_nano_20k_iot_pnr.json

# 3. Flash
openFPGALoader -b tangnano20k church_tang_nano_20k_iot.fs
```

Or use the included Makefile:

```bash
make tang-iot      # place-and-route + pack
make prog-iot      # flash
```

#### Efinix Ti60 F225 (proprietary toolchain)

The Ti60 requires the Efinity IDE from Efinix for place-and-route
and bitstream generation. Extract the ZIP, then:

1. Open the Efinity IDE and import the project
2. Add `church_ti60_f225.v` as the top-level source
3. Run the Efinity synthesis, placement, and routing flow
4. Generate the bitstream (`.hex` or `.bit` file)
5. Flash using the Efinity Programmer GUI

> **On Linux or Chromebook?** You can flash the Ti60 with `openFPGALoader`
> from OSS CAD Suite instead of the Efinity Programmer — no proprietary
> tools required:
>
> ```bash
> source ~/oss-cad-suite/environment
> ls /dev/ttyUSB*                                           # check JTAG port
> openFPGALoader -b titanium_ti60_f225 church_ti60_f225.bit
> ```
>
> See **[docs/bridge-setup-chromeos.md](bridge-setup-chromeos.md)** for the
> full install and troubleshooting guide (Step 0 covers flashing, Steps 1–8
> cover the bridge).

### Summary: what runs where

| Step | Where | How |
|------|-------|-----|
| Verilog generation | IDE | Builder tab → Build |
| Yosys synthesis | IDE | Builder tab → Build |
| Download package | IDE | Builder tab → Download FPGA Package |
| Place and route | Local | `nextpnr` (Tang) or Efinity (Ti60) |
| Pack bitstream | Local | `gowin_pack` (Tang) or Efinity (Ti60) |
| Flash | Local | `openFPGALoader` (Tang) or Efinity (Ti60) |

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

> **Efinity on Crostini:** if Efinity IDE crashes on startup, launch it with
> `QT_QPA_PLATFORM=xcb LIBGL_ALWAYS_SOFTWARE=1 ~/efinity/2026.1/bin/efinity &`
> — this forces X11 + software rendering, which is required in the ChromeOS
> Linux container. See `docs/hardware-ti60-f225.md` for a permanent launcher script.
>
> **Efinity GUI on Chromebook Penguin (Debian container):** the GUI splash
> screen crashes immediately — this is a known Qt/X11 limitation of the Penguin
> container and is not supported by Efinix. Use headless CLI tools only
> (`efx_map`, `efx_pnr`, `efx_pgm`) — synthesis and programming work correctly
> without the GUI. Upgrade to Efinity v2026.1 full release (do not apply
> 2025.2 patches on top of 2025.2 base) to avoid the EFX_PNR SIGSEGV crash.
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
- Is the serial port correct (ttyUSB1, not ttyUSB0)?
- Close any other serial terminals that might be holding the port

### "Editor is empty"

- Click a CR first (the CRs button), then click Edit
- The abstraction creator only appears when you select a CR to edit

### LEDs don't change after patching

- Check that the patch echoed correctly (addr and count match)
- Check for capability faults (led2 ON)
- Try resetting the board (unplug/replug USB)
- Verify with the bridge (click BRAM in the toolbar to read back memory)

---

## Quick Reference

### First-time setup (Tang Nano 20K)

| Step | Where | What |
|------|-------|------|
| 1 | Local | Install OSS CAD Suite + pyserial |
| 2 | IDE | Download `.fs` bitstream + `patch_fpga.py` |
| 3 | Local | Plug in board, check `/dev/ttyUSB*` |
| 4 | Local | `openFPGALoader -b tangnano20k *.fs` |
| 5 | Board | Check LEDs: solid + blinking + blinking |

### Everyday code patching (both boards)

| Step | Where | What |
|------|-------|------|
| 6 | IDE | Click CRs → select CR → Edit → write code |
| 7 | IDE | Click Patch → test in simulator |
| 8 | IDE | Click Export Patch → downloads `.patch` file |
| 9 | Local | `python3 patch_fpga.py /dev/ttyUSB1 file.patch` |
| 10 | Board | Check LEDs: solid = running, led2 = fault |

### Pin reference

| Board | Clock | TX | RX | LEDs | Button |
|-------|-------|----|----|------|--------|
| Tang Nano 20K | 4 (27 MHz) | 69 | 70 | 15,16,19,20 (LOW) | 88 |
| Ti60 F225 | PLL (50 MHz) | H14 | M14 | C13,A13,D14,B14 (HIGH) | — |

---

## Reference Material

The sections below provide background on the Church Machine architecture,
the Church-Turing thesis, the CLOOMC compiler, and the security model.
They are not required to get started — the quick start above is all you
need — but they explain why things work the way they do.

---

### The Six Laws

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
   fetch. CR12 bounds the thread lump stack. CR5 checks the heap. No
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

### The Church-Turing Thesis

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

### CLOOMC — the Universal Capability Compiler

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
a program, click Patch, and the IDE assembles it into machine words,
validates capability requirements, and writes it into simulator memory.

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

### Example: Ada Lovelace's Bernoulli Abstraction

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

#### Why this abstraction is immortal

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

#### For production: SlideRule.Bernoulli(n)

The NoteG abstraction above preserves Ada's original 25-operation
algorithm for historical fidelity. For production use, the SlideRule
abstraction provides `Bernoulli(n)` as a single CALL instruction
that computes any Bernoulli number B(n) and returns the result as a
fraction (numerator in DR1, denominator in DR2):

```
-- Production: compute B7 in one instruction
IADD DR1, DR0, #7
CALL SlideRule.Bernoulli
-- DR1 = -1, DR2 = 30 → B7 = -1/30
```

Both approaches produce the same mathematical result. The difference
is that NoteG shows the work — 25 operations, exactly as Ada
published them — while SlideRule.Bernoulli encapsulates it.

---

### Why This Matters

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
*Confidential — Kenneth Hamer-Hodges — April 2026*
