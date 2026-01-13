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
│   ├── Arithmetic.hs       # ADD, SUB, POW operations
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
```bash
runghc -i. metaMachine.hs
```

## Key Concepts
- **Context Registers (CR0-CR7)**: Hold capability keys granting access rights
- **Data Registers (DR0-DR7)**: Hold 64-bit numeric values
- **CR15 (Namespace)**: Root capability defining system scope
- **CR8 (Thread)**: Current user/process identity
- **C-List**: List of capability keys available to current context

## Available Commands
| Command | Description |
|---------|-------------|
| HELP | Show command reference |
| HUD | Display system telemetry |
| NS | Display namespace (CR15) |
| CLIST | Display C-List keys |
| ADD/SUB/POW dest src | Math operations |
| LOAD dest src i | Load capability |
| SAVE dest src | Save data |
| CALL reg | Enter procedure |
| RETURN | Exit procedure |
| CHANGE offset | Switch thread |
| EXIT | Shutdown |

## Recent Changes
- 2026-01-13: Refactored into modular structure with separate instruction files
- 2026-01-13: Added CALL and RETURN instructions
- 2026-01-13: Added comprehensive code documentation
- 2026-01-13: Added CLIST command for capability key display
- 2026-01-10: Initial project setup with Haskell GHC 9.8
