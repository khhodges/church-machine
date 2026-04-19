# CTMM Memory Map — Authoritative Reference

> **Principle:** The CTMM is defined by the memory, always, no more and no less.
> The simulator must follow the memory, no more and no less.

All values in this document are computed from a live simulator run with the
standard 16 384-word boot configuration.  The companion script
`tests/ctmm_map_dump.js` reproduces every table here.

---

## 1. Top-Level Memory Regions

The simulator's `memory[]` is a flat `Uint32Array` of 32-bit words.
All addresses are **word addresses** (multiply by 4 for byte offset).

### Standard 16 384-word configuration (default IDE project)

| Start (word) | End (word)  | Words | Region |
|:-------------|:------------|------:|:-------|
| `0x0000`     | `0x0D3F`    | 3 392 | **Lump area — occupied** (47 active NS slots, see §3) |
| `0x0D40`     | `0x3CFE`    | 12 223| **Lump area — free** (unallocated heap space) |
| `0x3CFF`     | `0x3CFF`    | 1     | **Format tag word** (`0xB0070229`) — boot-image version sentinel |
| `0x3D00`     | `0x3FFF`    | 768   | **NS table** (up to 256 × 3-word entries) |

`NS_TABLE_BASE = totalNamespaceWords − NS_TABLE_RESERVE = 16384 − 768 = 0x3D00`

### Historical 65 536-word configuration (no saved bootConfig)

When no `window.bootConfig` is present the simulator falls back to 65 536 words:

| Start (word) | End (word)  | Region |
|:-------------|:------------|:-------|
| `0x0000`     | `0xFCFE`    | Lump area |
| `0xFCFF`     | `0xFCFF`    | Format tag word |
| `0xFD00`     | `0xFDFF`    | NS table (`NS_TABLE_BASE = 0xFD00`) |
| `0xFE00`     | `0xFEFF`    | IO segment — memory-mapped device registers |
| `0xFF00`     | `0xFFFF`    | Boot ROM shadow (written by `_bootStep()`) |

> In the 16 384-word window the IO segment and Boot ROM shadow do not exist as
> separate regions.  Device register windows are embedded in the lump area at
> the word addresses given in the NS table (§3).

---

## 2. Namespace (NS) Table

Base address: `NS_TABLE_BASE` (= `0x3D00` for 16 384-word memory).
Each entry occupies exactly **3 consecutive words**.  Entry `i` starts at
`NS_TABLE_BASE + i × 3`.

### 2.1 NS entry word layout

**Word 0 — location**

| Bits   | Field    | Description |
|:-------|:---------|:------------|
| [31:0] | location | Base word address of the lump in `memory[]`.  For an IO device this is the word address of its first MMIO register. |

**Word 1 — limit / metadata**

Field positions are taken from `packNSWord1` / `parseNSWord1`:

| Bits    | Field      | Description |
|:--------|:-----------|:------------|
| [31]    | B-flag     | Bounds-check flag (set by the allocator) |
| [30]    | F-flag     | Far-call flag |
| [29]    | G-bit      | GC liveness bit (flipped by GC; 1 = live in standard polarity) |
| [28]    | chainable  | Capability chaining allowed |
| [27:26] | gtType     | Golden Token type: `00`=Null `01`=Inform `10`=Outform `11`=Abstract |
| [25:17] | clistCount | Number of c-list slots in this lump's c-list (9 bits, 0–511) |
| [16:0]  | limit      | Addressable limit in words from the lump base.  For a regular lump: `lumpSize − cc − 1`.  For an NS-entry-derived CR word2 it may be `cw − 1` or `cc − 1` (see §8). |

**Word 2 — seals**

| Bits    | Field   | Description |
|:--------|:--------|:------------|
| [31:25] | version | GT version counter (7 bits); bumped each time the entry is re-used |
| [24:16] | —       | Reserved (zero) |
| [15:0]  | seal    | CRC-16 over (location, limit) — integrity check |

### 2.2 All NS entries (47 active at boot)

Config: `totalNamespaceWords=16384`, `threadLumpWords=256`, `abstractionLumpWords=256`,
`namespaceLumpWords=64`.

