# CTMM Amaranth HDL — Technical Summary for ChipFlow Integration

**Version:** 1.0
**Date:** February 2026
**Author:** Kenneth James Hamer-Hodges

---

## 1. Architecture Overview

The Church-Turing Meta-Machine (CTMM) is a capability-based processor architecture that enforces security through hardware-validated Golden Tokens. It eliminates the need for an operating system, virtual memory, privilege rings, and superuser accounts.

**Core Principles:**

- **Golden Rule:** mLoad is the sole trusted path for all capability register writes. No instruction, no microcode sequence, no external agent can write a CR except through mLoad's validated pipeline.
- **Domain Separation:** Context Registers (CRs) hold capabilities exclusively. Data Registers (DRs) hold values exclusively. No mixing — "oil and water."
- **M Elevation:** The M (Meta/Microcode) permission is transient — elevated on CRs during microcode execution, never stored in Golden Tokens. No user instruction can set, test, or observe M.
- **Single Fault Path:** All validation failures route to a single hardware FAULT handler. No silent failures, no partial state.

**Security Properties (7 Zeroes):**

1. Zero operating system required
2. Zero virtual memory
3. Zero privilege escalation possible
4. Zero superuser / root
5. Zero unauthorized code execution
6. Zero unauthorized data access
7. Zero containment escape

---

## 2. Golden Token Data Structure

```
GT_LAYOUT (64 bits):
  offset [31:0]  — Namespace entry offset (32 bits)
  spare  [56:32] — Reserved (25 bits)
  g_bit  [57]    — Garbage collection mark bit (1 bit)
  perms  [63:58] — Permission field (6 bits)

Permission Bits:
  [0] R — Read       (Turing domain)
  [1] W — Write      (Turing domain)
  [2] X — Execute    (Turing domain)
  [3] L — Load       (Church domain)
  [4] S — Save       (Church domain)
  [5] E — Enter      (Church domain)

GT Type Field (2 bits, within spare):
  00 — Inform  (local reference)
  01 — Outform (remote reference)
  10 — NULL    (empty/invalid/revoked)
  11 — Abstract (unforgeable constant, e.g., pi)
```

**Capability Register (CR) Layout — 4 words, 256 bits:**

```
CAP_REG_LAYOUT:
  word0_gt        — Golden Token (GT_LAYOUT, 64 bits)
  word1_location  — Base address in namespace (64 bits)
  word2_limit     — Size/bounds limit (64 bits)
  word3_seals     — Version/MAC seals (64 bits)
```

**Namespace Entry — 3 words, 192 bits:**

```
NS_ENTRY_LAYOUT:
  word1_location  — Base address (64 bits)
  word2_limit     — Size limit (64 bits)
  word3_seals     — Version + MAC (64 bits)
```

---

## 3. Instruction Set Architecture

All instructions use a **32-bit fixed-width format** with a 4-bit condition code field.

### 3.1 Church Instructions (Capability Operations)

| Opcode | Binary | Mnemonic | Description |
|--------|--------|----------|-------------|
| 0x01 | 00001 | LOAD | Load GT from namespace into CR via mLoad |
| 0x02 | 00010 | SAVE | Save data to namespace via capability |
| 0x03 | 00011 | CALL | Enter abstraction (requires E permission) |
| 0x04 | 00100 | RETURN | Exit procedure, restore caller context |
| 0x05 | 00101 | CHANGE | Create new thread GT into CR8 |
| 0x06 | 00110 | SWITCH | Copy capability to system register CR8-15 |
| 0x07 | 00111 | TPERM | Test GT permissions against preset mask |
| 0x08 | 01000 | LOADX | Exclusive load (atomic) |
| 0x09 | 01001 | SAVEX | Exclusive save (atomic) |
| 0x0A | 01010 | LDM | Load multiple registers |
| 0x0B | 01011 | STM | Store multiple registers |

### 3.2 Turing Instructions (Data Operations)

