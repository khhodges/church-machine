# CM Verilog Hardware Implementation

This directory contains a synthesizable Verilog (SystemVerilog) implementation of the Church Machine (CM) capability-based architecture designed by Kenneth James Hamer-Hodges.

## Architecture Overview

The CM hardware implements failsafe security through Golden Tokens (64-bit capability keys) for all access control. The design follows these core principles:

1. **Capability-Based Security**: All access is mediated by Golden Tokens
2. **Hardware-Enforced Permissions**: Permission checks are performed in dedicated hardware
3. **Deterministic Garbage Collection**: The G bit enables hardware-assisted GC
4. **Failsafe Design**: Single FAULT output for all security violations

## File Structure

```
verilog/
├── ctmm_pkg.sv           # Package with types, constants, and definitions
├── ctmm_registers.sv     # Register file (16 x 256-bit CRs, 16 x 64-bit DRs)
├── ctmm_mload.sv         # mLoad micro-routine (shared trusted code)
├── ctmm_load.sv          # LOAD Church-Instruction (uses mLoad)
├── ctmm_loadx_savex.sv   # LOADX/SAVEX atomic operations with exclusive monitor
├── ctmm_ldm_stm.sv       # LDM/STM Load/Store Multiple
├── ctmm_switch.sv        # SWITCH Church-Instruction (uses mLoad)
├── ctmm_msave.sv         # mSave micro-routine (shared trusted code)
├── ctmm_save.sv          # SAVE Church-Instruction (uses mSave)
├── ctmm_change.sv        # CHANGE Church-Instruction (uses mSave + mLoad)
├── ctmm_call.sv          # CALL Church-Instruction (uses mLoad)
├── ctmm_return.sv        # RETURN Church-Instruction
├── ctmm_perm_check.sv    # Permission checking unit
├── ctmm_gc_unit.sv       # Garbage collection unit with G bit
├── ctmm_decoder.sv       # Instruction decoder
├── ctmm_core.sv          # Top-level processor core
├── ctmm_tb.sv            # Testbench
└── README.md             # This file
```

## Standardized Instruction Format (32-bit)

All CM instructions use a standardized format:

```
| 31:27 | 26:23 | 22 | 21:0     |
|-------|-------|----|---------  |
| Opcode| Cond  | I  | Operands |
```

- **Opcode** (5 bits): Instruction opcode (32 opcodes available)
- **Cond** (4 bits): ARM-style condition code
- **I** (1 bit): Immediate mode flag
- **Operands** (22 bits): Instruction-specific operands

## Capability Register (CR) Format - 4 x 64-bit Words (256 bits)

Each of the 16 Capability Registers contains 4 words:

```
Word 0: Golden Token (64 bits)
  Bits [63:48] - Permissions (16 bits)
    Bit 0: R - Read
    Bit 1: W - Write
    Bit 2: X - Execute
    Bit 3: L - Load (capability from C-List)
    Bit 4: S - Save/Store (capability to C-List)
    Bit 5: E - Enter (call procedure)
    Bit 6: B - Bind (save to namespace DNA)
    Bit 7: M - Meta-Machine (hardware-level access)
    Bit 8: F - Far (remote URL location)
    Bit 9: G - Garbage (deterministic GC flag)
  Bits [47:32] - Spare (reserved)
  Bits [31:0]  - Offset (index into Namespace Table)

Word 1: Location (64 bits)
  Physical address or base pointer to the object

Word 2: Limit (64 bits)
  Size/bounds for access checking

Word 3: Seals/MAC (64 bits)
  Security validation hash for integrity checking
```

## Register Architecture

