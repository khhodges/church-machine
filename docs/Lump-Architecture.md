# Church Machine — Lump Architecture

**v1.0 — April 2026**
**CONFIDENTIAL**

---

## What is a Lump?

A **Lump** is the self-defining binary object of the Church Machine.

Every piece of runnable code, every live execution context, every named
address space, and every data region is a Lump. A Lump is always a
contiguous, power-of-2 aligned block of 32-bit words in physical memory.
Its first word — the **Header Word** — identifies what kind of object the
Lump is and gives the hardware everything it needs to use that object
correctly.

Nothing outside the Lump describes the Lump. The Header Word is the
complete and authoritative self-description.

---

## Lump Size Rule

Lump size is always a power of 2, minimum 64 words, maximum 16 384 words:

```
lumpSize = 2^n   where 6 ≤ n ≤ 14
```

The size exponent `n` is encoded in the Header Word. The hardware derives
the boundary of every internal zone — code section, freespace, capability
list — from the single header word without any external manifest or
side-channel information.

---

## The Header Word (Word 0)

The first word of every Lump is a 32-bit metadata descriptor. It uses
opcode `0x1F` (`11111b`) — an instruction that is deliberately undefined
on the Church Machine ISA. If Word 0 were ever accidentally executed, the
hardware traps rather than silently corrupting state.

```
31      27 26    23 22                10 9   8 7              0
+──────────+────────+──────────────────+──────+────────────────+
│ magic[5] │ n-6[4] │     cw [13]      │typ[2]│    cc [8]      │
+──────────+────────+──────────────────+──────+────────────────+
```

| Field | Bits  | Meaning |
|-------|-------|---------|
| magic | 31:27 | Always `11111` (0x1F). Causes a hardware trap if executed. |
| n-6   | 26:23 | Size exponent. `lumpSize = 2^(val+6)`. Valid range 0–8 → 64–16 384 words. |
| cw    | 22:10 | Code Word count (0–8191). Words 1..cw are executable instructions. |
| typ   | 9:8   | Object type — identifies which Lump type this is (see below). |
| cc    | 7:0   | Capability-list slot count (0–255), or repurposed per Lump type. |

32 bits total. No spare bits. The `typ` field is the authoritative
discriminator between Lump types.

---

## The Four Lump Types

The `typ` field in the Header Word selects one of four Lump types. Each
type has a distinct body layout, a distinct role in the architecture, and
distinct hardware behaviour on CALL, LOAD, and CHANGE.

### `typ = 00` — Abstraction Lump

The standard unit of runnable code. An Abstraction Lump contains a CLOOMC
code section and an optional capability list (c-list). It is the only Lump
type that can be the target of a `CALL` instruction.

**Body layout:**

```
┌─────────────────────────────────────────────────────────┐  ← word 0
│  Word 0     Header word  (typ=00, cw>0)                 │
├─────────────────────────────────────────────────────────┤  ← word 1  (PC = 1)
│  Words 1 … cw   Code section                           │
│                 Dispatcher at PC = 1, then methods      │
├─────────────────────────────────────────────────────────┤  ← word cw + 1
│  Words cw+1 … lumpSize-cc-1   Freespace                │
│                 All zeros — verified by Mint at load    │
├─────────────────────────────────────────────────────────┤  ← word lumpSize - cc
│  Words lumpSize-cc … lumpSize-1   C-list               │
│                 cc × 1-word Golden Token slots          │
└─────────────────────────────────────────────────────────┘
```

- PC starts at **word 1** on every CALL; word 0 is never executed.
- The c-list is pre-populated at compile time with Golden Tokens (GTs)
  for every abstraction this code depends on.
- Mint issues one **E-GT** on install; transient CR14 (code view, X) and
  CR6 (c-list view, L) are derived fresh on each CALL.
- Distributed as `*.lump.zip`.

**Example header values:**

| Abstraction | n | cw  | cc | Header word  |
|-------------|---|-----|----|--------------|
| Decimal     | 7 | 107 | 0  | `0xF881_AC00` |
| SlideRule   |10 | 525 | 1  | `0xFA08_3401` |
| Boot.Abstr  | 8 |   0 | 46 | `0xF900_002E` |

---

### `typ = 01` — Data Lump

A raw data region with no code section and no c-list. The body is
programmer-defined binary data.

- `cw = 0` always; there is no dispatcher or method table.
- `cc = 0` always; the c-list mechanism does not apply.
- The hardware refuses `CALL` on a Data Lump (no E permission is granted
  by Mint for this type).
- Access is via **RW-GT** (read/write data) or **R-GT** (read-only)
  issued by Mint against the lump's physical region.