| Opcode | Binary | Mnemonic | Description |
|--------|--------|----------|-------------|
| 0x10 | 10000 | MOV | Register move |
| 0x11 | 10001 | ADD | Integer addition |
| 0x12 | 10010 | SUB | Integer subtraction |
| 0x13 | 10011 | MUL | Integer multiplication |
| 0x14 | 10100 | DIV | Integer division |
| 0x15 | 10101 | AND | Bitwise AND |
| 0x16 | 10110 | ORR | Bitwise OR |
| 0x17 | 10111 | EOR | Bitwise XOR |
| 0x18 | 11000 | LSL | Logical shift left |
| 0x19 | 11001 | LSR | Logical shift right |
| 0x1A | 11010 | ASR | Arithmetic shift right |
| 0x1B | 11011 | CMP | Compare (flags only) |
| 0x1C | 11100 | TST | Test bits (flags only) |
| 0x1D | 11101 | LDI | Load immediate |
| 0x1E | 11110 | B | Branch (conditional) |
| 0x1F | 11111 | BL | Branch with link |

### 3.3 Condition Codes (ARM-style)

| Code | Binary | Meaning | Flags |
|------|--------|---------|-------|
| EQ | 0000 | Equal | Z=1 |
| NE | 0001 | Not equal | Z=0 |
| CS | 0010 | Carry set | C=1 |
| CC | 0011 | Carry clear | C=0 |
| MI | 0100 | Negative | N=1 |
| PL | 0101 | Positive/zero | N=0 |
| VS | 0110 | Overflow | V=1 |
| VC | 0111 | No overflow | V=0 |
| HI | 1000 | Unsigned higher | C=1 AND Z=0 |
| LS | 1001 | Unsigned lower/same | C=0 OR Z=1 |
| GE | 1010 | Signed >= | N=V |
| LT | 1011 | Signed < | N!=V |
| GT | 1100 | Signed > | Z=0 AND N=V |
| LE | 1101 | Signed <= | Z=1 OR N!=V |
| AL | 1110 | Always | (unconditional) |

---

## 4. Amaranth Module Inventory

### 4.1 Module Summary

| Module | File | Lines | Status | Description |
|--------|------|------:|--------|-------------|
| CTMMCore | core.py | 463 | Complete | Top-level integration, state machine, 5-phase boot sequencer |
| CTMMDecoder | decoder.py | 136 | Complete | 32-bit instruction decode, Church/Turing split, 3-bit CR / 4-bit DR addressing |
| CTMMRegisters | registers.py | 114 | Complete | CR0-CR15 (256-bit capability) + DR0-DR15 (64-bit data) + NZCV flags |
| CTMMPermCheck | perm_check.py | 96 | Complete | 6-bit permission validation (R/W/X/L/S/E) |
| CTMMMLoad | mload.py | 217 | Complete | The Golden Rule gate — permission, bounds, G-bit reset, thread shadow |
| CTMMMSave | msave.py | 90 | Complete | Namespace write path with permission check |
| CTMMLoad | load.py | 96 | Complete | LOAD instruction — CR write via mLoad |
| CTMMSave | save.py | 124 | Complete | SAVE instruction — data write via capability |
| CTMMCall | call.py | 205 | Complete | CALL — push frame, validate E, switch CR6/CR7 |
| CTMMReturn | ret.py | 245 | Complete | RETURN — pop frame, revalidate, restore context |
| CTMMChange | change.py | 256 | Complete | Thread creation into CR8 |
| CTMMSwitch | switch.py | 140 | Complete | Capability copy to system registers CR8-15 |
| CTMMLoadxSavex | loadx_savex.py | 207 | Complete | Exclusive (atomic) load/store with monitor |
| CTMMLdmStm | ldm_stm.py | 163 | Complete | Load/store multiple registers |
| CTMMGCUnit | gc_unit.py | 126 | Partial | Mark-Scan-Sweep: mark and count implemented; sweep reclaim pending |
| Types | types.py | 147 | Complete | Opcodes, permission masks, fault types, enums |
| Layouts | layouts.py | 35 | Complete | GT, CR, namespace entry, flags struct layouts |
| Testbench | testbench.py | 99 | Complete | Basic verification harness |
| **Total** | | **2,959** | | |