### Capability Registers (Church) - 16 x 256-bit
| Register | Name           | Purpose                           |
|----------|----------------|-----------------------------------|
| CR0-CR5  | General        | General purpose capability storage |
| CR6      | C-List         | Current Capability List pointer   |
| CR7      | [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) Nucleus | Function Abstraction Code         |
| CR8      | Thread         | Suspended Thread State            |
| CR9      | Interrupt      | Interrupt Thread                  |
| CR10     | Double Fault   | Double Fault Recovery Thread      |
| CR11-CR14| General        | General purpose capability storage |
| CR15     | Namespace      | Namespace root capability         |

### Data Registers (Turing) - 16 x 64-bit
- **DR0-DR15**: 64-bit data registers for arithmetic/logic operations

### Condition Flags
- N (Negative), Z (Zero), C (Carry), V (Overflow)

## Complete Instruction Set

### Church Instructions (Capability Operations) - 5-bit Opcodes

| Opcode | Binary  | Mnemonic | Description |
|--------|---------|----------|-------------|
| 01     | 00001   | LOAD     | Load capability from C-List |
| 02     | 00010   | SAVE     | Save capability to C-List |
| 03     | 00011   | CALL     | Call procedure (I=1: embedded mask, I=0: DR15 mask) |
| 04     | 00100   | RETURN   | Return from procedure |
| 05     | 00101   | CHANGE   | Change thread identity |
| 06     | 00110   | SWITCH   | Switch namespace |
| 07     | 00111   | TPERM    | Transfer/restrict permissions (4-bit preset) |
| 08     | 01000   | LOADX    | Load-Exclusive (atomic with monitor) |
| 09     | 01001   | SAVEX    | Store-Exclusive (conditional store) |
| 10     | 01010   | LDM      | Load Multiple registers |
| 11     | 01011   | STM      | Store Multiple registers |

### Turing Instructions (Data Operations) - 5-bit Opcodes

| Opcode | Binary  | Mnemonic | Description |
|--------|---------|----------|-------------|
| 16     | 10000   | MOV      | Move data |
| 17     | 10001   | ADD      | Add (I=1: immediate, I=0: register) |
| 18     | 10010   | SUB      | Subtract |
| 19     | 10011   | MUL      | Multiply |
| 20     | 10100   | DIV      | Divide |
| 21     | 10101   | AND      | Bitwise AND |
| 22     | 10110   | ORR      | Bitwise OR |
| 23     | 10111   | EOR      | Bitwise XOR |
| 24     | 11000   | LSL      | Logical Shift Left |
| 25     | 11001   | LSR      | Logical Shift Right |
| 26     | 11010   | ASR      | Arithmetic Shift Right |
| 27     | 11011   | CMP      | Compare |
| 28     | 11100   | TST      | Test bits |
| 29     | 11101   | LDI      | Load Immediate (large constant) |
| 30     | 11110   | B        | Branch |
| 31     | 11111   | BL       | Branch with Link |

## TPERM Preset Masks (4-bit Code)

TPERM uses a 4-bit preset code to restrict permissions. Codes 14-15 are reserved and cause FAULT.

| Code | Name  | Permission Bits | Use Case |
|------|-------|-----------------|----------|
| 0    | CLEAR | none            | Revoke all access |
| 1    | R     | R               | Read-only data |
| 2    | RW    | R,W             | Read-write data |
| 3    | X     | X               | Execute code only |
| 4    | RX    | R,X             | Read + execute |
| 5    | RWX   | R,W,X           | Full data access |
| 6    | E     | E               | Enter abstraction |
| 7    | LS    | L,S             | Load + Save |
| 8    | B     | B               | Bound (can delegate) |
| 9    | LB    | L,B             | Load + Bind |
| 10   | G     | G               | GC marking |
| 11   | F     | F               | Foreign/remote |
| 12   | M     | M               | Meta/internal |
| 13   | LM    | L,M             | Load + Microcode (internal) |
| 14   | -     | RESERVED        | Causes FAULT |
| 15   | -     | RESERVED        | Causes FAULT |

## Instruction Formats

### Church Instructions (3-bit CR fields for security)

