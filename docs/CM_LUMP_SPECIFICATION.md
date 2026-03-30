# Church Machine — Lump Specification

## Overview

A **lump** is the fundamental deployable unit of the Church Machine. It is a
contiguous, capability-secured memory region containing an executable code
section and an optional capability list (c-list). Every function abstraction
compiles to exactly one lump.

- **Appendix A** covers the Thread — a specialised lump whose body holds live
  execution state (capabilities, LIFO stack, heap, data registers) rather than
  code.
- **Appendix B** covers the Namespace LUMP — the root lump of every application,
  which defines the physical address space, the pre-populated Namespace Table
  (Live / Outform / NULL entries), and the lazy-load protocol for fetching absent
  lumps from a Home Base IDE.

---

## Lump Size Rule

Lump size is always a power of 2, minimum 64 words, maximum 16 384 words
(32-bit each):

```
lumpSize = 2^n   where 6 ≤ n ≤ 14
freespace = lumpSize - 1 - cw - cc   (must be all-zero; Mint verifies at load time)
```

The maximum is 2^14 = 16 384 words. The header `cw` field (13 bits, max 8 191)
and `cc` field (8 bits, max 255) together cap the maximum useful payload at
1 + 8 191 + 255 = 8 447 words. Mint hard-rejects n-6 > 8 (lumpSize > 16 K).

| Abstraction | Code words (cw) | C-list slots (cc) | Lump size         | Freespace  |
|-------------|-----------------|-------------------|-------------------|------------|
| Decimal     | 107             | 0                 | 2^7 = 128 words   | 20 words   |
| SlideRule   | 525             | 1                 | 2^10 = 1 024 words | 497 words |
| TestSR      | 604             | 1                 | 2^10 = 1 024 words | 418 words |
| Boot.Abstr  | 0               | 46                | 2^8 = 256 words   | 209 words  |

---

## Lump Memory Layout — Function Abstraction

```
┌─────────────────────────────────────────────────────────┐  ← base (word 0)
│  Word 0     Header word   [metadata — never executed]   │
├─────────────────────────────────────────────────────────┤  ← word 1  (PC = 1)
│  Words 1 … cw   Code section                           │
│                 Dispatcher at PC = 1, then methods      │
├─────────────────────────────────────────────────────────┤  ← word cw + 1
│  Words cw+1 … lumpSize-cc-1   Freespace                │
│                 All zeros — verified by Mint at load    │
├─────────────────────────────────────────────────────────┤  ← word lumpSize - cc
│  Words lumpSize-cc … lumpSize-1   C-list               │
│                 cc × 1-word GT slots (Word 0 only)      │
└─────────────────────────────────────────────────────────┘  ← word lumpSize - 1
```

Hardware entry point is **PC = 1** — Word 0 is the header and is never
executed. The c-list is pre-populated by the compiler at build time and
anchors at the tail of the lump.

---

## The Header Word (Word 0)

The first word of every lump binary is a metadata descriptor. It uses opcode
`0x1F` (`11111b`) — an undefined instruction on the Church Machine ISA. If
Word 0 were accidentally executed, the hardware traps rather than silently
corrupting state.

```
31      27 26    23 22                10 9   8 7              0
+──────────+────────+──────────────────+──────+────────────────+
│ 0x1F [5] │ n-6[4] │     cw [13]      │typ[2]│    cc [8]      │
+──────────+────────+──────────────────+──────+────────────────+
```

| Field | Bits  | Meaning |
|-------|-------|---------|
| magic | 31:27 | Always `11111` (0x1F). Traps if executed. |
| n-6   | 26:23 | lumpSize = 2^(val+6). Valid range 0..8 → 64..16 384 words. Values 9..15 rejected by Mint. |
| cw    | 22:10 | Code word count (0..8191). Words 1..cw are code; words cw+1..lumpSize-cc-1 must be zero. |
| typ   | 9:8   | Object type: `00`=lump, `01`=data, `10`=clist-only, `11`=Outform. |
| cc    | 7:0   | C-list slot count (0..255). |

32 bits total. No spare bits. No dead fields. `code_base = base + 4` always.
`PC = 1` always.

### Example Header Words

Encoding formula: `(0x1F << 27) | ((n-6) << 23) | (cw << 10) | (typ << 8) | cc`

```
Decimal    (n=7,  cw=107, cc=0, typ=00):  0xF881_AC00
SlideRule  (n=10, cw=525, cc=1, typ=00):  0xFA08_3401
Boot.Abstr (n=8,  cw=0,   cc=46, typ=00): 0xF900_002E
```

---

## Addressing Convention

Two address spaces are used throughout the Church Machine lump model.
All hardware registers and memory interfaces operate in **byte addresses**.
The PC and NIA counters operate in **word offsets** (one unit = one 32-bit word = 4 bytes).

| Quantity | Unit | Notes |
|---|---|---|
| `base` / `location` field in a CAP_REG | byte address | 32-bit physical address; always word-aligned (bits [1:0] = 0) |
| `limit_offset` in WORD2_LAYOUT | inclusive word count − 1 | The last valid word index relative to `base`; multiply by 4 and add to base to get the last valid byte address |
| PC | word offset from `CR14.base` | Word 0 is the lump header; word 1 is the first code word, so PC starts at 1 |
| NIA | word offset from `CR14.base` | Same space as PC; converted to a byte address by: `byte_addr = CR14.base + NIA × 4` |
| `cw` (header field) | word count | Number of code words; code occupies words 1..cw inclusive |
| `cc` (header field) | slot count | Number of c-list slots; each slot is one word; c-list occupies the last `cc` words of the lump |

**×4 bridge rule**: whenever a word offset must be expressed as a memory address (for `mem_rd_addr` / `mem_wr_addr` bus signals), multiply by 4.  Conversely, a byte address arriving from the memory bus is converted to a word offset by right-shifting 2 bits.

**Word-alignment guarantee**: the lump allocator always places a lump at an address whose low two bits are zero.  Implementors may rely on this without a runtime check.

**Derived sizes**:
- `lumpSize` (words) = `1 << (n_minus_6 + 6)` — always a power of two, 64..16384
- `freespace` (words) = `lumpSize − 1 − cw − cc` — words between the last code word and the c-list; must be zero-filled
- `CR14.base` = `NS_base + 4` (skips lump header word)
- `CR14.limit_offset` = `lumpSize − cc − 2`
- `CR6.base` = `NS_base + (lumpSize − cc) × 4`
- `CR6.limit_offset` = `cc − 1`

---

## Mint Validation Sequence

`Mint.Lump(base, n)` receives a lump already inflated into physical memory.
It validates the header and binary before issuing any GT.

```
Step 1  Read Mem[base] — the header word.
Step 2  magic[31:27] == 0x1F — reject if not.
Step 3  n-6[26:23] <= 8   — reject if n-6 > 8 (lump would exceed 16 K words).
Step 4  lumpSize = 2^(n-6+6).
Step 5  cw[22:10] <= lumpSize - cc - 2  — reject if header is self-contradictory.
Step 6  cc[7:0]   <= lumpSize - 2       — reject if c-list overflows lump.
Step 7  Scan words cw+1 .. lumpSize-cc-1: reject if any word is non-zero.
          Freespace must be all-zero — this is enforced, not assumed.
Step 8  Validate c-list slots (each must be a well-formed GT Word 0).
Step 9  Issue E-GT, write NS slot.
```

Steps 2–6 are pure arithmetic on the 32-bit header — no memory access beyond
the header word. Step 7 is the freespace scan, protected by the cheap
consistency gates in steps 3–6. A malformed or malicious header is caught
before Mint touches the binary body.

---

## Instruction Set Mutual Exclusion

The Church Machine's 20 instructions divide into two completely independent
groups with mutually exclusive access rights. A memory region carries rights
from one group only — never both. This is enforced at the hardware
instruction-decode level, not by software policy.

```
┌────────────────────────────────────────┐  ┌────────────────────────────────────────┐
│       TURING instructions              │  │       CHURCH instructions              │
│       (Data side)                      │  │       (GT / Capability side)           │
├────────────────────────────────────────┤  ├────────────────────────────────────────┤
│  DREAD   DWRITE                        │  │  LOAD    SAVE                          │
│  IADD    ISUB    SHL    SHR            │  │  CALL    RETURN                        │
│  MCMP    BRANCH                        │  │  LAMBDA  TPERM                         │
│  BFEXT   BFINS                         │  │  ELOADCALL  XLOADLAMBDA                │
│                                        │  │  CHANGE  SWITCH                        │
│  Access rights:  R  W  X               │  │  Access rights:  L  S  E               │
└────────────────────────────────────────┘  └────────────────────────────────────────┘
         operate on DATA memory                    operate on CAPABILITIES only
         cannot reach GTs                          cannot reach data memory
```

