# PP250 Meta-Machine Simulator

## Overview
A Haskell simulator for the PP250 capability-based meta-machine, implementing Kenneth James Hamer-Hodges' architecture. The system uses "Golden Tokens" (192-bit capability keys) for all access control.

## Project Structure
```
metaMachine.hs              # Main entry point
PP250/
├── Core/
│   ├── Types.hs            # Shared data types (CPUState, ContextRegister, etc.)
│   └── Utils.hs            # Utility functions (formatting, key operations)
├── Instructions/
│   ├── Arithmetic.hs       # ADD, SUB, MUL, MOV, MVN, NEG, ADDI, SUBI
│   ├── Logic.hs            # AND, ORR, EOR, BIC, NOT
│   ├── Shift.hs            # LSL, LSR, ASR, ROR
│   ├── Compare.hs          # CMP, CMN, TST, TEQ + condition checker
│   ├── Branch.hs           # B, BL with condition codes
│   ├── Switch.hs           # SWITCH instruction (namespace relocation)
│   ├── LoadSave.hs         # LOAD, SAVE capability operations
│   ├── Call.hs             # CALL instruction (procedure entry)
│   ├── Return.hs           # RETURN instruction (procedure exit)
│   └── Change.hs           # CHANGE instruction (context switch)
├── Console/
│   ├── HUD.hs              # System telemetry display
│   └── REPL.hs             # Interactive console
└── Boot/
    └── Sequence.hs         # 4-step boot sequence
```

## Running the Project

### Console Simulator (Haskell)
```bash
runghc -i. metaMachine.hs
```

### Web Visualization
```bash
python web/server.py
```
Then open http://localhost:5000 in your browser.

## Key Concepts
- **Context Registers (CR0-CR7)**: Hold capability keys granting access rights
- **Data Registers (DR0-DR7)**: Hold 64-bit numeric values
- **CR15 (Namespace)**: Root capability defining system scope
- **CR8 (Thread)**: Current user/process identity
- **C-List**: List of capability keys available to current context
- **Bind Permission (B)**: When set, allows the Golden Token to be saved into the namespace DNA (persistent). When not set, prevents saving - used for temporary lending or newly minted tokens
- **Condition Flags (NZCV)**: ARM-style flags set by arithmetic operations
  - N (Negative): Result has sign bit set
  - Z (Zero): Result is zero
  - C (Carry): Unsigned overflow on ADD, no borrow on SUB
  - V (Overflow): Signed overflow detected

## Available Commands

### System
| Command | Description |
|---------|-------------|
| HELP | Show full command reference |
| HUD | Display system telemetry |
| NS | Display namespace (CR15) |
| CLIST | Display C-List keys |
| FLAGS | Display condition flags (NZCV) |
| EXIT | Shutdown |

### Arithmetic (sets NZCV)
| Command | Description |
|---------|-------------|
| ADD d s | DR[d] = DR[d] + DR[s] |
| SUB d s | DR[d] = DR[d] - DR[s] |
| MUL d s | DR[d] = DR[d] * DR[s] |
| NEG d s | DR[d] = -DR[s] |
| ADDI d imm | DR[d] = DR[d] + immediate |
| SUBI d imm | DR[d] = DR[d] - immediate |
| MOV d s | DR[d] = DR[s] |
| MVN d s | DR[d] = NOT DR[s] |

### Logic (sets N, Z)
| Command | Description |
|---------|-------------|
| AND d s | DR[d] = DR[d] AND DR[s] |
| ORR d s | DR[d] = DR[d] OR DR[s] |
| EOR d s | DR[d] = DR[d] XOR DR[s] |
| BIC d s | DR[d] = DR[d] AND (NOT DR[s]) |
| NOT d s | DR[d] = NOT DR[s] |

### Shifts (sets N, Z, C)
| Command | Description |
|---------|-------------|
| LSL d s amt | Logical shift left |
| LSR d s amt | Logical shift right |
| ASR d s amt | Arithmetic shift right |
| ROR d s amt | Rotate right |

### Compare (flags only)
| Command | Description |
|---------|-------------|
| CMP a b | Compare DR[a] - DR[b] |
| CMN a b | Compare negative DR[a] + DR[b] |
| TST a b | Test bits DR[a] AND DR[b] |
| TEQ a b | Test equal DR[a] XOR DR[b] |

### Branch
| Command | Description |
|---------|-------------|
| B offset | Unconditional branch |
| B cond offset | Conditional branch (EQ/NE/GT/LT/etc) |
| BL offset | Branch with link |

### Condition Codes
Used with conditional branches (e.g., `B EQ 10` branches if equal).

| Code | Name | Meaning | Flag Test |
|------|------|---------|-----------|
| EQ | Equal | Result was zero | Z=1 |
| NE | Not Equal | Result was non-zero | Z=0 |
| CS/HS | Carry Set / Unsigned Higher or Same | Unsigned >= (no borrow) | C=1 |
| CC/LO | Carry Clear / Unsigned Lower | Unsigned < (borrow occurred) | C=0 |
| MI | Minus (Negative) | Result is negative | N=1 |
| PL | Plus (Positive or Zero) | Result is positive or zero | N=0 |
| VS | Overflow Set | Signed overflow occurred | V=1 |
| VC | Overflow Clear | No signed overflow | V=0 |
| HI | Unsigned Higher | Unsigned > | C=1 AND Z=0 |
| LS | Unsigned Lower or Same | Unsigned <= | C=0 OR Z=1 |
| GE | Signed Greater or Equal | Signed >= | N=V |
| LT | Signed Less Than | Signed < | N!=V |
| GT | Signed Greater Than | Signed > | Z=0 AND N=V |
| LE | Signed Less or Equal | Signed <= | Z=1 OR N!=V |
| AL | Always | Unconditional (default) | Always true |

**Examples:**
- `CMP 0 1` then `B EQ 100` - Branch to 100 if DR0 equals DR1
- `CMP 0 1` then `B GT 50` - Branch to 50 if DR0 > DR1 (signed)
- `CMP 0 1` then `B HI 50` - Branch to 50 if DR0 > DR1 (unsigned)

### Capabilities
| Command | Description |
|---------|-------------|
| LOAD d s i | Load capability |
| SAVE d s | Save data |
| CALL reg | Enter procedure |
| RETURN | Exit procedure |
| CHANGE offset | Switch thread |
| SWITCH reg | Set CR15 (Namespace) to capability in CR[reg] |

## Recent Changes
- 2026-01-13: Added Assembly Editor with code editor, example programs, and step execution
- 2026-01-13: Added Instruction Visualizer with animated data flow and step-by-step execution
- 2026-01-13: Added B (Bind) permission for persistent namespace storage
- 2026-01-13: Added Capability Explorer with Golden Token visualization
- 2026-01-13: Added full ARM-style instruction set (arithmetic, logic, shifts, compare, branch)
- 2026-01-13: Added ARM-style NZCV condition flags to arithmetic operations
- 2026-01-13: Refactored into modular structure with separate instruction files
- 2026-01-13: Added CALL and RETURN instructions
- 2026-01-13: Added comprehensive code documentation
- 2026-01-13: Added CLIST command for capability key display
- 2026-01-10: Initial project setup with Haskell GHC 9.8
