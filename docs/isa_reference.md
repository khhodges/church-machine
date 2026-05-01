# Church Machine ISA Reference

**Version 1.0 — May 2026**
**Authoritative sources: `simulator/simulator.js`, `simulator/assembler.js`, `hardware/*.py`**

This document is the single definitive specification for all 20 Church Machine
instructions. Where existing documents conflict with what is stated here, this
document takes precedence. Simulator/hardware deviations are called out
explicitly; see `docs/HARDWARE-DEVIATIONS.md` for the full deviation register.

---

## 1. Instruction Word Format

Every instruction is a 32-bit word with a fixed layout:

```
 31      28 27    24 23    20 19    16 15             1 0
┌──────────┬─────────┬────────┬────────┬────────────────┬───┐
│  opcode  │  cond   │  fld_a │  fld_b │     imm15      │ 0 │
│  (4 b)   │  (4 b)  │  (4 b) │  (4 b) │    (15 b)      │(1)│
└──────────┴─────────┴────────┴────────┴────────────────┴───┘
```

- **Bit 0** is always 0 (word-aligned; a 1 here is a FAULT).
- **opcode** (bits 31:28): selects one of the 20 instructions (0–19). Values 20–15 are reserved and fault.
- **cond** (bits 27:24): condition under which the instruction executes (see §2).
- **fld_a** (bits 23:20): first register operand — CR or DR index depending on instruction.
- **fld_b** (bits 19:16): second register operand — CR or DR index depending on instruction.
- **imm15** (bits 15:1): 15-bit immediate; interpretation varies per instruction.

The **all-zero word** `0x00000000` (opcode=LOAD, cond=EQ, all fields zero) is
accepted by the assembler as `HALT` or `NOP`. The simulator treats an all-zero
instruction word encountered during normal execution as a warm reboot (not a halt
and not a fault). See §4 (HALT/NOP note) for implications.

---

## 2. Condition Codes

The `cond` field gates execution on the current flag state. If the condition is
false, the instruction is skipped (PC advances, no side effects, no faults).

| Code | Mnemonic | Meaning                    | Flags tested        |
|------|----------|----------------------------|---------------------|
|  0   | EQ       | Equal / Zero               | Z = 1               |
|  1   | NE       | Not equal / Non-zero       | Z = 0               |
|  2   | LT       | Less than (signed)         | N ≠ V               |
|  3   | LE       | Less than or equal (signed)| Z = 1 or N ≠ V      |
|  4   | GT       | Greater than (signed)      | Z = 0 and N = V     |
|  5   | GE       | Greater than or equal      | N = V               |
|  6   | CS / CC  | Carry set                  | C = 1               |
|  7   | CC       | Carry clear                | C = 0               |
|  8   | MI       | Minus / Negative           | N = 1               |
|  9   | PL       | Plus / Non-negative        | N = 0               |
| 10   | VS       | Overflow set               | V = 1               |
| 11   | VC       | Overflow clear             | V = 0               |
| 12   | HI       | Unsigned higher            | C = 1 and Z = 0     |
| 13   | LS       | Unsigned lower or same     | C = 0 or Z = 1      |
| 14   | AL       | Always (unconditional)     | (none)              |
| 15   | NV       | Never (no-op)              | (none — always skip)|

`AL` (always) is the normal unconditional form. `NV` is a no-op regardless of flags.

---

## 3. Register Files

### 3.1 Capability Registers (CR0–CR15)

Sixteen 64-bit capability registers. Each holds a **Guard Token (GT)**: a
type-tagged, permission-bearing, hardware-verified reference to an object.

