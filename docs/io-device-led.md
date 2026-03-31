# IO Device — LED (Boot NS Slot 7)

## Abstraction identity

| Property | Value |
|:---------|:------|
| Device name | `LED` |
| Boot NS slot | **7** |
| MMIO base address | `0x40000000` |
| Allocation size | 5 words (160 bits total) |
| `limit_offset` | 4 (five-word device; valid offsets: `{0, 1, 2, 3, 4}`) |
| GT type | `GT_TYPE_INFORM` (`0b01`) |
| Turing permissions | `R W` |
| Church permissions | none |
| `b_flag` | 1 (IDE-bound peripheral; excluded from CRC seal) |

The LED abstraction models **five independent RGB LED channels**, one word per LED.
Each word encodes bits `[2:0] = {B, G, R}`. The R bit (bit 0) drives the physical
LED pin on the board; the G and B bits are stored in the register but have no physical
pin on either board (hardware is single-colour only). The device is provisioned as an
Inform GT in the boot namespace before any user code runs.

---

## Register map

| Offset | Address | Name | Access | Bits | Description |
|:-------|:--------|:-----|:-------|:-----|:------------|
| 0 | `0x40000000` | `LED[0]` | R/W | `[2:0]={B,G,R}` | LED 0 colour register |
| 1 | `0x40000004` | `LED[1]` | R/W | `[2:0]={B,G,R}` | LED 1 colour register |
| 2 | `0x40000008` | `LED[2]` | R/W | `[2:0]={B,G,R}` | LED 2 colour register |
| 3 | `0x4000000C` | `LED[3]` | R/W | `[2:0]={B,G,R}` | LED 3 colour register |
| 4 | `0x40000010` | `LED[4]` | R/W | `[2:0]={B,G,R}` | LED 4 colour register |

Bits `[31:3]` of each word are ignored on write and read back as zero.

---

## GT word layout (Word 0)

```
 31   30 25  24 23  22 16  15       0
┌───┬──────┬─────┬───────┬──────────┐
│ b │ perms│type │gt_seq │ slot_id  │
│ 1 │ RW   │ 01₂ │  0    │   0x0007 │
└───┴──────┴─────┴───────┴──────────┘
```

| Field | Bits | Value | Meaning |
|:------|:-----|:------|:--------|
| `b_flag` | 31 | 1 | IDE-bound peripheral; excluded from CRC seal input |
| `perms` | 30:25 | `110000₂` | R=1, W=1, X=0, L=0, S=0, E=0 |
| `gt_type` | 24:23 | `01₂` | Inform |
| `gt_seq` | 22:16 | 0 | Boot-provisioned, sequence 0 |
| `slot_id` | 15:0 | `0x0007` | Boot NS index 7 |

**Word 1** (`word1_location`) = `0x40000000` — MMIO base address (NS entry `word0_location`).  
**Word 2** (`word1_w2`) = `0x00000004` — `limit_offset=4`, `gt_seq=0` (5-word device; offsets 0–4).  
**Word 3** (`word2_w3`) = `0x0000366A` — CRC-16/CCITT seal over `GT[24:0]` + location + word2.

---

## NS slot entry (boot namespace, slot 7)

| Field | Value |
|:------|:------|
| Slot index | 7 |
| MMIO base (`word1_location`) | `0x40000000` |
| `limit17` | 4 (→ `limit_offset = 4`) |
| `b_flag` | 1 |
| `f_flag` | 0 |
| `g_bit` | 0 |
| `chainable` | 0 |
| `gt_type` | `GT_TYPE_INFORM` (hardware constant `0b01`) |
| `version` | 0 |

The NS entry exists only to carry the GT description into the boot namespace table.
Hardware routes all DREAD/DWRITE operations on this slot to the MMIO registers directly —
no memory lump is allocated.

---

## Methods

### DWRITE — write LED colour

```
DWRITE DR_src, [CR_led + N]   ; N = 0..4, DR_src bits[2:0] = {B, G, R}
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `W` |
| Offsets | 0–4 (one per LED) |
| Operand | `DR_src[2:0]` = `{B, G, R}` |
| Effect | Updates LED N colour register; R bit drives physical pin |

### DREAD — read LED colour

```
DREAD DR_dst, [CR_led + N]   ; N = 0..4
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `R` |
| Offsets | 0–4 |
| Result | Current `{B, G, R}` register contents for LED N |

Reads back the value last written. Physical pin state equals bit 0 of the register.

---

## Board-level physical mapping

| Offset | Ti60 F225 pin | Active level | Tang Nano 20K pin | Active level |
|:-------|:-------------|:-------------|:-----------------|:-------------|
| 0 | `led0` | active-HIGH | `led0` | active-LOW |
| 1 | `led1` | active-HIGH | `led1` | active-LOW |
| 2 | `led2` | active-HIGH | `led2` | active-LOW |
| 3 | `led3` | active-HIGH | `led4`* | active-LOW |
| 4 | *(no pin)* | — | `led5` | active-LOW |

\* Tang Nano 20K: `led3` pin (pin 14) is internally used for PSRAM CE and is absent from the
GPIO pinmap. LED device offset 3 maps to the next available pin `led4`, and offset 4 maps to
`led5`. The Ti60 F225 has only 4 physical LEDs; offset 4 is a register-only placeholder.

Only the R bit (bit 0) of each word drives a physical pin. Writing G or B bits stores the value
in the register for software use but produces no visible effect on current hardware.

---

## Permissions and attenuation

A thread that holds NS slot 7 with full `R W` perms may:

- **Attenuate to `R` only** (read-only LED monitor) via `TPERM`
- **Attenuate to `W` only** (write-only LED driver) via `TPERM`

Attenuation is permanent — no instruction can add a permission back.

---

## Simulator behaviour

In the JS simulator the LED device is modelled by `simLED` (an array of 5 integers).

- `DWRITE offset N` → sets `simLED[N] = value & 0x7`; emits `ledChange { index: N, value, leds }` event
- `DREAD  offset N` → returns `simLED[N] & 0x7`

The `ledChange` event is consumed by the IDE UI to render the simulated LED panel.
