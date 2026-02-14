# CTMM Boot Permission Rules

## Foundational Principle

The M (Meta/Microcode) permission is a **transient hardware elevation** — set on the CR (register) by microcode, never on the GT (Golden Token) itself. M isolates metadata objects from all regular RWXLSE actions. The GT stored in the namespace carries only the owner-visible permission; the microcode temporarily adds M to the CR during privileged operations.

## Context Register Rules

### CR15 — Namespace Root

- **GT permission: none (zero RWXLSE)**
- **CR elevation: M only**
- The Namespace is pure metadata. It is not data (no R/W), not code (no X), not a capability container (no L/S/E). M alone grants the microcode access to walk and manage namespace entries. No user instruction can read, write, load, save, or enter the Namespace directly.

### CR8 — Thread Identity

- **GT permission: none (zero RWXLSE)**
- **CR elevation: M only**
- The Thread object is pure metadata — it holds the thread's identity, shadow C-List snippet, and scheduling state. Like the Namespace, it is isolated from all regular permissions. Only microcode (via M) can inspect or update thread state. No user instruction operates on CR8 directly.

### CR6 — Current C-List

- **GT permission: E only**
- **CR elevation: M added by microcode**
- The GT grants only E (Enter) to the owner, meaning the only user-visible action is CALL. When the microcode processes a LOAD instruction, it temporarily elevates M on the CR, which allows the microcode to perform the L (Load) action internally — extracting a capability from the C-List and placing it into the destination CR. The GT itself never carries L; the microcode bridges that gap. This enforces the rule that users can only access C-List contents through the controlled mLoad path.

### CR7 — Nucleus (CLOOMC Code)

- **GT permission: X (Execute)**
- **Optional: R if the code region contains constants**
- CR7 holds executable CLOOMC code (the Nucleus / Access.asm). X permission allows the processor to fetch and execute instructions from this region. R may be added when the code segment includes inline read-only constants. No L, S, or E — the Nucleus is code, not a capability container.

## The M Elevation Rule

1. M is **never** stored in the GT. It exists only on the CR during microcode execution.
2. The microcode sets M on the CR when it needs to perform a privileged action (e.g., LOAD reads from a C-List, CHANGE updates thread state, namespace walk during GC).
3. M is cleared from the CR when the microcode operation completes.
4. M grants the microcode the ability to perform any action (Load, Save, Read, Write) on the object — but only within the scope of the current microcode operation.
5. No user instruction can set, test, or observe M. It is invisible to the instruction set.

## Domain Separation Summary

| CR   | Object Type | GT Perms | CR Elevation | Rationale                                    |
|------|-------------|----------|--------------|----------------------------------------------|
| CR15 | Namespace   | —        | M            | Pure metadata, no user access                |
| CR8  | Thread      | —        | M            | Pure metadata, no user access                |
| CR6  | C-List      | E        | M (transient)| User can CALL; microcode does L internally   |
| CR7  | Nucleus     | X (+R)   | —            | Executable code, optionally readable         |

## Boot Sequence Permission Flow

1. **Step 1 (Fault Restart)**: Clear all registers. Cold restart.
2. **Step 2 (Load Namespace)**: Microcode writes CR15 with M elevation. GT has zero RWXLSE.
3. **Step 3 (Switch Thread)**: Microcode writes CR8 with M elevation. GT has zero RWXLSE.
4. **Step 4 (Call Boot)**: Microcode writes CR6 (GT has E only, CR gets M during LOAD operations) and CR7 (GT has X, optionally R). NIA set to 0.

## Implications for LOAD Instruction

When user code executes `LOAD dest src idx`:
1. The instruction handler checks that src CR holds a capability (not NULL).
2. Microcode elevates M on the src CR.
3. With M elevation, microcode performs the internal L (Load) action — reading entry `idx` from the C-List.
4. The loaded capability is placed into the dest CR via mLoad.
5. M is cleared from the src CR.
6. The GT in the src CR still only shows E to the user.

This is the single trusted path: mLoad is the only gate, and M is the key that only microcode holds.