| Slot | Name         | W0 location | W1 (hex)   | limit | clistCount | gtType  | G |
|-----:|:-------------|:------------|:-----------|------:|-----------:|:--------|:-:|
|  0   | Boot.NS      | `0x00000000`| `0x245E3FFF` | 16383 |  47 | Inform | 1 |
|  1   | Boot.Thread  | `0x00000040`| `0x242200FF` |   255 |   0 | Inform | 1 |
|  2   | Boot.Abstr   | `0x00000140`| `0x2422003B` |    59 |   4 | Inform | 1 |
|  3   | Boot.Entry   | `0x00000180`| `0x242200EE` |   238 |  17 | Inform | 1 |
|  4   | Salvation    | `0x00000280`| `0x2422003F` |    63 |   0 | Inform | 1 |
|  5   | Navana       | `0x000002C0`| `0x2422003F` |    63 |   0 | Inform | 1 |
|  6   | Mint         | `0x00000300`| `0x2422003F` |    63 |   0 | Inform | 1 |
|  7   | Memory       | `0x00000340`| `0x2422003F` |    63 |   0 | Inform | 1 |
|  8   | Scheduler    | `0x00000380`| `0x2422003F` |    63 |   0 | Inform | 1 |
|  9   | Stack        | `0x000003C0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 10   | DijkstraFlag | `0x00000400`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 11   | UART         | `0x00000440`| `0x24220002` |     2 |   0 | Inform | 1 |
| 12   | LED          | `0x00000480`| `0x24220005` |     5 |   0 | Inform | 1 |
| 13   | Button       | `0x000004C0`| `0x24220000` |     0 |   0 | Inform | 1 |
| 14   | Timer        | `0x00000500`| `0x24220004` |     4 |   0 | Inform | 1 |
| 15   | Display      | `0x00000540`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 16   | SlideRule    | `0x00000580`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 17   | Abacus       | `0x000005C0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 18   | Constants    | `0x00000600`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 19   | Loader       | `0x00000640`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 20   | SUCC         | `0x00000680`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 21   | PRED         | `0x000006C0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 22   | ADD          | `0x00000700`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 23   | SUB          | `0x00000740`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 24   | MUL          | `0x00000780`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 25   | ISZERO       | `0x000007C0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 26   | TRUE         | `0x00000800`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 27   | FALSE        | `0x00000840`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 28   | Family       | `0x00000880`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 29   | Schoolroom   | `0x000008C0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 30   | Friends      | `0x00000900`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 31   | Tunnel       | `0x00000940`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 32   | Negotiate    | `0x00000980`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 33   | Editor       | `0x000009C0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 34   | Assembler    | `0x00000A00`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 35   | Debugger     | `0x00000A40`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 36   | Deployer     | `0x00000A80`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 37   | Browser      | `0x00000AC0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 38   | Messenger    | `0x00000B00`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 39   | Photos       | `0x00000B40`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 40   | Social       | `0x00000B80`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 41   | Video        | `0x00000BC0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 42   | Email        | `0x00000C00`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 43   | PAIR         | `0x00000C40`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 44   | GC           | `0x00000C80`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 45   | Thread       | `0x00000CC0`| `0x2422003F` |    63 |   0 | Inform | 1 |
| 46   | Circle       | `0x00000D00`| `0x2422003F` |    63 |   0 | Inform | 1 |

**Device register windows (slots 11–14)** are MMIO.  The simulator intercepts
reads/writes to their `memory[]` addresses and routes them to device emulation.
In the 16 384-word configuration these addresses fall inside the lump area;
there is no separate IO segment.

| Slot | Name   | Base word addr | Registers (words) | limit |
|-----:|:-------|:---------------|:------------------|------:|
| 11   | UART   | `0x0440`       | TX@+0, STATUS@+1, RX@+2 | 2 |
| 12   | LED    | `0x0480`       | LED0–LED5 (one word per LED; bit[0]=pin) | 5 |
| 13   | Button | `0x04C0`       | BUTTON_STATE@+0 (bitmask) | 0 |
| 14   | Timer  | `0x0500`       | TICKS_LO@+0, TICKS_HI@+1, TOD_EPOCH@+2, ALARM_CMP@+3, CTL@+4 | 4 |

---

## 3. Lump Header Format