### 4.2 Modules Needed for FPGA (Not Yet Implemented)

| Module | Est. Lines | Description |
|--------|:----------:|-------------|
| ALU | ~350 | Turing arithmetic/logic/shift unit (ADD, SUB, MUL, AND, ORR, EOR, shifts, CMP, TST) |
| Branch Unit | ~150 | Conditional branch with link (B, BL + 15 condition codes) |
| LDI | ~50 | Load immediate into DR |
| LAMBDA | ~250 | Church function application (X permission fast path, no stack frame) |
| TPERM | ~150 | Permission test with 14 preset masks (already defined in types.py) |
| FNV MAC | ~200 | Hardware FNV hash for namespace MAC validation (currently validated in simulation) |
| GC Sweep Reclaim | ~100 | Extend GC unit to bump version and clear garbage entries |
| Bus Adapter | ~200 | Wishbone or AXI wrapper around raw memory interfaces |
| **Total needed** | **~1,450** | |

---

## 5. Detailed Module Interfaces

### 5.1 CTMMCore — Top-Level

The core exposes four memory interfaces plus control/status signals:

```python
# Instruction Memory (read-only)
imem_addr      : Signal(32)    # out — instruction address (NIA)
imem_data      : Signal(32)    # in  — 32-bit instruction word
imem_valid     : Signal(1)     # in  — instruction data valid

# Namespace Memory (read/write, 192-bit entries)
ns_addr        : Signal(32)    # out — namespace entry address
ns_rd_en       : Signal(1)     # out — read enable
ns_rd_data     : Signal(192)   # in  — namespace entry (3 x 64-bit words)
ns_wr_data     : Signal(192)   # out — write data
ns_wr_en       : Signal(1)     # out — write enable

# C-List Memory (read/write, 64-bit GTs)
clist_addr     : Signal(32)    # out — C-List entry address
clist_rd_en    : Signal(1)     # out — read enable
clist_rd_data  : Signal(64)    # in  — Golden Token data
clist_wr_data  : Signal(64)    # out — write data
clist_wr_en    : Signal(1)     # out — write enable

# Data Memory (read/write, 64-bit)
dmem_addr      : Signal(32)    # out — data address
dmem_rd_en     : Signal(1)     # out — read enable
dmem_rd_data   : Signal(64)    # in  — read data
dmem_wr_data   : Signal(64)    # out — write data
dmem_wr_en     : Signal(1)     # out — write enable

# Boot Control
boot_start     : Signal(1)     # in  — trigger boot sequence
boot_state     : Signal(3)     # out — current boot phase (IDLE/FAULT_RST/LOAD_NS/LOAD_THREAD/COMPLETE)
boot_complete  : Signal(1)     # out — boot finished

# Garbage Collection
gc_start       : Signal(1)     # in  — trigger GC cycle
gc_busy        : Signal(1)     # out — GC in progress
gc_garbage_count: Signal(32)   # out — garbage entries found

# Fault Output
fault          : Signal(4)     # out — fault type code
fault_valid    : Signal(1)     # out — fault occurred

# Debug
nia            : Signal(32)    # out — next instruction address
flags          : Signal(4)     # out — NZCV condition flags
```

### 5.2 CTMMMLoad — The Golden Rule Gate

This is the security-critical module. Every capability register write passes through mLoad.

**Validation pipeline (single-cycle target):**

1. Read source CR to get capability
2. Permission check (L required for LOAD, E required for CALL)
3. Bounds check (index < word2_limit)
4. Fetch namespace entry at word1_location + index
5. MAC validation (FNV hash of entry vs word3_seals)
6. G-bit reset (for GC: mark entry as reachable)
7. Thread table shadow update (CR0-CR7 snippet)
8. Write validated capability to destination CR

