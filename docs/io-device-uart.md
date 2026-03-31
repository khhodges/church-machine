# IO Device — UART (Boot NS Slot 8)

## Abstraction identity

| Property | Value |
|:---------|:------|
| Device name | `UART` |
| Boot NS slot | **8** |
| MMIO base address | `0x40000014` |
| Allocation size | 3 words (96 bits) |
| `limit_offset` | 2 (valid offsets: `{0, 1, 2}`) |
| GT type | `GT_TYPE_INFORM` (`0b01`) |
| Turing permissions | `R W` |
| Church permissions | none |
| `b_flag` | 1 (IDE-bound peripheral; excluded from CRC seal) |

The UART abstraction exposes the board's single FTDI-bridged UART as a three-word
Inform GT in the boot namespace. Offset 0 is the transmit register, offset 1 is the
status register (read-only; reflects TX readiness), and offset 2 is the receive register.
All three offsets are within the single limit_offset=2 grant — no separate GT is needed
for TX vs RX.

---

## GT word layout (Word 0)

```
 31   30 25  24 23  22 16  15       0
┌───┬──────┬─────┬───────┬──────────┐
│ b │ perms│type │gt_seq │ slot_id  │
│ 1 │ RW   │ 01₂ │  0    │   0x0008 │
└───┴──────┴─────┴───────┴──────────┘
```

| Field | Bits | Value | Meaning |
|:------|:-----|:------|:--------|
| `b_flag` | 31 | 1 | IDE-bound peripheral; excluded from CRC seal input |
| `perms` | 30:25 | `110000₂` | R=1, W=1, X=0, L=0, S=0, E=0 |
| `gt_type` | 24:23 | `01₂` | Inform |
| `gt_seq` | 22:16 | 0 | Boot-provisioned, sequence 0 |
| `slot_id` | 15:0 | `0x0008` | Boot NS index 8 |

**Word 1** (`word1_location`) = `0x40000014` — MMIO base address (NS entry `word0_location`).  
**Word 2** (`word1_w2`) = `0x00000002` — `limit_offset=2`, `gt_seq=0` (3-word device; offsets 0–2).  
**Word 3** (`word2_w3`) = `0x000043A4` — CRC-16/CCITT seal over `GT[24:0]` + location + word2.

---

## NS slot entry (boot namespace, slot 8)

| Field | Value |
|:------|:------|
| Slot index | 8 |
| MMIO base (`word1_location`) | `0x40000014` |
| `limit17` | 2 (→ `limit_offset = 2`) |
| `b_flag` | 1 |
| `f_flag` | 0 |
| `g_bit` | 0 |
| `chainable` | 0 |
| `gt_type` | `GT_TYPE_INFORM` (`0b01`) |
| `version` | 0 |

---

## Methods

### DWRITE offset 0 — transmit a byte (TX)

```
DWRITE DR_byte, [CR_uart + 0]
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `W` |
| Operand | `DR_byte[7:0]` — low byte is the character to send |
| Effect | Latches byte into the TX arbitration register; emitted when TX is not busy |

The hardware does not block on busy: the byte is held in `mmio_uart_byte_reg` with
`mmio_uart_pending=1` and forwarded to the UART TX shift register as soon as
`~debug.busy`. Software must poll STATUS (offset 1) before each write if it needs
to guarantee the previous byte was consumed.

### DREAD offset 1 — read TX status (STATUS)

```
DREAD DR_stat, [CR_uart + 1]
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `R` |
| Result | `DR_stat[0]` = TX ready flag (`1` = ready, `0` = busy) |

```
if (DR_stat[0] == 1):  UART is idle; safe to DWRITE offset 0
if (DR_stat[0] == 0):  TX in progress; wait before sending
```

The hardware returns `~debug.busy` (the UART TX shift-register idle flag). Bits 31:1
are always zero.

### DREAD offset 2 — receive a byte (RX)

```
DREAD DR_byte, [CR_uart + 2]
```

| Parameter | Detail |
|:----------|:-------|
| Permission required | `R` |
| Result | `DR_byte[7:0]` — received byte (0x00 if RX buffer is empty) |

Hardware RX is provided by `uart_rx.py`. On both boards the FTDI bridge is the physical
RX source. Software should check a separate RX-available flag (implementation-defined)
before reading to distinguish "no data" from a genuine `0x00` byte.

---

## Register map summary

| Offset | Name | Direction | Permissions | Meaning |
|:-------|:-----|:----------|:------------|:--------|
| 0 | `TX` | Write | W | Byte to transmit (`[7:0]`); write triggers TX when idle |
| 1 | `STATUS` | Read | R | `[0]` = TX ready (`~debug.busy`); `[31:1]` = 0 |
| 2 | `RX` | Read | R | Received byte (`[7:0]`); 0x00 = empty |

---

## Board-level notes

| Board | UART bridge | TX baud | RX baud | Notes |
|:------|:------------|:--------|:--------|:------|
| Efinix Ti60 F225 | FTDI FT232 | 115200 | 115200 | Single TX/RX pair on J4 |
| Tang Nano 20K | on-board CH340 | 115200 | 115200 | Single TX/RX pair on USB-C |

Both boards drive the UART from the FSM debug sender (`debug.py`). The MMIO TX path
shares the same physical UART via the arbitration mux — the debug FSM (banner, halt,
step, fault bytes) takes priority; MMIO TX sends when `~debug.busy`.

---

## Permissions and attenuation

| Attenuated GT | Perms kept | Use case |
|:--------------|:-----------|:---------|
| TX-only | `W` | Thread that may only send, never read back status or RX |
| RX+STATUS | `R` | Thread that may only receive and poll |
| Full | `R W` | Full UART access |

TX-only threads cannot poll STATUS (offset 1) because STATUS requires `R`. They must
not care about back-pressure or must be designed to send at a rate the UART can absorb.

---

## Simulator behaviour

In the JS simulator the UART device is modelled in `_readMMIO` / `_writeMMIO`.

- `DWRITE offset 0` → extracts `value & 0xFF`, appends `String.fromCharCode(byte)` to
  `this.output`, emits `uartTx { byte, char }` event
- `DREAD  offset 1` → returns `1` (TX always ready in simulation)
- `DREAD  offset 2` → returns `0` (RX always empty in simulation)

The `uartTx` event is consumed by the IDE terminal panel to display transmitted characters.