Word 0 of every object lump carries the lump header (magic `0x1F` in bits [31:27]).

```
 31      27 26    23 22            10  9   8  7          0
 ┌─────────┬────────┬───────────────┬───────┬────────────┐
 │  magic  │n_minus6│      cw       │  typ  │     cc     │
 │  5 bits │ 4 bits │   13 bits     │ 2 bits│  8 bits    │
 └─────────┴────────┴───────────────┴───────┴────────────┘
  = 0x1F    lumpSize  code word cnt  object   c-list cnt
             = 2^(n+6)               type
```

| Field    | Bits    | Meaning |
|:---------|:--------|:--------|
| magic    | [31:27] | Must be `0x1F` (= 31).  The CPU traps if PC lands on a header word. |
| n_minus_6| [26:23] | Slot allocation: `lumpSize = 2^(n_minus_6 + 6)`.  `0` → 64 words (minimum slot = `SLOT_SIZE`). |
| cw       | [22:10] | Code word count (0–8191).  Instructions are at `lumpBase+1` … `lumpBase+cw`. For a Thread-type lump this encodes the size of the data zone; see §4.3. |
| typ      | [9:8]   | Object type: `00`=lump, `01`=data, `10`=Thread, `11`=Outform |
| cc       | [7:0]   | C-list slot count (0–255).  C-list occupies `lumpBase + (lumpSize − cc)` … `lumpBase + lumpSize − 1`. |

**Constraint:** `lumpSize = 2^(n_minus_6 + 6)` must be a power of 2, minimum 64 words.

---

## 4. Key Lump Layouts

### 4.1 NS root lump — Slot 0, Boot.NS (base `0x0000`)

The NS root lump occupies the first 64 words of memory (`0x0000–0x003F`).
It carries **no standard lump header** — `memory[0x0000] = 0x00000000` (magic ≠ 0x1F).
The lump is the descriptor for the entire namespace and has no code or c-list
words of its own.  Its NS entry encodes the full namespace size as the limit
(`limit = 16383 = totalNamespaceWords − 1`).

### 4.2 Boot.Abstr director — Slot 2 (base `0x0140`)

A pure-director lump: `cw = 0` (no code), `cc = 4` (four c-list entries).

```
 0x0140  Header: 0xF8000004  (magic=0x1F, n_minus_6=0→64w, cw=0, typ=0, cc=4)
 0x0141–0x017B  Free space (60 words)
 0x017C  C-list[0] = 0x06800000  → slot 0 Boot.NS   [RW]
 0x017D  C-list[1] = 0x00800001  → slot 1 Boot.Thread  [ ]
 0x017E  C-list[2] = 0x40800002  → slot 2 Boot.Abstr   [E]  (self-reference)
 0x017F  C-list[3] = 0x40800003  → slot 3 Boot.Entry   [E]
```

### 4.3 Thread lump — Slot 1, Boot.Thread (base `0x0040`)

256-word lump.  Header: `0xF9008240`.

```
 Decoded: magic=0x1F  n_minus_6=2→256w  cw=32  typ=2(Thread)  cc=64
```

| Offset from base | Word address  | Words | Zone |
|:-----------------|:--------------|------:|:-----|
| +0               | `0x0040`      | 1     | **Header** (`0xF9008240`) |
| +1 … +16         | `0x0041–0x0050` | 16  | **DR zone** — home locations for DR0–DR15 |
| +17 … +32        | `0x0051–0x0060` | 16  | **Heap zone** (initial allocation; cw=32 marks end of data zone) |
| +33 … +191       | `0x0061–0x00EF` | 159 | Free space |
| +192 … +243      | `0x00F0–0x012B` | 52  | **Protected zone** (within cc=64 region: lumpSize−cc=192) |
| +192 … +211      | `0x00F0–0x0103` | 20  | Stack guard / frame buffer |
| +212 … +243      | `0x0104–0x012B` | 32  | **Stack** (grows down; STO starts at 243) |
| +244 … +255      | `0x012C–0x0137` | 12  | **Caps zone** — GT home slots for CR0–CR11 |

**Thread lump header field interpretation (typ=2):**

For Thread-type lumps the `cw` field does not count code words; it marks the
end of the data zone (DR zone + heap).  The hardware formula for the stack's
minimum STO (stack top offset) is:

