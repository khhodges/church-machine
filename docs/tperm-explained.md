# TPERM — The Permission Test Instruction

TPERM is the Church Machine's *ask-before-you-act* instruction.
It reads the permissions encoded in a Golden Token and tells you — via
the Z flag — whether a capability meets a stated requirement.
It does not fault on failure. It does not modify the namespace.
It simply answers a yes/no question so that the code that follows can
branch accordingly.

---

## The two modes

### Mode 1 — preset test (the common case)

```
TPERM CRd, <preset>
```

Reads the GT currently loaded in `CRd` and checks whether it carries
every permission named by `<preset>`.

| Preset | Permissions required |
|--------|----------------------|
| `R`    | Read                 |
| `W`    | Write                |
| `RW`   | Read + Write         |
| `X`    | Execute              |
| `L`    | Load (Church)        |
| `S`    | Save (Church)        |
| `E`    | Enter / Call         |
| `LS`   | Load + Save          |
| …      | any valid combination|

Result: `Z=1` if the GT has *at least* the required permissions.
`Z=0` if any required permission is absent. `N = !Z` always.
`C` and `V` are always cleared.

```
TPERM  CR3, RW          ; does CR3 have read AND write?
BRANCH NE, no_write     ; Z=0 → it doesn't, jump away
STORE  CR3, DR0, 0      ; safe to write
```

The GT in `CRd` is **not modified** by a Mode 1 test.

### Mode 2 — attenuation (capability narrowing)

```
TPERM CRd, CRs, 0x7FFF
```

Produces a new, narrowed Golden Token in `CRd`.
`CRs` carries the *permission mask* — only the permissions present in
`CRs` survive into the result. The NS index, version, and type are
copied from `CRd`'s original GT; the permission set is replaced by the
intersection `CRd.perms ∩ CRs.perms`.

```
; CR0 = Navana, full RWX authority
; CR1 = a token with only R set (acts as the mask)
TPERM  CR0, CR1, 0x7FFF   ; CR0 now holds Navana R-only
CALL   CR0                 ; callee can read, cannot write or execute
```

`Z=1` if the attenuated GT is non-empty (at least one permission
survived). `Z=0` if the intersection is empty — no usable token was
produced.

In Mode 2, the B bit is **inherited unchanged** from the source GT;
it is not a permission and cannot be attenuated away.

Domain purity is enforced in both modes: a GT that mixes Turing
permissions `{R, W, X}` with Church permissions `{L, S, E}` causes an
immediate `TPERM_RSV` fault.

---

## The B-modifier — single-use delegation latch

Adding `B` to any preset code (bit 4 of the 5-bit preset field) turns
the test into a *test-and-consume*:

```
TPERM CRd, EB       ; "does CR_d have E, and is the B latch set?"
```

The test passes (`Z=1`) only when **both** conditions are true:
1. The GT has the required permission (E in this example).
2. The GT's B bit (bit 31) is currently set to 1.

If the test passes, B is immediately cleared to 0 in the cached GT.
The latch has fired. A second `TPERM CRd, EB` on the same GT will see
`Z=0` because B is now 0.

If the test fails (`Z=0`) — either because the permission is absent
or because B is already 0 — the GT is left completely unchanged.

### Why the B latch exists

The default rule is that no capability may be bound (written into a
c-list slot via SAVE) unless its B bit is 1. CALL auto-clears B on
every CR it forwards to the callee, so a callee receives capabilities
it may *use* but not re-delegate.

When a caller wants to explicitly grant delegation rights for one call:

```
; caller sets B on the token it is about to share
; (only privileged code / Mint can produce a B=1 GT in the first place)
TPERM  CR2, EB          ; callee tests: do I hold an E+B capability?
BRANCH NE, no_delegate  ; Z=0 → delegation not granted
SAVE   CR2, CR6, 5      ; bind it into my own c-list slot 5
```

The single-use nature is the security property: the grantor decides
*once* that delegation is permitted. After the callee's TPERM fires,
the latch is consumed and cannot be re-used or passed further.

