# IO Device — Free-Running Timer (Boot NS Slot 10)

## Abstraction identity

| Property | Value |
|:---------|:------|
| Device name | `TIMER` |
| Boot NS slot | **10** |
| MMIO base address | `0x40000014` |
| Allocation size | 1 word (32 bits) |
| `limit_offset` | 0 (single-word device; valid offsets: `{0}`) |
| GT type | `GT_TYPE_ABSTRACT` (`0b11`) |
| Turing permissions | `R` |
| Church permissions | none |
| `b_flag` | 0 (not propagable from boot namespace) |

The TIMER abstraction is a **read-only 32-bit free-running counter** that increments
on every clock cycle. It is write-protected at the hardware level: no software can
reset or write the counter. This ensures the timer cannot be falsified — it is an
unforgeable monotonic time reference available to any thread that holds NS slot 10.

---

## GT word layout (Word 0)

```
 31   30 25  24 23  22 16  15       0
┌───┬──────┬─────┬───────┬──────────┐
│ b │ perms│type │gt_seq │ slot_id  │
│ 0 │ R    │ 11₂ │  0    │   0x000A │
└───┴──────┴─────┴───────┴──────────┘
```

| Field | Bits | Value | Meaning |
|:------|:-----|:------|:--------|
| `b_flag` | 31 | 0 | Not propagable via mSave |
| `perms` | 30:25 | `100000₂` | R=1, W=0, X=0, L=0, S=0, E=0 |
| `gt_type` | 24:23 | `11₂` | Abstract |
| `gt_seq` | 22:16 | 0 | Boot-provisioned, sequence 0 |
| `slot_id` | 15:0 | `0x000A` | Boot NS index 10 |

**Word 1** (`word1_location`) = `0x40000014` — the MMIO base address.  
**Words 2–3** = `0x00000000` — no tunnel backup (local peripheral GT).

---

## NS slot entry (boot namespace, slot 10)

| Field | Value |
|:------|:------|
| Slot index | 10 |
| MMIO base (`word1_location`) | `0x40000014` |
| `limit17` | 0 (→ `limit_offset = 0`) |
| `b_flag` | 0 |
| `f_flag` | 0 |
| `g_bit` | 0 |
| `chainable` | 0 |
| `gt_type` | `GT_TYPE_ABSTRACT` (`0b11`) |
| `version` | 0 |

---

## Methods

### DREAD offset 0 — read timer value

```
DREAD DR_t, [CR_timer + 0]
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `R` |
| Offset | 0 (only valid offset) |
| Result | `DR_t[31:0]` — current 32-bit counter value |

The counter wraps silently at 2³² − 1 → 0. Software that needs elapsed time must
take two readings and compute the difference (handling the wrap case if needed).

**Elapsed-time pattern:**

```
  DREAD DR_start, [CR_timer + 0]   ; capture start
  ; ... do work ...
  DREAD DR_end,   [CR_timer + 0]   ; capture end
  ; elapsed = DR_end - DR_start (unsigned subtraction; wrap-safe)
```

### DWRITE — prohibited

There is no W permission on this GT. Attempting `DWRITE` against NS slot 10 will fault
with `PERMISSION`.

---

## Board-level clock rates

| Board | System clock | Timer tick | 32-bit wrap period |
|:------|:-------------|:-----------|:-------------------|
| Efinix Ti60 F225 | 50 MHz | 20 ns | ~85.9 s |
| Tang Nano 20K | 27 MHz | ~37 ns | ~158.9 s |

The timer is implemented as a 32-bit `Signal()` driven by a single `m.d.sync += timer_ctr.eq(timer_ctr + 1)` in the top-level hardware module. It is synchronous with the system clock and has no prescaler.

---

## Heartbeat LED relationship

Both FPGA targets also derive the **heartbeat blink** from the same counter (via an
independent comparator in the hardware module). The heartbeat and the MMIO TIMER
register are driven from the same underlying counter but the LED blink path does not
consume or interfere with DREAD reads.

---

## Permissions and attenuation

This GT carries only `R` permission at boot. It cannot be attenuated further.
A thread without NS slot 10 has no architectural access to timing information —
it cannot measure elapsed time, implement a timeout, or construct a timing side-channel
through this abstraction.

---

## Simulator behaviour

In the JS simulator the TIMER device is modelled by `simTimer` (a 32-bit integer,
initially 0, auto-incrementing on each read).

- `DREAD offset 0` → returns `(simTimer++) >>> 0`

Each DREAD increments the counter by 1, approximating a free-running counter whose
advance is proportional to instruction count rather than real wall time. This is
sufficient for software that uses the timer for ordering (start < end) and for testing
elapsed-time arithmetic without requiring a real clock.

There is no `DWRITE` path; the `_writeMMIO` handler ignores writes to `'timer'`.
