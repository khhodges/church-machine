# Call Stack, CALL/RETURN, and Thread Switching

## CALL Operation

The CALL instruction invokes a protected abstraction (service or function) referenced by a Golden Token. It saves the caller's context so that execution can resume after the callee returns.

### CALL Flow

| Step | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|------|---------------|-------------------|
| **1. Permission Check** | L (Load) on source CR | E (Enter) on source CR |
| **2. GT Validation** | Capability object integrity | Version match + MAC seal validation |
| **3. Context Save** | Return NIA, CR6, CR7, bound GT list pushed to stack | PC, CR5, CR6, CR7 pushed to call stack |
| **4. Stack Check** | Software-managed depth tracking | FAULT if stack full (256 frames) |
| **5. Register Setup** | CR6 = target C-List, CR7 = Access Code (X permission) | CR6 = callee C-List (M-bit set), CR7 = callee code |
| **6. Register Clearing** | 11-bit mask selects which DRs/CRs to clear; DR0 preserved, DR6-15 always cleared | CR5 cleared after push; software clears others |
| **7. PC Update** | PC set to target code entry | PC set to namespace entry Location |

**Permission difference**: Sim-64 requires L because CALL's first action loads the target's C-List entries (a Load operation). Sim-32 requires E because CALL enters an abstraction directly. Both achieve the same security goal.

---

## RETURN Operation

The RETURN instruction restores the context saved by a previous CALL and resumes execution at the caller.

| Aspect | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Permission Check** | None | None |
| **Restored Registers** | CR6, CR7, NIA | CR5, CR6 (M-bit set), CR7, PC (+4) |
| **Bound GT Surrender** | CRs bound during CALL are cleared to NULL | Not implemented |
| **Stack Underflow** | FAULT: "Stack underflow" | FAULT: "No saved context to restore" |
| **Stack Indicators** | N/A | Updates stackFrames and stackSpace flags |

RETURN requires no permission -- it is always permitted if a saved context exists on the call stack. If the stack is empty, a FAULT is triggered.

In Sim-32, the M-bit is set on the restored CR6. This marks the C-List as having Machine permission, indicating that the caller's context has been properly restored through the hardware return mechanism.

---

## CR5 Save Area

CR5 serves as a programmer-controlled register for call frame data. It provides a mechanism for passing data between caller and callee:

- Before CALL, the caller can place data in CR5 that the callee needs.
- The hardware automatically pushes CR5 to the call stack during CALL.
- The hardware restores CR5 from the call stack during RETURN.
- After CALL completes (entering the callee), CR5 is cleared.

This gives the programmer a dedicated register for inter-abstraction data transfer without relying on global state or shared memory.

---

## Stack Indicators (Sim-32)

Sim-32 provides two 1-bit stack indicator flags that are automatically maintained by the CALL and RETURN microcode:

| Flag | Meaning |
|------|---------|
| **stackSpace** | 1 = room for at least one more frame on the call stack (CALL is safe) |
| **stackFrames** | 1 = at least one frame exists on the call stack (RETURN is safe) |

These flags are visible on the Dashboard and can be tested programmatically using the TPERM instruction.

---

## TPERM Instruction (Sim-32)

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

Both simulators prevent stack overflow:

- **Sim-64**: Software-managed depth tracking. The stack depth is tracked by the runtime, and overflow behavior is defined by the software implementation.
- **Sim-32**: Hardware-enforced 256-frame limit. If the call stack is full when a CALL is executed, an immediate FAULT is triggered. The stackSpace indicator (testable via TPERM) allows software to check for available space before calling.

---

## CHANGE: Thread Context Switching

The CHANGE instruction performs thread context switching by modifying the thread identity.

| Aspect | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Mnemonic** | `CHANGE CRs` (I=0) or `CHANGE CRn, idx` (I=1) | `CAP.CHANGE CRs` |
| **Required Permission** | None (I=0) / L (I=1 for C-List lookup) | E (Enter) on source CR |
| **Operation** | Creates new thread GT with R/W permissions, writes to CR8 | Full atomic thread swap via thread table |
| **Context Saved** | N/A (new thread created) | x0-x31, CR0-CR8, PC saved to thread table |
| **Context Loaded** | N/A | Target thread's x0-x31, CR0-CR8, PC loaded from thread table |
| **CR9-CR15** | N/A | Unchanged (shared across threads) |
| **I-bit Variant** | Yes (register or C-List lookup) | No (register only) |
| **Exclusive Monitor** | Cleared for current thread | Not implemented |

In Sim-32, CHANGE performs a full atomic swap: the current thread's complete register state (all 32 data registers, capability registers CR0-CR8, and the PC) is saved to the thread table, and the target thread's state is loaded. System registers CR9-CR15 are shared across all threads and remain unchanged. The thread table stores complete thread contexts indexed by the GT's namespace index, and entries are created on first use.

---

## SWITCH: The Privilege Gate

The SWITCH instruction is the sole mechanism for writing to system registers CR8-CR15. It copies a capability from an instruction-addressable register into a system register.

| Aspect | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|--------|---------------|-------------------|
| **Mnemonic** | `SWITCH CRs, target` | `CAP.SWITCH CRs, target` |
| **Required Permission** | L or E on source CR | M (Machine) on source CR |
| **Target Field** | 3-bit: 0=CR8, 1=CR9, ..., 7=CR15 | 3-bit: 0=CR8, 1=CR9, ..., 7=CR15 |
| **I-bit Variant** | Yes (register or C-List lookup) | No (register only) |

SWITCH is architecturally significant because it is the only way to escalate privilege. All other instructions are confined to CR0-CR7. To modify the namespace root (CR15), the thread identity (CR8), or any other system register, code must possess a valid capability with the appropriate permission and use SWITCH to install it.

**Permission difference**: Sim-64 requires L or E because SWITCH may load from a C-List (L) or enter a new context (E). Sim-32 requires M (Machine) because SWITCH is a privileged machine-level operation.