**Hardware status:** The B-modifier is fully implemented in the
assembler and simulator. The hardware decoder currently reads only the
lower 4 bits of the preset field, so the B-modifier has no effect on
real silicon until the field is widened to 5 bits.

---

## Instruction encoding

All Church Machine instructions share the same 32-bit word layout:

```
 31      27 26    23 22    19 18    15 14             0
 ┌─────────┬────────┬────────┬────────┬────────────────┐
 │ opcode  │  cond  │  CRd   │  CRs   │     imm15      │
 │  5 bits │ 4 bits │ 4 bits │ 4 bits │    15 bits     │
 └─────────┴────────┴────────┴────────┴────────────────┘
```

TPERM is **opcode 6** (`0b00110`).

The four cases differ only in the CRs and imm15 fields.

---

### Case 1 — Mode 1 preset test  `TPERM CRd, <preset>`

```
 31      27 26    23 22    19 18    15 14    5  4  3    0
 ┌─────────┬────────┬────────┬────────┬─────────┬──┬──────┐
 │  00110  │  cond  │  CRd   │  0000  │  zeros  │B │ pre  │
 └─────────┴────────┴────────┴────────┴─────────┴──┴──────┘
```

- `CRs` field [18:15] = `0000` — no second register
- imm15[14:5] = 0 — upper bits unused
- imm15[4] = **B-modifier** (0 = plain test, 1 = test-and-consume B latch)
- imm15[3:0] = **preset code** — which permissions to test for

Preset codes (imm15[3:0], B=0):

| Code | Mnemonic | Permissions tested |
|------|----------|--------------------|
| 0x0  | CLEAR    | none (always Z=1 if GT non-null) |
| 0x1  | R        | Read               |
| 0x2  | RW       | Read + Write       |
| 0x3  | X        | Execute            |
| 0x4  | RX       | Read + Execute     |
| 0x5  | RWX      | Read + Write + Execute |
| 0x6  | L        | Load               |
| 0x7  | S        | Save               |
| 0x8  | E        | Enter              |
| 0x9  | LS       | Load + Save        |
| 0xA–0xC | —    | reserved → `TPERM_RSV` fault |
| 0xD  | FRAME    | *(special — see Case 3)* |
| 0xE  | EXACT    | *(special — see Case 4)* |
| 0xF  | —        | reserved → `TPERM_RSV` fault |

Setting B=1 (imm15[4]) produces the named B-variants:
`RB`=0x11, `RWB`=0x12, `XB`=0x13, `RXB`=0x14, `RWXB`=0x15,
`LB`=0x16, `SB`=0x17, **`EB`=0x18**, `LSB`=0x19.
B-variants of reserved codes (0x1A–0x1C, 0x1F) also fault.

---

### Case 2 — Mode 2 attenuation  `TPERM CRd, CRs, 0x7FFF`

```
 31      27 26    23 22    19 18    15 14             0
 ┌─────────┬────────┬────────┬────────┬────────────────┐
 │  00110  │  cond  │  CRd   │  CRs   │  1111111111111 │
 │         │        │ (R/W)  │ (mask) │   0x7FFF       │
 └─────────┴────────┴────────┴────────┴────────────────┘
```

- imm15 = `0x7FFF` — all 15 bits set; this is the Mode 2 sentinel
- CRd is both source and destination: the full-authority GT is read from CRd and the attenuated result is written back to CRd
- CRs holds the permission-mask GT; only permissions present in both CRd and CRs survive

The B-modifier and domain-purity checks from Case 1 do not apply here.

---

### Case 3 — FRAME query  `TPERM CRd, FRAME`

```
 31      27 26    23 22    19 18    15 14             0
 ┌─────────┬────────┬────────┬────────┬────────────────┐
 │  00110  │  cond  │  CRd   │  0000  │  000000000 1101│
 │         │        │(unused)│        │     0x000D     │
 └─────────┴────────┴────────┴────────┴────────────────┘
```