```
sp_min = lumpSize − cc − cw + 2 = 256 − 64 − 32 + 2 = 162
sp_max = THREAD_CAPS_OFFSET − 1  = 243                       (constant 244 − 1)
```

`cc=64` marks the entire protected zone (words 192–255) as the c-list region;
no CALL-microcode c-list access can reach below word 192.

**Caps zone layout (+244…+255):**

| Offset | CR  | Contents at boot |
|-------:|:----|:-----------------|
| +244   | CR0 | `0x00000000` (null GT) |
| +245   | CR1 | `0x00000000` |
| …      | …   | … (all null) |
| +255   | CR11| `0x00000000` |

After boot, CRs 0–11 are all null.  CR6, CR12, CR14, CR15 (populated by the
boot ROM) are privileged registers not stored in the caps zone (see §7).

**Stack sentinel at boot (+242, +243):**

```
 +242  0x40800002  ← E-GT for slot 2 (Boot.Abstr) — saved CR15 in sentinel frame
 +243  0x0FFFF0F3  ← CALL sentinel frame word (return-PC = 0x0FFFF0F3, guard value)
```

### 4.4 Boot.Entry lump — Slot 3 (base `0x0180`)

The boot ROM code; 256 words allocated, `cw=17` instructions, `cc=17` c-list slots.

Header: `0xF9004411` — decoded: `n_minus_6=2→256w`, `cw=17`, `typ=0` (lump), `cc=17`.

```
 0x0180  Header: 0xF9004411
 0x0181–0x0191  Code zone (cw=17 words)          ← §5.3 full listing
 0x0192–0x026E  Free space
 0x026F–0x027F  C-list (cc=17 entries)            ← §5.4 full listing
```

---

## 5. Address Conflict Table

All lump regions and fixed regions checked for pairwise overlap.

**No conflicts detected.** Layout is clean.

The intervals checked (all in 16 384-word configuration):

| Region | Start word | End word | Words |
|:-------|:----------:|:--------:|------:|
| Slot 0 Boot.NS (no hdr) | `0x0000` | `0x003F` | 64 |
| Slot 1 Boot.Thread | `0x0040` | `0x013F` | 256 |
| Slot 2 Boot.Abstr | `0x0140` | `0x017F` | 64 |
| Slot 3 Boot.Entry | `0x0180` | `0x027F` | 256 |
| Slot 4–10 (7 × 64w) | `0x0280` | `0x043F` | 448 |
| Slot 11 UART | `0x0440` | `0x047F` | 64 |
| Slot 12 LED | `0x0480` | `0x04BF` | 64 |
| Slot 13 Button | `0x04C0` | `0x04FF` | 64 |
| Slot 14 Timer | `0x0500` | `0x053F` | 64 |
| Slot 15–46 (32 × 64w) | `0x0540` | `0x0D3F` | 2 048 |
| Format tag | `0x3CFF` | `0x3CFF` | 1 |
| NS table | `0x3D00` | `0x3FFF` | 768 |

---

## 6. Lump Header Validity Table

For each NS slot: `memory[location]` is read and passed to `parseLumpHeader`.

| Slot | Name         | Hdr word     | Status | n_minus_6→size | cw | cc | typ | Notes |
|-----:|:-------------|:-------------|:-------|:---------------|---:|---:|----:|:------|
|   0  | Boot.NS      | `0x00000000` | **NO-HEADER** | — | — | — | — | Word 0 of memory; no lump header by design. The NS root lump is a descriptor only. |
|   1  | Boot.Thread  | `0xF9008240` | **VALID** | 2→256w ✓ | 32 | 64 | Thread | Thread-type; cw encodes data zone, not code count. |
|   2  | Boot.Abstr   | `0xF8000004` | **VALID** | 0→64w ✓  |  0 |  4 | lump | Director; cw=0 (no code). |
|   3  | Boot.Entry   | `0xF9004411` | **VALID** | 2→256w ✓ | 17 | 17 | lump | Boot ROM code; 13 live instructions. |
| 4–46 | (43 slots)   | `0x00000000` | **NOT-POPULATED** | — | — | — | — | Lazy lumps: lump area is zeroed until the IDE loads code. magic=0≠0x1F. |

