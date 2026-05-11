# CM Memory Map — Authoritative Reference

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

> **Principle:** The CM is defined by the memory, always, no more and no less.
> The simulator must follow the memory, no more and no less.

All data in this document are computed from a live simulator run using
`tests/ctmm_map_dump.js`.  That script boots the simulator, iterates every
NS entry, checks each lump header, detects address conflicts, and decompiles
code words via `ChurchAssembler.disassemble()`.  Every table here is
directly reproducible from the script.

> **Scope note:** The dump script iterates `nsCount` active entries (47 at
> boot in the 16 384-word profile) rather than all 256 possible NS table
> slots.  Slots 47–255 contain `0x00000000` words (never written) and are
> out of scope for this audit.

---

## 1. Top-Level Memory Regions

The simulator's `memory[]` is a flat `Uint32Array` of 32-bit unsigned words.
All addresses are **word addresses** (byte address = word address × 4).

Two sizes are in use.  Lump slot addresses (`0x0000`–`0x0D3F`) are **identical**
between them because lumps are allocated from address 0 upward.

### 1.1 Standard 65 536-word architectural configuration

`NS_TABLE_RESERVE = 0x300` (768 words = 256 entries × 3 words).

| Start    | End      | Words  | Region |
|:---------|:---------|-------:|:-------|
| `0x0000` | `0xFCFE` | 64 767 | **Lump area** — all object lumps |
| `0xFCFF` | `0xFCFF` |      1 | **Format tag word** (`0xB0070229`) — boot-image version sentinel |
| `0xFD00` | `0xFFFF` |    768 | **NS table** — 256 × 3-word entries (`NS_TABLE_BASE = 0xFD00`) |

`NS_TABLE_BASE = 65536 − NS_TABLE_RESERVE = 65536 − 768 = 0xFD00`

> The `simulator/simulator.js` header comment (lines 15–19) shows an older
> layout that placed the NS table at `0xFD00–0xFDFF` (256 words), the IO
> segment at `0xFE00–0xFEFF`, and Boot ROM at `0xFF00–0xFFFF`.  That reflected
> an era when the NS table had 1 word per entry.  With `NS_TABLE_RESERVE = 0x300`
> (3 words × 256 entries) the NS table now spans `0xFD00–0xFFFF` in the 65
> 536-word window; there is no separate IO segment or Boot ROM region in the
> current implementation's memory layout.

### 1.2 Alternate 16 384-word runtime profile (IDE default project)

When `window.bootConfig.step1.totalNamespaceWords = 16384`:

| Start    | End      | Words  | Region |
|:---------|:---------|-------:|:-------|
| `0x0000` | `0x0D3F` |  3 392 | **Lump area — occupied** (47 active NS slots at boot) |
| `0x0D40` | `0x3CFE` | 12 223 | **Lump area — free** (unallocated heap space) |
| `0x3CFF` | `0x3CFF` |      1 | **Format tag word** (`0xB0070229`) |
| `0x3D00` | `0x3FFF` |    768 | **NS table** (`NS_TABLE_BASE = 0x3D00`) |

`NS_TABLE_BASE = 16384 − 768 = 0x3D00`

> In the 16 384-word profile there is no separate IO segment or Boot ROM shadow.
> Device register windows (UART, LED, Button, Timer) sit inside the lump area
> at the word addresses stored in their NS table entries.

---

## 2. Namespace (NS) Table

Base address: `NS_TABLE_BASE`.  Entry `i` starts at `NS_TABLE_BASE + i × 3`.
Each entry is exactly **3 consecutive 32-bit words**.

### 2.1 NS entry word layout

**Word 0 — location**

| Bits   | Field    | Description |
|:-------|:---------|:------------|
| [31:0] | location | Base word address of the lump in `memory[]`. |

**Word 1 — limit / metadata** (fields from `packNSWord1` / `parseNSWord1`)

| Bits    | Field      | Description |
|:--------|:-----------|:------------|
| [31]    | B-flag     | `bFlag` — bounds marker set by allocator |
| [30]    | F-flag     | `fFlag` — Far-call flag |
| [29]    | G-bit      | `gBit` — GC liveness (1 = live, 0 = garbage suspect) |
| [28]    | chainable  | Capability chaining permitted |
| [27:26] | gtType     | Golden Token type: `00`=Null, `01`=Inform, `10`=Outform, `11`=Abstract |
| [25:17] | clistCount | C-list slot count (9 bits, 0–511) |
| [16:0]  | limit      | Addressable limit from lump base in words (17 bits). For a fully loaded lump: `lumpSize − cc − 1`. |

> **Note:** The `simulator/simulator.js` header comment (lines 24–28) describes
> these bits with G and B swapped.  The authoritative positions are those in
> `packNSWord1` / `parseNSWord1`: B=[31], F=[30], G=[29].