| Range    | Name                 | Notes                                          |
|----------|----------------------|------------------------------------------------|
| CR0–CR5  | User CRs             | General-purpose; caller context preserved by CALL |
| CR6      | C-list root          | E-permission token for current abstraction's c-list; re-derived by CALL/RETURN |
| CR7–CR11 | User CRs             | General-purpose; caller context preserved by CALL |
| CR12     | Thread stack         | Privileged; system-wide; unchanged by CALL/RETURN; only writeable via CHANGE |
| CR13     | Interrupt handler    | Privileged; system-wide; only writeable via SWITCH (hardware: PassKey gate) |
| CR14     | Code register (CLOOMC) | Privileged; per-thread; set by CALL, re-derived by RETURN; X-only |
| CR15     | Namespace root       | Privileged; per-thread; only writeable via SWITCH (hardware: PassKey gate) |

**Privilege zone**: CR12–CR15 cannot appear as operands in LOAD, SAVE, TPERM,
LAMBDA instructions. CALL, RETURN, CHANGE, and SWITCH are the only Church-domain
instructions that touch them.

### 3.2 Data Registers (DR0–DR15)

Sixteen 32-bit integer registers.

> **A.1 — DR0 is hardwired zero.**
>
> DR0 reads as 0 at all times. After every instruction that produces a result,
> the simulator unconditionally writes 0 to DR0 (`simulator.js` line 2748:
> `this._writeDR(0, 0)`). Writes targeting DR0 are silently discarded — the
> value is immediately overwritten back to 0.
>
> This enables two universal idioms, replacing MOV and load-immediate opcodes
> that would otherwise need their own encodings:
>
> | Idiom | Instruction | Effect |
> |-------|-------------|--------|
> | Register copy | `IADD DRd, DR0, DRs` | DRd ← DRs |
> | Load immediate | `IADD DRd, DR0, #k` | DRd ← k (0 ≤ k ≤ 16383) |
>
> Any instruction that writes a computed result into DR0 (e.g., `IADD DR0, DR1, DR2`)
> always reads back 0 on the next instruction. This is not a bug — it is the
> intended architectural property. Do not use DR0 as a scratch register.

### 3.3 Permission Bits (GT word0)

The permission field of a GT encodes the following access rights:

| Bit | Symbol | Meaning                                      |
|-----|--------|----------------------------------------------|
|  30 | E      | Execute — may call the abstraction            |
|  29 | S      | Save — may store a GT into this object's c-list |
|  28 | L      | Load — may load a GT from this object's c-list |
|  27 | X      | Code — execute raw instructions from lump memory |
|  26 | W      | Write — may write data words into lump memory |
|  25 | R      | Read — may read data words from lump memory   |
|  31 | B      | Busy — object lock; clearable by TPERM B-modifier |

**Domain purity rule**: X may not coexist with L, S, or E in the same GT's
effective permission set. A GT that would combine X with any of L/S/E is invalid
and causes TPERM to fault with `TPERM_RSV` when the combination is tested.

---

## 4. HALT / NOP (all-zero word)

```
Encoding: 0x00000000
Assembler aliases: HALT, NOP
```

The all-zero word is architecturally the instruction `LOAD AL, CR0, CR0, #0`
— a conditional LOAD that would load CR0 from `CR0[0]`. In practice, an
all-zero instruction word is used to mark the end of a code region.

**Simulator behaviour:** an all-zero word encountered during execution triggers
a warm reboot sequence, not a halt. Execution does not pause cleanly; the boot
ROM re-runs. Writers of code lumps should never allow execution to fall through
to an all-zero word unless a reboot is the intended outcome.

---

---

## 5. Flag Behaviour — Quick Reference

Four flags: **N** (negative), **Z** (zero), **C** (carry), **V** (overflow).

> **A.2 — BFEXT and BFINS do write flags: N and Z reflect the result; C and V are always cleared.**
>
> Hardware (`core.py` lines 1140–1143, 1169–1172) sets N = result[31],
> Z = (result == 0), C = 0, V = 0 for both instructions. The simulator
> (`_execBfext`, `_execBfins`) matches this behaviour.
>
> This means a BFEXT result can be tested directly with a conditional branch:
>
> ```
> BFEXT  DR1, DR2, 0, 8      ; extract byte — Z = 1 if byte is zero
> BRANCH EQ, handle_zero     ; correctly tests the extracted byte
> ```
>
> Note that C and V are **cleared**, not preserved. Any preceding instruction's
> carry or overflow flag is lost after BFEXT or BFINS.