- Freespace rule: all words between the header and `lumpSize-1` that are
  not declared data must be zero.
- Distributed as `*.data.zip`.

---

### `typ = 10` — Thread Lump  ·  Namespace Lump

Both Thread Lumps and Namespace Lumps carry `typ = 10`. Neither is
callable as code. The `cw` field is always `0` for both. They are
distinguished from each other by context and usage — not by an additional
tag bit. Within a given system there is exactly one Namespace Lump (Boot.NS
at Slot 0) and one or more Thread Lumps; the Scheduler knows which is which
by the NS slot it references.

---

#### `typ = 10, cw = 0` — Thread Lump

A live execution context. A Thread Lump holds the full hardware state of
one thread: context registers, LIFO stack, heap, and data registers. It is
never called directly; the `CHANGE` instruction switches the processor into
or out of a Thread Lump.

The `cc` field in a Thread Lump header is repurposed: it encodes
**heapWords** (the initial heap allocation), not a c-list count. The
architectural c-list for a thread is always the fixed 12-slot zone at the
tail of the lump (CR0–CR11 GT Word 0 values), whose size is
architecture-fixed, not recorded in `cc`.

**Body layout — five zones (word addresses within the 256-word lump):**

```
┌─────────────────────────────────────────────────────────┐
│  Word 0          Header (typ=10, cw=0)                  │  Zone: Header
├─────────────────────────────────────────────────────────┤
│  Words 1..16     Data Registers DR0–DR15                │  Zone ⑤
├─────────────────────────────────────────────────────────┤
│  Words 17..80    Heap (grows upward)                    │  Zone ④
├─────────────────────────────────────────────────────────┤
│  Words 81..211   Freespace (all-zero; Mint verified)    │  Zone ③
├─────────────────────────────────────────────────────────┤
│  Words 212..243  LIFO Stack (grows downward)            │  Zone ②
├─────────────────────────────────────────────────────────┤
│  Words 244..255  Initial CR0–CR11 GT Word 0 values      │  Zone ①
└─────────────────────────────────────────────────────────┘
```

- Zone ① is pre-populated by the IDE at compile time with the thread's
  birth capabilities (one GT Word 0 per context register slot).
- Zone ③ must be all-zero in the distributed binary; Mint.Thread verifies
  this and rejects any non-zero freespace word.
- Mint issues two GTs on install: an **E-GT** for the Scheduler and an
  **RW-GT** for the Thread itself.
- Distributed as `*.thread.zip`.

**Example header:**  `0xF900_020C`  (n=8, cw=0, heapWords=12)

---

#### `typ = 10, cw = 0` — Namespace Lump

The root lump of a deployed application. A Namespace Lump defines the
complete physical address space the application owns and holds the
**Namespace Table** — a flat directory of every object the application can
ever reach.

The `cc` field in a Namespace Lump header records the **number of Locator
entries** in the NS Table header, not a c-list count. The body is binary
data (NS Table entries), not GT slots.

**Body layout:**

```
┌─────────────────────────────────────────────────────────┐  ← word 0
│  Word 0          NS LUMP header (typ=10, cw=0)          │
├─────────────────────────────────────────────────────────┤
│  Words 1..NS_TABLE_START-1   Freespace (all-zero)       │
├─────────────────────────────────────────────────────────┤
│  Words NS_TABLE_START..NS_TABLE_END                     │
│                  NS Table  (N × 3-word entries)         │
├─────────────────────────────────────────────────────────┤
│  Words NS_TABLE_END+1..lumpSize-1   Trailing zeros      │
└─────────────────────────────────────────────────────────┘
```

Each NS Table entry is three 32-bit words and carries one of three states:

| State | Word 1 | Word 2 | Word 3 | Meaning |
|-------|--------|--------|--------|---------|
| **Live** | base address | `spare\|gt_seq\|limit_offset` | `spare\|G\|CRC-16` | Lump is resident in RAM |
| **Outform** | SHA256 prefix [31:0] | SHA256 prefix [63:32] | `spare\|loc_idx\|flags\|0x1FF` | Lump absent — Locator fetch on first LOAD/CALL |
| **NULL** | `0x00000000` | `0x00000000` | `0x00000000` | No capability installed |

The low 9 bits of NS Word 3 distinguish the three states: `000000000` =
NULL, `111111111` (0x1FF) = Outform, anything else = Live (CRC-16).

The Boot.NS Lump (Slot 0) is the system root: it spans the entire physical
address space and its NS Table covers every object in the machine. It is
the only Lump not issued by Mint — it is written directly into the FPGA
block RAM at synthesis time.

**Example header values:**

