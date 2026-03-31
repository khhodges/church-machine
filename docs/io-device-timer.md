# IO Device — Timer (Boot NS Slot 10)

## Abstraction identity

| Property | Value |
|:---------|:------|
| Device name | `TIMER` |
| Boot NS slot | **10** |
| MMIO base address | `0x40000014` |
| Allocation size | 5 words (160 bits) |
| `limit_offset` | 4 (valid offsets: `{0, 1, 2, 3, 4}`) |
| GT type | `GT_TYPE_INFORM` (`0b01`) |
| Turing permissions | `R W` |
| Church permissions | none |
| `b_flag` | 0 (not propagable from boot namespace) |

The TIMER abstraction exposes a 64-bit free-running hardware tick counter, a
software-settable Unix epoch register, and a single-shot alarm mechanism — all within
one five-word Inform GT in the boot namespace. The counter is read-only; the epoch
and alarm registers are read-write.

---

## GT word layout (Word 0)

```
 31   30 25  24 23  22 16  15       0
┌───┬──────┬─────┬───────┬──────────┐
│ b │ perms│type │gt_seq │ slot_id  │
│ 0 │ RW   │ 01₂ │  0    │   0x000A │
└───┴──────┴─────┴───────┴──────────┘
```

| Field | Bits | Value | Meaning |
|:------|:-----|:------|:--------|
| `b_flag` | 31 | 0 | Not propagable via mSave |
| `perms` | 30:25 | `110000₂` | R=1, W=1, X=0, L=0, S=0, E=0 |
| `gt_type` | 24:23 | `01₂` | Inform |
| `gt_seq` | 22:16 | 0 | Boot-provisioned, sequence 0 |
| `slot_id` | 15:0 | `0x000A` | Boot NS index 10 |

**Word 1** (`word1_location`) = `0x40000014` — MMIO base address (NS entry `word0_location`).  
**Word 2** (`word1_w2`) = `0x00000004` — `limit_offset=4`, `gt_seq=0` (5-word device; offsets 0–4).  
**Word 3** (`word2_w3`) = `0x0000E505` — CRC-16/CCITT seal over `GT[24:0]` + location + word2.

---

## NS slot entry (boot namespace, slot 10)

| Field | Value |
|:------|:------|
| Slot index | 10 |
| MMIO base (`word1_location`) | `0x40000014` |
| `limit17` | 4 (→ `limit_offset = 4`) |
| `b_flag` | 0 |
| `f_flag` | 0 |
| `g_bit` | 0 |
| `chainable` | 0 |
| `gt_type` | `GT_TYPE_INFORM` (`0b01`) |
| `version` | 0 |

---

## Register map

| Offset | Address | Name | Dir | Meaning |
|:-------|:--------|:-----|:----|:--------|
| 0 | `0x40000014` | `TICKS_LO` | R | Low 32 bits of 64-bit free-running tick counter |
| 1 | `0x40000018` | `TICKS_HI` | R | High 32 bits of 64-bit tick counter |
| 2 | `0x4000001C` | `TOD_EPOCH` | R/W | Unix time (seconds since epoch); set by boot/IDE |
| 3 | `0x40000020` | `ALARM_CMP` | R/W | Alarm compare value — compared against `TICKS_LO` |
| 4 | `0x40000024` | `ALARM_CTL` | R/W | `[0]`=armed, `[1]`=fired; write 1 to bit 1 to clear |

The MMIO selector is decoded from `dmem_addr[5:2]` (4 bits), covering the full
range of 10 registers from `sel=0` (LED) through `sel=9` (`ALARM_CTL`).

---

## Methods

### DREAD offset 0 — read tick counter low word (`TICKS_LO`)

```
DREAD DR_lo, [CR_timer + 0]
```

| Parameter | Detail |
|:----------|:-------|
| Permission | `R` |
| Result | `DR_lo[31:0]` — low word of the 64-bit hardware tick counter |

The counter increments on every clock cycle, wrapping silently at 2³² − 1 → 0.
Reading `TICKS_LO` before `TICKS_HI` is the correct ordering for a coherent 64-bit
read (low word then high word — if `TICKS_LO` wraps between the two reads, `TICKS_HI`
will have already incremented).

### DREAD offset 1 — read tick counter high word (`TICKS_HI`)

```
DREAD DR_hi, [CR_timer + 1]
```

| Parameter | Detail |
|:----------|:-------|
| Permission | `R` |
| Result | `DR_hi[31:0]` — high word of the 64-bit hardware tick counter |

**64-bit elapsed-time pattern:**

```
  DREAD DR0, [CR_timer + 0]   ; TICKS_LO start
  DREAD DR1, [CR_timer + 1]   ; TICKS_HI start
  ; ... do work ...
  DREAD DR2, [CR_timer + 0]   ; TICKS_LO end
  DREAD DR3, [CR_timer + 1]   ; TICKS_HI end
  ; elapsed_lo = DR2 - DR0 (unsigned; handles wrap automatically)
  ; elapsed_hi = DR3 - DR1 - (DR2 < DR0 ? 1 : 0)  ; borrow from wrap
```

### DREAD/DWRITE offset 2 — Unix epoch (`TOD_EPOCH`)

```
DWRITE DR_secs, [CR_timer + 2]   ; set wall-clock seconds
DREAD  DR_secs, [CR_timer + 2]   ; read wall-clock seconds
```

