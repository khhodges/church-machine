# Church Machine

[![CI](https://github.com/khhodges/church-machine/actions/workflows/ci.yml/badge.svg)](https://github.com/khhodges/church-machine/actions/workflows/ci.yml)

A capability-secured processor architecture with an educational IDE, targeting the Tang Nano 20K FPGA. The Church Machine implements Golden Token (GT) security — every memory access is validated through unforgeable capability tokens, eliminating entire classes of vulnerabilities by construction.

## What Is This?

The Church Machine is a processor that fuses two computational models:

- **Church domain** — Lambda calculus operations (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA) that manipulate capabilities
- **Turing domain** — Integer arithmetic and data operations (DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR) that process data

Domain purity is enforced in hardware: a code object is either Church or Turing, never both. Turing code runs inside Church-callable abstractions — Church is the armor (security interface), Turing is the sword inside (implementation).

## Quick Start

### Web Simulator

1. Open the IDE at the project URL
2. Click **Code** to open the assembly editor
3. Select an example (Self-Test, Salvation, Bernoulli)
4. Click **Assemble** then **Step** or **Run**

### Hardware (Tang Nano 20K)

```bash
cd hardware
make verilog    # Generate Verilog from Amaranth HDL
make synth      # Synthesize with Yosys
make pnr        # Place and route with NextPNR-Gowin
make pack       # Create bitstream
make prog       # Upload to Tang Nano 20K
```

Prerequisites: [oss-cad-suite](https://github.com/YosysHQ/oss-cad-suite-build) (includes yosys, nextpnr-gowin, gowin_pack, openFPGALoader).

## Community

Have a question, want to share something you built, or looking for help? Join the conversation on [GitHub Discussions](https://github.com/khhodges/cloomc-project/discussions/categories/q-a) — the Q&A category is the best place to ask and answer questions.

## Project Structure

```
hardware/           Amaranth HDL implementation (Tang Nano 20K target)
  core.py           Church Machine processor core
  tang_nano_20k.py  Top-level platform (Gowin BSRAM, UART, LEDs)
  tang_nano_20k.cst Pin constraints
  gen_verilog.py    Verilog generation script
  Makefile          Full FPGA build chain

simulator/          Web-based IDE and simulator
  index.html        Single-page IDE interface
  simulator.js      Cycle-accurate simulator engine
  assembler.js      Assembly language parser and encoder
  abstractions.js   Abstraction registry (44 abstractions, 9 layers)
  app.js            UI controller
  styles.css        Church Gold theme

server/             Flask backend
  app.py            HTTP server (serves simulator, API endpoints)
  models.py         Database models

docs/               Architecture and reference documentation
```

## Architecture Overview

### Golden Tokens (GTs)

Every capability is a 32-bit Golden Token:

```
| Version (7) | Index (17) | Permissions (6) | Type (2) |
```

- **Version** — 7-bit counter; must match namespace entry version or access FAULTs
- **Index** — 17-bit namespace entry index (up to 131,072 entries)
- **Permissions** — 6 bits: R (read), W (write), X (execute), L (load), S (save), E (enter)
- **Type** — 2 bits: Inform (00), Outform (01), NULL (10), Abstract (11)

### Registers

- **CR0–CR15** — 128-bit Context Registers holding Golden Tokens
  - CR6: Current c-list (capability list)
  - CR7: Current code object ([CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html))
  - CR8: Thread identity
  - CR15: Namespace root
- **DR0–DR15** — 32-bit Data Registers (DR0 is hardwired to zero)

### Security Model

Every memory access passes through **mLoad** (read gate) or **mSave** (write gate):

1. GT type check (NULL → FAULT)
2. Version validation (mismatch → FAULT)
3. Seal verification (FNV-1a hash)
4. Bounds check (access within object limits)
5. Permission check (R/W/X/L/S/E as required)
6. F-bit check (far/foreign object detection)
7. Data delivery (on success)

### Abstraction Layers

The system organizes 44 abstractions across 9 layers:

| Layer | Name | Examples |
|-------|------|----------|
| 0 | Boot | NS root, Thread, CList, [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) |
| 1 | System Services | Salvation, Mint, Memory, Scheduler, Stack |
| 2 | Hardware | UART, LED, Button, Timer, Display |
| 3 | Mathematics | SlideRule, Abacus, Constants, Circle |
| 4 | Lambda Calculus | Lambda, Church Numerals (SUCC..FALSE), PAIR |
| 5 | Social | Family, Schoolroom, Friends, Tunnel, Negotiate |
| 6 | IDE | Editor, Assembler, Debugger, Deployer |
| 7 | Internet | Browser, Messenger, Photos, Social, Video, Email |
| 8 | Garbage Collection | PP250 deterministic GC |

## Documentation

- [Architecture](docs/architecture.md) — System design and security model
- [Abstractions](docs/abstractions.md) — Complete catalog of all 44 abstractions
- [Instruction Set](docs/instruction-set.md) — All 20 instructions with encoding details
- [Tang Nano 20K](docs/tang-nano-20k.md) — FPGA target and hardware build
- [Getting Started](docs/getting-started.md) — Tutorial for educators and students

## License

This project implements patented capability-based security architecture. See docs/ for patent references.
