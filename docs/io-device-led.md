# IO Device — LED (Boot NS Slot 7)

## Abstraction identity

| Property | Value |
|:---------|:------|
| Device name | `LED` |
| Boot NS slot | **7** |
| MMIO base address | `0x40000000` |
| Allocation size | 1 word (32 bits) |
| `limit_offset` | 0 (single-word device; valid offsets: `{0}`) |
| GT type | `GT_TYPE_ABSTRACT` (`0b11`) |
| Turing permissions | `R W` |
| Church permissions | none |
| `b_flag` | 0 (not propagable from boot namespace) |

The LED abstraction is a **read/write 32-bit register** whose low bits are wired directly
to the board's status LEDs. It is provisioned as an Abstract GT in the boot namespace
before any user code runs, so any thread that holds a copy of NS slot 7 (or an
attenuated derivative) has unforgeable, bounded access to LED state.

---

## GT word layout (Word 0)

```
 31   30 25  24 23  22 16  15       0
┌───┬──────┬─────┬───────┬──────────┐
│ b │ perms│type │gt_seq │ slot_id  │
│ 0 │ RW   │ 11₂ │  0    │   0x0007 │
└───┴──────┴─────┴───────┴──────────┘
```

| Field | Bits | Value | Meaning |
|:------|:-----|:------|:--------|
| `b_flag` | 31 | 0 | Not propagable via mSave |
| `perms` | 30:25 | `110000₂` | R=1, W=1, X=0, L=0, S=0, E=0 |
| `gt_type` | 24:23 | `11₂` | Abstract |
| `gt_seq` | 22:16 | 0 | Boot-provisioned, sequence 0 |
| `slot_id` | 15:0 | `0x0007` | Boot NS index 7 |

**Word 1** (`word1_location`) = `0x40000000` — the MMIO base address.  
**Words 2–3** = `0x00000000` — no tunnel backup (local peripheral GT).

---

## NS slot entry (boot namespace, slot 7)

| Field | Value |
|:------|:------|
| Slot index | 7 |
| MMIO base (`word1_location`) | `0x40000000` |
| `limit17` | 0 (→ `limit_offset = 0`) |
| `b_flag` | 0 |
| `f_flag` | 0 |
| `g_bit` | 0 |
| `chainable` | 0 |
| `gt_type` | `GT_TYPE_ABSTRACT` (hardware constant `0b11`) |
| `version` | 0 |

The NS entry exists only to carry the GT description into the boot namespace table.
Hardware routes all DREAD/DWRITE operations on this slot to the MMIO register directly —
no memory lump is allocated.

---

## Methods

### DWRITE — write LED state

```
DWRITE DR_src, [CR_led + 0]
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `W` |
| Offset | 0 (only valid offset) |
| Operand | `DR_src[31:0]` — full 32-bit write |
| Effect | Updates the LED output register |

**Board-level mapping:**

| Board | Active level | LED count | Bits used |
|:------|:-------------|:----------|:----------|
| Efinix Ti60 F225 | **Active-HIGH** | 4 | `[3:0]` |
| Tang Nano 20K | **Active-LOW** | 6 | `[5:0]` (output is `~DR_src[5:0]`) |

Writing `0x00000001` lights LED 0 on Ti60; writing `0x00000000` lights all 6 LEDs on Tang Nano.

### DREAD — read LED state

```
DREAD DR_dst, [CR_led + 0]
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `R` |
| Offset | 0 |
| Result | Current LED register contents (same encoding as DWRITE) |

Reads back the value last written via DWRITE. The board applies the active-level
inversion at the physical pins; the register always stores the logical value.

---

## Permissions and attenuation

A thread that holds NS slot 7 with full `R W` perms may:

- **Attenuate to `R` only** (read-only LED monitor) via `TPERM`
- **Attenuate to `W` only** (write-only LED driver) via `TPERM`

Attenuation is permanent — no instruction can add a permission back. The original
`R W` GT in the boot namespace cannot be duplicated by user code.

---

## Simulator behaviour

In the JS simulator the LED device is modelled by `simLED` (a 32-bit integer).

- `DWRITE offset 0` → sets `simLED`; emits `ledChange { value }` event
- `DREAD  offset 0` → returns `simLED`

The `ledChange` event is consumed by the IDE UI to render the simulated LED bar.