| Lump    | n  | cw | cc | Header word   |
|---------|----|----|----|---------------|
| Boot.NS | 14 |  0 |  3 | `0xFF00_0003` |
| App.NS  | 10 |  0 |  4 | `0xFA00_0004` |

---

### `typ = 11` — Outform Lump  *(reserved header type)*

An Outform header marks a Lump slot that has been claimed in the NS Table
but whose binary body has not yet been inflated into physical memory. The
slot holds an Outform token (SHA256 content-hash prefix + Locator index)
rather than a live binary.

When a thread issues `LOAD` or `CALL` against an Outform NS slot, the
hardware parks the calling thread and the Scheduler invokes the Locator to
fetch, verify, and inflate the binary. Once Mint.Lump completes the NS
slot transitions from Outform to Live and the thread retries transparently.

This type appears in the NS Table, not as a binary resident in memory. The
`typ=11` value in a lump header is reserved for this class; no resident
binary carries it.

---

## Lump Type Summary

| `typ` | Name | Callable | Code | C-list | Primary use |
|-------|------|----------|------|--------|-------------|
| `00` | Abstraction | Yes — `CALL` | CLOOMC dispatcher + methods | Yes — GT slots | All runnable abstractions |
| `01` | Data | No | None | None | Raw binary data regions |
| `10` | Thread | No — `CHANGE` | None (`cw=0`) | Fixed 12-slot zone (birth caps) | Live execution context |
| `10` | Namespace | No | None (`cw=0`) | None — NS Table body | Address-space root + NS directory |
| `11` | Outform *(NS only)* | Pending | Not yet inflated | Not yet inflated | Absent lump placeholder in NS Table |

---

## Mint Validation

Every Lump (except Boot.NS) must pass `Mint.Lump(base, n)` before it can
be used. Mint validates in strict order:

```
Step 1  Read Mem[base] — the header word.
Step 2  magic[31:27] == 0x1F — reject if not.
Step 3  n-6[26:23] <= 8 — reject if lump would exceed 16 384 words.
Step 4  lumpSize = 2^(n-6+6).
Step 5  cw[22:10] <= lumpSize - cc - 2 — reject if header is self-contradictory.
Step 6  cc[7:0] <= lumpSize - 2 — reject if c-list overflows lump.
Step 7  Scan words cw+1 .. lumpSize-cc-1: reject if any word is non-zero.
Step 8  Validate c-list slots (each must be a well-formed GT Word 0).
Step 9  Issue the appropriate GT(s) and write the NS slot.
```

Steps 2–6 operate on the header word only. The freespace scan (Step 7) and
c-list validation (Step 8) are gated behind those cheap arithmetic checks,
so a malformed or malicious header is rejected before Mint touches the
binary body.

Thread Lumps follow `Mint.Thread`, which enforces `cw=0`, skips Zone ①
and Zone ⑤ in the freespace scan (they are intentionally pre-populated),
and issues two GTs instead of one.

---

## The C-List Rule

A c-list is strictly an array of 32-bit **Golden Token (GT) words** — one
GT per slot. No raw address, scalar, or data word may occupy a c-list slot.
The hardware and simulator both refuse to load anything other than a
MAC-validated GT from a c-list slot.

A null word (`0x00000000`) is a valid GT encoding meaning *empty/invalid*
— it is structurally legal but semantically unusable. It does not violate
the c-list rule.

This constraint is what gives the capability system its security property:
a program cannot smuggle a raw address or arbitrary data through a c-list
slot.

---

## Distribution Formats

| Lump type | File extension | Contents |
|-----------|---------------|----------|
| Abstraction | `*.lump.zip` | Single `.bin` file — header + code + freespace + c-list |
| Thread | `*.thread.zip` | Single `.bin` file — header + five zones |
| Namespace | `*.namespace.zip` | `manifest.json` + NS LUMP `.bin` + optional bundled deps |
| Data | `*.data.zip` | Single `.bin` file — header + raw data |

All ZIP containers: bit 3 of general-purpose flags must be `0`
(uncompressed size present in local file header). The Locator reads the
uncompressed size before downloading the body and pre-allocates physical
memory accordingly. ZIP files where bit 3 is `1` are rejected.

---

## Cross-References

- `docs/CM_LUMP_SPECIFICATION.md` — Full binary-level specification with
  encoding formulae, example words, and hardware flow diagrams
- `docs/foundation-lump-design.md` — Boot image design and three-lump
  foundation architecture
- `docs/golden-tokens.md` — GT format, CRC coverage, and permission model
- `docs/architecture.md` — Overall Church Machine architecture

---

*Document applies to: Church Machine IDE simulator · Tang Nano 20 K ·
Efinix Ti60 F225 targets.*

*Confidential — Kenneth Hamer-Hodges — April 2026*
