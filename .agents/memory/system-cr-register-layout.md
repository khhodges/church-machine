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

## Direct system-register reload

`SWITCH CRn, CRn` for CR12–CR15 is a privileged two-operand form: the first
operand names SRn and the second names the GT for CDn. It is not an ordinary
programmer reference to a reserved CR and does not take a C-list row.

**Why:** Treating both encoded fields as ordinary CR operands incorrectly
rejects the direct SR15 reload and conflates the system-register and
capability-domain roles.

**How to apply:** Permit matching isolated operands only. Mismatched isolated
sources remain invalid; the existing three-operand C-list form continues to
require a CR0–CR11 source and an explicit row.