**Statuses:**

- **VALID** — magic=0x1F, lumpSize and fields are consistent.
- **NO-HEADER** — Location=0 (or the lump base) holds 0x00000000; by design for the NS root.
- **NOT-POPULATED** — The lump slot is allocated in the NS table but the body is all-zeros; the IDE will write the lump header and code words when the abstraction is first loaded (lazy loading).

---

## 7. Code Word Decompilation Tables

### 7.1 Slot 1 — Boot.Thread (base `0x0040`, cw=32, all data zone)

Words `+1` … `+32` (`0x0041–0x0060`) are the **DR + heap data zone**, not code.
All 32 words are `0x00000000` at boot (DRs 0–15 initialized to zero; heap
unallocated).  Decompiled as HALT only because the header says `cw=32` and the
lump type is Thread — the CPU will never fetch from here.

| Offset | Addr   | Hex word   | Purpose |
|-------:|:-------|:-----------|:--------|
| +1…+16 | `0x0041–0x0050` | `00000000` | DR0–DR15 home slots (read/written by DREAD/DWRITE) |
| +17…+32| `0x0051–0x0060` | `00000000` | Heap zone (initially empty) |

### 7.2 Slot 2 — Boot.Abstr director (base `0x0140`, cw=0)

No code words.  The director lump has only a header (+0) and a c-list (+60…+63).

### 7.3 Slot 3 — Boot.Entry (base `0x0180`, cw=17)

The boot ROM program.  13 live instructions followed by 4 empty (HALT) slots.

| Offset | Addr    | Hex word   | Disassembly | Notes |
|-------:|:--------|:-----------|:------------|:------|
| +1     | `0x0181`| `27660001` | `CHANGE  CR12, CR12[0x0001]` | Step 0: set DR0=boot sentinel |
| +2     | `0x0182`| `070B0000` | `LOAD  CR1, CR6[0x0000]` | Step 1: CR1 ← NS root |
| +3     | `0x0183`| `07130001` | `LOAD  CR2, CR6[0x0001]` | Load Boot.Thread GT into CR2 |
| +4     | `0x0184`| `37100003` | `TPERM  CR2, X` | Restrict to execute |
| +5     | `0x0185`| `3F100000` | `LAMBDA  CR2` | Step 2: push LAMBDA frame (entry indirection) |
| +6     | `0x0186`| `07030004` | `LOAD  CR0, CR6[0x0004]` | Load Salvation GT (first boot target) |
| +7     | `0x0187`| `37000008` | `TPERM  CR0, E` | Restrict to invoke-only |
| +8     | `0x0188`| `17000000` | `CALL  CR0` | Step 3: enter Salvation |
| +9     | `0x0189`| `073B0001` | `LOAD  CR7, CR6[0x0001]` | Reload Boot.Thread on return |
| +10    | `0x018A`| `37380003` | `TPERM  CR7, X` | Restrict |
| +11    | `0x018B`| `3F380000` | `LAMBDA  CR7` | LAMBDA frame for post-boot |
| +12    | `0x018C`| `1F028000` | `RETURN` | Step 4: return from boot entry |
| +13    | `0x018D`| `0F308002` | `SAVE  CR6, CR1[0x0002]` | (unreachable post-RETURN) |
| +14    | `0x018E`| `00000000` | HALT | empty |
| +15    | `0x018F`| `00000000` | HALT | empty |
| +16    | `0x0190`| `00000000` | HALT | empty |
| +17    | `0x0191`| `00000000` | HALT | empty |

### 7.4 Boot.Entry c-list (base `0x026F`, cc=17)