| Parameter | Detail |
|:----------|:-------|
| Write permission | `W` |
| Read permission | `R` |
| Operand / result | 32-bit Unix timestamp in seconds (valid until year 2106) |

`TOD_EPOCH` is a software-maintained register. The hardware does not auto-increment it.
The boot/IDE code sets it once at startup from network time (or a stored RTC value). To
compute the current time at any moment:

```
current_unix = TOD_EPOCH + (TICKS_LO_now - TICKS_LO_at_boot) / CLK_FREQ
```

where `CLK_FREQ` is the board clock rate (50 000 000 on Ti60, 27 000 000 on Tang Nano).
Integer division gives whole seconds; the remainder gives the sub-second fractional tick.

### DREAD/DWRITE offset 3 — alarm compare (`ALARM_CMP`)

```
DWRITE DR_target, [CR_timer + 3]   ; set alarm target tick (TICKS_LO value)
DREAD  DR_target, [CR_timer + 3]   ; read current alarm target
```

| Parameter | Detail |
|:----------|:-------|
| Permission | `R W` |
| Operand / result | 32-bit compare value; alarm fires when `TICKS_LO == ALARM_CMP` |

Write the target tick before arming (ALARM_CTL offset 4). The compare runs continuously
while `armed=1`; when `TICKS_LO` equals the stored value the `fired` flag is set.

### DREAD/DWRITE offset 4 — alarm control (`ALARM_CTL`)

```
DREAD  DR_ctl, [CR_timer + 4]   ; read alarm status
DWRITE DR_ctl, [CR_timer + 4]   ; arm alarm / clear fired flag
```

| Bit | Name | Dir | Meaning |
|:----|:-----|:----|:--------|
| `[0]` | `armed` | R/W | 1 = alarm comparison is active; write 1 to arm |
| `[1]` | `fired` | R/clear | 1 = alarm has fired; write 1 to clear |
| `[31:2]` | — | — | Reserved, read as zero |

**Alarm usage pattern:**

```
  ; 1. Compute target tick
  DREAD  DR0, [CR_timer + 0]    ; read current TICKS_LO
  ADDI   DR0, DR0, #delay_ticks ; target = now + delay
  ; 2. Program and arm
  DWRITE DR0, [CR_timer + 3]    ; set ALARM_CMP
  MOVI   DR1, #0x01             ; armed=1, do not clear fired
  DWRITE DR1, [CR_timer + 4]    ; arm
  ; 3. Poll until fired
alarm_poll:
  DREAD  DR2, [CR_timer + 4]
  ANDI   DR2, DR2, #0x02        ; test bit [1]
  BEQ    alarm_poll             ; loop while fired == 0
  ; 4. Clear fired flag and disarm
  MOVI   DR3, #0x02             ; write 1 to bit [1] to clear fired; armed remains
  DWRITE DR3, [CR_timer + 4]
```

To disarm (stop future matches), write `ALARM_CTL` with both bits 0: `DWRITE DR_zero, [CR_timer + 4]`
currently has no disarm-bit — set `ALARM_CMP` to a value that will not be reached and
leave `armed=1`, or add a future disarm mechanism via bit `[2]` in a later revision.

---

## Board-level clock rates

| Board | System clock | Tick period | 32-bit wrap (`TICKS_LO`) | 64-bit wrap |
|:------|:-------------|:------------|:-------------------------|:------------|
| Efinix Ti60 F225 | 50 MHz | 20 ns | ~85.9 s | ~11 700 years |
| Tang Nano 20K | 27 MHz | ~37 ns | ~158.9 s | ~21 700 years |

`TICKS_HI` overflows at astronomical timescales; for practical use only `TICKS_LO`
matters for short intervals (< 85 s on Ti60, < 159 s on Tang Nano).

---

## Alarm hardware semantics

The alarm comparator is purely combinational on `TICKS_LO`. It fires in the same clock
cycle that `TICKS_LO` matches `ALARM_CMP`, setting `alarm_fired` on the next rising
edge. It does **not** fire again until the flag is cleared and another match occurs
(2³² cycles later). Software must clear the fired flag after each alarm.

The `alarmFired` event is emitted by the simulator on each alarm match so that IDE
panels can react immediately without polling.

---

## Permissions and attenuation

| Attenuated GT | Perms kept | Use case |
|:--------------|:-----------|:---------|
| Read-only timer | `R` | Thread may only read ticks and TOD; cannot set epoch or arm alarms |
| Write-only alarm setter | `W` | Thread may only program alarm and TOD; cannot read tick count |
| Full | `R W` | Boot/privileged thread; can do everything |

An `R`-only timer GT is safe to distribute widely — holders can measure elapsed time and
read TOD but cannot interfere with alarm state or the epoch register.

---

## Simulator behaviour

In the JS simulator the timer device is modelled by `simTimerLo`, `simTimerHi`,
`simTodEpoch`, `simAlarmCmp`, `simAlarmArmed`, and `simAlarmFired`.

- On every **`DREAD`** against this slot, `simTimerLo` is incremented first (and
  `simTimerHi` if it wraps), then the alarm comparator is checked, then the requested
  offset is returned. This models a counter that advances once per instruction.
- **DWRITE offset 2** → sets `simTodEpoch`
- **DWRITE offset 3** → sets `simAlarmCmp`
- **DWRITE offset 4** → bit `[0]` arms; bit `[1]` clears the fired flag
- **Alarm fire** → emits `alarmFired { tickLo }` event; IDE panels subscribe to this
  event to display alarm notifications without polling