### Permission Bit Definitions

Word 0 of every GT encodes the TPERM-controllable permission bits at [31:25],
the GT class at [24:23], and identity fields below that:

| Bits  | Field | Side   | Instruction | Meaning |
|-------|-------|--------|-------------|---------|
| 31    | B     | Church | SAVE        | Bind — B=1 allows SAVE; B=0 causes SAVE to fault |
| 30    | R     | Turing | DREAD       | Read data words from this region |
| 29    | W     | Turing | DWRITE      | Write data words to this region |
| 28    | X     | Turing | —           | Region is executable (PC may enter) |
| 27    | L     | Church | LOAD        | Load a capability out of this region |
| 26    | S     | Church | SAVE        | Save a capability into this region |
| 25    | E     | Church | CALL        | This GT is a valid CALL target |
| 24:23 | typ   | —      | —           | GT class: 00=NULL, 01=Inform, 10=Outform, 11=Abstract — CRC covered |

**R, W, X and L, S, E are mutually exclusive groups.** Any GT with bits from
more than one group is rejected by Mint as malformed.

### Standard GT Combinations

| GT type           | typ | permissions [31:25] | Description |
|-------------------|-----|---------------------|-------------|
| E-GT (lump gate)  | 01  | B E                 | Church: callable lump — the only issued lump GT |
| RW-GT (data)      | 01  | B R W               | Turing: full data read/write |
| R-GT (read-only)  | 01  | B R                 | Turing: read-only data |
| LS-GT (MintCL)    | 01  | B L S               | Church: full capability read/write |
| NULL GT           | 00  | 0 (all clear)       | All bits zero — faults on any use |
| OUTFORM GT        | 10  | (any)               | Lump registered but not yet resident — fires Absent event on LOAD |
| ABSTRACT GT       | 11  | 0 (no rights)       | Self-defining constant or PassKey — no RAM |
| *(CR14 transient)*| 01  | X                   | Derived from NS slot on CALL; never issued or stored |
| *(CR6 transient)* | 01  | L                   | Derived from NS slot on CALL; never issued or stored |

---

## GT Taxonomy — Three Fundamental Classes

Every GT belongs to exactly one of three fundamental classes, identified by
`typ[2]` in Word 0 bits [24:23]. This is CRC-covered and visible to hardware
at instruction-decode time.

### NULL GT (typ = 00)

All 128 bits zero. Faults on any CALL, LOAD, or DREAD. Occupies every
unoccupied c-list slot. Never issued by Mint.

When `mLoad` validation encounters a NULL slot in the NS table, the GT
used in the instruction is set to NULL — causing any subsequent CALL,
LOAD, or DREAD on that register to fault.

### Inform GT (typ = 01)

Issued by Mint. References a physical memory region. The R/W/X or L/S/E
permission bits describe what the holder may do with that region.

### Abstract GT (typ = 10)

Self-defining. No memory region, no Object NS slot. Hardware maps
`object_id → value` internally. Covers physical constants (DREAD returns a
fixed value) and PassKey credentials (opaque identity tokens). Abstract GTs
are distributed by writing the full CR directly into c-list slots — no NS
slot consumed.

### Outform GT (typ = 10)

A GT issued by the IDE as a dependency placeholder. The GT itself (Word 0
only) is the IDE's key to identify the lump — no NS slot is required until
the lump is resolved. When the lump is first LOAD-ed, an Absent event fires;
the Locator fetches the zip, inflates it, determines the lump size and all
metadata from the header word, and then allocates an NS slot and calls
`Mint.Lump` to promote the slot to Live (typ = 01). The IDE may issue many
Outform GTs for the same lump; they all resolve to the same Live slot when
inflated.

---

## Context Register (CR) — 128-bit Structure

A CR is four 32-bit words stored in a hardware register file (CR0..CR15 per
thread).

```
┌──────────────────────────────────────────────────────────────┐
│  Word 3 [127:96]  CRC and GC  (spare[15] | G[1] | CRC[16]) │
├──────────────────────────────────────────────────────────────┤
│  Word 2 [95:64]   Limit and revocation                      │
│                   (spare[4] | gt_seq[7] | limit_offset[21]) │
├──────────────────────────────────────────────────────────────┤
│  Word 1 [63:32]   Base address [32]                         │
├──────────────────────────────────────────────────────────────┤
│  Word 0 [31:0]    GT — the holder's credential (per-holder) │
│                   SAVE copies this word only                 │
└──────────────────────────────────────────────────────────────┘
```

### Word 0 — The Golden Token (per-holder credential)

```
31      25 24  23 22      16 15            0
+─────────┬──────┬──────────┬──────────────+
│B R W X  │ typ  │  gt_seq  │  object_id   │
│ L S E   │ [2]  │   [7]    │    [16]      │
│  [7]    │      │          │              │
+─────────┴──────┴──────────┴──────────────+
```

| Field         | Bits  | Meaning |
|---------------|-------|---------|
| B R W X L S E | 31:25 | Permissions — TPERM-changeable, **excluded from CRC** |
| typ           | 24:23 | GT class: 00=NULL, 01=Inform, 10=Outform, 11=Abstract — CRC covered |
| gt_seq        | 22:16 | Revocation sequence number — CRC covered |
| object_id     | 15:0  | Object index, unique per lump issuance — CRC covered |

TPERM clears any subset of bits [31:25] to produce a weaker GT. Permission
escalation is architecturally impossible.

### Word 1 — Base Address

Physical base address of the memory region. CRC covered.

### Word 2 — Limit and Revocation

```
95  92 91      85 84                          64
+──────+──────────+────────────────────────────+
│spare │  gt_seq  │       limit_offset [21]     │
│ [4]  │   [7]    │                             │
+──────+──────────+────────────────────────────+
```

**Revocation:** Mint increments gt_seq in the Object NS slot. On LOAD,
hardware checks Word 0 gt_seq against Word 2 gt_seq — a mismatch means the
GT has been revoked and the LOAD faults and the GT is set to NULL.

### Word 3 — CRC and GC

```
127         113 112 111                     96
+─────────────┬───┬──────────────────────────+
│  spare [15] │ G │        CRC [16]          │
+─────────────┴───┴──────────────────────────+
```

CRC is CRC-16/CCITT (poly 0x1021) over Word 0[24:0] + Word 1[all] +
Word 2[all]. Permission bits [31:25] are **excluded** — TPERM requires no
CRC recomputation.

---

## Mint.Lump — One E-GT, One NS Slot

`Mint.Lump(base, n)` issues exactly **one E-GT** and writes **one NS slot**
matching the E-GT of the downloaded LUMP. Transient CR14 and CR6 are derived
fresh on every CALL, RETURN, and CHANGE instructions — CR14 and CR6 are never
issued or stored, the E-GT can only be shared if B=1.

| Token    | Region                         | Permissions | Mounted as   | Issued? |
|----------|--------------------------------|-------------|--------------|---------|
| **E-GT** | Entire lump (word 0..size-1)   | B E         | held by caller | Yes — only issued GT |
| CR14 (X) | Words 1..lumpSize-cc-1         | X           | CR14 on CALL | No — transient only |
| CR6  (E) | Words lumpSize-cc..lumpSize-1  | M           | CR6 on CALL  | Saved on stack on CALL/CHANGE reused by RETURN/CHANGE |

If `cc = 0`: CR6 is NULL GT after CALL; the derived X view still covers the
full code section. The E-GT is pushed onto the stack frame if a CALL takes
place; it is cached temporarily in CR16, and the M bit is set to allow the
microcode to use CR6 with only E permissions. The L permission is never set
in CR6 (a hardware requirement).

---

## The Object NS Slot

Each lump occupies exactly one Object NS slot (three 32-bit words). Word 0
(the Golden Token) is held privately by the owner — it is never stored in
the NS slot.

```
NS Word 1  base [32]               — physical byte address of lump word 0
NS Word 2  spare[4] | gt_seq[7] | limit_offset[21]
NS Word 3  spare[15] | G[1] | CRC[16]
```