**Word 2 — seals**

| Bits    | Field   | Description |
|:--------|:--------|:------------|
| [31:25] | version | GT version counter (7 bits); bumped each time the entry is reused |
| [24:16] | —       | Reserved (zero) |
| [15:0]  | seal    | CRC-16 of (location, limit) — integrity tag |

### 2.2 All NS entries (47 active at boot, 16 384-word profile)

Lump addresses in this table are identical in both the 65 536-word and the
16 384-word configurations.

| Slot | Name         | W0 location    | W1 (hex)     | limit | cc | G | Notes |
|-----:|:-------------|:---------------|:-------------|------:|---:|:-:|:------|
|   0  | Boot.NS      | `0x00000000`   | `0x245E3FFF` | 16383 | 47 | 1 | NS root; location=0 |
|   1  | Boot.Thread  | `0x00000040`   | `0x240000FF` |   255 |  0 | 1 | Thread lump |
|   2  | (free/null)  | `0x00000140`   | `0x00000000` |     — |  — | 0 | Free slot — Boot.Abstr director eliminated (Task #247) |
|   3  | Boot.Abstr   | `0x00000180`   | `0x242200EE` |   238 | 17 | 1 | Boot ROM code; cw=17, cc=17 |
|   4  | Salvation    | `0x00000280`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|   5  | Navana       | `0x000002C0`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|   6  | Mint         | `0x00000300`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|   7  | Memory       | `0x00000340`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|   8  | Scheduler    | `0x00000380`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|   9  | Stack        | `0x000003C0`   | `0x1400003F` |    63 |  0 | 0 | Lazy, chainable (bit[28]=1) |
|  10  | DijkstraFlag | `0x00000400`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  11  | UART         | `0x00000440`   | `0x04000002` |     2 |  0 | 0 | 3 MMIO regs: TX@+0, STATUS@+1, RX@+2 |
|  12  | LED          | `0x00000480`   | `0x04000005` |     5 |  0 | 0 | 6 MMIO regs: LED0–LED5 |
|  13  | Button       | `0x000004C0`   | `0x04000000` |     0 |  0 | 0 | 1 MMIO reg: BUTTON_STATE@+0 |
|  14  | Timer        | `0x00000500`   | `0x04000004` |     4 |  0 | 0 | 5 MMIO regs: TICKS_LO/HI, TOD_EPOCH, ALARM_CMP, CTL |
|  15  | Display      | `0x00000540`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  16  | SlideRule    | `0x00000580`   | `0x1400003F` |    63 |  0 | 0 | Lazy, chainable |
|  17  | Abacus       | `0x000005C0`   | `0x1400003F` |    63 |  0 | 0 | Lazy, chainable |
|  18  | Constants    | `0x00000600`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  19  | Loader       | `0x00000640`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  20  | SUCC         | `0x00000680`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  21  | PRED         | `0x000006C0`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  22  | ADD          | `0x00000700`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  23  | SUB          | `0x00000740`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  24  | MUL          | `0x00000780`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  25  | ISZERO       | `0x000007C0`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  26  | TRUE         | `0x00000800`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  27  | FALSE        | `0x00000840`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  28  | Family       | `0x00000880`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  29  | Schoolroom   | `0x000008C0`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  30  | Friends      | `0x00000900`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  31  | Tunnel       | `0x00000940`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  32  | Negotiate    | `0x00000980`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  33  | Editor       | `0x000009C0`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  34  | Assembler    | `0x00000A00`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  35  | Debugger     | `0x00000A40`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  36  | Deployer     | `0x00000A80`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  37  | Browser      | `0x00000AC0`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  38  | Messenger    | `0x00000B00`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  39  | Photos       | `0x00000B40`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  40  | Social       | `0x00000B80`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  41  | Video        | `0x00000BC0`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  42  | Email        | `0x00000C00`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  43  | PAIR         | `0x00000C40`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  44  | GC           | `0x00000C80`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  45  | Thread       | `0x00000CC0`   | `0x0400003F` |    63 |  0 | 0 | Lazy |
|  46  | Circle       | `0x00000D00`   | `0x0400003F` |    63 |  0 | 0 | Lazy |

**G-bit after boot:** Slots 0–3 are GC-live (G=1, explicitly initialized).
Slots 4–46 are G=0 (lazy; marked live by first GC reachability scan).

**Chainable bit (W1 bit[28]=1):** Slots 9 (Stack), 16 (SlideRule), 17 (Abacus).

---

## 3. Lump Header Format

Word 0 of every object lump carries the lump header.  Magic `0x1F` in bits
[31:27] is the validity marker; the CPU traps if PC lands on a header word.

```
 31      27 26    23 22            10  9   8  7          0
 ┌─────────┬────────┬───────────────┬───────┬────────────┐
 │  magic  │n_minus6│      cw       │  typ  │     cc     │
 │  5 bits │ 4 bits │   13 bits     │ 2 bits│  8 bits    │
 └─────────┴────────┴───────────────┴───────┴────────────┘
   = 0x1F   lumpSize  code-word cnt   type    c-list cnt
              = 2^(n+6)
```

| Field     | Bits    | Meaning |
|:----------|:--------|:--------|
| magic     | [31:27] | Must be `0x1F`.  CPU traps if fetched. |
| n_minus_6 | [26:23] | `lumpSize = 2^(n_minus_6 + 6)`.  `0` → 64 words (`SLOT_SIZE`). |
| cw        | [22:10] | Code-word count (0–8191).  Instructions at `lumpBase+1` … `lumpBase+cw`. For Thread-type lumps, see §4.3. |
| typ       | [9:8]   | Object type: `00`=lump, `01`=data, `10`=Thread, `11`=Outform |
| cc        | [7:0]   | C-list slot count.  C-list at `lumpBase + lumpSize − cc` … `lumpBase + lumpSize − 1`. |

---

## 4. Key Lump Layouts

### 4.1 NS root lump — Slot 0, Boot.NS (base `0x0000`)

The NS root lump occupies the first 64 words of memory (`0x0000–0x003F`).
`memory[0x0000] = 0x00000000` (magic ≠ 0x1F — no standard lump header).
This is by design: the NS root lump is a descriptor region, not a code or
data lump.  Its NS entry uses `limit = totalNamespaceWords − 1 = 16383`.

### 4.2 Free/null — Slot 2 (`0x0140`–`0x017F`) *(Task #247)*

Slot 2 is a free/null NS entry.  The Boot.Abstr director that previously
occupied this range has been eliminated.  The 64 words at `0x0140`–`0x017F`
are available to the heap allocator; the NS entry for slot 2 is all-zero
(no valid lump header, no c-list).

### 4.3 Thread lump — Slot 1, Boot.Thread (base `0x0040`)

256-word lump.  Header: `0xF9008240` — `magic=0x1F`, `n_minus_6=2` → 256w,
`cw=32`, `typ=2` (Thread), `cc=64`.

| Offset from base | Word address    | Words | Zone |
|:-----------------|:----------------|------:|:-----|
| +0               | `0x0040`        |     1 | **Header** (`0xF9008240`) |
| +1 … +16         | `0x0041–0x0050` |    16 | **DR zone** — home locations for DR0–DR15 |
| +17 … +32        | `0x0051–0x0060` |    16 | **Heap zone** (`cw=32` marks end of data zone) |
| +33 … +191       | `0x0061–0x00BF` |   159 | Free space |
| +192 … +255      | `0x00C0–0x00FF` |    64 | **Protected zone** (`lumpSize − cc = 192` is c-list base; `cc=64`) |
| +212 … +243      | `0x00D4–0x00F3` |    32 | **Stack** (grows down; STO starts at 243) |
| +244 … +255      | `0x00F4–0x00FF` |    12 | **Caps zone** — GT home slots for CR0–CR11 |

**Thread lump `cw` and `cc` semantics (typ=2):**

For Thread-type lumps `cw` does not count code words.  It marks the end of the
data zone.  The hardware uses:

```
sp_min = lumpSize − cc − cw + 2 = 256 − 64 − 32 + 2 = 162
sp_max = THREAD_CAPS_OFFSET − 1  = 243
```

**DR zone and caps zone at boot:** All 28 words (`+1…+16` and `+244…+255`) are
`0x00000000` at boot (DRs initialized to zero; CRs 0–11 null).

**Stack sentinel words at boot:**

| Offset | Value        | Meaning |
|-------:|:-------------|:--------|
| +242   | `0x40800003` | Saved CR15 in sentinel frame (E-GT for slot 3 Boot.Abstr) |
| +243   | `0x0FFFF0F3` | CALL sentinel frame word (guard value; a stray RETURN reboots) |

### 4.4 Boot.Abstr lump — Slot 3 (base `0x0180`)

Header: `0xF9004411` — `n_minus_6=2` → 256w, `cw=17`, `typ=0` (lump), `cc=17`.

```
 0x0180   Header: 0xF9004411
 0x0181–0x0191  Code zone (cw=17 words)       ← §8.3 full listing
 0x0192–0x026E  Free space (222 words)
 0x026F–0x027F  C-list (cc=17 entries)         ← §8.4 full listing
```

---

## 5. IO Device Register Windows

Device register windows are defined by NS entry locations, not by the NS
table itself.  Lump slots 11–14 carry device MMIO windows at the lump
addresses recorded in their NS entries (see §2.2), which sit in the normal
lump area starting from address 0.  In both the 65 536-word and 16 384-word
configurations, device registers are at the **same absolute word addresses**
(`0x0440`, `0x0480`, `0x04C0`, `0x0500`), deep below the NS table region.

The simulator intercepts reads and writes to `[location … location + limit]`
for these slots and routes them to device emulation.

### Absolute MMIO register addresses (derived from NS entry locations)

| Slot | Device | Word addr | Mnemonic | Description |
|-----:|:-------|:---------:|:---------|:------------|
|  11  | UART   | `0x0440`  | TX       | Write byte to transmit |
|  11  | UART   | `0x0441`  | STATUS   | Bit[0]=tx-ready, Bit[1]=rx-ready |
|  11  | UART   | `0x0442`  | RX       | Read received byte |
|  12  | LED    | `0x0480`  | LED0     | LED 0 state (bit[0]=pin) |
|  12  | LED    | `0x0481`  | LED1     | LED 1 state |
|  12  | LED    | `0x0482`  | LED2     | LED 2 state |
|  12  | LED    | `0x0483`  | LED3     | LED 3 state |
|  12  | LED    | `0x0484`  | LED4     | LED 4 state |
|  12  | LED    | `0x0485`  | LED5     | LED 5 state |
|  13  | Button | `0x04C0`  | BUTTON_STATE | Button bitmask (read-only) |
|  14  | Timer  | `0x0500`  | TICKS_LO | Low 32 bits of tick counter |
|  14  | Timer  | `0x0501`  | TICKS_HI | High 32 bits of tick counter |
|  14  | Timer  | `0x0502`  | TOD_EPOCH | Time-of-day epoch |
|  14  | Timer  | `0x0503`  | ALARM_CMP | Alarm compare register |
|  14  | Timer  | `0x0504`  | CTL       | Timer control (bit[0]=enable) |

---

## 6. Address Conflict Table

For every NS slot with a non-zero location the word range
`[location, location + allocSize − 1]` is computed and compared against every
other such range plus the fixed NS table and format-tag regions.
Slot 0 (Boot.NS, location=0) is excluded (ABSENT).

**No conflicts detected in the 16 384-word profile.**

Per-slot interval listing (sorted by start address, 16 384-word profile):

| Slot | Name         | Start    | End      | Words |
|-----:|:-------------|:--------:|:--------:|------:|
|   1  | Boot.Thread  | `0x0040` | `0x013F` |   256 |
|   2  | (free/null)  | `0x0140` | `0x017F` |    64 | *(Task #247 — heap-available)* |
|   3  | Boot.Abstr   | `0x0180` | `0x027F` |   256 |
|   4  | Salvation    | `0x0280` | `0x02BF` |    64 |
|   5  | Navana       | `0x02C0` | `0x02FF` |    64 |
|   6  | Mint         | `0x0300` | `0x033F` |    64 |
|   7  | Memory       | `0x0340` | `0x037F` |    64 |
|   8  | Scheduler    | `0x0380` | `0x03BF` |    64 |
|   9  | Stack        | `0x03C0` | `0x03FF` |    64 |
|  10  | DijkstraFlag | `0x0400` | `0x043F` |    64 |
|  11  | UART         | `0x0440` | `0x047F` |    64 |
|  12  | LED          | `0x0480` | `0x04BF` |    64 |
|  13  | Button       | `0x04C0` | `0x04FF` |    64 |
|  14  | Timer        | `0x0500` | `0x053F` |    64 |
|  15  | Display      | `0x0540` | `0x057F` |    64 |
|  16  | SlideRule    | `0x0580` | `0x05BF` |    64 |
|  17  | Abacus       | `0x05C0` | `0x05FF` |    64 |
|  18  | Constants    | `0x0600` | `0x063F` |    64 |
|  19  | Loader       | `0x0640` | `0x067F` |    64 |
|  20  | SUCC         | `0x0680` | `0x06BF` |    64 |
|  21  | PRED         | `0x06C0` | `0x06FF` |    64 |
|  22  | ADD          | `0x0700` | `0x073F` |    64 |
|  23  | SUB          | `0x0740` | `0x077F` |    64 |
|  24  | MUL          | `0x0780` | `0x07BF` |    64 |
|  25  | ISZERO       | `0x07C0` | `0x07FF` |    64 |
|  26  | TRUE         | `0x0800` | `0x083F` |    64 |
|  27  | FALSE        | `0x0840` | `0x087F` |    64 |
|  28  | Family       | `0x0880` | `0x08BF` |    64 |
|  29  | Schoolroom   | `0x08C0` | `0x08FF` |    64 |
|  30  | Friends      | `0x0900` | `0x093F` |    64 |
|  31  | Tunnel       | `0x0940` | `0x097F` |    64 |
|  32  | Negotiate    | `0x0980` | `0x09BF` |    64 |
|  33  | Editor       | `0x09C0` | `0x09FF` |    64 |
|  34  | Assembler    | `0x0A00` | `0x0A3F` |    64 |
|  35  | Debugger     | `0x0A40` | `0x0A7F` |    64 |
|  36  | Deployer     | `0x0A80` | `0x0ABF` |    64 |
|  37  | Browser      | `0x0AC0` | `0x0AFF` |    64 |
|  38  | Messenger    | `0x0B00` | `0x0B3F` |    64 |
|  39  | Photos       | `0x0B40` | `0x0B7F` |    64 |
|  40  | Social       | `0x0B80` | `0x0BBF` |    64 |
|  41  | Video        | `0x0BC0` | `0x0BFF` |    64 |
|  42  | Email        | `0x0C00` | `0x0C3F` |    64 |
|  43  | PAIR         | `0x0C40` | `0x0C7F` |    64 |
|  44  | GC           | `0x0C80` | `0x0CBF` |    64 |
|  45  | Thread       | `0x0CC0` | `0x0CFF` |    64 |
|  46  | Circle       | `0x0D00` | `0x0D3F` |    64 |
| —    | Format tag   | `0x3CFF` | `0x3CFF` |     1 |
| —    | NS table     | `0x3D00` | `0x3FFF` |   768 |

---

## 7. Lump Header Validity Table

For each NS slot: `parseLumpHeader(memory[location])` is applied.
Status taxonomy:

- **VALID** — magic=0x1F; lumpSize and fields are consistent
- **INVALID** — bad magic or out-of-range fields; reason stated
- **ABSENT** — location=0 or slot is empty (no header to check)

| Slot | Name         | Hdr word     | Status      | lumpSize | cw | cc | typ | Notes |
|-----:|:-------------|:-------------|:------------|:--------:|---:|---:|----:|:------|
|   0  | Boot.NS      | —            | **ABSENT**  | —        |  — |  — |  —  | location=0; NS root; no standard lump header by design |
|   1  | Boot.Thread  | `0xF9008240` | **VALID**   | 256      | 32 | 64 |  2  | Thread-type; cw = data-zone size, not code count |
|   2  | (free/null)  | `0x00000000` | **ABSENT**  |  —       |  — |  — |  —  | Free slot; no lump written (Task #247) |
|   3  | Boot.Abstr   | `0xF9004411` | **VALID**   | 256      | 17 | 17 |  0  | Boot ROM; 13 live instructions |
|   4  | Salvation    | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|   5  | Navana       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|   6  | Mint         | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|   7  | Memory       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|   8  | Scheduler    | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|   9  | Stack        | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  10  | DijkstraFlag | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  11  | UART         | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; MMIO window (no lump header) |
|  12  | LED          | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; MMIO window (no lump header) |
|  13  | Button       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; MMIO window (no lump header) |
|  14  | Timer        | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; MMIO window (no lump header) |
|  15  | Display      | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  16  | SlideRule    | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  17  | Abacus       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  18  | Constants    | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  19  | Loader       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  20  | SUCC         | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  21  | PRED         | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  22  | ADD          | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  23  | SUB          | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  24  | MUL          | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  25  | ISZERO       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  26  | TRUE         | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  27  | FALSE        | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  28  | Family       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  29  | Schoolroom   | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  30  | Friends      | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  31  | Tunnel       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  32  | Negotiate    | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  33  | Editor       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  34  | Assembler    | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  35  | Debugger     | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  36  | Deployer     | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  37  | Browser      | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  38  | Messenger    | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  39  | Photos       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  40  | Social       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  41  | Video        | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  42  | Email        | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  43  | PAIR         | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  44  | GC           | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  45  | Thread       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |
|  46  | Circle       | `0x00000000` | **INVALID** | —        |  — |  — |  —  | magic=0x0; lump body not yet loaded |

---

## 8. Code Word Decompilation Tables

### 8.1 Slot 1 — Boot.Thread (base `0x0040`, cw=32)

Words `+1`…`+32` are the **data zone** (DR + heap), not executable code.
All 32 words are `0x00000000` at boot.  The cw=32 header field marks the
end of the data zone for hardware stack-boundary computation; the CPU never
fetches instructions from here.

| Offset | Addr    | Hex word   | Mnemonic              | Purpose |
|-------:|:--------|:-----------|:----------------------|:--------|
| +1     | `0x0041`| `00000000` | HALT (empty/zero)     | DR0 home slot |
| +2     | `0x0042`| `00000000` | HALT (empty/zero)     | DR1 home slot |
| +3     | `0x0043`| `00000000` | HALT (empty/zero)     | DR2 home slot |
| +4     | `0x0044`| `00000000` | HALT (empty/zero)     | DR3 home slot |
| +5     | `0x0045`| `00000000` | HALT (empty/zero)     | DR4 home slot |
| +6     | `0x0046`| `00000000` | HALT (empty/zero)     | DR5 home slot |
| +7     | `0x0047`| `00000000` | HALT (empty/zero)     | DR6 home slot |
| +8     | `0x0048`| `00000000` | HALT (empty/zero)     | DR7 home slot |
| +9     | `0x0049`| `00000000` | HALT (empty/zero)     | DR8 home slot |
| +10    | `0x004A`| `00000000` | HALT (empty/zero)     | DR9 home slot |
| +11    | `0x004B`| `00000000` | HALT (empty/zero)     | DR10 home slot |
| +12    | `0x004C`| `00000000` | HALT (empty/zero)     | DR11 home slot |
| +13    | `0x004D`| `00000000` | HALT (empty/zero)     | DR12 home slot |
| +14    | `0x004E`| `00000000` | HALT (empty/zero)     | DR13 home slot |
| +15    | `0x004F`| `00000000` | HALT (empty/zero)     | DR14 home slot |
| +16    | `0x0050`| `00000000` | HALT (empty/zero)     | DR15 home slot |
| +17    | `0x0051`| `00000000` | HALT (empty/zero)     | Heap slot 0 |
| +18    | `0x0052`| `00000000` | HALT (empty/zero)     | Heap slot 1 |
| +19    | `0x0053`| `00000000` | HALT (empty/zero)     | Heap slot 2 |
| +20    | `0x0054`| `00000000` | HALT (empty/zero)     | Heap slot 3 |
| +21    | `0x0055`| `00000000` | HALT (empty/zero)     | Heap slot 4 |
| +22    | `0x0056`| `00000000` | HALT (empty/zero)     | Heap slot 5 |
| +23    | `0x0057`| `00000000` | HALT (empty/zero)     | Heap slot 6 |
| +24    | `0x0058`| `00000000` | HALT (empty/zero)     | Heap slot 7 |
| +25    | `0x0059`| `00000000` | HALT (empty/zero)     | Heap slot 8 |
| +26    | `0x005A`| `00000000` | HALT (empty/zero)     | Heap slot 9 |
| +27    | `0x005B`| `00000000` | HALT (empty/zero)     | Heap slot 10 |
| +28    | `0x005C`| `00000000` | HALT (empty/zero)     | Heap slot 11 |
| +29    | `0x005D`| `00000000` | HALT (empty/zero)     | Heap slot 12 |
| +30    | `0x005E`| `00000000` | HALT (empty/zero)     | Heap slot 13 |
| +31    | `0x005F`| `00000000` | HALT (empty/zero)     | Heap slot 14 |
| +32    | `0x0060`| `00000000` | HALT (empty/zero)     | Heap slot 15 |

### 8.2 Slot 2 — free/null (Task #247)

No lump written.  The Boot.Abstr director indirection has been eliminated.
The 64 words at `0x0140`–`0x017F` are free heap space.  The NS entry for
slot 2 is all-zeros.  B:03 INIT_ABSTR loads Boot.Abstr (slot 3)
directly; B:04 LOAD_NUC no longer performs a director hop.

### 8.3 Slot 3 — Boot.Abstr (base `0x0180`, cw=17)

13 live instructions followed by 4 empty (word=0) slots.

| Offset | Addr    | Hex word   | Disassembly | Notes |
|-------:|:--------|:-----------|:------------|:------|
| +1     | `0x0181`| `27660001` | `CHANGE  CR12, CR12[0x0001]` | Set DR0 = boot sentinel |
| +2     | `0x0182`| `070B0000` | `LOAD  CR1, CR6[0x0000]` | CR1 ← NS root GT |
| +3     | `0x0183`| `07130001` | `LOAD  CR2, CR6[0x0001]` | CR2 ← Boot.Thread GT |
| +4     | `0x0184`| `37100003` | `TPERM  CR2, X` | Restrict to execute |
| +5     | `0x0185`| `3F100000` | `LAMBDA  CR2` | Push LAMBDA frame (entry indirection) |
| +6     | `0x0186`| `07030004` | `LOAD  CR0, CR6[0x0004]` | CR0 ← Salvation GT |
| +7     | `0x0187`| `37000008` | `TPERM  CR0, E` | Restrict to invoke-only |
| +8     | `0x0188`| `17000000` | `CALL  CR0` | Enter Salvation |
| +9     | `0x0189`| `073B0001` | `LOAD  CR7, CR6[0x0001]` | Reload Boot.Thread on return |
| +10    | `0x018A`| `37380003` | `TPERM  CR7, X` | Restrict |
| +11    | `0x018B`| `3F380000` | `LAMBDA  CR7` | LAMBDA frame for post-boot |
| +12    | `0x018C`| `1F028000` | `RETURN` | Return from boot entry |
| +13    | `0x018D`| `0F308002` | `SAVE  CR6, CR1[0x0002]` | Unreachable after RETURN |
| +14    | `0x018E`| `00000000` | HALT (empty/zero) | empty |
| +15    | `0x018F`| `00000000` | HALT (empty/zero) | empty |
| +16    | `0x0190`| `00000000` | HALT (empty/zero) | empty |
| +17    | `0x0191`| `00000000` | HALT (empty/zero) | empty |

### 8.4 Boot.Abstr c-list (base `0x026F`, cc=17)

| Index | Addr    | GT word      | Slot | Perms | Name |
|------:|:--------|:-------------|-----:|:------|:-----|
|  0    | `0x026F`| `0x06800000` |   0  | RW    | Boot.NS |
|  1    | `0x0270`| `0x00800001` |   1  | —     | Boot.Thread |
|  2    | `0x0271`| `0x00000000` |   —  | —     | *(free/null — Task #247)* |
|  3    | `0x0272`| `0x40800003` |   3  | E     | Boot.Abstr (self) |
|  4    | `0x0273`| `0x40800004` |   4  | E     | Salvation |
|  5    | `0x0274`| `0x40800005` |   5  | E     | Navana |
|  6    | `0x0275`| `0x40800006` |   6  | E     | Mint |
|  7    | `0x0276`| `0x40800007` |   7  | E     | Memory |
|  8    | `0x0277`| `0x0680000C` |  12  | RW    | LED (channel 0) |
|  9    | `0x0278`| `0x0680000C` |  12  | RW    | LED (channel 1) |
| 10    | `0x0279`| `0x0680000C` |  12  | RW    | LED (channel 2) |
| 11    | `0x027A`| `0x0680000C` |  12  | RW    | LED (channel 3) |
| 12    | `0x027B`| `0x0680000C` |  12  | RW    | LED (channel 4) |
| 13    | `0x027C`| `0x0680000C` |  12  | RW    | LED (channel 5) |
| 14    | `0x027D`| `0x0680000B` |  11  | RW    | UART |
| 15    | `0x027E`| `0x0280000D` |  13  | R     | Button |
| 16    | `0x027F`| `0x0680000E` |  14  | RW    | Timer |

---

## 9. Capability Register (CR) State After Boot

| CR   | GT word      | Slot | Perms | word1 (location) | word2 (limit word) | m | Role |
|-----:|:-------------|-----:|:------|:-----------------|:-------------------|:-:|:-----|
| CR6  | `0x40800003` |   3  | E     | `0x0000026F`     | `0x04000010`       | 1 | C-list root → Boot.Abstr c-list base |
| CR12 | `0x00800001` |   1  | —     | `0x00000040`     | `0x040000FF`       | 1 | Thread stack (privileged, system-wide) |
| CR14 | `0x0A800003` |   3  | RX    | `0x00000180`     | `0x04000010`       | 1 | Code fence (privileged) |
| CR15 | `0x00800000` |   0  | —     | `0x00000000`     | `0x045E3FFF`       | 1 | NS root (privileged) |

CRs 0–5, 7–11, 13 are null after boot.

---

## 10. Simulator State Classification

### 10.1 State backed by `memory[]`

These are the only authoritative CM state sources:

| Memory range | Content |
|:-------------|:--------|
| `memory[0 … NS_TABLE_BASE−2]` | All object lumps |
| `memory[NS_TABLE_BASE−1]` | Boot-image format tag (`0xB0070229`) |
| `memory[NS_TABLE_BASE … NS_TABLE_BASE + NS_TABLE_RESERVE − 1]` | NS table (256 × 3 words) |

### 10.2 Legitimate hardware registers (not in DMEM by design)

| Property | Description |
|:---------|:------------|
| `this.pc` | Program counter — hardware pipeline register |
| `this.physicalPC` | Resolved physical PC (pc + code base) |
| `this.sto` | Stack Top Offset — hardware stack pointer register |
| `this.flags` | Condition flags (N, Z, C, V) — hardware register file |
| `this.running / this.halted` | Execution state machine |
| `this.mElevation` | M-bit elevation — transient hardware signal |
| `this.lambdaActive / lambdaReturnPC / lambdaCachedFrame` | LAMBDA micro-instruction transient state |

### 10.3 Gaps — state not in `memory[]` (Step 2 targets)

#### Gap 1: Data Registers (`this.dr[0..15]`)

**Specification:** Thread lump offsets +1…+16 are defined as the DR zone.
DR0 is at `threadBase+1`, DR15 at `threadBase+16`.

**Current reality:** `this.dr[]` is a plain JavaScript array.  DREAD and DWRITE
read and write `this.dr[n]` directly.  They do **not** touch
`memory[threadBase + 1 + n]`.

**Consequence:** After any DWRITE instruction `this.dr[n]` is updated but
`memory[threadBase + 1 + n]` is not.  Any code reading the thread lump from
`memory[]` sees stale zeros in the DR zone.

**Expected fix (Step 2):** DREAD/DWRITE must read/write
`memory[this.cr[12].word1 + 1 + n]` and keep `this.dr[]` as a write-through
cache or eliminate it entirely.

#### Gap 2: CR word1 / word2 / word3 vs NS table

**Specification:** Each CR's limit and seal should equal the NS table entry for
the GT's slot index.  Ground truth: `memory[NS_TABLE_BASE + slot × 3 + 1]`
and `memory[NS_TABLE_BASE + slot × 3 + 2]`.

**Current reality:** At CALL time the CALL microcode packs `cw − 1` into
`cr[14].word2` and `cc − 1` into `cr[6].word2`, rather than copying the NS
entry's word1.

**Concrete numbers (Boot.Abstr, slot 3):**

| Source | Value | limit field | Encoding |
|:-------|:------|------------:|:---------|
| NS entry word1 (`memory[NS_TABLE_BASE + 9 + 1]`) | `0x242200EE` | 238 | lumpSize − cc − 1 = 256 − 17 − 1 |
| `cr[14].word2` (after CALL)                       | `0x04000010` |  16 | cw − 1 = 17 − 1 |
| `cr[6].word2` (c-list root)                       | `0x04000010` |  16 | cc − 1 = 17 − 1 |

Neither CR word2 matches the NS entry.  The NS entry is the ground truth.

**Expected fix (Step 2):** `_writeCR` and `getFormattedCR` should derive
word1/word2/word3 from `readNSEntry(slot)` on demand rather than caching a
CALL-time computation.

### 10.4 IDE-only metadata (correctly outside `memory[]`)

| Property | Role |
|:---------|:-----|
| `this.nsLabels` | Symbolic slot names — display only |
| `this.nsClistMap` | Cached c-list relationships — display only |
| `this.nsHandlers` | Abstraction dispatch handlers — simulation aid |
| `this.bootStep / bootComplete` | Boot state machine step — simulator control |
| `this.gcPolarity` | GC G-bit polarity — GC internal |
| `this.ledBits / ledMode` | LED display cache — UI aid |
| `this.callStack[]` | JS mirror of call frames — shadow; truth is thread lump stack in memory |
| `this.output / faultLog / auditLog` | Debug and audit logs — IDE trace |
| `this._instrHistory` | Instruction trace ring — IDE display |
| `this.stepCount` | Instruction counter — telemetry |
| `this.lastSignedReturn / lastCapability` | Display caches |
| `this.lazyManifest / _loaderSlot / awaitingLump` | Lazy loader state — IDE loader |
| `this.nsCount` | NS entry count — derived from NS table scan; redundant with memory |

---

## 11. Summary of Findings

| Finding | Status | Section |
|:--------|:-------|:--------|
| **65 536-word NS table comment** — `simulator.js` lines 15–19 show an outdated layout where NS table was 256 words and IO/Boot ROM had separate regions.  With `NS_TABLE_RESERVE = 0x300`, the NS table is 768 words (0xFD00–0xFFFF in 65 536-word space). | Stale comment | §1.1 |
| **NS word1 bit comment** — `simulator.js` lines 24–28 have B and G flags described in wrong bit positions.  The code (`packNSWord1` / `parseNSWord1`) is correct. | Stale comment | §2.1 |
| **Slot 0 Boot.NS** — `memory[0x0000]=0x00000000`, ABSENT (no standard lump header by design) | Expected | §7 |
| **Slots 4–46** — all 43 lazy lumps INVALID (magic=0x0); body not yet loaded | Expected | §7 |
| **No address conflicts** — all 46 allocated intervals are disjoint | Clean | §6 |
| **Gap 1 — DR registers** — DREAD/DWRITE do not sync `memory[threadBase+1..+16]` | **Bug → Task #242** | §10.3 |
| **Gap 2 — CR limit words** — CR14.word2 limit=16 (cw−1) ≠ NS entry limit=238 (lumpSize−cc−1) | **Bug → Task #242** | §10.3 |

---

*Generated from: `tests/ctmm_map_dump.js` driven against `simulator/simulator.js` +
`simulator/assembler.js`.*
*Config: `totalNamespaceWords=16384`, `threadLumpWords=256`,
`abstractionLumpWords=256`, `namespaceLumpWords=64`.*
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
