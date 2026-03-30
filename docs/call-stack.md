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
| **Mask Apply** | All CRs with mask bit set → NULL in one parallel clock edge (see below) |
| **Stack Indicators** | stackFrames and stackSpace updated |

RETURN requires no permission — it is always permitted if a saved context exists on the call stack. If the stack is empty, a FAULT is triggered.

CR6 and CR14 are recomputed from the caller's E-GT rather than stored directly — the NS split is re-run on RETURN, which simultaneously revalidates the caller's GT (use-after-free protection: version mismatch → FAULT).

### RETURN Mask

`RETURN` encodes a 12-bit literal mask in bits [11:0] of the instruction word. Bit N = 1 clears CR_N to NULL after frame restoration — giving the callee a one-instruction way to scrub its working registers before the caller resumes.

**Hardware**: The mask fans directly into the CR register-file write enables. All marked CRs are written to NULL on a single clock edge — zero overhead regardless of how many bits are set.

**Bit 6 reserved**: CR6 is always restored from the frame E-GT by the hardware; its write enable is not connected to the mask bus.

**Programmer-declared**: GTs are first-class values — a callee may legitimately return a GT in CR0. Only the programmer knows which CRs carry return values vs. internal working state. The CLOOMC compiler emits the mask as a compile-time literal from a `clear:` annotation.

| Example | Effect |
|---------|--------|
| `RETURN` | mask=0 — no scrub, backward-compatible |
| `RETURN 0b111111011111` | Clear CR0–CR5, CR7–CR11 — full working-register scrub |
| `RETURN 0b000000011110` | Clear CR1–CR4 only — CR0 carries a return GT |

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
| **Context Saved** | DR0-DR15, CR0-CR11, CR12, STO, PC, FLAGS, LAMBDA state |
| **Context Loaded** | Incoming thread's DR0-DR15, CR12, STO, PC, FLAGS, LAMBDA state; CR5 re-installed from incoming Zone ④ bounds |
| **CR13 — Unchanged** | IRQ handler — system-wide, shared by all threads |
| **CR14 — Unchanged** | Transient code-view — re-derived by cLoad on the next CALL |
| **CR15 — Unchanged** | Namespace root — system-wide, shared by all threads |

CHANGE performs a full atomic swap of per-thread state: data registers DR0–DR15, CR12 (Thread Identity), the hidden STO (Stack Top Offset), PC, condition FLAGS, and LAMBDA state. CR5 (Heap GT) is re-installed automatically from the incoming thread's Zone ④ bounds. Three registers are system-wide and are never touched by CHANGE: CR13 (IRQ handler), CR14 (code register — transient, rebuilt by cLoad on the next CALL), and CR15 (Namespace root — all threads in the same application share one namespace). To write CR13 or CR15, code must use SWITCH — the explicit privilege gate — presenting the correct PassKey for the target register.

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

## SWITCH: The Privilege Gate

SWITCH is the sole mechanism for writing to the two system-wide registers **CR13** (IRQ Thread) and **CR15** (Namespace root). CR12 (Thread Identity) is managed automatically by CHANGE and cannot be written by user instructions. CR14 (transient code-view) is re-derived by cLoad on every CALL and is equally off-limits.

| Aspect | Detail |
|--------|--------|
| **Mnemonic** | `SWITCH CRs, target` |
| **Valid Targets** | CR13 (Tgt=101₂) and CR15 (Tgt=111₂) only — all others FAULT |
| **PassKey type check** | CRs.word0_gt.gt_type must equal `11₂` (Abstract GT); any other type → FAULT |
| **Sentinel for CR13** | CRs.word1_location must equal `0xFFFFFFFE` (all-1s − 1) |
| **Sentinel for CR15** | CRs.word1_location must equal `0xFFFFFFFF` (all-1s) |
| **Sentinel mismatch** | CRs sentinel does not match the chosen target → FAULT |

SWITCH enforces two mandatory checks on the source register **CRs** before installing it into the target:

1. **PassKey type check** — CRs.word0_gt.gt_type must equal `11₂` (Abstract GT). Any non-Abstract capability faults. Abstract GTs used as SWITCH tokens are called *PassKeys*.
2. **Sentinel address check** — CRs.word1_location must equal the reserved hardware sentinel address for the target register:
   - Tgt = CR13 (IRQ Thread): sentinel = `0xFFFFFFFE` (all-1s − 1)
   - Tgt = CR15 (Namespace): sentinel = `0xFFFFFFFF` (all-1s)

The sentinel values occupy the top of the 32-bit Abstract Address Space — a range no real RAM lump can occupy — so there is no ambiguity between a PassKey and a live capability. Presenting a CR13 PassKey to the CR15 target (or vice versa) is a sentinel mismatch and faults immediately.

Only code that already holds the appropriate PassKey in an instruction-addressable register (CR0–CR7) can install it into a system register. This makes SWITCH a one-way privilege gate: without the right PassKey, no code can overwrite a live system register regardless of what other permissions it holds.

### SWITCH PassKeys as Abstract GT I/O Tokens

The two SWITCH PassKeys are the first two entries in the **Abstract Address Space** — the 32-bit `word1_location` range that the IDE owns for all hardware-routed I/O and remote network addressing. Abstract GTs whose `word1_location` falls in this reserved range are the general mechanism for I/O peripherals, encrypted tunnels, and remote services, with the Home Base tunnel (`0xFF000000`) as the primary network gateway.

See [Abstract GT I/O and Network Addressing](abstract-io-addressing.md) for the full Abstract Address Space layout and IDE provisioning protocol.