CALL fetches the **callee** lump header word directly from `Mem[CR14.word1_location]`
(FETCH_LUMP phase) to read `mw` and compute the entry NIA.

The **THREAD_HDR** hidden register (loaded by CHANGE on thread restore from
`Mem[CR12.word1_location + 0]`) holds the **current thread's** lump header and is
used by CALL for stack-bound validation only. These are two separate fetches from two
different lumps: the callee header (fetched each CALL) and the thread header (cached
by CHANGE, shared across all CALLs in the thread's lifetime).

---

## CALL/RETURN and CHANGE Execution Flow

```
If CALL CR_s   (CR_s holds the E-GT for the target lump), if RETURN (E-GT found from stack frame), otherwise if CHANGE (E-GT is restored from CR6 of new thread)
  1. Validate E-GT CRC — FAULT if mismatch
  2. Read object_id and gt_seq from E-GT Word 0
  3. Fetch NS[object_id] — 3 words: base, gt_seq_ns, limit_offset
     Read Mem[base] → lump header word:
       n_minus_6 = Mem[base][26:23]   (bits 26..23)
       cw        = Mem[base][22:10]   (bits 22..10)
       cc        = Mem[base][7:0]     (bits  7..0)
     If lump not present (evicted / Outform): invoke Locator, retry
  4. Revocation check: if E-GT gt_seq != NS gt_seq_ns -> FAULT
  5. Derive lumpSize = 1 << (n_minus_6 + 6)
  6. Build transient CR14 (X):
       base+4, limit = lumpSize-cc-2, gt_seq, CRC
  7. If cc > 0: build transient CR6 (L):
       base+(lumpSize-cc)*4, limit = cc-1, gt_seq, CRC
     Else: CR6 ← NULL GT
  8. PC ← 1
  9. Execute dispatcher
```

---

## C-List — Compiler-Populated

The IDE toolchain pre-fills every c-list slot at compile time with a Golden
Token as a resident inform or a IDE outform. Inform GT reference c-list slot
is one 32-bit word as Word 0 of the NS slot. LOAD reads Word 0 from the
c-list, then fetches Words 1–3 from the NS table. Otherwise, mLoad triggers
an Outform Event only if the download remains absent.

| Slot Word 0 value       | typ | Meaning |
|-------------------------|-----|---------|
| B\|perms\|typ=01\|gt_seq\|object_id | 01=Inform | Regular lump or data GT |
| typ=10\|object_id       | 10=Outform | IDE-managed dep — Absent event fires on first LOAD |
| typ=11\|object_id       | 11=Abstract | Physical constant or PassKey — self-defining |
| 0x00000000              | 00=NULL | Unused slot |

`cc` is the slot count. The c-list occupies the last `cc` words of the lump.

---

## Zip Distribution Format

Lump binaries are distributed as zip files.

### Single Lump Upload

```
SlideRule.lump.zip
+-- SlideRule.bin    ← raw lump binary: header + code + freespace + c-list
```

### Single Thread Upload

```
MyApp.thread.zip
+-- MyApp.thread.bin    ← 256-word Thread lump binary (1 024 bytes)
                           Word 0:        0xF900_020C (header)
                           Words 1..16:   Zone ⑤ — DR0..DR15 (all zero at creation)
                           Words 17..80:  Zone ④ — Heap (all zero at creation)
                           Words 81..211: Zone ③ — Freespace (all zero — Mint verifies)
                           Words 212..243: Zone ② — LIFO Stack (all zero at creation)
                           Words 244..255: Zone ① — initial CR0..CR11 GT Word 0 values
```

### Namespace Bundle

```
namespace.zip
+-- manifest.json   ← install order + dependency declarations
+-- Decimal.bin
+-- SlideRule.bin
+-- TestSR.bin
```

### Network-Cached Lump

```
cm://domain/SlideRule@sha256:a3f9c2...
```

The SHA256 hash covers the lump binary. Any node holding the binary can
serve it. **Bit 3** of the ZIP general-purpose flags must be 0 (no data
descriptor). The Locator rejects any lump zip where bit 3 is 1 or the
uncompressed-size field is zero.

Network-cached lumps are only used for network browsing using a GT with
Read (R) permission and to set up a CM tunnel. The NS slot holds the
reference that is defined by the object reference.

### ZIP Pre-Allocation Sequence

```
1. Verify signature = 0x04034B50
2. Assert bit 3 of flags = 0 — reject if streaming mode
3. Read uncompressed_size at offset 24
4. Derive n = log2(uncompressed_size / 4)
   Reject if not power-of-2 multiple of 4, or n < 6
5. Call Memory Manager with n → receive base
6. Inflate compressed payload into [base, base + uncompressed_size)
7. Verify ZIP CRC-32 — reject on mismatch
8. Hand (base, n) to Mint.Lump()
```

---

## Security Properties

### Architectural (hardware-enforced, not bypassable)

| Property | Mechanism |
|----------|-----------|
| Turing/Church mutual exclusion | Data and capability instructions operate on strictly separate rights |
| GT unforgeable | Only Mint issues GTs — raw bytes cannot be reinterpreted as capabilities |
| Execute isolation | Transient CR14 grants X only — code is execute-only, DREAD cannot reach it |
| C-list isolation | Transient CR6 grants E+M only — callers can load capabilities out but cannot SAVE into slots without B=1 |
| Permission non-escalation | TPERM can only remove bits, never add; perms excluded from CRC enables pure-hardware TPERM |
| Entry point integrity | PC always starts at 1 — the header word cannot be executed |
| CRC check | Every LOAD validates CRC-16/CCITT over Word 0[24:0] + Word 1 + Word 2 |
| SAVE gating | B=0 in Word 0 bit 31 causes SAVE to fault — PassKeys and session GTs cannot be copied |
| GC correctness | Mark-and-sweep via G bit — cycles collected, no per-operation overhead (deterministic and real-time, no applition stalls) |

### Policy (Mint + Namespace enforced)

| Property | Mechanism |
|----------|-----------|
| Tamper detection | Mint binds GT to exact zip bytes — any modification invalidates the GT |
| Type safety | `typ` field in header word and NS slot |
| Slot isolation | MintCL issues a fresh, empty c-list — no leftover capabilities |
| Install authority | NamespaceWrite E-GT held only by Locator |
| Content integrity | SHA256 hash in URL verified before inflate |
| Revocation | gt_seq in Word 0 matched against Object NS slot at LOAD |

---

## Concrete Lump Examples

### Decimal (n=7, cw=107, cc=0)

```
Header:  0xF881_AC00
  magic=0x1F  n-6=1 (2^7=128)  cw=107  typ=00  cc=0

Layout (128 words):
  Word 0:         0xF881_AC00  [header]
  Words 1..107:   CLOOMC code  [107 words]
  Words 108..127: freespace    [20 zeros]
  C-list:         (none)

NS Slot (gt_seq=0x01, base=0x20000000):
  Word 1:  0x20000000
  Word 2:  0x0020007F  (gt_seq=0x01, limit_offset=127)
  Word 3:  0x00004CEF  (E-GT CRC)
```

### SlideRule (n=10, cw=525, cc=1)

```
Header:  0xFA08_3401
  magic=0x1F  n-6=4 (2^10=1024)  cw=525  typ=00  cc=1

Layout (1024 words):
  Word 0:          0xFA08_3401  [header]
  Words 1..525:    CLOOMC code  [525 words]
  Words 526..1022: freespace    [497 zeros]
  Word 1023:       PI abstract GT (Word 0 only)  [c-list, cc=1]

NS Slot (gt_seq=0x01, base=0x10000000):
  Word 1:  0x10000000
  Word 2:  0x002003FF  (gt_seq=0x01, limit_offset=1023)
  Word 3:  0x000048F3  (E-GT CRC — illustrative)
```

### Boot.Abstr (n=8, cw=0, cc=46) — simulator boot-time lump

```
Header:  0xF900_002E
  magic=0x1F  n-6=2 (2^8=256)  cw=0  typ=00  cc=46

Layout (256 words):
  Word 0:          0xF900_002E  [header]
  Words 1..0:      (no code — cw=0)
  Words 1..209:    freespace    [209 zeros]
  Words 210..255:  c-list       [46 GT words, one per NS slot 0..45]

Note: clistStart = lumpSize - cc = 256 - 46 = 210
```

---

---

# Appendix A — Thread as a Lump

## Overview

The Thread is a specialised lump. Like every other lump it is a
capability-secured, power-of-2 memory region with a header word at Word 0
and a c-list at its tail and freespace for stack and heap growth in between. The Thread GT occupies one Object NS slot and is assigned a single zero permissions GT by Mint at creation time. Access rights are under M (TSB microcode) control like the NS and CR6.

What makes the Thread distinct is how the rest of the lump is used.
A function abstraction lump holds executable CLOOMC code followed by
freespace. The Thread lump holds **live execution state** — capability
registers, a call stack, heap, and data registers — rather than code.
PC never enters the Thread lump. It is a static data structure of a suspended Thread registers, indicators, GTs, heap and stack saved and restored by the CHANGE instruction, not a program.

See Tutorial on Threads

---

## Thread Header Word (Word 0)

The Thread lump **does** have a header word at Word 0, using the same magic
field `0x1F` as every other lump. The `typ` field is set to `10`
(clist-only) because the Thread has no executable code section — its
"program" lives in the CRs and stack, not in a code region.

```
31      27 26    23 22                10 9   8 7              0
+──────────+────────+──────────────────+──────+────────────────+
│ 0x1F [5] │ n-6[4] │      sw [13]     │10[2] │    cc [8]      │
+──────────+────────+──────────────────+──────+────────────────+
```

| Field | Value | Meaning |
|-------|-------|---------|
| magic | 0x1F  | Traps if accidentally executed |
| n-6   | IDE   | lumpSize = 2^(val+6); e.g. val=2 → 256 words |
| sw    | IDE   | **Stack words** — `cw` field reinterpreted for `typ=10`; set by IDE at thread creation, validated by Mint |
| typ   | 10    | clist-only — Mint does not scan for an executable code region |
| cc    | IDE   | **heapWords** — IDE-set max heap words; caps zone is architecture-fixed at 12 words |

> **`cw` → `sw` reinterpretation:** For `typ=10` (Thread/clist-only) lumps,
> the 13-bit `cw` (code word count) field is otherwise wasted — a Thread
> carries no executable code. The hardware and Mint **reinterpret** it as `sw`
> (stack words). The IDE sets `sw` at thread-creation time; Mint validates
> that `sw > 0`, `cc > 0`, and `17 + cc + sw ≤ lumpSize − 12`. All zone
> boundaries are then derived from `sw` at CALL time — no literals in the FSM.

**Encoding example** (256-word thread, 32 stack words):

```
(0x1F << 27) | (2 << 23) | (sw << 10) | (0b10 << 8) | heapWords

Boot.Thread   (n-6=2, sw=32, cc=64, typ=10):  0xF900_8240
Thread        (n-6=2, sw=32, cc=64, typ=10):  0xF900_8240
```

Thread lumps of the same geometry share the same header word. Version is
carried in the NS slot `gt_seq` field, not the header.

---

## Thread Lump Memory Layout

Word 0 is the header. The five live-state zones occupy Words 1..255.
Word addresses increase downward from the base.

```
┌─────────────────────────────────────────────┐  ← base  (+0)            ← Word 0
│  Header  magic=0x1F · n-6 · sw · typ=10 · cc│  [1 word]  never executed
├─────────────────────────────────────────────┤  ← base  (+1)            ← DR base
│  ⑤ Data Registers                           │  [16 words]  fixed
│     DR0 … DR15 — 32-bit registers           │
├─────────────────────────────────────────────┤  ← base  (+17)           ← heap base
│  ④ Heap  ↑                                  │  [heapWords]  IDE-defined
│     Size = cc words · cc field in Header[0] │
│     Objects allocated from heap base upward │
│     Grows toward Freespace                  │
├─────────────────────────────────────────────┤  ← 17+heapWords →        ← FREE base
│  ③ Freespace                                │  [dynamic]
│     Unallocated — shrinks as Stack/Heap grow│
│     Mint verifies all-zero at creation time │
├─────────────────────────────────────────────┤  ← sp_max →              ← STO_initial (empty)
│  ② LIFO Stack  ↓                            │  [sw words]  IDE-defined
│     CALL: 2-word frame  [E-GT · frame word] │  STO -= 2
│     LAMBDA: 1-word frame  [frame word]      │  STO -= 1
│     Grows downward; STO hidden register     │  sp_max = lumpSize−12−1
│     sp_min = lumpSize−12−sw+2               │  CALL fault if STO < sp_min
├─────────────────────────────────────────────┤  ← lumpSize−12 →         ← c-list base
│  ① Capabilities                             │  [12 words]  architecture-fixed
│     CR0 … CR11 — Golden Token words         │  one 32-bit GT Word 0 per slot
│     Fixed zone — mLoad keeps this zone      │  = c-list tail (12 words)
└─────────────────────────────────────────────┘  ← lumpSize−1 →
```

**Stack bound formulas** (all in word offsets from lump base, IDE-controlled via `sw`):

| Signal | Formula | Example (sw=32, lumpSize=256) |
|--------|---------|-------------------------------|
| `sp_max` | `lumpSize − 12 − 1` | 243 (initial STO, empty stack) |
| `stack_min` | `lumpSize − 12 − sw` | 212 (bottom of Stack zone) |
| `sp_min` | `lumpSize − 12 − sw + 2` | 214 (CALL minimum: needs 2 slots) |

The CALL FSM reads the thread header at `thread_base` to recover `sw` and
`n_minus_6` (caps zone is architecture-fixed at 12). Both bounds are enforced
in hardware — no literals for stack bounds in the FSM.

### Zone Constants (all offsets from Thread lump base, IDE-parameterised)

| Zone | Identifier | Offset range | Words | Notes |
|------|-----------|--------------|-------|-------|
| Header        | HDR   | +0                               | 1        | Header word — never executed |
| ⑤ Data Regs    | DR    | +1 … +16                        | 16       | DR0…DR15 (16 × 32-bit, fixed) |
| ④ Heap         | HEAP  | +17 … +17+heapWords−1           | heapWords | IDE-defined; grows upward |
| ③ Freespace    | FREE  | +17+heapWords … +sp_max          | dynamic  | Collision zone; all-zero at creation |
| ② LIFO Stack   | STACK | +stack_min … +sp_max            | sw       | IDE-defined; grows downward |
| ① Capabilities | CAPS  | +lumpSize−12 … +lumpSize−1      | 12       | GT Word 0 × 12; c-list tail (architecture-fixed) |

All five zones fit within `lumpSize` words. The Capabilities zone at
the tail (last 12 words, architecture-fixed) is identical to the lump c-list
tail, eliminating the overlap from the previous layout.

---

## C-List at the Tail — Zone ① (Capabilities)

The LUMP spec places the c-list at the physical tail (last `cc` words).
In a Thread lump the caps zone is always 12 words (architecture-fixed), so
the c-list occupies words `lumpSize-12`..`lumpSize-1` = words 244..255 (for
lumpSize=256). **Zone ① (CR0..CR11) is also at words +244..+255** — the same region.

The resolution: by reversing the zone order, Zone ① and the c-list tail are
now co-located:

| Region | Offsets | Role |
|--------|---------|------|
| Zone ① (live CRs) | +244 … +255 | Save/restore target for SAVE/LOAD at runtime AND c-list pre-population |
| C-list tail | +244 … +255 | Boot-time initialisation — pre-populated by Mint.Thread with the initial 12 GT Word 0 values |

`Mint.Thread` populates words +244..+255 with the initial GT Word 0 values at
creation time. The boot sequence then LOAD-s them into the CRs via `mLoad`.
Thereafter SAVE/LOAD operates on Zone ① (words +244..+255) directly. Zone ①
serves both as the live capability register zone and the c-list tail — one
12-word region with two semantic roles.

---

## Zone ① — Capabilities (CR0–CR11)

Twelve 32-bit words at offsets +244..+255. Each word is **GT Word 0** — the
per-holder credential. Words 1–3 of the full 128-bit CR are held in the
hardware CR file, not in lump memory. Only Word 0 is written to / read from
lump memory by SAVE/LOAD.

```
+244  CR0    — General-purpose
+245  CR1    — CALL/RETURN ABI — argument GT in; return GT out  [hardware-defined]
+246  CR2    — General-purpose
+247  CR3    — General-purpose
+248  CR4    — General-purpose
+249  CR5    — Heap GT (Zone ④ · by convention · installed by CHANGE)  [hardware-assisted]
+250  CR6    — C-list view (E+M+B?-only) — set by CALL, cleared by RETURN  [hardware-defined]
+251  CR7    — General-purpose
+252  CR8    — General-purpose
+253  CR9    — General-purpose
+254  CR10   — General-purpose
+255  CR11   — General-purpose
```

CR0 and CR2–CR11 are all **general-purpose** capability registers — exactly
as DR0–DR15 are general-purpose data registers. The architecture assigns no
fixed semantic to any of them. The same rule applies to both domains: a
register is a holder; the programmer decides what it holds.

Only **CR1** and **CR6** carry hardware-defined roles in this zone:

- **CR1** — the CALL/RETURN ABI register. The caller places the first
  argument GT here before CALL; RETURN deposits the result GT here.
  Hardware reads CR1 by name during these instructions.
- **CR6** — the transient c-list view. Hardware sets this from the callee's
  NS slot/lump on every CALL/RETURN/CHANGE. Its E-GT Word 0 is persistently
  stored in CR6 (as E+M+B?) and it is re-derived on each CALL/RETURN/CHANGE.

### System GTs — C-list Slots, Not Fixed CRs

Capabilities for system services (Scheduler, Mint, NS write authority, etc.)
are held in **c-list slots** — the lump's pre-populated GT store at the
tail. A thread loads them into any convenient general-purpose CR with LOAD
immediately before use, then discards (or retains) them as needed.

```
LOAD  CR2, CR6[SCHED_SLOT]   ; fetch Scheduler E-GT from c-list
CALL  CR2, method             ; invoke Scheduler
```

This follows the same pattern as DR0–DR15: the register is a transient
holder; the durable home is the c-list (for GTs) or lump memory (for data).
No numbered CR is permanently dedicated to any named system service.

> **Important — Security is Programmable.**  By placing system GTs in
> c-list slots rather than fixed registers, the architecture makes security
> fully under the programmer's control. The programmer decides which system
> services a thread can reach, when it loads those credentials, and how long
> it retains them. A thread that never LOADs the Scheduler GT cannot invoke
> the Scheduler — not by policy, but by capability absence. A thread that
> LOADs a GT and then clears the CR holds the credential for exactly the
> duration it chooses. There is no ambient authority, no implicit privilege
> granted by register position, and no way for one thread to obtain a
> system GT it was not given at birth (via the c-list) or passed explicitly
> at runtime. Security is not a property of the register file; it is a
> property of what the c-list contains.

### CR12–CR15 — Privileged Zone (Priv zone)

CR12–CR15 are not stored in Zone ① of the Thread lump. They are held
exclusively in the hardware CR file and are loaded via `mLoad(NS Slot 1)`
at boot step B:02. They carry zero permissions in their stored GT Word 0
and are of Inform-type — the hardware returns a constant on DREAD. They
are never written to lump memory and are never accessible via DREAD.

**CR12 — Thread Identity.** CR12 specifically encodes the Thread lump's
base address and total word count. It acts as the hardware anchor for the
stack: the effective stack zone spans `stack_min` (= `lumpSize−12−sw`,
example: 212) up to `sp_max` (= `lumpSize−12−1`, example: 243), with the
hidden **STO** (Stack Top Offset) register tracking the current top.
`Mint.Thread` sets STO = `sp_max` (example: 243) at Thread creation — this
is the empty-stack sentinel; the first word pushed onto the stack occupies
`sp_max−1` (cursor STO field decreases by 1 for LAMBDA, by 2 for CALL).
CR12 is saved and restored on every CHANGE alongside STO, DR0–DR15, PC,
and FLAGS (see §CHANGE Context Save below). CR13 and CR15 are system-wide
registers not touched by CHANGE. CR14 is also not touched by CHANGE — it is
transient and re-derived by cLoad on the next CALL.

The Zone ④ **Heap** (words 17..17+heapWords−1, example: 17..80) is entirely absent from the hardware
save/restore path. It is private to its thread — no other thread holds a GT
that spans those words — and is managed entirely by software running within
the thread. The allocator, GC policy, object layout, and compaction strategy
are all programmer-chosen. The hardware enforces only the outer boundary
(the lump limit encoded in CR12); everything inside Zone ④ is a software
concern. This makes heap behaviour fully programmable on a per-thread basis:
two threads in the same application may use completely different allocation
strategies without any conflict or coordination at the hardware level.

By convention **CR5 is the Heap GT** — a data GT whose range covers exactly
Zone ④ (words 17..80) of the thread's own lump. The CHANGE instruction
installs this GT transparently into CR5 as part of context restoration,
scoped to the IDE-defined bounds of Zone ④. This gives the thread immediate
DREAD/DWRITE access to its heap on every context-load without an explicit
LOAD instruction, while keeping the heap strictly private: the GT covers only
this thread's Zone ④ and cannot be widened by the programmer.

**DR5 is the heap allocation pointer** — a raw 32-bit offset from Zone ④
base (word 17) giving the next free word. CR5 and DR5 form the complete
heap register pair: CR5 is the access right, DR5 is the position. Together
they are everything the software allocator needs to allocate, read, and write
heap objects without any further indirection.

---

## Zone ② — LIFO Stack

`sw` words at offsets `lumpSize−12−sw .. lumpSize−12−1` (IDE-defined).
The stack grows downward (toward lower offsets). **STO** (Stack Top Offset,
a hidden per-thread register) tracks the current top. `Mint.Thread`
initialises STO = `lumpSize−12−1` = **sp_max** at Thread creation (the
empty-stack sentinel at the top of Zone ②); the first word pushed lands at
`sp_max−1` (STO -= 1 for LAMBDA, -= 2 for CALL).

### Frame Formats

```
CALL frame (SZ=1 — 2 words):      STO -= 2 after push
  STO+0:  Frame word: SZ[1] | return_PC[15] | prev_STO[16]
  STO-1:  E-GT Word 0 of the callee  (Golden Token, Church-side)

LAMBDA frame (SZ=0 — 1 word):     STO -= 1 after push
  STO+0:  Frame word: SZ[1]=0 | lambda_arg[15] | prev_STO[16]
```

The RETURN instruction pops the frame, restores STO to the saved
`prev_STO` value, and jumps to `return_PC` in the caller's code section.
No kernel involvement.

### Stack Depth and Hardware Bounds

The maximum call depth is `sw ÷ 2` nested CALL frames (each frame is 2
words). For `sw=32` that is **16 nested calls**.

The CALL FSM reads the thread header to obtain `sw`, `cc`, and `n_minus_6`
before each stack push and enforces two bounds in hardware:

| Fault | Condition | Meaning |
|-------|-----------|---------|
| `STACK_OVERFLOW` | `STO < sp_min` | Pushing 2 words would land below Zone ② floor |
| `STACK_CORRUPT`  | `STO > sp_max` | STO pointer is above the initial sentinel — corrupted |

Both bounds are **IDE-defined** via `sw` in the thread header; neither is a
literal constant in the FSM. Increasing `sw` widens the stack zone and
relaxes the overflow threshold automatically.

---

## Zone ③ — Freespace

`17+heapWords` to `sp_max` words (dynamic, IDE-defined; example: +81..+243,
163 words). This is the collision zone between the upward-growing Heap and
the downward-growing Stack. At Thread creation `Mint.Thread` verifies all
words in this zone are zero.

At runtime, Heap objects above heap base and Stack frames below `sp_max`
both consume words from this zone. The sum of live Heap allocation and live
Stack depth must not exceed `sp_max − 17 − heapWords + 1` words (example: 163).

This is the only zone in any Church Machine lump that is dynamically
variable at runtime. Function abstraction freespace is fixed at compile
time and never changes; Thread freespace is live.

---

## Zone ④ — Heap

`heapWords` words at offsets +17..+17+heapWords−1 (IDE-defined; example:
64 words, +17..+80). Fixed size set by the IDE slot metadata
at design time. Objects are allocated from base+17 upward using bump
allocation; DR5 tracks the current frontier (offset from word 17 to the
next free word).

**Object garbage collection.** Zone ④ is not individually scanned by the
hardware GC. The G-bit mark-and-sweep operates at the *Thread object*
level: when the system GC marks the Thread GT as reachable, the entire
lump — including Zone ④ — is considered live and is not examined further.
If the Thread GT becomes unreachable, the whole lump is reclaimed at once.
The hardware enforces only the outer boundary (the lump limit encoded in
CR12); all heap memory management within Zone ④ — allocation, object
layout, compaction, and freeing — is a software concern left to the
thread's own code.

---

## Zone ⑤ — Data Registers

16 words at offsets +1..+16. DR0–DR15 are 32-bit general-purpose
data registers. Always at the physical head of the Thread body (after the
header).

DR contents are raw 32-bit integers — subject to DREAD/DWRITE via a
Turing-rights view, never to LOAD/SAVE. A data value cannot be
reinterpreted as a GT.

By convention **DR5 is the heap allocation pointer** — a raw 32-bit integer
offset (relative to Zone ④ base, word 17) giving the next free word in the
heap. DR5 pairs with CR5 (the Heap GT) to form the complete heap register
pair: CR5 supplies the access right, DR5 supplies the position. DR5 is
the only DR with an architecture-level convention; DR0–DR4 and DR6–DR15
remain fully general-purpose.

---

## CHANGE Context Save

On every **CHANGE** (context switch), the hardware saves the outgoing
thread's per-thread state and restores the incoming thread's saved state.

**Saved and restored by CHANGE:**

| Register | Role |
|----------|------|
| **CR12** | Thread Identity (Priv zone) — lump base + word count |
| **CR5** | Heap GT — re-installed from incoming Zone ④ bounds automatically |
| **STO** | Stack Top Offset hidden register — current stack depth |
| **DR0–DR15** | All 16 data registers |
| **PC** | Program counter |
| **FLAGS** | Condition flags |
| **LAMBDA state** | LAMBDA_PC and LAMBDA-active flag |

**Never touched by CHANGE (system-wide):**

| Register | Role |
|----------|------|
| **CR13** | IRQ handler — one handler for the whole machine; CHANGE must not re-point it |
| **CR14** | Transient code-view (X) — re-derived by cLoad on the next CALL, not stored |
| **CR15** | Namespace root — all threads in the same application share one namespace |

CR0–CR4 and CR6–CR11 (Zone ①, the live capability registers) are **not**
saved on CHANGE — they are saved and restored only by explicit SAVE/LOAD
instructions within the thread. CR5 is the exception: CHANGE re-installs it
from the incoming thread's Zone ④ bounds automatically.

CR7–CR11 (Prog zone) are saved as part of Zone ① via SAVE/LOAD, not
via CHANGE. The boot sequence does not touch them; they start at whatever
value Zone ① carries in the `*.thread.zip` binary.

---

## Mint.Thread Validation

`Mint.Thread(base, n)` uses the same header-word format as `Mint.Lump`
but applies a modified validation sequence appropriate for `typ=10`
(clist-only) lumps with a live data body:

```
Step 1  Read Mem[base] — the header word.
Step 2  magic[31:27] == 0x1F — reject if not.
Step 3  typ[9:8] == 0b10 (clist-only) — reject if not; prevents calling
          Mint.Thread on a code lump.
Step 4  n-6[26:23] == 2 — Thread lump size is fixed at 256 words;
          reject if mismatch.
Step 5  cw[22:10] == 0 — Thread lump has no code; reject if non-zero.
Step 6  cc[7:0] > 0 AND 17 + cc + sw ≤ lumpSize − 12 — heapWords (cc) must be
          positive and all zones must fit; reject if not.
Step 7  Scan words 81..211 (Zone ③, Freespace): reject if any word
          is non-zero. Zone ①  and Zone ⑤ are pre-populated by the
          boot sequence and are not scanned.
Step 8  Copy initial GT Word 0 values into c-list tail (words 244..255).
Step 9  Issue E-GT (B E) for Scheduler, RW-GT (B R W) for Thread.
Step 10 Write single Object NS slot.
```

The difference from `Mint.Lump`:
- `typ` is `10`, not `00`
- `cw == 0` is enforced, not derived
- Freespace scan covers Zone ③ only (not words 1..cw+1, since cw=0)
- Zone ① and Zone ⑤ are intentionally pre-populated; the scan skips them
- Two GTs are issued instead of one

---

## Thread.zip Distribution Format

Thread lumps are distributed as `*.thread.zip` files, following the same
ZIP container rules as function abstraction lumps (bit 3 = 0, uncompressed
size present in local file header). The contained binary is the 256-word
Thread lump image — header word followed by the five zones.

```
MyApp.thread.zip
+-- MyApp.thread.bin    ← 256-word Thread lump binary (1 024 bytes)
                           Word 0:        0xF900_020C (header)
                           Words 1..16:   Zone ⑤ — DR0..DR15 (all zero at creation)
                           Words 17..80:  Zone ④ — Heap (all zero at creation)
                           Words 81..211: Zone ③ — Freespace (all zero — Mint verifies)
                           Words 212..243: Zone ② — LIFO Stack (all zero at creation)
                           Words 244..255: Zone ① — initial CR0..CR11 GT Word 0 values
```

The ZIP pre-allocation sequence is identical to that for function
abstraction lumps — the Locator reads `uncompressed_size` from the local
file header, derives `n = log2(size / 4) = 8` (always 8 for Thread), calls
the Memory Manager to reserve a 256-word region, inflates into it, then
passes `(base, 8)` to `Mint.Thread` for validation and GT issuance.

### What the IDE Writes at Compile Time

The IDE populates Zone ① (words 244..255) with the initial GT Word 0 values
that the Thread will hold in CR0..CR11 on first context-load. These are the
thread's birth capabilities — whatever the application requires. The
architecture does not prescribe which system GTs go in which CR slot;
system GTs (Scheduler, Mint, NS write authority, etc.) live in c-list slots
and are LOADed into general-purpose CRs as needed at runtime. All other
zones are all-zero in the distributed binary; runtime activity populates
Stack, Heap, and DR.

Zone ③ must be all-zero in the zip binary. `Mint.Thread` verifies this at
install time and rejects the binary if any freespace word is non-zero.

---

# Appendix B — Namespace LUMP

## Overview

A **Namespace LUMP** is the root lump of a deployed application. Every
running Church Machine application has exactly one Namespace LUMP, which
defines three things that no other lump type defines:

1. **Physical memory map** — the base address and total size of the
   application's entire address space.
2. **Namespace Table** — a fully pre-populated directory of every
   abstraction the application can ever reach, in Live, Outform, or NULL
   state.
3. **Lazy-load machinery** — the Outform token format and the Locator
   interface that fetches absent lumps on demand from a Home Base IDE.

The system's root Namespace LUMP is Boot.NS (Slot 0), which spans the
entire physical address space and whose NS Table covers every object in
the machine. Application-scope Namespace LUMPs cover a sub-range and
list only the abstractions their application references.

---

## Namespace LUMP Header Word (Word 0)

A Namespace LUMP is always a clist-only lump (`typ=10`). It contains no
executable code — the body is Binary Data (NS Table entries). `cw` is
always `0` and there is no c-list of capability slots; the tail of the
lump holds the NS Table entries, not GT Word 0 slots.

### Boot.NS Header

```
31      27 26    23 22                10 9   8 7              0
+──────────+────────+──────────────────+──────+────────────────+
│ 0x1F [5] │ n-6[4] │     cw=0 [13]    │10[2] │    cc [8]      │
+──────────+────────+──────────────────+──────+────────────────+
```

| Field | Boot.NS value | Meaning |
|-------|--------------|---------|
| magic | 0x1F | Traps if executed out-of-sequence |
| n-6   | 8 (2^14 = 16 384 words) | Covers full 64 KB physical address space |
| cw    | 0 | No code section — NS Table is binary data only |
| typ   | 10 | clist-only — not callable, no init microcode |
| cc    | 3 | Locator count embedded in header; no GT Word 0 c-list slots |

### Application NS Header

```
Boot.NS  (n=14, cw=0, cc=3, typ=10):  0xFF00_0003
App.NS   (n=10, cw=0, cc=4, typ=10):  0xFA00_0004
```

---

## Physical Memory Map

The Namespace LUMP's E-GT (Word 1 = base, Word 2 limit_offset) defines
the **complete physical address range** the application owns. No memory
outside this range is accessible to the application — Mint refuses to
issue GTs that reference addresses beyond the NS LUMP's limit.

```
┌─────────────────────────────────────────────────────────┐  ← base
│  Word 0     NS LUMP header (typ=10, cw=0)               │
│  Words 1..NS_TABLE_START-1  Freespace (all-zero)        │
│  Words NS_TABLE_START..NS_TABLE_END  NS Table           │  ← N × 3 words (Binary Data)
│  Words NS_TABLE_END+1..lumpSize-1  Trailing zeros       │
└─────────────────────────────────────────────────────────┘  ← base + lumpSize - 1
```

### Boot.NS Physical Map (simulator)

| Region | Start | End | Size | Contents |
|--------|-------|-----|------|----------|
| NS LUMP freespace | 0x0001 | 0xFCFF | variable | All zero — Mint verified by CRC scan per slot |
| NS Table | 0xFD00 | 0xFD83 | 44 × 3 = 132 words | 44 NS slots × 3 words each (Binary Data) |

The NS Table lives at a **hardware-known fixed offset** within Boot.NS.
On Tang Nano 20 K, `NS_TABLE_BASE = 0xFD00` is wired in the decoder;
on Efinix Ti60 F225, the base is parameterised but fixed at synthesis time.

---

## Namespace Table — Entry Format

The NS Table is a flat array of **N entries × 3 words**. N is the total
number of object slots in the namespace. Only the object owner holds
GT Word 0 (the per-holder credential) in their c-list — GT Word 0 is
never stored in the NS Table.

Each entry has one of three states: **Live**, **Outform**, or **NULL**.

```
Live entry   (lump resident in RAM):
  Word 1:  base [32]                    physical base of lump binary
  Word 2:  spare[4] | gt_seq[7] | limit_offset[21]
  Word 3:  spare[15] | G[1] | CRC[16]   CRC-16/CCITT over GT Wrd0[24:0]+W1+W2

Outform entry   (lump absent — lazy load pending):
  Word 1:  content_id[32]               first 32 bits of SHA256 content hash
  Word 2:  content_id[32]               next 32 bits of SHA256 content hash
  Word 3:  spare[7] | loc_idx[8] | flags[8] | OUTFORM_MARKER[9]
           loc_idx   → which Locator NS slot to call for this fetch
           flags     → bit 0: required (fault if unreachable)
                       bit 1: bundle (pre-bundled in install zip)
                       bit 2: pinned (do not evict)
           OUTFORM_MARKER = 0x1FF (9-bit sentinel, distinguishes from Live CRC)

NULL entry   (no capability installed):
  Word 1:  0x00000000
  Word 2:  0x00000000
  Word 3:  0x00000000
```

### Distinguishing Live from Outform

The hardware distinguishes the three states at LOAD time using the low 9
bits of NS Word 3:

| NS Word 3 [8:0] | Interpretation |
|-----------------|----------------|
| `000000000` | NULL — all zero, faults immediately |
| `111111111` (0x1FF) | Outform — Absent event fired, Locator invoked |
| anything else | Live — CRC-16 field; LOAD re-computes and checks |

A valid CRC-16/CCITT value of exactly `0x1FF` is astronomically unlikely
and forbidden by Mint (Mint re-generates the lump if this collision occurs).
The hardware state machine therefore requires no extra tag bit.

---

## NS Entry State Machine

```
         Mint.Lump()                Locator.fetch() + Mint.Lump()
 NULL ─────────────────► Live ◄──────────────────────────────── Outform
  ▲                        │                                       ▲
  │      Revoke /          │ Evict                                 │
  │      Mint.Revoke()     ▼                                       │
  └──────────────────── Outform ──── IDE token preserved ──────────┘
                           │
                           ▼
                      Absent event on LOAD/CALL
                      → Locator subroutine invoked
```

| Transition | Who | How |
|------------|-----|-----|
| NULL → Live | Mint.Lump() | Binary validated, E-GT issued, NS Words 1-3 written |
| NULL → Outform | IDE install | Outform token written into NS Words 1-3 |
| Outform → Live | Locator + Mint.Lump() | Binary fetched, inflated, validated, NS slot updated |
| Live → Outform | Memory Manager (eviction) | Lump binary freed; Outform token restored from manifest |
| Live → NULL | Mint.Revoke() | gt_seq incremented in NS Word 2, slot zeroed |
| Outform → NULL | Mint.Revoke() | Slot zeroed; content hash discarded |

---

## Outform Token Detail

The 96-bit Outform token (NS Words 1–3) encodes enough information for
the Locator to perform a cold fetch without any additional state:

```
NS Word 1  [31:0]   SHA256 content hash, bits [31:0]
NS Word 2  [31:0]   SHA256 content hash, bits [63:32]
NS Word 3  [31:9]   spare[7] | loc_idx[8] | dep_flags[8]
           [8:0]    0x1FF — Outform marker (sentinel value)
```

The full SHA256 hash (256 bits) is too wide for 3 × 32-bit words.
The first 64 bits (Words 1-2) are stored. The Locator fetches the lump by
URL (resolved from a label→URL table it maintains), then verifies the full
SHA256 against the downloaded bytes. The 64-bit prefix is sufficient for
the Locator to select the correct cached copy if multiple versions exist
locally.

`loc_idx` is the NS slot index of the Locator abstraction to call. This
allows different fetch policies (LAN cache, CDN, origin, peer-to-peer)
for different subsets of the namespace, simply by pointing groups of
Outform entries at different Locator NS slots.

---

## Lazy Load Protocol — Step by Step

This is the full thread-level sequence when a LOAD or CALL targets an
Outform NS slot. The calling thread is never aware of the pause.

```
① Thread issues:  LOAD CR_d, CR6, #slot_idx
                  (or CALL CR_s  where CR_s.object_id → Outform NS slot)

② Hardware reads NS[slot_idx] Words 1-3.
   Detects Outform marker (Word 3 [8:0] == 0x1FF).
   Hardware parks calling thread (CHANGE to Scheduler).

③ Scheduler receives control.
   Reads Outform token from NS[slot_idx].
   Extracts loc_idx (NS Word 3 [24:17]) and content_id prefix (Words 1-2).

④ Scheduler CALLs Locator[loc_idx].fetch(content_id_prefix).

⑤ Locator resolves label → URL:
     label = Locator's internal label-to-URL table
     url   = cm://homebase.ide/{label}@sha256:{full_hash}

⑥ Locator sends HTTP GET to Home Base IDE:
     GET /lump/{label}@sha256:{hash}.lump.zip  HTTP/1.1
     Authorization: Bearer <PassKey credential>
   Response: ZIP file with the lump binary.

⑦ Locator verifies ZIP:
   a. Signature = 0x04034B50 ✓
   b. Bit 3 of flags = 0 (no data descriptor) ✓
   c. uncompressed_size → derive n = log2(size / 4) ✓
   d. n in [6..14] ✓

⑧ Locator calls Memory Manager (via RW-GT):
   base = MemoryManager.alloc(n)   → returns physical base address

⑨ Locator inflates ZIP payload into [base, base + 2^n × 4).

⑩ Locator verifies SHA256 of inflated binary — reject + free if mismatch.

⑪ Locator calls Mint.Lump(base, n):
   Mint validates header, scans freespace, validates c-list.
   Mint writes Live NS slot:
     NS[slot_idx].Word1 = base
     NS[slot_idx].Word2 = spare | gt_seq | (lumpSize-1)
     NS[slot_idx].Word3 = spare | G=0 | CRC-16(...)
   Mint issues E-GT to Locator (Locator stores in its own c-list).

⑫ Locator RETURNs to Scheduler.

⑬ Scheduler un-parks calling thread (CHANGE back).

⑭ Thread retries LOAD / CALL.
   NS slot is now Live — LOAD reconstructs GT normally.
   Execution continues as if the lump had always been present.
```

**Cost:** one CHANGE out (step ②) and one CHANGE back (step ⑬). The
thread pays exactly two context switches for a cold fetch. All network
I/O is absorbed inside the Locator's own CHANGE cycle (see Flag Pool in
the main body). The calling thread sees no network latency — only a
brief scheduler pause.