| Index | Addr    | GT word    | Slot | Perms | Name |
|------:|:--------|:-----------|-----:|:------|:-----|
|  0    | `0x026F`| `0x06800000`|  0 | RW  | Boot.NS |
|  1    | `0x0270`| `0x00800001`|  1 | —   | Boot.Thread |
|  2    | `0x0271`| `0x40800002`|  2 | E   | Boot.Abstr |
|  3    | `0x0272`| `0x40800003`|  3 | E   | Boot.Entry (self) |
|  4    | `0x0273`| `0x40800004`|  4 | E   | Salvation |
|  5    | `0x0274`| `0x40800005`|  5 | E   | Navana |
|  6    | `0x0275`| `0x40800006`|  6 | E   | Mint |
|  7    | `0x0276`| `0x40800007`|  7 | E   | Memory |
|  8    | `0x0277`| `0x0680000C`| 12 | RW  | LED (channel 0) |
|  9    | `0x0278`| `0x0680000C`| 12 | RW  | LED (channel 1) |
| 10    | `0x0279`| `0x0680000C`| 12 | RW  | LED (channel 2) |
| 11    | `0x027A`| `0x0680000C`| 12 | RW  | LED (channel 3) |
| 12    | `0x027B`| `0x0680000C`| 12 | RW  | LED (channel 4) |
| 13    | `0x027C`| `0x0680000C`| 12 | RW  | LED (channel 5) |
| 14    | `0x027D`| `0x0680000B`| 11 | RW  | UART |
| 15    | `0x027E`| `0x0280000D`| 13 | R   | Button |
| 16    | `0x027F`| `0x0680000E`| 14 | RW  | Timer |

---

## 8. Capability Register (CR) State After Boot

| CR  | GT word    | Slot | Perms | word1 (loc) | word2 (limit word) | m | Role |
|----:|:-----------|-----:|:------|:------------|:-------------------|:-:|:-----|
| CR6 | `0x40800003`|  3  | E     | `0x0000026F`| `0x04000010`       | 1 | C-list root → Boot.Entry c-list |
| CR12| `0x00800001`|  1  | —     | `0x00000040`| `0x040000FF`       | 1 | Thread identity (privileged) |
| CR14| `0x0A800003`|  3  | RX    | `0x00000180`| `0x04000010`       | 1 | Code fence (privileged) |
| CR15| `0x00800000`|  0  | —     | `0x00000000`| `0x045E3FFF`       | 1 | NS root (privileged) |

CRs 0–5, 7–11, 13 = null after boot.

---

## 9. Simulator State Classification

All properties of `ChurchSimulator` (`this.*`) are classified here relative to
`memory[]` as the ground truth.

### 9.1 State backed by `memory[]`

These are the only authoritative sources of CTMM state:

| Storage location | Content |
|:-----------------|:--------|
| `memory[0 … NS_TABLE_BASE−2]` | All object lumps (header, code, heap, stack, caps zone, c-lists) |
| `memory[NS_TABLE_BASE−1]` | Boot-image format tag (`0xB0070229`) |
| `memory[NS_TABLE_BASE … NS_TABLE_BASE + NS_TABLE_RESERVE − 1]` | NS table (location, limit/meta, seals for each slot) |

### 9.2 Legitimate hardware registers (not in DMEM by design)

| Property | Description |
|:---------|:------------|
| `this.pc` | Program counter — hardware pipeline register |
| `this.physicalPC` | Resolved physical PC (pc + code base of current lump) |
| `this.sto` | Stack Top Offset — hardware stack pointer register |
| `this.flags` | Condition flags (N, Z, C, V) — hardware register file |
| `this.running / this.halted` | Execution state machine — hardware control signals |
| `this.mElevation` | M-bit elevation — transient hardware signal |
| `this.lambdaActive / lambdaReturnPC / lambdaCachedFrame` | LAMBDA micro-instruction transient state |

### 9.3 Gaps — state that should be in `memory[]` but is not (Step 2 targets)

#### Gap 1: Data Registers (`this.dr[0..15]`)

**Specification:** The thread lump header (§4.3) defines offsets +1…+16 as the
DR zone.  DR0 is at `threadBase+1`, DR15 is at `threadBase+16`.

**Current reality:** `this.dr[]` is a plain JavaScript array.  DREAD and DWRITE
instructions read/write `this.dr[n]` directly.  They do **not** read or write
`memory[threadBase + 1 + n]`.

**Evidence:** After boot, `memory[threadBase+1 … +16]` = all zeros, and
`this.dr[0..15]` = all zeros.  They agree at boot.  After any DWRITE instruction
during execution, `this.dr[n]` is updated but `memory[threadBase+1+n]` is not,
creating a divergence invisible to any code that reads memory.