**Security Design**: Only CR0-CR7 are addressable by instructions. CR8-CR15 are protected special registers (Thread, Nucleus, C-List, Namespace) that cannot be directly manipulated, preventing privilege escalation attacks.

#### LOAD/SAVE/LOADX
```
| 31:27 | 26:23 | 22 | 21:19 | 18:16 | 15:6  | 5:4      | 3:0      |
|-------|-------|----| ------|-------|-------|----------|----------|
| Opcode| Cond  | I  | CRd   | CRn   | Index | Reserved | Reserved |
```
- 3-bit CR fields (CR0-CR7 only) for security
- 10-bit index supports 1024 C-List entries

#### SAVEX (Store-Exclusive)
```
| 31:27 | 26:23 | 22 | 21:19 | 18:16 | 15:6  | 5:4      | 3:0 |
|-------|-------|----| ------|-------|-------|----------|-----|
| Opcode| Cond  | I  | CRs   | CRn   | Index | Reserved | DRd |
```
- DRd receives result: 0 = success, 1 = fail (monitor cleared)

#### CALL
```
| 31:27 | 26:23 | 22 | 21:19 | 18:16 | 15:6 | 5:0      |
|-------|-------|----| ------|-------|------|----------|
| Opcode| Cond  | I  | CRret | CRtgt | Mask | Reserved |
```
- I=1: Use 10-bit embedded permission mask
- I=0: Use DR15 as 64-bit permission mask

#### RETURN
```
| 31:27 | 26:23 | 22 | 21:19 | 18:0     |
|-------|-------|----| ------|----------|
| Opcode| Cond  | I  | CRn   | Reserved |
```

#### TPERM
```
| 31:27 | 26:23 | 22 | 21:19 | 18:16 | 15:4     | 3:0    |
|-------|-------|----| ------|-------|----------|--------|
| Opcode| Cond  | I  | CRd   | CRs   | Reserved | Preset |
```

#### LDM/STM (Load/Store Multiple)
```
| 31:27 | 26:23 | 22 | 21:19 | 18:8     | 7:0      |
|-------|-------|----| ------|----------|----------|
| Opcode| Cond  | I  | CRn   | Reserved | Reg List |
```
- Reg List: 8-bit mask (CR0-CR7 only), bit i = include CRi
- Security: Uses mLoad/mSave internally for each register

### Turing Instructions

#### Arithmetic/Logic (Register Mode, I=0)
```
| 31:27 | 26:23 | 22 | 21:18 | 17:14 | 13:10 | 9:0      |
|-------|-------|----| ------|-------|-------|----------|
| Opcode| Cond  | 0  | DRd   | DRn   | DRm   | Reserved |
```

#### Arithmetic/Logic (Immediate Mode, I=1)
```
| 31:27 | 26:23 | 22 | 21:18 | 17:14 | 13:0      |
|-------|-------|----| ------|-------|-----------|
| Opcode| Cond  | 1  | DRd   | DRn   | Immediate |
```
- 14-bit signed immediate value

#### LDI (Load Immediate)
```
| 31:27 | 26:23 | 22 | 21:18 | 17:0      |
|-------|-------|----| ------|-----------|
| Opcode| Cond  | I  | DRd   | Immediate |
```
- 22-bit immediate (18 bits + I bit + cond bits can extend)

#### Branch
```
| 31:27 | 26:23 | 22 | 21:18    | 17:0   |
|-------|-------|----| ---------|--------|
| Opcode| Cond  | I  | Reserved | Offset |
```
- 18-bit signed offset (word-aligned)

## Atomic Operations (LOADX/SAVEX)

ARM-style Load-Exclusive / Store-Exclusive for lock-free atomic operations:

1. **LOADX CRd, [CRn, #offset]**
   - Load capability from namespace
   - Set exclusive monitor for that address
   - Normal permission checks apply

2. **SAVEX CRs, [CRn, #offset], DRd**
   - Try to store capability back
   - DRd = 0 if success (monitor still valid)
   - DRd = 1 if fail (someone else accessed entry)
   - Monitor cleared after SAVEX

**Exclusive Monitor Logic:**
- Per-thread flag tracking (namespace entry address, valid bit)
- Cleared when another thread accesses monitored address
- Enables lock-free synchronization on capabilities

## Boot Sequence

1. **FAULT_RST**: Clear all registers (cold restart)
2. **LOAD_NS**: Load namespace root into CR15 with M+L permissions
3. **INIT_THRD**: Initialize thread identity in CR8
4. **LOAD_NUC**: Load CR6 (Boot C-List) and CR7 (Nucleus)

## mLoad Micro-Routine - Shared Trusted Code

The mLoad micro-routine (`ctmm_mload.sv`) is the **single trusted microcode** for all capability fetching. This minimizes the Trusted Computing Base (TCB).

### mLoad Microcode Sequence

| Step | State         | Description                                      |
|------|---------------|--------------------------------------------------|
| 1    | CHECK_L       | Check CRn has M or L permission                  |
| 2    | CHECK_BOUNDS  | Verify Index < CRn.Limit                         |
| 3    | FETCH_W0      | Fetch GT from CRn[Index] → result.W0             |
| 4    | CHECK_NS      | Check GT.offset < CR15.limit AND CR15 = M        |
| 5    | FETCH_W1      | Fetch W1 (Location) from CR15.Location + GT.offset |
| 6    | FETCH_W2      | Fetch W2 (Limit) from CR15.Location + GT.offset + 8 |
| 7    | FETCH_W3      | Fetch W3 (Seals/MAC) from CR15.Location + GT.offset + 16 |
| 8    | CHECK_MAC     | Validate MAC (calculated hash vs Seals)          |
| 9    | RESET_G       | If G=1: Reset G bit in CR15[GT.offset].Word3.Gbit |
| 10   | UPDATE_THREAD | Write GT with G=0 to Thread[CRd]                 |
| 11   | COMPLETE      | Write all 4 words to CRd, assert sub_done        |

## Garbage Collection

The G bit enables deterministic garbage collection:

1. **Mark Phase**: GC sets G=1 on all namespace entries
2. **Scan Phase**: Valid key access (via LOAD) resets G=0
3. **Sweep Phase**: Entries with G=1 are unreachable garbage

## Simulation

Using Icarus Verilog:
```bash
iverilog -g2012 -o ctmm_sim ctmm_pkg.sv ctmm_registers.sv ctmm_perm_check.sv \
    ctmm_gc_unit.sv ctmm_decoder.sv ctmm_mload.sv ctmm_load.sv \
    ctmm_loadx_savex.sv ctmm_ldm_stm.sv ctmm_return.sv \
    ctmm_core.sv ctmm_tb.sv
vvp ctmm_sim
```

Using Verilator:
```bash
verilator --binary -j 0 --top-module ctmm_tb *.sv
./obj_dir/Vctmm_tb
```

## Synthesis

The design is synthesizable for FPGA or ASIC targets. Key synthesis considerations:

- Target clock: 100 MHz (adjustable based on target technology)
- Memory interfaces are external (instantiate appropriate memory IPs)
- Single-cycle execution for most instructions
- Multi-cycle for memory operations and GC

## Security Features

1. **Permission Validation**: All capability access requires permission checks
2. **Bounds Checking**: Access index validated against namespace entry limits
3. **MAC Validation**: Optional hardware MAC check for integrity
4. **Null Capability Detection**: NULL GT access causes FAULT
5. **Single FAULT Path**: All security violations use same FAULT mechanism
6. **TPERM Restrictions**: Codes 14-15 cause FAULT to prevent bypass
7. **Exclusive Monitor**: LOADX/SAVEX for atomic operations

## License

Part of the CM Simulator project implementing Kenneth James Hamer-Hodges' capability-based architecture.