---

## Home Base IDE Interface

The Home Base IDE is the authoritative source for all application lumps.
In the Church Machine IDE development environment this is the Replit-hosted
Flask server (`server/app.py`). In production it is any server conforming
to the following interface.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/lump/{label}@sha256:{hash}.lump.zip` | Fetch a specific lump by label and content hash |
| `GET` | `/namespace/{app_id}/manifest.json` | Fetch the application's NS manifest |
| `GET` | `/namespace/{app_id}/bundle.zip` | Fetch a full install bundle (namespace.zip) |
| `POST` | `/lump/publish` | Upload a new lump binary (authenticated) |
| `GET` | `/lump/{label}/latest` | Resolve latest hash for a label (for IDE use only) |

### Authentication

```
Authorization: Bearer <PassKey GT credential>
```

The Locator holds a PassKey E-GT in its c-list (issued by the IDE at
install time). The Home Base IDE verifies the credential against its
registered application PassKey list. Unsigned requests are rejected.

### Response Format

A successful `GET /lump/...` returns:
```
Content-Type: application/zip
Content-Length: <compressed_size>

[ZIP local file header]
[Compressed lump binary — DEFLATE or RLE]
[ZIP central directory]
```

Bit 3 of the ZIP general-purpose flags is always 0 (uncompressed size
present in local file header). The Locator reads the uncompressed size
before downloading the body, pre-allocates physical memory, then streams
directly into the allocated region.

---

## Application Namespace Bundle (namespace.zip)

An application is distributed as a `namespace.zip` file containing the
NS LUMP binary, a manifest, and an optional set of pre-bundled dependency
lumps. The Loader inflates the bundle at install time.

```
app_name.namespace.zip
├── manifest.json          ← install metadata + NS Table declarations
├── App.bin                ← application NS LUMP binary
├── [optional pre-bundled deps]
│   ├── SlideRule.bin
│   ├── Decimal.bin
│   └── ...
└── [everything else is Outform — fetched on demand from Home Base]
```

### manifest.json Schema

```json
{
  "app_id":   "com.example.SlideRuleApp",
  "version":  "1.0.0",
  "ns_lump":  "App.bin",
  "base":     "0x00010000",
  "n":        10,
  "entries": [
    {
      "slot":    0,
      "label":   "Boot.NS",
      "state":   "live",
      "file":    null,
      "hash":    null
    },
    {
      "slot":    16,
      "label":   "SlideRule",
      "state":   "bundled",
      "file":    "SlideRule.bin",
      "hash":    "sha256:a3f9c2..."
    },
    {
      "slot":    17,
      "label":   "Decimal",
      "state":   "outform",
      "file":    null,
      "hash":    "sha256:d4e8f1...",
      "loc_idx": 2,
      "flags":   1
    }
  ]
}
```

| `state` value | NS Table entry written | Binary needed? |
|---------------|----------------------|----------------|
| `live`        | Live entry (base+CRC) | Must be present at install |
| `bundled`     | Live entry after Mint | Included in namespace.zip |
| `outform`     | Outform token (hash + loc_idx) | Fetched on demand |
| `null`        | NULL entry (all zeros) | Never fetched |

### Install Sequence

```
1. Loader receives namespace.zip
2. Extract manifest.json — parse base, n, entry list
3. Verify App.bin header: magic=0x1F, typ correct, n matches
4. Pre-allocate NS LUMP region at declared base
5. Inflate App.bin into region — Mint.Lump validates and issues E-GT
6. For each 'bundled' entry:
   a. Inflate *.bin from zip into Memory Manager allocation
   b. Mint.Lump → Live NS slot
