# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
A simulator for the CTMM (Church-Turing Meta-Machine) capability-based architecture, implementing Kenneth James Hamer-Hodges' failsafe security design. The system uses "Golden Tokens" (192-bit capability keys) for all access control.

## Project Structure
```
metaMachine.hs              # Main entry point
CTMM/
├── Core/
│   ├── Types.hs            # Shared data types (CPUState, ContextRegister, etc.)
│   └── Utils.hs            # Utility functions (formatting, key operations)
├── Instructions/
│   ├── Arithmetic.hs       # ADD, SUB, MUL, MOV, MVN, NEG, ADDI, SUBI
│   ├── Logic.hs            # AND, ORR, EOR, BIC, NOT
│   ├── Shift.hs            # LSL, LSR, ASR, ROR
│   ├── Compare.hs          # CMP, CMN, TST, TEQ + condition checker
│   ├── PermTest.hs         # TPERM - permission/bounds validation
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
- **Data Registers (DR0-DR15)**: Hold 64-bit numeric values
- **CR15 (Namespace)**: Root capability defining system scope
- **CR8 (Thread)**: Current user/process identity
- **Thread Objects**: Type-less containers with open access for microcode to save machine state (data registers DR0-DR7 + Golden Tokens CR0-CR3) during context switches. No program-level access rights - only microcode can read/write thread state, preventing programs from tampering with saved execution context.
- **C-List**: List of capability keys available to current context
- **Bind Permission (B)**: When set, allows the Golden Token to be saved into the namespace DNA (persistent). When not set, prevents saving - used for temporary lending or newly minted tokens
- **Condition Flags (NZCV)**: ARM-style flags set by arithmetic operations
  - N (Negative): Result has sign bit set
  - Z (Zero): Result is zero
  - C (Carry): Unsigned overflow on ADD, no borrow on SUB
  - V (Overflow): Signed overflow detected

## Golden Token Structure (64-bit in Context Registers)
| Bit Range | Field       | Description |
|-----------|-------------|-------------|
| 0-31      | Offset      | Index into Namespace Table (the "pointer") |
| 32-47     | Permissions | On/Off bits (R/W/X/L/S/E/B) |
| 48-63     | Spare       | Reserved (future flags or Thread ID) |

**Security Rule:** The MAC does NOT cover permissions. This allows a thread to downgrade a key (turn off bits) and pass it to a sub-process without needing to recalculate the crypto signature. You can restrict rights, but you cannot forge the location or size.

## Namespace Entry (3-Word Descriptor in Memory)
Pointed to by the Golden Token's Offset field.

| Word   | Field    | Content (64-bit) |
|--------|----------|------------------|
| Word 1 | Location | Physical Address (RAM) OR URL (Network/Cloud) |
| Word 2 | Limit    | Object Size (in bytes/words). Defines the boundary |
| Word 3 | Seals    | MetaData[0:31] + Type[32:47] + MAC[48:63] |

**MAC Validation:**
When hardware LOADs a key, it performs:
```
Calculated_MAC = Hash(GT_Offset + Word1 + Word2 + Word3_Meta)
If Calculated_MAC != Word3_MAC → Security Trap (object corrupted or forged)
```

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

### Permission Test (validates gifted capabilities)
| Command | Description |
|---------|-------------|
| TPERM cr mask | Test if CR[cr] has ALL permissions in mask |
| TPERM cr mask BOUNDS n | Also verify offset n <= capability size |

**Mask format:** Any combination of `R`, `W`, `X`, `L`, `S`, `E`, `B`
- Example: `TPERM 0 RW` - Check if CR0 has Read and Write
- Example: `TPERM 1 LSE BOUNDS 512` - Check CR1 has L+S+E and 512 <= size

**Flags set:**
- Z=1 if all checks pass (capability is safe to use)
- Z=0 if any check fails (reject the capability)
- C=1 if permissions OK, V=1 if bounds OK, N=1 if no permissions

**Purpose:** Validate gifted Golden Tokens aren't malware tricks before trusting them.

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
- 2026-01-15: Assembly Editor: Static "Boot/Nucleus" namespace path (security - no direct access)
- 2026-01-15: Assembly Editor: Three output tabs - Console, TURING (DR0-DR15), CHURCH (CR0-CR15)
- 2026-01-15: Assembly Editor: SPARE registers (CR9-CR14) greyed out, narrower panel for wider code editor
- 2026-01-15: Assembly Editor redesigned with fixed horizontal toolbar (no sidebar)
- 2026-01-15: Examples moved to Command Input dropdown menu
- 2026-01-15: Removed Quick Reference and Church/Turing paradigm tabs from Assembly
- 2026-01-15: Simplified UI with fixed top toolbar (non-scrolling) and minimal sidebar
- 2026-01-15: Consolidated view selector and action buttons into single header row
- 2026-01-15: Removed Visualizer and DNS Editor from main nav (streamlined to 5 views)
- 2026-01-15: Tutorial now uses dropdown for lesson selection instead of sidebar list
- 2026-01-15: Added IEEE 754 Binary64 compliance to all SlideRule (Float) functions
- 2026-01-15: Added NaN propagation, Infinity handling, and FPSR flag documentation
- 2026-01-15: Added special case handling (0/0=NaN, Inf-Inf=NaN, 0*Inf=NaN, etc.)
- 2026-01-15: Added formal type validation (TPERM checks) to all beta-reduction code for flawless computer science
- 2026-01-15: SlideRule functions validate Float type (8-byte), Abacus functions validate Integer type (8-byte)
- 2026-01-15: Added domain validation (div-by-zero, sqrt of negative, log of non-positive) with trap handlers
- 2026-01-15: Added click-to-view beta-reduction assembly code for all Function GTs in Namespace Browser
- 2026-01-15: Added Circle abstraction with GT_PI, GT_TWO_PI constants and GT_CIRCUMFERENCE, GT_AREA, GT_DIAMETER functions
- 2026-01-15: Added editable GT bit field editor in Capability Explorer (Offset[0:31], Permissions[32:47], Spare[48:63])
- 2026-01-15: Added 3-word Namespace Entry editor (Location, Limit, Seals with MetaData+Type+MAC breakdown)
- 2026-01-15: Added live MAC validation with Hash(GT_Offset + W1 + W2 + W3_Meta) formula
- 2026-01-15: Added visual MAC valid/invalid indicator with Security Trap warning
- 2026-01-15: Replaced all PP250 references with CTMM throughout codebase
- 2026-01-14: Added right-click context menu for Namespace Browser (Add/Edit/Link/Delete objects with modal dialogs)
- 2026-01-14: Added dynamic object creation with automatic address allocation (0x8000+ range, 0x1000 aligned)
- 2026-01-14: Added popup help tooltips for all UI elements (hover to see explanations)
- 2026-01-14: Added Namespace Browser with flat object list and C-List hierarchy visualization
- 2026-01-14: Added Boot Namespace with Boot root abstraction
- 2026-01-14: Added Thread C-Lists for Kenneth, Matthew, and Daniel
- 2026-01-14: Added SlideRule abstraction with math function GTs (ADD, SUB, MUL, DIV, LOG, EXP, SQRT, POW)
- 2026-01-14: Added Abacus abstraction with integer math function GTs (ADD, SUB, MUL, DIV, MOD, ABS, NEG, INC, DEC)
- 2026-01-14: Reorganized Assembly Editor with CHURCH/TURING tabs (CHURCH as default)
- 2026-01-14: Enhanced Command Input with categorized dropdown for all instructions (Arithmetic, Logic, Shifts, Compare, Branch, Capability Church)
- 2026-01-14: Added Church Instructions to web simulator (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH) with permission checking
- 2026-01-14: Added condition code dropdown for branch instructions (EQ/NE/GT/LT/CS/CC/MI/PL/VS/VC/HI/LS/GE/LE)
- 2026-01-14: Added CR register selector with CR8 (Thread) and CR15 (Namespace) options
- 2026-01-14: Added TPERM instruction for validating gifted capabilities (permission mask + optional bounds check)
- 2026-01-13: Added Capability DNS Editor with MINT function for creating new capabilities with custom size/permissions
- 2026-01-13: Added Interactive Tutorial with 5 lessons on capability-based security concepts
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
