# Call Stack, CALL/RETURN, and Thread Switching

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

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
| **6. PC** | method entry offset (hardware method-table dispatch via imm15; method index 0 → word 1) |

**Registers not touched by CALL**: DR0–DR15, CR0–CR5, CR7–CR13, CR15.
The callee inherits all of these from the caller unchanged. CR5 (Heap GT) belongs to the thread and is installed by CHANGE from the incoming thread's Zone ④ bounds — it is not saved or restored by CALL/RETURN.

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
| **Mask Apply** | Not implemented — mask field is ignored in current hardware (see below) |
| **Stack Indicators** | stackFrames and stackSpace updated |

RETURN requires no permission — it is always permitted if a saved context exists on the call stack. If the stack is empty, a FAULT is triggered.

CR6 and CR14 are recomputed from the caller's E-GT rather than stored directly — the NS split is re-run on RETURN, which simultaneously revalidates the caller's GT (use-after-free protection: version mismatch → FAULT).

### RETURN Mask

> **Not implemented.** The 12-bit mask field in bits [11:0] is defined in the ISA encoding but is **not implemented in current hardware or simulator**. All mask bits are silently ignored. Use bare `RETURN` (mask = 0). The assembler will warn if any mask bit is set. Bit 6 is additionally reserved and must always be zero.

The intended design (for future implementation): Bit N = 1 would clear CR_N to NULL after frame restoration, letting a callee scrub working registers in a single instruction. CR6 (bit 6) is permanently reserved — it is always re-derived from the caller's E-GT by cload regardless of the mask field.

| Example | Effect |
|---------|--------|
| `RETURN` | mask=0 — no scrub, backward-compatible (current hardware) |
| `RETURN 0b111111011111` | **Assembler warning** — mask bits set but not implemented; no CRs cleared |

DRs and non-masked CRs retain whatever values the callee left.

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
| [12:11] | Type | GT type: 00=NULL, 01=Inform, 10=Outform, 11=Abstract |
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
| **Context Saved** | DR0-DR15, CR0-CR11, STO, PC, FLAGS, LAMBDA state |
| **Context Loaded** | Incoming thread's DR0-DR15, CR0-CR11, STO, PC, FLAGS, LAMBDA state; CR5 re-installed from incoming Zone ④ bounds |
| **CR12 — Unchanged** | Thread stack — system-wide, shared by all threads |
| **CR13 — Unchanged** | Interrupt handler — system-wide, shared by all threads |
| **CR14 — Saved/Restored** | Code register — per-thread, saved and restored with each context switch |
| **CR15 — Saved/Restored** | Namespace root — per-thread, saved and restored with each context switch |

CHANGE performs a full atomic swap of per-thread state: data registers DR0–DR15, the 12 programmer-accessible capability registers CR0–CR11, the hidden STO (Stack Top Offset), PC, condition FLAGS, and LAMBDA state. CR5 (Heap GT) is re-installed automatically from the incoming thread's Zone ④ bounds. CR14 (code register) and CR15 (namespace root) are per-thread and are saved and restored by CHANGE. CR12 (thread stack) and CR13 (interrupt handler) are system-wide and are never touched by CHANGE. SWITCH is the destination-M-gated special LOAD path for explicitly replacing an isolated register.

### THREAD_HDR — Hidden Per-Thread Machine Register

As the final step of a CHANGE restore, after all incoming CRs have been written to the register file, hardware performs one additional memory read:

```
THREAD_HDR ← Mem[CR12.word1_location + 0]   (the incoming thread's lump header word)
```

This hidden register is invisible to software but is consulted by every subsequent CALL to validate stack bounds. By caching the thread lump header on thread restore rather than re-reading it on every CALL, hardware eliminates one memory read from the CALL critical path.

**Lifetime**: THREAD_HDR is valid from the moment CHANGE completes until the next CHANGE on the same hardware thread.

**Switch-out behaviour (restore-only, no save)**: THREAD_HDR is a *restore-only* register — CHANGE loads it on every thread switch-in but does **not** save it on switch-out. This is architecturally sound because:

1. The lump header word at `Mem[CR12.word1_location + 0]` is **immutable**: it is written once by Mint during lump creation and is protected by the capability model thereafter.
2. Since the source value never changes, restoring it from memory on the next switch-in always yields the same result as any saved copy would. Saving adds no information and wastes a write cycle.
3. CHANGE is the *only* path that transitions a thread out; on each subsequent switch-in, it will re-read the lump header from DRAM, keeping THREAD_HDR correct across any number of context switches.

This "restore-only from an immutable source" pattern eliminates the save path entirely without any loss of correctness.

**Fields consumed by CALL**: `n_minus_6` (lump size exponent) and `cw` (code-word count) → used to compute `sp_max` and `sp_min` for stack-overflow/corruption detection.

---

## SWITCH: M-Gated Isolated LOAD

SWITCH loads a c-list entry into CR12–CR15. It uses the destination's
instruction-accepted, latched M bit as authority.

| Aspect | Detail |
|--------|--------|
| **Mnemonic** | `SWITCH CRd, CRs, #row` |
| **Valid destination** | CR12–CR15 |
| **Valid source** | CR0–CR11, with ordinary LOAD L authority |
| **Operand fault** | Non-isolated destination, isolated source, malformed encoding → `INVALID_OP` |
| **Authorization fault** | Latched destination M clear → `PERM_L` |
| **Success** | Load c-list[row] into CRd and consume CRd.M |

M is destination-register state, not a source permission. Namespace alone
holds the target-bound M-bit device capabilities used to authorize a later
SWITCH. Source M is irrelevant. Faults do not mutate CRs, M bits, namespace
entries, or memory.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