7. For each 'outform' entry:
   a. Write Outform token (hash prefix + loc_idx + flags) into NS slot
8. For each 'null' entry:
   a. Zero NS slot (already zero; explicit for clarity)
9. Install complete — NS Table is fully populated
   Any un-fetched lumps fire Absent events on first LOAD/CALL
```

---

## Boot.NS as the Root Namespace LUMP

Boot.NS (Slot 0) is a special case of the Namespace LUMP:

| Property | Boot.NS | Application NS LUMP |
|----------|---------|---------------------|
| Base | 0x0000 | Declared in manifest |
| limit_offset | Entire RAM − 1 | 2^n − 1 (sub-range) |
| typ | 10 (clist-only — no init microcode) | 10 always |
| cw | 0 | 0 always |
| N (NS Table entries) | All 46 boot slots | App-specific count |
| NS Table location | `NS_TABLE_BASE = 0xFD00` (hardware fixed) | Declared in manifest or header field |
| Locators (cc) | 3 (Mint, Scheduler, Locator — header field only, no GT slots) | App-chosen count (header field only) |
| Issued by | Hardware at power-on (pre-written) | Mint.Lump() at install time |
| Distribution | Embedded in FPGA bitstream | namespace.zip |

Boot.NS is the only lump that is not itself issued by Mint. It is written
directly by the hardware synthesis toolchain into the FPGA block RAM image.
All subsequent Namespace LUMPs (application and sub-application) are issued
by Mint and occupy sub-ranges of the physical address space that Boot.NS
already owns.

---

# All Three Lump Types — Side-by-Side Reference

| Property | Function Abstraction | Thread | Namespace LUMP |
|----------|---------------------|--------|----------------|
| **Purpose** | CALL & RETURN code unit (one abstraction, several methods) | Live execution context (one thread) · Full machine state save on suspension using CHANGE | SWITCH into CR15 · NS Address-space root + NS Table + lazy-load host |
| **Word 0** | Header `0x1F` | Header `0x1F` | Header `0x1F` |
| **`typ` field** | `00` — callable · Enter only | `10` — clist-only | `10` NS table directory only |
| **`cw` field** | Code word count (≥ 0) | Always `0` | Always `0` |
| **`cc` field** | Compiler-chosen GT count | **heapWords** (IDE-set; caps always 12, architecture-fixed) | None — NS Table only |
| **Example header** | `0xF881_AC00` (Decimal, n=7 cw=107 cc=0) | `0xF900_8240` (n-6=2, sw=32, heapWords=cc=64) | Binary data |
| **Entry point** | PC = 1 on every CALL | Never — not callable | Never — not callable |
| **Words 1..cw** | CLOOMC code (dispatcher + methods) | Absent — `cw = 0` | Boot / init microcode and SWITCH |
| **Freespace zone** | Compile-time fixed · all-zero · immutable per release | Dynamic 131 words — Stack ↓ and Heap ↑ collide | Between init code and NS Table · all-zero |
| **C-list zone** | Last `cc` words · list E-GTs · compiler-set | Last 12 words · CR0–CR11 + LIFO Stack | BINARY DATA |
| **Unique body** | Code and C-List | 5 zones: Header · Caps · Stack · Free · Heap · DR | NS Table (N × 3-word entries: Inform GT) |
| **Physical scope · 2^n frame size** | One lump region | One 256/512/1024-word thread frames | Entire application address space |
| **NS Table** | None — uses parent NS | None — uses parent NS | IS the NS Table |
| **Outform support** | No — all deps must be Live at call time | No | Yes — Absent event → Locator fetch |
| **Lazy load** | Fetch from Home Base Library | Not applicable | Hosts the Locator; fetches from Home Base IDE |
| **Issued by** | `Mint.Lump(base, n)` | `Mint.Thread(base, n)` | `Mint.Lump(base, n)` or FPGA-embedded (Boot.NS) |
| **Transient CR14** | Code view (X) words 1..cw | Loaded into CR12 | Code view (X) if typ=00 |
| **Transient CR6** | C-list view (L) last `cc` words | Not derived | C-list view (L) last `cc` words |
| **Issued GTs** | One E-GT (caller holds) | GT (Thread) | GT NS |
| **GC interaction** | G bit in NS slot Word 3 | G bits in all live CRs in Zone ① | Live & Dead slots |
| **lumpSize** | 2^n compiler-chosen (64–16 384 words) | IDE defined 2^n < 1024 | 2^n IDE-chosen; Boot.NS = 2^14 = 16 384 words |
| **Freespace verified by Mint** | Yes — words cw+1..lumpSize-cc-1 all-zero | Zone ③ only (words 45..175); Zone ① skipped | Scan CRC per slot |
| **Distribution format** | `*.lump.zip` | `*.thread.zip` | `*.namespace.zip` |
| **Simulator NS slot** | Most slots (Salvation=4, Mint=6, …) | Slots 1 and 45 | Slot 0 (Boot.NS) |
| **CALL target** | Yes | No | No |

---

*Document applies to: Church Machine IDE simulator · Boot.NS slots 0 (Boot.NS), 1 (Boot.Thread), 2 (Boot.Abstr), 45 (Thread) · Tang Nano 20 K + Efinix Ti60 F225 targets.*
