# Church Machine

[![CI / Fast](https://github.com/khhodges/church-machine/actions/workflows/ci.yml/badge.svg)](https://github.com/khhodges/church-machine/actions/workflows/ci.yml)

A capability-oriented processor architecture with an educational IDE. The current
hardware target is the QMTECH Wukong A7 (Artix-7 XC7A100T). A 32-bit Golden
Token (GT) carries a namespace slot, sequence/version, type/domain, permissions,
and bind flag. Object location, bounds, and the `integrity32` value live in the
referenced capability/namespace entry rather than in the GT word itself. The
simulator and FPGA RTL check these fields at the relevant access gates. This is
an implemented enforcement mechanism, not a claim that the present system is
formally proven unforgeable or eliminates every vulnerability class.

## Project Status

| Area | Status |
|---|---|
| Web IDE and simulator | Current and executable in this repository |
| Wukong A7 / XC7A100T | Current hardware development and release target |
| Tang Nano 20K | Legacy/experimental IoT profile; retained source is not the current hardware release path |
| Ti60 F225 and pico-ice | Historical targets; their documents live under `docs/archive/` and are non-authoritative |
| UART security, FW=2 | Shipped protocol is plaintext; the physical UART link is the trust boundary |
| UART security, FW=3 | Authenticated encryption is a design goal, not shipped behavior |

Executable evidence for current enforcement behavior includes the simulator tests
under `simulator/`, the hardware tests under `tests/hardware/`, and the Wukong
build guards referenced by [`docs/HARDWARE.md`](docs/HARDWARE.md). These tests
cover specific behaviors; they are not a formal proof of the whole security model.

## What Is This?

The Church Machine is a processor that fuses two computational models through symbolic addressing:

- **Church domain** — Lambda calculus operations (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA) that manipulate capabilities
- **Turing domain** — Integer arithmetic and data operations (DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR) that process data

The current simulator and RTL enforce the encoded Church/Turing permission checks
at their implemented gates. Turing code runs inside Church-callable abstractions —
Church is the security interface and Turing is the implementation domain. Treat
broader non-interference or isolation statements as architecture goals unless they
name a test or formal proof.

## Quick Start

### Web Simulator

1. Open the IDE at the project URL
2. Click **Code** to open the assembly editor
3. Select an example (Self-Test, Salvation, Bernoulli)
4. Click **Assemble** then **Step** or **Run**

### Hardware (Wukong A7)

```bash
python3 -m hardware.gen_rtlil --wukong
cp build/church_wukong_xc7a100t.v hardware/
cd hardware
vivado -mode batch -source wukong_xc7a100t.tcl
```

Prerequisite: Xilinx Vivado. See [`docs/HARDWARE.md`](docs/HARDWARE.md) for the
complete build, programming, bridge, and tested-version notes. Tang Nano material
is retained for legacy/experimental work and is not the current release procedure.

## Community

Have a question, want to share something you built, or looking for help? Join the conversation on [GitHub Discussions](https://github.com/khhodges/cloomc-project/discussions/categories/q-a) — the Q&A category is the best place to ask and answer questions.

## Project Structure

```
hardware/           Amaranth HDL and Wukong A7 build/bridge support
  core.py           Church Machine processor core
  wukong_top.py     Current Wukong A7 top-level
  wukong_xc7a100t.* Vivado constraints and build script
  wukong_bridge.py  Plain UART trace/control/upload bridge

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

Every capability uses a 32-bit Golden Token word:

```
| Bind (1) | Perm (3) | Domain (1) | Type (2) | Sequence (9) | Slot (16) |
```

- **Slot** — 16-bit namespace slot index
- **Sequence** — 9-bit revocation/version counter; checked against the entry
- **Type** — 2 bits: NULL (00), Inform (01), Outform (10), Abstract (11)
- **Domain + permissions** — Turing (`X/W/R`) or Church (`E/S/L`) with a
  three-bit permission payload
- **Bind** — bindable override used by defined delegation/I/O paths

The referenced namespace entry separately carries location in W0, bounds,
sequence, GC/far flags in W1, and the 32-bit `integrity32(W0,W1)` check in W2.

### Registers

- **CR0–CR15** — 128-bit Context Registers holding Golden Tokens
  - CR6: Current c-list (capability list)
  - CR12: Current thread
  - CR14: Current code object
  - CR15: Namespace root
- **DR0–DR15** — 32-bit Data Registers (DR0 is hardwired to zero)

### Security Model

Capability-mediated accesses pass through the implemented validation gates,
including **mLoad** and **mSave**:

1. GT type check (NULL → FAULT)
2. Version validation (mismatch → FAULT)
3. Integrity/seal verification for the relevant object format
4. Bounds check (access within object limits)
5. Permission check (R/W/X/L/S/E as required)
6. Namespace-entry far/foreign flag handling
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
- [Current Wukong hardware](docs/HARDWARE.md) — status, build, programming, and bridge
- [CM_MSG protocol](docs/cm-msg-protocol.md) — shipped FW=2 plaintext versus planned FW=3 encryption
- [Archived hardware documents](docs/archive/) — historical context only
- [Getting Started](docs/getting-started.md) — Tutorial for educators and students

## License

This project implements patented capability-based security architecture. See docs/ for patent references.