```python
# Control
sub_start      : Signal(1)     # in  — begin mLoad operation
sub_busy       : Signal(1)     # out — operation in progress
sub_done       : Signal(1)     # out — operation complete
sub_fault      : Signal(1)     # out — validation failed
sub_fault_type : Signal(4)     # out — which check failed

# Source/Destination
sub_cr_src     : Signal(4)     # in  — source CR index
sub_cr_dst     : Signal(4)     # in  — destination CR index
sub_index      : Signal(10)    # in  — C-List entry index
sub_direct     : Signal(1)     # in  — direct GT mode (for RETURN)
sub_direct_gt  : Signal(64)    # in  — direct GT value

# Register File Access
cr_rd_addr     : Signal(4)     # out — CR read address
cr_rd_data     : Signal(256)   # in  — CR read data (full 4-word cap)
cr_wr_addr     : Signal(4)     # out — CR write address
cr_wr_data     : Signal(256)   # out — CR write data
cr_wr_en       : Signal(1)     # out — CR write enable

# Memory Access
mem_addr       : Signal(64)    # out — namespace memory address
mem_rd_en      : Signal(1)     # out — read enable
mem_rd_data    : Signal(64)    # in  — read data
mem_rd_valid   : Signal(1)     # in  — data valid

# GC Integration
g_bit_reset    : Signal(1)     # out — reset G-bit on accessed entry
g_bit_addr     : Signal(64)    # out — address of entry to reset

# Thread Table Shadow
thread_wr_en   : Signal(1)     # out — update thread table
thread_wr_idx  : Signal(3)     # out — which CR0-CR7 slot
thread_wr_data : Signal(64)    # out — GT to shadow
```

### 5.3 CTMMCall — Procedure Invocation

```python
# Control
call_start     : Signal(1)     # in  — begin CALL
call_busy      : Signal(1)     # out — in progress
call_complete  : Signal(1)     # out — CALL finished
call_fault     : Signal(1)     # out — validation failed

# Parameters
cr_src         : Signal(4)     # in  — source CR (must have E permission)
index          : Signal(8)     # in  — C-List index for target
mask           : Signal(11)    # in  — register save mask

# Outputs
nia_set        : Signal(1)     # out — update NIA
nia_value      : Signal(64)    # out — new NIA (target code address)
dr_clear_mask  : Signal(16)    # out — DRs to clear on entry
cr_clear_mask  : Signal(16)    # out — CRs to clear on entry
```

### 5.4 CTMMGCUnit — Deterministic Garbage Collection (PP250)

```python
# Control
gc_start       : Signal(1)     # in  — begin GC cycle
gc_mark_en     : Signal(1)     # in  — enable mark phase
gc_sweep_en    : Signal(1)     # in  — enable sweep phase
gc_busy        : Signal(1)     # out — GC active
gc_done        : Signal(1)     # out — cycle complete

# Namespace Scan
ns_start_addr  : Signal(32)    # in  — first namespace entry
ns_end_addr    : Signal(32)    # in  — last namespace entry
ns_addr        : Signal(32)    # out — current scan address
ns_rd_en       : Signal(1)     # out — read enable
ns_rd_data     : Signal(64)    # in  — entry data
ns_wr_data     : Signal(64)    # out — updated entry (G-bit set/clear)
ns_wr_en       : Signal(1)     # out — write enable

# Results
marked_count   : Signal(32)    # out — entries marked
garbage_count  : Signal(32)    # out — unreachable entries found

# Integration with mLoad (scan phase)
g_bit_reset    : Signal(1)     # in  — mLoad accessed this entry
valid_key_access: Signal(1)    # in  — valid access occurred
```

**GC Algorithm:**
- **Mark:** Set G=1 on all namespace entries
- **Scan:** Normal execution continues; mLoad resets G=0 on every valid access
- **Sweep:** Entries still with G=1 are garbage; bump version to revoke

---

## 6. Fault Types

All validation failures produce a specific fault code:

