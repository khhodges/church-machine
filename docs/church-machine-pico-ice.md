# Church Machine on pico-ice FPGA

## Overview

The Church Machine is a pure lambda calculus processor — a standalone, Church-only 32-bit capability-secure computer running on a [pico-ice](https://pico-ice.tinyvision.ai/) FPGA development board. The board combines a Lattice iCE40UP5K FPGA with a Raspberry Pi RP2040 microcontroller that provides USB bridging and UART communication.

**Hardware specifications:**
- FPGA: Lattice iCE40UP5K-SG48
- Clock: 12 MHz (internal HFOSC)
- Logic utilization: ~4520 LUT4 out of 5280 (85%)
- Memory: 2 SPRAM blocks (64KB data memory)
- Boot ROM: Constant instruction memory (synthesized into LUTs)
- I/O: UART (115200 baud), RGB LED, push button

## Architecture

The Church Machine on pico-ice uses a split memory architecture:

```
┌─────────────────────────────────────────────┐
│                pico-ice FPGA                │
│                                             │
│  ┌──────────┐        ┌───────────────────┐  │
│  │ Boot ROM │──imem──│   Church Core     │  │
│  │ (LUTs)   │        │                   │  │
│  │ 12 instr │        │ CR0-CR15, DR0-DR3 │  │
│  └──────────┘        │ PC, flags, stack  │  │
│                      └───────┬───────────┘  │
│                              │ dmem         │
│                      ┌───────┴───────────┐  │
│                      │    SPRAM (64KB)    │  │
│                      │ 0x000: Namespace   │  │
│                      │ 0x0C0: C-list      │  │
│                      │ 0x100+: Scratch    │  │
│                      └───────────────────┘  │
│                                             │
│  ┌──────────┐        ┌───────────────────┐  │
│  │ UART RX  │◄──────►│  Loader FSM       │  │
│  └──────────┘        │  (upload/autoboot) │  │
│  ┌──────────┐        └───────────────────┘  │
│  │ UART TX  │◄── Debug Printer (banner,     │
│  └──────────┘    NIA, HALT, fault)          │
└─────────────────────────────────────────────┘
         │ USB (via RP2040 bridge)
         ▼
    /dev/ttyACM1
```

### Why Boot ROM?

Instruction memory is stored as constant data in the Boot ROM (synthesized into FPGA lookup tables). This is not a limitation — it is a deliberate architectural decision.

When Yosys (the synthesis tool) sees constant instruction data, it can determine which decode paths are never taken and optimizes them away. This **constant propagation saves approximately 1800 LUTs**:

| Configuration | LUT4 Usage | Fits? |
|---|---|---|
| Boot ROM (constant instructions) | 4520 / 5280 (85%) | Yes |
| SPRAM instructions (runtime variable) | 6324 / 5280 (119%) | No |

Without constant propagation, the full instruction decoder must be preserved because any instruction could appear at runtime. The iCE40UP5K simply does not have enough logic cells for that.

**Consequence:** Changing the boot program requires rebuilding the FPGA bitstream. The namespace and c-list are reprogrammable via UART without rebuilding.

## Default Boot Program

The boot program is 12 instructions (padded to 256 words with zeros). It demonstrates three key Church Machine operations: LAMBDA (fast-path execution), CALL (full security pipeline), and SAVE (writing capabilities back to a c-list).

### Instruction-by-instruction

```
Addr  Instruction              Description
────  ───────────────────────  ──────────────────────────────────────
0x00  LOAD CR1, [CR6 + 0]     Load Golden Token from c-list slot 0 into CR1
                               (C-list is accessed via CR6; slot 0 = RX Inform GT → NS idx 3)

0x04  LOAD CR2, [CR6 + 1]     Load GT from c-list slot 1 into CR2
                               (Slot 1 = XE Inform GT → NS idx 4)

0x08  TPERM CR2, X            Set CR2 permissions to Execute-only (clear all others)

0x0C  LAMBDA CR2              Apply CR2 as a lightweight lambda
                               Fast-path: no stack push, immediate execution
                               This is the "sword inside the armor" — hidden Turing
                               implementation inside a Church-callable entry

0x10  LOAD CR0, [CR6 + 1]     Reload GT from c-list slot 1 into CR0

0x14  TPERM CR0, E            Set CR0 permissions to Enter-only (for CALL)

0x18  CALL CR0                Enter the abstraction via CALL
                               Full 7-step security pipeline:
                               E-GT validated → mLoad → CR6 set → X-GT loaded → CR7 set → PC=0
                               The callee sees only what it was granted

0x1C  LOAD CR7, [CR6 + 1]     Load GT from c-list slot 1 into CR7

0x20  TPERM CR7, X            Set Execute permission on CR7

0x24  LAMBDA CR7              Apply as lambda (second fast-path demonstration)

0x28  RETURN CR5              Return from current scope via CR5
                               Restores caller's context from call stack

0x2C  SAVE CR1, [CR6 + 2]     Save CR1 (the GT loaded in instruction 0) back to
                               c-list slot 2, demonstrating capability transfer
```

### Three operations demonstrated

1. **LAMBDA** (instructions 2-3, 8-9): The fast path. Set X permission with TPERM, then execute directly via LAMBDA. No call stack involved — the abstraction runs in the current scope. Used for performance-critical code application.

2. **CALL** (instructions 4-6): The full security pipeline. Set E permission with TPERM, then enter via CALL. The machine validates the GT (version, seal, permissions), sets up the callee's c-list in CR6, loads the entry point code GT into CR7, and begins execution at PC=0. The callee cannot see or access anything it wasn't explicitly granted.

3. **SAVE** (instruction 11): Writing a capability back into the c-list. The source GT must have B=1 (bindable) and the target c-list must have valid bounds. This is how capabilities are transferred between domains.

## Demo Namespace

The demo namespace contains 16 entries. Each entry is 3 words (96 bits):

| Word | Field | Description |
|---|---|---|
| 0 | Location | Physical memory address where the object begins |
| 1 | Limit & Flags | Bits 0-16: size (17-bit limit), Bit 30: F-bit (far/tunnel), Bit 31: B-bit (bindable) |
| 2 | Seal/Version | Bits 25-31: version (7-bit), Bits 0-24: FNV-1a MAC seal |

### Default entries

All 16 entries share the same structure: limit=8, B=1 (bindable), F=0, version=0, seal=0. Seal checking is disabled in the minimal iCE40 build (`ENABLE_SEAL_CHECK = False`). The limit word for all entries is `0x80000008` (B-bit set, limit=8).

| Slot | Location | Raw Word 1 |
|---|---|---|
| 0 | 0xFD00 | 0x80000008 |
| 1 | 0x0100 | 0x80000008 |
| 2 | 0x0200 | 0x80000008 |
| 3 | 0x0300 | 0x80000008 |
| 4 | 0x0400 | 0x80000008 |
| 5 | 0x0500 | 0x80000008 |
| 6 | 0x0600 | 0x80000008 |
| 7 | 0x0700 | 0x80000008 |
| 8-15 | 0x0800-0x0F00 | 0x80000008 |

Slot 0 is special: its location is `NS_TABLE_BASE` (0xFD00), meaning the namespace root's binary data IS the namespace table itself. Slots 1-15 are spaced at 256-word (0x100) intervals starting at 0x0100. In the demo configuration, all entries are generic placeholders; their roles are determined by the c-list GTs that reference them.

The namespace occupies **192 words** in SPRAM (16 entries x 3 words each, addresses 0x000 through 0x0BF).

## Demo C-List

The c-list (capability list) contains 64 Golden Token entries. Each GT is a single 32-bit word:

```
 31       25 24          8 7      2 1  0
┌──────────┬──────────────┬────────┬────┐
│ Version  │    Index     │ Perms  │Type│
│  (7 bit) │   (17 bit)  │ (6 bit)│(2b)│
└──────────┴──────────────┴────────┴────┘

Permission bits: R(0) W(1) X(2) L(3) S(4) E(5)
Types: Inform(00) Outform(01) NULL(10) Abstract(11)
```

### Default entries

| Slot | Hex Value | Type | Permissions | Target NS Index | Purpose |
|---|---|---|---|---|---|
| 0 | 0x00000314 | Inform | R, X | 3 | Read+Execute access to NS slot 3 |
| 1 | 0x00000490 | Inform | X, E | 4 | Execute+Enter access to NS slot 4 |
| 2 | 0x00000002 | NULL | — | — | Empty (SAVE target in boot program) |
| 3 | 0x00000280 | Inform | E | 2 | Enter-only access to NS slot 2 |
| 4 | 0x00000580 | Inform | E | 5 | Enter-only access to NS slot 5 |
| 5 | 0x00000620 | Inform | L | 6 | Load-only access to NS slot 6 |
| 6-7 | 0x00000002 | NULL | — | — | Empty |
| 8-63 | 0x00000000 | NULL | — | — | Empty (zero-filled) |

The c-list occupies **64 words** in SPRAM (addresses 0x0C0 through 0x0FF).

## UART Upload Protocol

The UART loader allows reprogramming the namespace and c-list without rebuilding the FPGA bitstream.

### Protocol

| Step | Data | Size |
|---|---|---|
| 1. Header | Word count as little-endian u32 | 4 bytes |
| 2. Payload | N words as little-endian u32 | N x 4 bytes |

- **Baud rate:** 115200
- **Format:** 8N1
- **Default payload:** 256 words (192 namespace + 64 c-list) = 1028 bytes total (including header)
- **Word count is bounds-capped** to 256 (DMEM_WORDS) for safety

### Memory layout of uploaded image

```
Word Address    Content
─────────────   ──────────────────────────────
0x000 - 0x0BF   Namespace (192 words = 16 entries x 3 words)
0x0C0 - 0x0FF   C-list (64 words = 64 Golden Tokens)
```

### Auto-boot behavior

After power-on or reset, the loader FSM waits approximately **1 second** for the first UART header byte:

- **If UART data arrives:** The loader receives the full header + payload, writes to SPRAM, then boots the core.
- **If no data arrives within ~1 second:** The loader copies built-in defaults (`DEMO_NAMESPACE` and `DEMO_CLIST` from `boot_rom.py`) into SPRAM, then boots the core.

In both cases, after boot completes, the UART TX sends:

```
CHURCH v1.0
<NIA hex value>
HALT
```

### LED indicators

| Color | State | Meaning |
|---|---|---|
| Blue | Solid | Waiting for UART upload / loading data |
| Green | Solid | Running (core executing) |
| Green | Blinking | Halted (waiting for button step) |
| Red | Solid | Fault detected |

## Web Simulator to Hardware Workflow

The web simulator can build a namespace + c-list image and export it for upload to the physical pico-ice:

1. **Configure in the simulator** — set up namespace entries and c-list as desired
2. **Click "Download Image"** — downloads `church_image.bin` (1028 bytes: 4-byte header + 256 words)
3. **Copy the file to your Linux terminal** (on ChromeOS, it downloads to `~/Downloads`)
4. **Upload to pico-ice:**
   ```bash
   python3 pico_upload.py --port /dev/ttyACM1 --image ~/Downloads/church_image.bin
   ```
5. Press the pico-ice reset button, then press Enter

The binary file format is the same UART protocol: 4-byte LE word count header followed by 256 x 4-byte LE data words (192 namespace + 64 c-list).

## Build and Flash Workflow

### Prerequisites

- Yosys, nextpnr-ice40, icestorm tools (via oss-cad-suite or system packages)
- Python 3 with Amaranth HDL
- pyserial (`pip install pyserial`)

### 1. Build the bitstream

```bash
make -C church_machine all
```

This runs three steps:
1. **Verilog generation** — Amaranth compiles `UartTestTop` to Verilog (`build/uart_test.v`)
2. **Synthesis** — Yosys synthesizes for iCE40 (`build/uart_test.json`)
3. **Place & Route** — nextpnr-ice40 fits the design (`build/uart_test.asc` → `build/uart_test.bin`)

### 2. Flash the bitstream

```bash
sudo dfu-util -d 1209:b1c0 --alt 1 --download build/uart_test.bin
```

This loads the bitstream into the FPGA's CRAM (volatile — lost on power cycle). The RP2040 USB bridge takes about 3 seconds to initialize after flashing.

### 3. Upload namespace and c-list (optional)

```bash
python -m church_machine.upload --port /dev/ttyACM1
```

The upload tool opens the serial port first, then prompts you to press the pico-ice reset button. The workflow is:

1. Run the command above
2. The script opens the port and waits
3. Press the **RP2040 reset button** on the pico-ice (the button that does NOT turn off the green LED)
4. Press Enter immediately — data must arrive within ~1 second of reset

The port must be opened before reset so the data can be sent instantly when the FPGA loader FSM is listening.

A standalone version (`pico_upload.py`) with no project dependencies is also available for use on machines without the full project installed.

To upload custom data, modify `boot_rom.py` or create a custom binary and use `--image file.bin`.

If you skip this step, the FPGA auto-boots with built-in defaults after ~1 second.

### 4. Verify

```bash
timeout 15 cat /dev/ttyACM1
```

Expected output after successful upload:
```
S:0000000C
HALT
```

Expected output after auto-boot with defaults:
```
CHURCH v1.0
00000008
HALT
```

The push button on the pico-ice single-steps one instruction per press. After each step, the UART prints `S:<NIA hex>` showing the next instruction address.

### Serial ports

| Port | Device | Purpose |
|---|---|---|
| /dev/ttyACM0 | RP2040 REPL | MicroPython console on the RP2040 |
| /dev/ttyACM1 | FPGA UART bridge | Church Machine debug output and data upload |

## Design Files

| File | Purpose |
|---|---|
| `church_machine/uart_test.py` | Top-level FPGA design with UART loader (UartTestTop) |
| `church_machine/boot_rom.py` | Boot program, demo namespace, demo c-list constants |
| `church_machine/upload.py` | Host-side Python upload tool (requires project) |
| `church_machine/pico_upload.py` | Standalone upload script (no project dependencies) |
| `church_machine/uart_rx.py` | UART receiver module (8N1) |
| `church_machine/uart_tx.py` | UART transmitter and DebugPrinter |
| `church_machine/core.py` | Church Machine processor core |
| `church_machine/types.py` | Constants, opcodes, GT format definitions |
| `church_machine/pico_ice.py` | Standalone design (no UART, Switch-based init, for sim testing) |
| `church_machine/gen_verilog.py` | Amaranth-to-Verilog generator |
| `church_machine/pico_ice.pcf` | Pin constraint file for iCE40UP5K-SG48 |
| `church_machine/Makefile` | Build flow (verilog → synth → PnR → bitstream) |
| `church_machine/test_loader.py` | Loader FSM simulation tests |
| `church_machine/test_pico_ice.py` | Integration simulation tests |
| `church_machine/testbench.py` | Core-only simulation tests |

## Compile-Time Feature Flags

The Church Machine supports compile-time feature flags in `church_machine/types.py`. All default to `False` for the minimal iCE40 build:

| Flag | Purpose | Default |
|---|---|---|
| `ENABLE_SEAL_CHECK` | FNV-1a seal and version validation on GT access | False |
| `ENABLE_FUSED_OPS` | Fused instructions (ELOADCALL, XLOADLAMBDA) | False |
| `ENABLE_CHANGE_SWITCH` | CHANGE and SWITCH instructions | False |
| `ENABLE_GC` | PP250 deterministic garbage collector | False |

Setting flags to `True` enables full security semantics but increases LUT usage. The minimal build fits at 85%; enabling all flags may exceed the iCE40UP5K capacity.