- imm15 = `0x000D` (preset code 13)
- Does **not** read the GT in CRd — checks the call stack instead
- Z=1 if a real RETURN frame is present; Z=0 if the stack is empty or synthetic

---

### Case 4 — EXACT identity check  `TPERM CRd, CRs`  *(preset EXACT)*

```
 31      27 26    23 22    19 18    15 14             0
 ┌─────────┬────────┬────────┬────────┬────────────────┐
 │  00110  │  cond  │  CRd   │  CRs   │  000000000 1110│
 │         │        │        │        │     0x000E     │
 └─────────┴────────┴────────┴────────┴────────────────┘
```

- imm15 = `0x000E` (preset code 14)
- Z=1 if and only if `CRd.word0 == CRs.word0` (bit-exact GT match)
- Used to verify that two CRs hold the same capability token

---

## Why not a simple permission-mask field?

A natural first reaction is: *why go to all this trouble? Just add a
mask field to the GT — AND it with the stored permissions, done.*

Here is why that does not work.

### 1 — A mask field is a mutation, not a test

TPERM's core value is that it is **side-effect-free** in Mode 1.
After `TPERM CR5, R`, `CR5` is exactly what it was before. The code
that follows can branch on Z without having changed anything. A
mask-and-store operation would have to write somewhere — and any write
to a GT requires the CRC seal to remain valid (the hardware checks it
on every NS access). Resealing requires knowing the seal key, which
only Mint holds. So masking a GT in place is not a lightweight
operation — it is a Mint call.

### 2 — Permission bits are already excluded from the seal

The CRC in NS Entry Word 2 does *not* cover the permission bits
(`perms[30:25]` of the GT) or the B flag (`bit[31]`). This is
intentional: it lets TPERM Mode 2 produce an attenuated GT without
calling Mint or touching the namespace at all. The seal still covers
the NS index and version, guaranteeing that an attenuated token still
refers to the same object with the same version — you cannot smuggle
in a different NS slot by masking.

A raw mask field would exploit this same exclusion, but without the
*intersection* constraint. Nothing would stop code from computing
`stored_perms OR extra_perms` and writing a wider permission set into
the GT — effectively forging a higher-privilege token. TPERM Mode 2
enforces that the result can only be a **subset** of what is already
held; it cannot amplify.

### 3 — The test-then-act pattern is load-bearing

Capability-based security depends on being able to reason about
*who is allowed to do what* before anything happens. The pattern:

```
TPERM  CRd, <required>
BRANCH NE,  handler_no_permission
<act>
```

is the primitive that makes conditionally-scoped authority possible.
A mask field answers *what you end up with after masking*; it does not
answer *whether the capability you hold is sufficient*. Those are
different questions. Code that uses TPERM for the test can
prove — statically, by inspecting the instruction stream — that it
never acts beyond what it tested for. A mask field provides no such
guarantee because the mask value can be computed at runtime from
arbitrary data.

### 4 — Mode 2 is the mask field, done right

TPERM Mode 2 (`TPERM CRd, CRs, 0x7FFF`) *is* a permission mask
operation, but with two constraints a bare mask field lacks:

- The mask is itself a GT (held in `CRs`), so it is a capability — it
  was granted by someone, not invented by the programmer.
- The result is always a subset of `CRd`'s permissions. You cannot
  use a mask GT that contains permissions you do not hold in `CRd`.

This is POLA (Principle of Least Authority) expressed as hardware: you
can narrow a capability for a callee, but you cannot manufacture
authority you were not given.

---

## Summary

| Aspect | Mode 1 (test) | Mode 2 (attenuation) | B-modifier |
|--------|--------------|----------------------|------------|
| Modifies GT in CR? | No | Yes (narrows CRd) | Clears B if Z=1 |
| Modifies namespace? | No | No | No |
| Faults on failure? | No (Z=0) | No (Z=0) | No (Z=0) |
| Requires Mint? | No | No | No |
| Result | Z flag only | Narrowed GT + Z flag | Z flag + B consumed |
