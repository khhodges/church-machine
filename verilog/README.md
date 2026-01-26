# CTMM Verilog Hardware Implementation

This directory contains a synthesizable Verilog (SystemVerilog) implementation of the Church-Turing Meta-Machine (CTMM) capability-based architecture designed by Kenneth James Hamer-Hodges.

## Architecture Overview

The CTMM hardware implements failsafe security through Golden Tokens (64-bit capability keys) for all access control. The design follows these core principles:

1. **Capability-Based Security**: All access is mediated by Golden Tokens
2. **Hardware-Enforced Permissions**: Permission checks are performed in dedicated hardware
3. **Deterministic Garbage Collection**: The G bit enables hardware-assisted GC
4. **Failsafe Design**: Single FAULT output for all security violations

## File Structure

```
verilog/
├── ctmm_pkg.sv           # Package with types, constants, and definitions
├── ctmm_registers.sv     # Register file (18 x 256-bit CRs, 16 x 64-bit DRs)
├── ctmm_mload.sv         # mLoad micro-routine (shared trusted code)
├── ctmm_load.sv          # LOAD Church-Instruction (uses mLoad)
├── ctmm_perm_check.sv    # Permission checking unit
├── ctmm_gc_unit.sv       # Garbage collection unit with G bit
├── ctmm_decoder.sv       # Instruction decoder
├── ctmm_core.sv          # Top-level processor core
├── ctmm_tb.sv            # Testbench
└── README.md             # This file
```

## Capability Register (CR) Format - 4 x 64-bit Words (256 bits)

Each of the 18 Capability Registers contains 4 words:

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
| CR7      | CLOOMC Nucleus | Function Abstraction Code         |
| CR8      | Thread         | Suspended Thread State            |
| CR9      | Interrupt      | Interrupt Thread                  |
| CR10     | Double Fault   | Double Fault Recovery Thread      |
| CR11-CR14| General        | General purpose capability storage |
| CR15     | Namespace      | Namespace root capability         |

### Data Registers (Turing) - 16 x 64-bit
- **DR0-DR15**: 64-bit data registers for arithmetic/logic operations

### Condition Flags
- N (Negative), Z (Zero), C (Carry), V (Overflow)

## Instruction Set

### Church Instructions (Capability Operations)
| Opcode | Mnemonic | Description |
|--------|----------|-------------|
| 000001 | LOAD     | Load capability from C-List |
| 000010 | SAVE     | Save capability to C-List |
| 000011 | CALL     | Call procedure via capability |
| 000100 | RETURN   | Return from procedure |
| 000101 | CHANGE   | Change thread identity |
| 000110 | SWITCH   | Switch namespace |
| 000111 | TPERM    | Test permissions |

### Turing Instructions (Data Operations)
| Opcode | Mnemonic | Description |
|--------|----------|-------------|
| 010000 | MOV      | Move data |
| 010001 | ADD      | Add |
| 010010 | SUB      | Subtract |
| 010011 | MUL      | Multiply |
| 010100 | DIV      | Divide |
| 010101 | AND      | Bitwise AND |
| 010110 | ORR      | Bitwise OR |
| 010111 | EOR      | Bitwise XOR |
| 011000 | LSL      | Logical Shift Left |
| 011001 | LSR      | Logical Shift Right |
| 011010 | ASR      | Arithmetic Shift Right |
| 011011 | CMP      | Compare |
| 011100 | TST      | Test bits |
| 100000 | B        | Branch |
| 100001 | BL       | Branch with Link |

## Boot Sequence

1. **FAULT_RST**: Clear all registers (cold restart)
2. **LOAD_NS**: Load namespace root into CR15 with M+L permissions
3. **INIT_THRD**: Initialize thread identity in CR8
4. **LOAD_NUC**: Load CR6 (Boot C-List) and CR7 (Nucleus)

## mLoad Micro-Routine - Shared Trusted Code

The mLoad micro-routine (`ctmm_mload.sv`) is the **single trusted microcode** for all capability fetching. This minimizes the Trusted Computing Base (TCB) - all Church CLOOMC instructions that need to fetch capabilities share this verified code:

| Instruction | Uses mLoad For | Status |
|-------------|----------------|--------|
| **LOAD**    | Fetch capability into destination register | Implemented |
| **CALL**    | Fetch procedure capability, then transfer control | Planned |
| **RETURN**  | Fetch return capability from stack | Planned |
| **CHANGE**  | Fetch new thread identity into CR8 | Planned |
| **SWITCH**  | Fetch new namespace capability into CR15 | Planned |

### mLoad Interface

```systemverilog
// Caller provides:
input  sub_start,           // Start mLoad
input  sub_cr_src,          // Source register (CRn)
input  sub_cr_dst,          // Destination register (CRd) - written directly
input  sub_index,           // C-List index

// mLoad signals:
output sub_done,            // Completed successfully
output sub_fault,           // Caused a fault

// Direct register write (single bus transfer):
output cr_wr_addr,          // Destination register
output cr_wr_data,          // Fetched capability with G bit cleared
output cr_wr_en,            // Write enable (on completion)
```

**Key Optimization:** mLoad writes directly to the destination register, avoiding a second bus transfer through the caller. Each Church instruction just specifies its destination:
- **LOAD**: User-specified CRd
- **CALL**: CR7 (Nucleus)
- **RETURN**: Return register
- **CHANGE**: CR8 (Thread)
- **SWITCH**: CR15 (Namespace)

### mLoad Microcode Sequence

The mLoad micro-routine fetches a capability from a C-List. The microcode sequence is:

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
| 9    | RESET_G       | Reset G bit in CR15[GT.offset].Word3.Gbit        |
| 10   | COMPLETE      | Write all 4 words to CRd, assert sub_done        |

**Key Points:**
- Result is written directly to destination register in COMPLETE state (single bus transfer)
- cr_wr_en is asserted for one cycle in COMPLETE - register file must capture on rising edge
- CRd.W0 = GT fetched from CRn[Index] (the Golden Token)
- CRd.W1, W2, W3 = fetched from CR15 (Namespace) at GT.offset
- Step 4 validates: GT.offset < CR15.limit AND CR15 has M permission
- **GT.offset is a direct memory offset (bytes), not an index** - this provides hardware error detection

**Fault Conditions:**
- NULL capability access → FAULT_NULL_CAP
- M or L permission missing on CRn → FAULT_PERM_L
- Index >= CRn.Limit → FAULT_BOUNDS
- GT.offset >= CR15.limit OR CR15 missing M → FAULT_BOUNDS/FAULT_PERM_M
- MAC mismatch → FAULT_MAC

## Garbage Collection

The G bit enables deterministic garbage collection:

1. **Mark Phase**: GC sets G=1 on all namespace entries
2. **Scan Phase**: Valid key access (via LOAD) resets G=0
3. **Sweep Phase**: Entries with G=1 are unreachable garbage

## Simulation

Using Icarus Verilog:
```bash
iverilog -g2012 -o ctmm_sim ctmm_pkg.sv ctmm_registers.sv ctmm_perm_check.sv ctmm_gc_unit.sv ctmm_decoder.sv ctmm_core.sv ctmm_tb.sv
vvp ctmm_sim
```

Using Verilator:
```bash
verilator --binary -j 0 --top-module ctmm_tb ctmm_pkg.sv ctmm_registers.sv ctmm_perm_check.sv ctmm_gc_unit.sv ctmm_decoder.sv ctmm_core.sv ctmm_tb.sv
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

## License

Part of the CTMM Simulator project implementing Kenneth James Hamer-Hodges' capability-based architecture.