Flag-writing summary across all 20 instructions:

| Instruction | N | Z | C | V | Notes |
|-------------|---|---|---|---|-------|
| LOAD        | — | — | — | — | |
| SAVE        | — | — | — | — | |
| CALL        | — | — | — | — | |
| RETURN      | — | — | — | — | |
| CHANGE      | — | — | — | — | |
| SWITCH      | — | — | — | — | |
| TPERM       | ✓ | ✓ | 0 | 0 | N = !Z; C and V always cleared |
| LAMBDA      | — | — | — | — | |
| ELOADCALL   | — | — | — | — | |
| XLOADLAMBDA | — | — | — | — | |
| DREAD       | — | — | — | — | |
| DWRITE      | — | — | — | — | |
| BFEXT       | ✓ | ✓ | 0 | 0 | N = result[31]; Z = (result==0); C and V cleared — see A.2 |
| BFINS       | ✓ | ✓ | 0 | 0 | N = result[31]; Z = (result==0); C and V cleared — see A.2 |
| MCMP        | ✓ | ✓ | ✓ | ✓ | Subtraction flags: a − b; no result register |
| IADD        | ✓ | ✓ | ✓ | ✓ | Addition flags |
| ISUB        | ✓ | ✓ | ✓ | ✓ | Subtraction flags |
| BRANCH      | — | — | — | — | Reads flags, never writes them |
| SHL         | ✓ | ✓ | ✓ | 0 | C = last bit shifted out (source[32-shamt], 0 if shamt=0); V always 0. Hardware confirmed (Task #857) |
| SHR         | ✓ | ✓ | ✓ | 0 | C = last bit shifted out (source[shamt-1], 0 if shamt=0); imm[5]=0→LSR, imm[5]=1→ASR (sign-extend). V always 0. Hardware confirmed (Task #857) |

---

## 6. Cross-Cutting Encoding Rules

### A.3 — SHR: bit 5 selects ASR vs LSR; A.4 — BRANCH: bit 14 is the sign bit

> **A.3 — SHR imm15[5] = mode select.**
>
> `SHR DRd, DRs, #amt` encodes the shift amount in `imm15[4:0]` (0–31).
> `imm15[5]` selects the fill mode:
>
> | imm15[5] | Mode | Fill bit | Assembler suffix |
> |----------|------|----------|-----------------|
> | 0        | LSR  | 0        | (none)          |
> | 1        | ASR  | sign bit (DRs[31]) | `ASR` |
>
> Assembler syntax: `SHR DR1, DR2, #4` (LSR) or `SHR DR1, DR2, #4, ASR` (ASR).
> C = last bit shifted out. V = 0 always.
>
> **Simulator/hardware deviation (D-12, open):** The hardware currently implements
> LSR only (C = 0, no ASR mode). The simulator implements both correctly.
> Task #857 tracks the hardware fix.

> **A.4 — BRANCH: bit 14 of imm15 is the sign bit.**
>
> BRANCH uses all 15 bits of the imm15 field as a signed PC-relative word offset:
>
> ```
> soff  = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm   ; sign-extend bit 14
> target = current_PC + soff                            ; word addressing
> ```
>
> Range: **−16384 to +16383 words** (±65536 bytes on byte-addressed hardware).
>
> Hardware sign-extension (Amaranth): `Cat(immediate, immediate[14].replicate(17))`
> then `nia += sign_extend(imm) × 4` — equivalent; byte vs word addressing only.
>
> **Key offsets:**
>
> | Offset | Effect |
> |--------|--------|
> | `#0`   | **Infinite loop** — branches back to itself (target = current PC) |
> | `#1`   | Fall-through — target = current_PC + 1 = next instruction (effectively a NOP branch) |
> | `#-1`  | Step back — target = previous instruction |
>
> **Assembler label resolution:** labels resolve at assemble time as
> `offset = label_word_index − branch_word_index`. The assembler is two-pass,
> so forward references (label appears after the branch) are legal. After
> encoding, every BRANCH imm is bounds-checked to fit in −16384..+16383;
> out-of-range offsets are a hard assembler error.
>
> **Runtime bounds:** the simulator faults immediately with BOUNDS if the target
> is outside the loaded memory image. Hardware detects the violation on the next
> instruction fetch via the CR14 code fence (`fetch_bounds_fault`).
>
> **Condition code is mandatory.** There is no bare `BRANCH label` form — the
> condition code is always present in the word encoding. Use `BRANCH AL, label`
> for an unconditional jump, or the alias mnemonics: `BRANCHEQ`, `BRANCHNE`,
> `BRANCHLT`, `BRANCHGE`, `BRANCHGT`, `BRANCHLE`, etc.

---

### A.5 — CALL: 1-based method index; A.6 — ELOADCALL: split imm15

> **A.5 — CALL imm15 is 1-based: user method index N encodes as imm15 = N + 1.**
>
> imm15 = 0 is the fast-path shorthand: NIA = lump_base + 4 (word 1, first
> instruction in the lump). The method table is bypassed entirely. This is the
> correct encoding for single-entry-point abstractions.
>
> imm15 > 0 is a table lookup: hardware reads `memory[lump_base + imm15 × 4]`
> to get the callee's first instruction word offset, then sets
> NIA = lump_base + entry × 4. A zero table entry → PRIVATE_METHOD FAULT.
>
> | What you write | imm15 encoded | Hardware does |
> |----------------|---------------|---------------|
> | `CALL CRn` (no selector) | 0 | Fast path: NIA = lump_base + 4 |
> | `CALL CRn, 0` | 1 | Table entry [1]: user method index 0 |
> | `CALL CRn, 1` | 2 | Table entry [2]: user method index 1 |
> | `CALL CRn, N` | N + 1 | Table entry [N+1]: user method index N |
>
> Assembler: named methods (`CALL CRn, MethodName`) are resolved from the
> registered method conventions table and encoded as `imm15 = method.index + 1`.
> Dot-notation (`CALL SlideRule.Multiply`) resolves the object binding and method
> name in one step. Numeric selector range: 0–16383 (imm15 range: 1–16384).
>
> **Disassembly note:** a disassembled CALL showing imm15 = 3 means user method
> index 2, not 3. Always subtract 1 from the raw imm15 field to get the user-facing
> method selector.

> **A.6 — ELOADCALL imm15 is split into two fields.**
>
> ```
> imm15[14:8]  =  method index (7 bits, 0–127)    — same 1-based encoding as CALL
> imm15[7:0]   =  c-list row   (8 bits, 0–255)    — word offset into CRsrc c-list
> ```
>
> ELOADCALL atomically loads the GT at `CRsrc[row]` into the destination CR and
> calls it with the given method index. The method index is encoded identically
> to CALL (0 = fast path, N+1 = user method N).
>
> **Backward compatibility:** old programs that encoded `ELOADCALL CRd, CRs, #N`
> with a simple row number stored the row in bits[7:0] and left bits[14:8] = 0.
> Method index 0 → fast path — behaviour is identical to the pre-split encoding.
>
> Valid ranges (enforced by assembler and checked at assembly time):
> - c-list row: 0–255 (8 bits; values 256+ are a hard assembler error)
> - method index: 0–126 in user terms → 0–127 in imm15[14:8] (value 127 rejected)

---

### A.7–A.11 — TPERM: preset table, NULL behaviour, domain-purity, B-modifier, flag invariants

> **TPERM preset encoding (imm15[4:0])**
>
> Bit 4 = B-modifier (see A.11). Bits [3:0] = preset code (0–15).
>
> | Code | Mnemonic | Permissions required | Reserved? |
> |------|----------|----------------------|-----------|
> | 0x00 | CLEAR    | none                 | No |
> | 0x01 | R        | R                    | No |
> | 0x02 | RW       | R, W                 | No |
> | 0x03 | X        | X                    | No |
> | 0x04 | RX       | R, X                 | No |
> | 0x05 | RWX      | R, W, X              | No |
> | 0x06 | L        | L                    | No |
> | 0x07 | S        | S                    | No |
> | 0x08 | E        | E                    | No |
> | 0x09 | LS       | L, S                 | No |
> | 0x0A | W        | W only (no R)        | No |
> | 0x0B–0x0F | — | —                   | **Reserved** |
>
> Adding 0x10 to any valid code sets the B-modifier: `TPERM CRd, RB` = code 0x11.
> All B-modifier variants of 0x0B–0x0F are also reserved.

> **A.7 — CLEAR (preset 0) always passes for any non-NULL, non-reserved GT.**
>
> `TPERM CRd, CLEAR` requires no permissions. Since the required set is empty,
> `required.every(p => gt.permissions[p])` is vacuously true. Z = 1 for any valid
> non-NULL GT regardless of what permissions it actually holds. This is the
> standard "GT is live and non-NULL" existence check.

> **A.8 — NULL GT always produces Z = 0, N = 1, no fault.**
>
> If `CR.word0 = 0` (NULL GT), TPERM immediately sets Z = 0, N = 1, C = 0, V = 0
> and returns — before checking the preset code, before the domain-purity check,
> before anything else. No fault is raised. This applies to every preset including
> CLEAR: `TPERM CRd, CLEAR` on a NULL GT gives Z = 0.
>
> Pattern to distinguish NULL from "lacks permission":
> ```
> TPERM  CR1, CLEAR        ; Z=1 → non-NULL; Z=0 → NULL
> BRANCH EQ, not_null
> ```

> **A.9 — Domain-purity violation → hard FAULT(TPERM_RSV).**
>
> If the *result* permission set (intersection of preset's required bits and the GT's
> held bits) would combine X with any of L, S, or E, TPERM faults with `TPERM_RSV`.
> This is a hard fault — not Z = 0, not recoverable.
>
> No built-in preset triggers this (presets are X-pure or LSE-pure, never mixed),
> but a GT that already combines X and L/S/E could trigger it on certain presets.
> In practice this guards against malformed GTs reaching code that uses them.

> **A.10 — TPERM flag invariants: N = !Z, C = 0, V = 0 always.**
>
> These three relationships hold unconditionally after every TPERM that does not
> fault. The flag table in §5 already captures this. Key implication: C and V are
> **always cleared** by TPERM — any preceding instruction's carry or overflow is
> lost.

> **A.11 — B-modifier (imm15 bit 4): clears the Busy bit on a passing test.**
>
> When bit 4 of the imm15 field is set and the permission test passes (Z = 1),
> TPERM clears bit 31 of `CR.word0` (the B "Busy" bit) **in place** — no namespace
> write, no SAVE needed. The change is local to the CR until a SAVE commits it.
>
> If the test fails (Z = 0), the B bit is left unchanged regardless of the modifier.
> The modifier has no effect on flags.
>
> ```
> TPERM  CR2, EB          ; test for E permission; if Z=1, clear B bit atomically
> BRANCH EQ, call_ok      ; Z=1: abstraction is callable and now marked un-busy
> ```
>
> **Reserved preset + B-modifier:** codes 0x1B–0x1F are reserved; behaviour
> matches A-13 (simulator: Z=0 no fault; hardware: FAULT — see D-3 in
> `HARDWARE-DEVIATIONS.md`).

---

### A.12–A.14 — Call stack: CALL frame layout, LAMBDA SZ=0, M-window writeback

> **A.12 — CALL pushes exactly 2 words to thread memory; no CRs or DRs.**
>
> When CALL executes, it writes two words into the current thread's lump memory
> at the stack pointer (STO):
>
> | Word offset (from STO) | Contents |
> |------------------------|----------|
> | STO      | Frame word: packed (returnPC[14:0] \| sz[12] \| flags[11:8] \| savedSTO[7:0]) |
> | STO − 1  | Caller's E-GT (CR6 value before the call) |
>
> `sz = 1` distinguishes CALL frames from LAMBDA frames (sz = 0). No capability
> registers or data registers are written to thread memory — the callee inherits
> all DRs and CRs from the caller (with the exception of CR6 and CR14, which
> are replaced by the callee's c-list and code tokens).
>
> The JS-side simulator call stack (`callStack[]`) additionally holds a snapshot
> of all saved registers for state inspection, but this is not part of the
> hardware frame format.

> **A.13 — LAMBDA pushes a SZ=0 (1-word) frame; RETURN identifies it by sz.**
>
> LAMBDA writes only the frame word (sz = 0) to thread memory — no E-GT slot.
> RETURN distinguishes frame types by the sz field:
>
> | sz | Frame type | Pop size | Return address source |
> |----|------------|----------|-----------------------|
> | 0  | LAMBDA     | 1 word   | `lambdaReturnPC` cache (no memory read) |
> | 1  | CALL       | 2 words  | Frame word in thread memory |
>
> The leaf-lambda fast path: when `lambdaActive = 1` and the frame popped is SZ=0,
> RETURN restores PC from the cached `lambdaReturnPC` register without a memory
> read. This gives O(1) RETURN at any recursion depth.
>
> LAMBDA CR6 idempotent re-entry (D-9): re-executing `LAMBDA CR6` while
> `lambdaActive = 1` is non-faulting (same return address overwrites the same
> register). `LAMBDA CRn` (n ≠ 6) while `lambdaActive = 1` → FAULT.

> **A.14 — M-window writeback fires at every CALL and every RETURN.**
>
> When an abstraction is called via an Abstract GT (M-bit = 1), hardware tracks
> modified namespace state in a 3-register M-window (DR11–DR13). Before the
> callee's frame is pushed (CALL) or before the caller's frame is popped (RETURN),
> the M-window writeback fires: DR11–DR13 are written back to the CR15 namespace
> entry and the M-bit is cleared.
>
> If the writeback fails (e.g. NULL DR11, invalid state), CALL and RETURN both
> fault with `INVALID_OP` before any frame manipulation occurs. The frame stack
> is never left in a partially-modified state.

---

### A.15–A.16 — BFINS source masking; LOAD short form

> **A.15 — BFINS uses only the low `width` bits of DRs.**
>
> The value inserted is `DRs & ((1 << width) - 1)`. Upper bits of DRs beyond
> `width` are discarded before insertion. The destination word is modified as:
>
> ```
> mask     = ((1 << width) - 1) << pos
> new_word = (old_DRd & ~mask) | ((DRs & ((1<<width)-1)) << pos)
> ```
>
> There is no alignment requirement — `pos` and `width` may be any values
> satisfying `width ≥ 1` and `pos + width ≤ 32`.

> **A.16 — LOAD (and SAVE, ELOADCALL, XLOADLAMBDA) short form uses CR6 implicitly.**
>
> Two-operand forms resolve the named abstraction from the assembler's NS binding
> table and substitute CR6 as the c-list base:
>
> ```
> LOAD  CRd, SlideRule        →  LOAD  CRd, CR6, <slot>
> SAVE  CRd, SlideRule        →  SAVE  CRd, CR6, <slot>
> ELOADCALL  CRd, SlideRule   →  ELOADCALL  CRd, CR6, <slot>
> XLOADLAMBDA  CRd, SlideRule →  XLOADLAMBDA  CRd, CR6, <slot>
> ```
>
> CR6 is the c-list root by architectural convention. The slot is looked up from
> the namespace binding established by a prior `LOAD CRd, Name` (which registers
> the name → CR mapping in `nsLoaded`). Using the short form for a name that has
> never been loaded is a hard assembler error.

*(Instruction entries for opcodes 0–19 follow in §7 onwards — to be added.)*