| Code | Name | Trigger |
|------|------|---------|
| 0x0 | NONE | No fault |
| 0x1 | PERM_R | Read permission denied |
| 0x2 | PERM_W | Write permission denied |
| 0x3 | PERM_X | Execute permission denied |
| 0x4 | PERM_L | Load permission denied |
| 0x5 | PERM_S | Save permission denied |
| 0x6 | PERM_E | Enter permission denied |
| 0x7 | NULL_CAP | Attempted use of NULL capability |
| 0x8 | BOUNDS | Index exceeds word2_limit |
| 0x9 | MAC | MAC validation failed (tampered entry) |
| 0xA | INVALID_OP | Unknown opcode |
| 0xB | TPERM_RSV | Reserved TPERM preset used |
| 0xC | EXCL_FAIL | Exclusive monitor failure |

---

## 7. Boot Sequence

Five-phase hardware boot:

| Phase | State | Action |
|-------|-------|--------|
| 0 | IDLE | Waiting for boot_start signal |
| 1 | FAULT_RST | Clear all CRs, DRs, flags, exclusive monitors |
| 2 | LOAD_NS | Load namespace GT into CR15 (the one wired GT) |
| 3 | INIT_THRD | Initialize thread GT into CR8, services into CR5 |
| 4 | LOAD_NUC | Load nucleus code reference into CR7 |
| 5 | COMPLETE | Begin instruction fetch at NIA |

---

## 8. Integration Options with ChipFlow RISC-V SoC

### Option A: CTMM as Co-Processor

```
┌─────────────────────────────────────────────────┐
│                 ChipFlow SoC                     │
│                                                  │
│  ┌──────────┐    Wishbone     ┌──────────────┐  │
│  │  RV32I   │◄──────────────►│  Bus Fabric   │  │
│  │  Core    │                │  (Wishbone)   │  │
│  └──────────┘                └──────┬────────┘  │
│                                     │            │
│  ┌──────────┐    Wishbone     ┌─────┴────────┐  │
│  │  CTMM    │◄──────────────►│              │  │
│  │  Core    │                │  BRAM/SRAM   │  │
│  │ (Golden  │     mLoad      │  (Namespace) │  │
│  │  Tokens) │────────────────►│              │  │
│  └──────────┘                └──────────────┘  │
│                                                  │
│  ┌────────┐  ┌────────┐  ┌────────┐            │
│  │  UART  │  │  SPI   │  │  GPIO  │            │
│  └────────┘  └────────┘  └────────┘            │
└─────────────────────────────────────────────────┘
```

- RV32I handles boot, I/O, and conventional tasks
- CTMM handles all capability-secured operations
- Shared memory namespace via bus fabric
- Fastest integration path (~2-3 weeks)
- Note: CTMMCore currently exposes raw memory interfaces (addr/rd_en/wr_en/data); a thin bus adapter module (~200 lines) would bridge to Wishbone

### Option B: Replace RV32I Pipeline (Pure CLOOMC)

```
┌─────────────────────────────────────────────────┐
│                 ChipFlow SoC                     │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │              CTMM Core                    │   │
│  │  ┌─────────┐  ┌────────┐  ┌──────────┐  │   │
│  │  │ Decoder  │  │  ALU   │  │  mLoad   │  │   │
│  │  │(Church + │  │(Turing)│  │(Golden   │  │   │
│  │  │ Turing)  │  │        │  │ Rule)    │  │   │
│  │  └─────────┘  └────────┘  └──────────┘  │   │
│  │  ┌─────────┐  ┌────────┐  ┌──────────┐  │   │
│  │  │ CR0-15  │  │ DR0-15 │  │ GC Unit  │  │   │
│  │  │(Caps)   │  │(Data)  │  │(PP250)   │  │   │
│  │  └─────────┘  └────────┘  └──────────┘  │   │
│  └──────────────────┬───────────────────────┘   │
│                     │ Wishbone                   │
│           ┌─────────┴─────────┐                  │
│           │    Bus Fabric     │                  │
│           └─┬────┬────┬────┬──┘                  │
│  ┌────────┐ │ ┌──┴──┐ │ ┌─┴──────┐             │
│  │  UART  │ │ │ SPI │ │ │  BRAM  │             │
│  └────────┘ │ └─────┘ │ └────────┘             │
│  ┌────────┐ │         │                          │
│  │  GPIO  │ │         │                          │
│  └────────┘ │         │                          │
└─────────────┴─────────┴──────────────────────────┘
```

