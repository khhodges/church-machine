# IO Device — Push Button (Boot NS Slot 9)

## Abstraction identity

| Property | Value |
|:---------|:------|
| Device name | `BTN` |
| Boot NS slot | **9** |
| MMIO base address | `0x40000010` |
| Allocation size | 1 word (32 bits) |
| `limit_offset` | 0 (single-word device; valid offsets: `{0}`) |
| GT type | `GT_TYPE_INFORM` (`0b01`) |
| Turing permissions | `R` |
| Church permissions | none |
| `b_flag` | 0 (not propagable from boot namespace) |

The BTN abstraction is a **read-only 32-bit register** that reflects the debounced
state of the board's user push button. It is write-protected at the hardware level:
a DWRITE against a `W`-less GT will fault with `PERMISSION`. This ensures no software
can falsify button state.

---

## GT word layout (Word 0)

```
 31   30 25  24 23  22 16  15       0
┌───┬──────┬─────┬───────┬──────────┐
│ b │ perms│type │gt_seq │ slot_id  │
│ 0 │ R    │ 01₂ │  0    │   0x0009 │
└───┴──────┴─────┴───────┴──────────┘
```

| Field | Bits | Value | Meaning |
|:------|:-----|:------|:--------|
| `b_flag` | 31 | 0 | Not propagable via mSave |
| `perms` | 30:25 | `100000₂` | R=1, W=0, X=0, L=0, S=0, E=0 |
| `gt_type` | 24:23 | `01₂` | Inform |
| `gt_seq` | 22:16 | 0 | Boot-provisioned, sequence 0 |
| `slot_id` | 15:0 | `0x0009` | Boot NS index 9 |

**Word 1** (`word1_location`) = `0x40000010` — MMIO base address (NS entry `word0_location`).  
**Word 2** (`word1_w2`) = `0x00000000` — `limit_offset=0`, `gt_seq=0` (1-word device; offset 0 only).  
**Word 3** (`word2_w3`) = `0x000001C3` — CRC-16/CCITT seal over `GT[24:0]` + location + word2.

---

## NS slot entry (boot namespace, slot 9)

| Field | Value |
|:------|:------|
| Slot index | 9 |
| MMIO base (`word1_location`) | `0x40000010` |
| `limit17` | 0 (→ `limit_offset = 0`) |
| `b_flag` | 0 |
| `f_flag` | 0 |
| `g_bit` | 0 |
| `chainable` | 0 |
| `gt_type` | `GT_TYPE_INFORM` (`0b01`) |
| `version` | 0 |

---

## Methods

### DREAD offset 0 — read button state

```
DREAD DR_btn, [CR_btn + 0]
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `R` |
| Offset | 0 (only valid offset) |
| Result | `DR_btn[0]` = button pressed (`1` = pressed, `0` = released); `[31:1]` = 0 |

The hardware returns the **debounced** press signal. The debouncer is a two-stage
synchroniser followed by an edge detector. Bit 0 is `1` only while the button is held
down (level), not a single-cycle pulse. Software must edge-detect in software if it
wants to respond to press transitions.

**Edge-detect pattern:**

```
  DREAD DR0,  [CR_btn + 0]   ; read current state
  ; ... compare DR0 against saved previous state in DR1 ...
  ; if DR0[0] == 1 and DR1[0] == 0: rising edge (press)
  ; if DR0[0] == 0 and DR1[0] == 1: falling edge (release)
  ; save DR0 → DR1 for next iteration
```

### DWRITE — prohibited

There is no W permission on this GT. Attempting `DWRITE` against NS slot 9 will fault
with `PERMISSION` before any MMIO access occurs.

---

## Board-level notes

| Board | Button | Raw signal | Debounce |
|:------|:-------|:-----------|:---------|
| Efinix Ti60 F225 | `push_button` (USER BTN, active-HIGH) | `self.push_button` | 2-stage synchroniser in hardware |
| Tang Nano 20K | `push_button` (KEY0, active-LOW, inverted) | `~self.push_button` | 2-stage synchroniser in hardware |

Both boards normalise the signal so `1` in the register means the button is pressed,
regardless of the physical active level.

---

## Permissions and attenuation

This GT carries only `R` permission at boot. It cannot be attenuated further (no other
permission bits are set). Threads that do not hold slot 9 have no path to button state.

---

## Simulator behaviour

In the JS simulator the BTN device is modelled by `simBTN` (a 32-bit integer, default 0).

- `DREAD offset 0` → returns `simBTN >>> 0`
- The IDE UI may write `simBTN` directly (via the simulator API) to simulate a button press

There is no `DWRITE` path; the `_writeMMIO` handler ignores writes to `'btn'`.
