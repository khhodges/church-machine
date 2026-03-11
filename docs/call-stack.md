# Call Stack, CALL/RETURN, and Thread Switching

## CALL Operation

The CALL instruction enters a protected abstraction referenced by a Golden Token. It pushes a **2-word frame** onto the call stack — nothing more.

### CALL Frame Layout

```
Word 0:  The caller's E-GT — the complete Golden Token identifying the
         calling abstraction. Pushed so RETURN can revalidate and
         re-derive the caller's CR6 (c-list) and CR14 (code) regions.

Word 1:  NIA | packed machine indicators
         NIA = Next Instruction Address — the return offset within the
         caller's code region (i.e., PC of the instruction after CALL).
         Machine indicators: LAMBDA-active, M-elevation, condition flags
         (Z, N, C, V), stackFrames, stackSpace, and other status bits.
```

**Total frame cost: 2 words per CALL.**

### CALL Flow

| Step | Detail |
|------|--------|
| **1. Permission Check** | L on CRs (C-List mode) or E on CRs (direct mode, offset=0xF) |
| **2. GT Validation** | mLoad: version match + MAC seal + G-bit reset |
| **3. Stack Check** | FAULT if stack full (256 frames) |
| **4. Frame Push** | 2 words: [caller E-GT \| NIA+machine_indicators] |
| **5. Register Setup** | CR6 = callee C-List (L-only), CR14 = callee code (X-only, privileged) |
| **6. PC Reset** | PC = 0 |

**Registers not touched by CALL**: DR0–DR15, CR0–CR5, CR7–CR13, CR15.
The callee inherits all of these from the caller unchanged.

---

## RETURN Operation

RETURN pops the top 2-word frame and resumes the caller.

### RETURN Flow

| Aspect | Detail |
|--------|--------|
| **Permission Check** | None |
| **Stack Underflow** | FAULT: no saved context |
| **E-GT Revalidation** | mLoad on caller's E-GT: version check + MAC + G-bit reset |
| **CR6/CR14 Restore** | Re-derived from caller's NS entry via NS split (same logic as CALL) |
| **PC Restore** | Set to NIA from Word 1 |
| **Machine Indicators** | Restored from Word 1 (LAMBDA-active, flags, etc.) |
| **Stack Indicators** | stackFrames and stackSpace updated |

RETURN requires no permission — it is always permitted if a saved context exists on the call stack. If the stack is empty, a FAULT is triggered.

CR6 and CR14 are recomputed from the caller's E-GT rather than stored directly — the NS split is re-run on RETURN, which simultaneously revalidates the caller's GT (use-after-free protection: version mismatch → FAULT).

DRs and all other CRs (CR0–CR5, CR7–CR13, CR15) are unchanged by RETURN — they retain whatever values the callee left.

---

## Stack Indicators (Church Machine)

Church Machine provides two 1-bit stack indicator flags automatically maintained by CALL and RETURN. They are packed into the machine indicators field of the frame's Word 1 and reflected in machine status at all times:

| Flag | Meaning |
|------|---------|
| **stackSpace** | 1 = room for at least one more frame on the call stack (CALL is safe) |
| **stackFrames** | 1 = at least one frame exists on the call stack (RETURN is safe) |

These flags are visible on the Dashboard and can be tested programmatically using the TPERM instruction.

---

## TPERM Instruction (Church Machine)

The TPERM (Test Permission) instruction tests the permissions, validity, type, and stack indicators of a Golden Token and writes the result to a data register.

**Mnemonic**: `CAP.TPERM rd, CRs`

**Result Layout (rd)**:

| Bits | Field | Description |
|------|-------|-------------|
| [5:0] | Permissions | R, W, X, L, S, E from the CRs Golden Token |
| [7:6] | Reserved | Zero |
| [8] | stackFrames | 1 = at least one frame on call stack |
| [9] | stackSpace | 1 = room for at least one more frame |
| [10] | Valid | 1 = GT passes version and MAC validation |
| [12:11] | Type | GT type: 00=Inform, 01=Outform, 10=NULL, 11=Abstract |
| [31:13] | Reserved | Zero |

TPERM allows software to inspect capability metadata and stack state without triggering a FAULT. This is useful for conditional logic: check whether a CALL is safe (stackSpace=1) before attempting it, or verify that a token has the required permissions before using it.

---

## Stack Overflow Protection

The Church Machine prevents stack overflow with a hardware-enforced 256-frame limit. If the call stack is full when a CALL is executed, an immediate FAULT is triggered. The stackSpace indicator (testable via TPERM) allows software to check for available space before calling.

---

## CHANGE: Thread Context Switching

The CHANGE instruction performs thread context switching by modifying the thread identity.

| Aspect | Detail |
|--------|--------|
| **Mnemonic** | `CHANGE CRs` |
| **Required Permission** | E (Enter) on source CR |
| **Operation** | Full atomic thread swap via thread table |
| **Context Saved** | DR0-DR15, CR0-CR11, CR14, CR15, PC, LAMBDA state saved to thread table |
| **Context Loaded** | Target thread's registers, CRs, PC, LAMBDA state loaded from thread table |
| **CR12-CR13** | Unchanged (system-wide: fault handler and interrupt handler) |

CHANGE performs a full atomic swap. Per-thread context saved/restored: data registers DR0-DR15, programmer-accessible capability registers CR0-CR11, per-thread privileged registers CR14 (code) and CR15 (namespace), and the PC. System-wide registers CR12 (data fault handler) and CR13 (interrupt handler) are shared across all threads and remain unchanged during CHANGE. The thread table stores complete thread contexts indexed by the GT's namespace index, and entries are created on first use.

---

## SWITCH: The Privilege Gate

The SWITCH instruction is the sole mechanism for writing to privileged registers CR12-CR15. It copies a capability from an instruction-addressable register into a privileged register.

| Aspect | Detail |
|--------|--------|
| **Mnemonic** | `SWITCH CRs, target` |
| **Required Permission** | M (Machine) on source CR |
| **Target Field** | 2-bit: 0=CR12(fault), 1=CR13(interrupt), 2=CR14(code), 3=CR15(namespace) |

SWITCH is architecturally significant because it is the only way to escalate privilege. All other instructions are confined to CR0-CR11. To modify the namespace root (CR15), the fault handler (CR12), the interrupt handler (CR13), or the code register (CR14), code must possess a valid capability with the appropriate permission and use SWITCH to install it.