- CTMM replaces the RV32I pipeline entirely
- Uses ChipFlow's peripheral and bus infrastructure
- Pure capability-secure execution from boot
- More work (~4-6 weeks) but cleaner architecture

---

## 9. Resource Estimates

### FPGA (Cyclone V 5CSEBA6 / Lattice ECP5)

| Resource | Estimated Use | Available (Cyclone V) | Utilization |
|----------|:------------:|:---------------------:|:-----------:|
| Logic Elements | ~3,000-5,000 ALMs | 41,910 | ~7-12% |
| Memory Blocks | ~20-40 M10K | 553 | ~4-7% |
| DSP Blocks | 1-2 | 112 | ~1% |
| Registers | ~2,000-3,000 | >80,000 | ~3% |

### ASIC Estimate (Rough)

| Metric | Estimate |
|--------|----------|
| Gate count | ~50,000-80,000 gates |
| Core area (28nm) | ~0.1-0.2 mm2 |
| Target frequency | 100-200 MHz |
| Power | <100 mW (estimated) |

The CTMM is notably compact because it has **no MMU, no TLB, no cache coherency logic, no privilege ring hardware** — all of which are substantial in conventional processors.

---

## 10. Repository Structure

```
ctmm_amaranth/
  __init__.py
  types.py          — Opcodes, permissions, fault codes, enums
  layouts.py        — Struct layouts for GT, CR, namespace entry, flags
  core.py           — Top-level processor core
  decoder.py        — Instruction decoder
  registers.py      — Register file (CR0-15 + DR0-15 + flags)
  perm_check.py     — Permission validation unit
  mload.py          — mLoad: the single trusted gate
  msave.py          — mSave: namespace write path
  load.py           — LOAD instruction
  save.py           — SAVE instruction
  call.py           — CALL instruction
  ret.py            — RETURN instruction
  change.py         — CHANGE instruction (thread creation)
  switch.py         — SWITCH instruction (system register copy)
  loadx_savex.py    — LOADX/SAVEX (atomic operations)
  ldm_stm.py        — LDM/STM (load/store multiple)
  gc_unit.py        — Garbage collection unit (PP250)
  testbench.py      — Verification harness
```

---

## 11. Key Design Decisions

1. **64-bit Golden Tokens** — Large enough for 32-bit namespace offsets + 6-bit permissions + G-bit + type field + spare bits. Fits cleanly in a single memory word.

2. **256-bit Capability Registers** — 4-word structure (GT + location + limit + seals) gives hardware everything needed for validation without additional memory fetches.

3. **Separate CR and DR register files** — Hardware-enforced domain separation. No instruction can move data between CR and DR files except through mLoad.

4. **FNV hash MAC** — Simple, fast, deterministic. No cryptographic key management needed for local namespace validation. Outform GTs use standard cryptographic MACs for network security.

5. **32-bit fixed-width instructions** — Simple decode, single-cycle fetch, compatible with standard instruction memories. The 5-bit opcode field naturally partitions into Church (00xxx) and Turing (1xxxx) domains. Church instructions address CR0-CR7 via 3-bit fields (CR8-CR15 are system-only, accessed via SWITCH/boot). Turing instructions address DR0-DR15 via 4-bit fields.

6. **ARM-style condition codes** — Familiar to hardware engineers, well-understood behavior, compact encoding in the instruction word.

---

*This document accompanies the cover letter dated February 2026. Full source code, interactive web simulator, and documentation available upon request.*
