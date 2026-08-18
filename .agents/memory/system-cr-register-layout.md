---
name: System CR register layout
description: Which capability and data registers are system-reserved vs available for parameter passing in the Church Machine ISA.
---

# System CR Register Layout

**Why:** Compiler must never assign API parameters to system-reserved registers or DR0.

## Reserved — must not be used for parameter passing

| Register | Role |
|----------|------|
| DR0  | Hardwired zero on Artix-7; never a valid parameter |
| CR5  | Thread heap |
| CR6  | Abstraction c-list |
| CR12 | Thread object |
| CR13 | IRQ thread |
| CR14 | Executing code (R/W) |
| CR15 | Namespace |

## Available for parameter passing

- Data registers: DR1 and above
- Capability registers: CR0–CR4, CR7–CR11

**How to apply:** Any API JSON reg field in in[] or out[] must not name a reserved register.
CLOOMC++ compiler must reject such assignments at compile time.