**Expected fix (Step 2):** DREAD/DWRITE microcode must read/write
`memory[threadBase + 1 + n]` (where `threadBase = this.cr[12].word1`) and
keep `this.dr[]` as a write-through cache or eliminate it entirely.

#### Gap 2: CR word1 / word2 / word3 vs NS table entries

**Specification:** Each CR's limit (word2) and seal (word3) should be the NS
table entry for the GT index in `cr[i].word0`.  The ground truth is
`memory[NS_TABLE_BASE + slot × 3 + 1]` (limit/meta) and
`memory[NS_TABLE_BASE + slot × 3 + 2]` (seals).

**Current reality:** At CALL time, the CALL microcode packs `cw − 1` into
`cr[14].word2` (see `hardware/call.py` line 1173) rather than copying the NS
entry's word1 verbatim.  This gives a `limit` value of `cw − 1 = 16` for
Boot.Entry, while the NS entry stores `limit = lumpSize − cc − 1 = 238`.

**Concrete numbers (Boot.Entry, slot 3):**

| Source | word2 value | limit field | Encoding |
|:-------|:------------|------------:|:---------|
| NS entry word1 (`memory[NS_TABLE_BASE+3×3+1]`) | `0x242200EE` | 238 | lumpSize − cc − 1 |
| `cr[14].word2` (after CALL) | `0x04000010` | 16 | cw − 1 |
| `cr[6].word2` (c-list root) | `0x04000010` | 16 | cc − 1 |

Neither CR14.word2 nor CR6.word2 matches the NS entry.  The NS entry is the
memory-defined ground truth.

**Expected fix (Step 2):** `_writeCR` and `getFormattedCR` should derive
word1/word2/word3 from `readNSEntry(slot)` on demand rather than caching a
CALL-time computation.  The NS table is the single source of truth.

### 9.4 IDE-only metadata (correctly outside `memory[]`)

These properties serve the IDE UI and simulator control logic.  They have no
equivalent in the hardware CTMM.

| Property | Role |
|:---------|:-----|
| `this.nsLabels` | Symbolic names for NS slots — display only |
| `this.nsClistMap` | Cached c-list relationships — display only |
| `this.nsHandlers` | Abstraction dispatch handlers — simulation aid |
| `this.bootStep / bootComplete` | Boot state machine step — simulator control |
| `this.gcPolarity` | GC G-bit polarity — GC internal |
| `this.ledBits / ledMode` | LED display cache — UI aid |
| `this.callStack[]` | JS mirror of call frames — shadow (truth: thread lump stack in memory) |
| `this.output / faultLog / auditLog` | Debug/audit logs — IDE trace |
| `this._instrHistory` | Instruction trace ring — IDE display |
| `this.stepCount` | Instruction counter — telemetry |
| `this.lastSignedReturn / lastCapability` | Display caches |
| `this.lazyManifest / _loaderSlot / awaitingLump` | Lazy loader state — IDE loader |
| `this.nsCount` | NS entry count — derived from NS table scan; technically redundant with `memory[]` |

---

## 10. Summary of Findings

| Finding | Severity | Tracked in |
|:--------|:---------|:-----------|
| **Boot.NS slot 0** — `memory[0x0000]=0x00000000` fails parseLumpHeader (magic≠0x1F). Expected; the NS root has no standard lump header. | Info | §6 |
| **Slots 4–46** — All 43 lazy lumps have INVALID headers (magic=0). Expected; code is loaded on demand. | Info | §6 |
| **Gap 1 — DR registers** — DREAD/DWRITE do not read/write `memory[threadBase+1..+16]`. | **Bug** | §9.3 Gap 1, Task #242 |
| **Gap 2 — CR14/CR6 word2 limit** — CR14.word2 encodes `cw−1=16`; NS entry encodes `lumpSize−cc−1=238`. Neither matches the other; memory is the ground truth. | **Bug** | §9.3 Gap 2, Task #242 |
| **Address conflicts** — None. All 47 lump regions are disjoint. | Clean | §5 |

---

*Generated from: `tests/ctmm_map_dump.js` + `simulator/simulator.js` + `simulator/assembler.js`.*
*Config: `totalNamespaceWords=16384`, `threadLumpWords=256`, `abstractionLumpWords=256`, `namespaceLumpWords=64`.*
