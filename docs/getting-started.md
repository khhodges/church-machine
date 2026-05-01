# Getting Started with the Church Machine

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

## For Educators

The Church Machine teaches computer security through direct experience. Students write programs that interact with a capability-secured processor — they learn security not as an add-on, but as the fundamental way computers work.

### What Students Will Learn

1. **Capabilities vs. Access Control Lists**: Every resource requires an explicit token (Golden Token). No ambient authority, no root user.
2. **Permission Models**: Six permission bits (R, W, X, L, S, E) control what operations are possible on each resource.
3. **Revocation**: How to instantly revoke access across all copies of a token.
4. **Domain Separation**: Why keeping data processing separate from security operations prevents entire classes of attacks.
5. **Lambda Calculus**: How pure functions can perform computation (Church numerals, Boolean logic). LAMBDA is an instruction/method within abstractions, not a standalone security block.

### Lesson Progression

1. Start with the **Self-Test** example — shows basic register operations
2. Move to **Salvation** — demonstrates CALL and security pipeline verification, transitions to Navana
3. Try **Load/Save** — capability manipulation
4. Explore **Bernoulli** — lambda calculus and Church numerals
5. Run **Perm Attack** and **Bind Attack** — see the security system block unauthorized access

## Using the Web IDE

### Views

The IDE has eight views, accessible via the toolbar:

| View | Purpose |
|------|---------|
| **Dashboard** | Register inspection (CR0–CR15, DR0–DR15), machine state, flags |
| **Code** | Assembly editor with syntax highlighting, examples, assemble/deploy |
| **Namespace** | Browse all namespace entries with their GTs, versions, and permissions — see the [Namespace Vocabulary Tutorial](namespace-vocabulary-tutorial.md) to understand how a namespace grows from raw registers into application-level vocabulary |
| **Abstractions** | Catalog of all 45 security blocks across 9 layers |
| **Pipeline** | Visual 7-step security pipeline (mLoad validation) |
| **Tutorial** | Guided lessons with explanations |
| **REPL** | Lambda calculus interactive interpreter |
| **Reference** | Complete instruction set documentation |

### Writing Your First Program

1. Click **Code** in the toolbar
2. Clear the editor and type:

```asm
; My first Church program
; Load the Salvation abstraction and call it

LOAD CR0, CR6, #4     ; Load Salvation GT from c-list row 4
CALL CR0              ; Enter Salvation (imm=0: fast-path, NIA = lump word 1)
; Salvation transitions to Navana (does not RETURN)
; Navana runs indefinitely as namespace controller
```

3. Click **Assemble** — the console shows success or error messages
4. Click **Step** to execute one instruction at a time
5. Watch the **Dashboard** to see registers change

### Understanding the Dashboard

#### Context Registers (CR)

Each CR shows four 32-bit words:

- **GT**: The Golden Token value (version, index, permissions, type)
- **Location**: Base address of the referenced object
- **Limit**: Size bound of the object
- **Seal**: Integrity check (CRC-16/CCITT)

Click any CR to see its decoded fields (version, index, permissions breakdown).

#### Data Registers (DR)

Simple 32-bit integer values. DR0 is always zero.

#### Flags

ARM-style condition flags displayed in the flags bar:
- **N**: Result was negative
- **Z**: Result was zero
- **C**: Carry/borrow occurred
- **V**: Signed overflow occurred

### Assembly Examples

#### Loading and Calling an Abstraction

```asm
LOAD CR0, CR6, #4     ; Load from c-list row 4
CALL CR0              ; Enter abstraction (imm=0: fast-path)
; ... abstraction executes and RETURNs here
```

#### Restricting Permissions

```asm
LOAD CR1, CR6, #5     ; Load Mint from c-list
TPERM CR1, E          ; Restrict to Enter-only (remove all other perms)
CALL CR1              ; Enter Mint (imm=0: fast-path, permission check still applies)
```

#### Integer Arithmetic (Turing Domain)

```asm
IADD DR1, DR0, #10    ; DR1 = 0 + 10 = 10
IADD DR2, DR0, #20    ; DR2 = 0 + 20 = 20
IADD DR3, DR1, #0     ; DR3 = DR1 + 0 = 10
ISUB DR4, DR2, #5     ; DR4 = 20 - 5 = 15
MCMP DR3, DR4         ; Compare DR3 and DR4 (sets flags)
```

#### Conditional Execution

```asm
IADD DR1, DR0, #5     ; DR1 = 5
IADD DR2, DR0, #5     ; DR2 = 5
MCMP DR1, DR2         ; Compare: equal, so Z=1
IADDEQ DR3, DR0, #1   ; DR3 = 1 (executes because Z=1)
IADDNE DR4, DR0, #1   ; DR4 = 0 (skipped because Z=1, NE requires Z=0)
```

#### Loop with Branch

```asm
IADD DR1, DR0, #10    ; DR1 = counter = 10
loop:
    ISUB DR1, DR1, #1 ; Decrement counter
    BRANCHNE loop      ; Loop until DR1 = 0 (Z flag set)
RETURN
```

### Security Demonstrations

#### Permission Attack (Blocked)

The **Perm Attack** example tries to access a resource without the required permission. Watch the Pipeline view to see exactly where the security check fails:

1. Load a GT with only E permission
2. Try to DREAD (requires R permission)
3. mLoad detects missing R bit → FAULT

#### Bind Attack (Blocked)

The **Bind Attack** example tries to copy a GT without the B-bit set:

1. Load a GT (B=0 by default)
2. Try to SAVE it to another c-list
3. mSave detects B=0 → FAULT

### The REPL

The REPL provides an interactive lambda calculus environment:

```
λ> let n = succ(3)
n = 4

λ> let m = add(n, 2)
m = 6

λ> iszero(0)
TRUE

λ> iszero(n)
FALSE
```

Type `HELP` for available commands. Every REPL operation goes through the full 7-step security pipeline.

## For Developers

### Running Locally

```bash
pip install flask flask-sqlalchemy gunicorn
python main.py
```

The server starts on port 5000 and serves the simulator IDE.

### Project Layout

```
hardware/           Synthesizable Amaranth HDL (Church Machine, Tang Nano 20K target)
ctmm_amaranth/      Amaranth HDL hardware implementation (Church Machine)
simulator/          Web IDE (HTML/JS/CSS)
server/             Flask backend
docs/               Documentation
```

### Hardware Development

To modify the processor core:

1. Edit files in `hardware/` (Python/Amaranth HDL)
2. Run `python -m hardware.gen_verilog` to generate Verilog
3. Use the Makefile for synthesis and upload

Verify the core imports correctly:

```bash
python3 -c "from hardware.core import ChurchCore"
```

### Adding New Abstractions

1. Add the abstraction definition in `simulator/abstractions.js` using `createAbstraction()`
2. Implement methods in `simulator/system_abstractions.js` or `simulator/device_abstractions.js`
3. Bind methods using `bindMethod(index, methodName, fn)`
4. The abstraction automatically appears in the IDE's Abstractions view

## For Parents

The Church Machine is designed to teach children about computer security through safe experimentation. Key features for parents:

- **Capability-based access**: Children can only access resources you explicitly grant via Golden Tokens
- **Instant revocation**: Remove access to any resource instantly — all copies of the token die
- **Dual approval**: The Negotiate abstraction requires both parent and teacher approval for special grants
- **No backdoors**: There is no admin mode, no superuser, no way to bypass the security model
- **Namespace isolation**: Each child has their own isolated namespace — siblings cannot see each other's data unless you explicitly allow it

The c-list IS the approved list. If a capability slot is empty (NULL), access is denied by hardware. No software can override this.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
