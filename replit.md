# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
A comprehensive simulator for the CTMM (Church-Turing Meta-Machine) capability-based architecture, implementing Kenneth James Hamer-Hodges' failsafe security design. The system uses "Golden Tokens" (64-bit capability keys) for all access control, combining Church's lambda calculus with Turing's computational model.

## Project Structure

### Haskell Console Simulator
```
metaMachine.hs              # Main entry point for console REPL
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

### Web Visualization (Primary Interface)
```
web/
├── server.py               # Python HTTP server with no-cache headers (port 5000)
├── index.html              # Main HTML with 5 view sections
├── styles.css              # Complete CSS with tooltip system (~3600 lines)
├── simulator.js            # Core CTMM simulator logic and state
└── app.js                  # UI interactions, namespace browser, persistence (~5000 lines)
```

## Running the Project

### Web Visualization (Recommended)
```bash
python web/server.py
```
Then open http://localhost:5000 in your browser.

### Console Simulator (Haskell)
```bash
runghc -i. metaMachine.hs
```

---

## Web Interface Views

The simulator provides 5 integrated views accessible via the dropdown in the header:

### 1. Dashboard (Default)
The main control panel showing:
- **Boot Sequence Banner**: 4-step initialization process with visual progress
- **Church Registers (CR0-CR7)**: Capability registers holding Golden Tokens
- **Lambda Registers**: Special registers (CR15 Namespace, CR8 Thread, CR6 C-List, CR7 Nucleus)
- **Turing Registers (DR0-DR15)**: 64-bit data registers with page navigation
- **Condition Flags**: Turing flags (N, Z, C, V) and Church flags (P, B)
- **Command Input**: Dropdown-based instruction builder with all opcodes
- **Output Log**: Console output and status messages

### 2. Namespace Browser
Visual exploration of the capability namespace:
- **Namespace Objects**: Flat list of all objects in the system (Boot, Thread, SlideRule, Abacus, Circle, etc.)
- **C-List Hierarchy**: Tree view showing capability relationships per thread
- **Toolbar Actions**: Add, Edit, Link, Delete objects + Export/Import state
- **Click-to-Select**: Select objects to view/edit their properties

### 3. Assembly Editor
Code editor for writing and executing CTMM assembly:
- **Code Editor**: Syntax-highlighted text area for assembly programs
- **Examples Dropdown**: Pre-built example programs demonstrating concepts
- **Output Tabs**: Console output, TURING registers (DR0-DR15), CHURCH registers (CR0-CR15)
- **Static Namespace Path**: Shows "Boot/Nucleus" (security - no direct namespace access from code)

### 4. Capabilities Explorer
Deep dive into Golden Token structure:
- **Capability List**: All capabilities in the current context
- **Bit Field Editor**: Editable view of GT structure (Offset[0:31], Permissions[32:47], Spare[48:63])
- **Namespace Entry Editor**: 3-word descriptor (Location, Limit, Seals with MetaData+Type+MAC)
- **MAC Validation**: Live calculation showing Hash(GT_Offset + W1 + W2 + W3_Meta) with valid/invalid indicator

### 5. Tutorial
Interactive lessons on capability-based security:
- **Lesson Dropdown**: Select from 5 progressive lessons
- **Rich Content**: Explanations of Church-Turing concepts, Golden Tokens, permissions, etc.
- **Guided Examples**: Step-by-step walkthroughs of key operations

---

## Key Architectural Concepts

### Register Architecture
- **Context Registers (CR0-CR7)**: Hold capability keys (Golden Tokens) granting access rights
- **Data Registers (DR0-DR15)**: Hold 64-bit numeric values for computation
- **CR15 (Namespace)**: Root capability defining current system scope
- **CR8 (Thread)**: Current user/process identity
- **CR7 (Nucleus)**: Trusted kernel capability
- **CR6 (C-List)**: Current capability list for context

### Golden Token Structure (64-bit)
| Bit Range | Field       | Description |
|-----------|-------------|-------------|
| 0-31      | Offset      | Index into Namespace Table (the "pointer") |
| 32-47     | Permissions | On/Off bits (R/W/X/L/S/E/B) |
| 48-63     | Spare       | Reserved (future flags or Thread ID) |

### Permission Bits
| Bit | Name | Description |
|-----|------|-------------|
| R | Read | Can read object data |
| W | Write | Can modify object data |
| X | Execute | Can execute as code |
| L | Load | Can load sub-capabilities |
| S | Save | Can save to object |
| E | Enter | Can call as procedure |
| B | Bind | Can save to namespace DNA (persistent) |

### Namespace Entry (3-Word Descriptor)
| Word | Field | Content (64-bit) |
|------|-------|------------------|
| Word 1 | Location | Physical Address (RAM) OR URL (Network/Cloud) |
| Word 2 | Limit | Object Size (in bytes/words) |
| Word 3 | Seals | MetaData[0:31] + Type[32:47] + MAC[48:63] |

### MAC Validation
Hardware validates capabilities on LOAD:
```
Calculated_MAC = Hash(GT_Offset + Word1 + Word2 + Word3_Meta)
If Calculated_MAC != Word3_MAC → Security Trap
```

---

## Boot Sequence

The 4-step boot process initializes the CTMM:

1. **Hardware Reset**: Clear all registers, initialize CPU state
2. **Load Namespace**: Establish root namespace in CR15 for access control
3. **Initialize Thread**: Set current thread identity in CR8 (default: Kenneth)
4. **Load Nucleus**: Load trusted kernel capability into CR7

Use **Step** button to execute one step at a time, or **Run** to complete all steps.

---

## Namespace Objects

### Built-in Abstractions

**Boot**: Root namespace containing all system objects

**Threads** (User identities):
- Kenneth, Matthew, Daniel - Each with their own C-List

**SlideRule** (IEEE 754 Float operations):
- Functions: ADD, SUB, MUL, DIV, LOG, EXP, SQRT, POW
- Constants: PI, E
- Full IEEE 754 Binary64 compliance with NaN/Infinity handling

**Abacus** (Integer operations):
- Functions: ADD, SUB, MUL, DIV, MOD, ABS, NEG, INC, DEC
- 64-bit signed integer arithmetic

**Circle** (Geometric calculations):
- Functions: CIRCUMFERENCE, AREA, DIAMETER
- Constants: PI, TWO_PI

---

## UI Features

### Tooltip Help System
All interactive elements have hover tooltips explaining their purpose:
- **Attribute**: `data-tooltip="explanation text"`
- **Positioning**: `tooltip-bottom` class displays tooltip below element (for top-of-screen items)
- **Width**: Fixed 250px for consistent display
- **Z-index**: 99999 ensures visibility above all layers

### State Persistence
The simulator automatically saves and restores state:

| Key | Purpose |
|-----|---------|
| `ctmm_namespace_state` | Namespace objects, dynamic objects, C-Lists, addresses |
| `ctmm_editor_content` | Assembly editor code content |

### Export/Import
In the Namespace view toolbar:
- **Export**: Downloads complete state as JSON file (`ctmm_state_YYYY-MM-DD.json`)
- **Import**: Restores state from previously exported JSON file

Exported state includes:
- Dynamic objects and C-Lists
- Namespace modifications
- Simulator state (registers, flags, IP, boot step)

---

## Instruction Set Reference

### Arithmetic (sets NZCV flags)
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

### Logic (sets N, Z flags)
| Command | Description |
|---------|-------------|
| AND d s | DR[d] = DR[d] AND DR[s] |
| ORR d s | DR[d] = DR[d] OR DR[s] |
| EOR d s | DR[d] = DR[d] XOR DR[s] |
| BIC d s | DR[d] = DR[d] AND (NOT DR[s]) |
| NOT d s | DR[d] = NOT DR[s] |

### Shifts (sets N, Z, C flags)
| Command | Description |
|---------|-------------|
| LSL d s amt | Logical shift left |
| LSR d s amt | Logical shift right |
| ASR d s amt | Arithmetic shift right |
| ROR d s amt | Rotate right |

### Compare (sets flags only)
| Command | Description |
|---------|-------------|
| CMP a b | Compare DR[a] - DR[b] |
| CMN a b | Compare negative DR[a] + DR[b] |
| TST a b | Test bits DR[a] AND DR[b] |
| TEQ a b | Test equal DR[a] XOR DR[b] |

### Permission Test
| Command | Description |
|---------|-------------|
| TPERM cr mask | Test if CR[cr] has ALL permissions in mask |
| TPERM cr mask BOUNDS n | Also verify offset n <= capability size |

### Branch
| Command | Description |
|---------|-------------|
| B offset | Unconditional branch |
| B cond offset | Conditional branch (EQ/NE/GT/LT/etc) |
| BL offset | Branch with link |

### Capability Operations (Church)
| Command | Description |
|---------|-------------|
| LOAD d s i | Load capability from object |
| SAVE d s | Save data to object |
| CALL reg | Enter procedure via capability |
| RETURN | Exit procedure |
| CHANGE offset | Switch thread context |
| SWITCH reg | Set CR15 to capability in CR[reg] |

---

## Condition Codes

| Code | Name | Meaning | Flag Test |
|------|------|---------|-----------|
| EQ | Equal | Result was zero | Z=1 |
| NE | Not Equal | Result was non-zero | Z=0 |
| CS/HS | Carry Set | Unsigned >= | C=1 |
| CC/LO | Carry Clear | Unsigned < | C=0 |
| MI | Minus | Negative | N=1 |
| PL | Plus | Positive or zero | N=0 |
| VS | Overflow Set | Signed overflow | V=1 |
| VC | Overflow Clear | No overflow | V=0 |
| HI | Higher | Unsigned > | C=1 AND Z=0 |
| LS | Lower/Same | Unsigned <= | C=0 OR Z=1 |
| GE | Greater/Equal | Signed >= | N=V |
| LT | Less Than | Signed < | N!=V |
| GT | Greater Than | Signed > | Z=0 AND N=V |
| LE | Less/Equal | Signed <= | Z=1 OR N!=V |
| AL | Always | Unconditional | Always true |

---

## Recent Changes

- 2026-01-16: Added Export/Import buttons to Namespace toolbar with tooltip-bottom positioning
- 2026-01-16: Fixed BigInt serialization in export function for JSON compatibility
- 2026-01-16: Renamed localStorage key from pp250_namespace_state to ctmm_namespace_state
- 2026-01-16: Added exportNamespaceState() and importNamespaceState() functions
- 2026-01-16: Fixed tooltip width to 250px for consistent display
- 2026-01-16: Added tooltip-bottom class to condition flags (N, Z, C, V, P, B)
- 2026-01-15: Assembly Editor: Static "Boot/Nucleus" namespace path (security)
- 2026-01-15: Assembly Editor: Three output tabs - Console, TURING, CHURCH
- 2026-01-15: Simplified UI with fixed top toolbar and 5 streamlined views
- 2026-01-15: Added IEEE 754 Binary64 compliance to SlideRule functions
- 2026-01-15: Added formal type validation (TPERM checks) to beta-reduction code
- 2026-01-15: Added editable GT bit field editor in Capability Explorer
- 2026-01-15: Added 3-word Namespace Entry editor with live MAC validation
- 2026-01-15: Replaced all PP250 references with CTMM throughout codebase
- 2026-01-14: Added right-click context menu for Namespace Browser
- 2026-01-14: Added popup help tooltips for all UI elements
- 2026-01-14: Added SlideRule and Abacus math abstractions
- 2026-01-14: Added Circle abstraction with geometric functions
- 2026-01-14: Added Thread C-Lists for Kenneth, Matthew, Daniel
- 2026-01-14: Added Church Instructions (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH)
- 2026-01-14: Added TPERM instruction for capability validation
- 2026-01-13: Added Interactive Tutorial with 5 lessons
- 2026-01-13: Added Assembly Editor with example programs
- 2026-01-13: Added Capability Explorer with Golden Token visualization
- 2026-01-13: Added ARM-style NZCV condition flags
- 2026-01-10: Initial project setup with Haskell GHC 9.8

---

## User Preferences

- Tooltips positioned below for elements near top of viewport
- Minimal UI with consolidated header controls
- Auto-switching to Dashboard when Reset/Step/Run clicked
- Code persistence in localStorage for session continuity
