# Locator — Absent-Lump Fetch Protocol

---

## Overview

When a thread executes **LOAD** against a c-list slot whose GT type is
`Outform` (`typ=10`), the lump binary is not resident in physical memory.
The hardware fires the **Absent event** and invokes the **Locator** as a
secure subroutine `CALL` in the same thread. There is no scheduler transfer,
no thread park, and no context switch. The calling thread's register state
stays live; the Locator executes on its stack.

The Locator fetches the `lump.zip`, inflates and validates it, calls `Mint.Lump()`
to write the Live NS slot, then `RETURN`s. The hardware automatically retries
the `LOAD` instruction against the now-Live NS slot, and the calling thread
continues normally.

This model keeps the hardware NS table small (256 slots × 16 bytes = 4 KB)
and allows a practically unlimited catalogue of abstractions to be available
without pre-loading them all.

---

## Terminology

| Term | Definition |
|------|------------|
| **Outform GT** | A c-list slot Word 0 with `typ=10`. Signals that the lump is registered but not yet resident. The `object_id` field identifies which NS slot holds the recovery token. |
| **Outform NS slot** | The three NS words for the object hold a **96-bit opaque IDE token** (Words 1–3). Hardware passes this token to the Locator when the Absent event fires. |
| **Live NS slot** | The three NS words hold the real lump descriptor: `base` (Word 1), `gt_seq + limit_offset` (Word 2), `CRC-16` (Word 3). `LOAD` succeeds against a Live slot. |
| **Locator** | A ROM-resident or namespace-installed lump invoked as a secure `CALL`. It owns the fetch-inflate-validate sequence and holds `NetworkIO`, `Mint`, and `NamespaceWrite` capabilities in its c-list. |
| **IDE token** | The 96-bit value stored in the Outform NS slot (Words 1–3). Opaque to hardware; interpreted by the Locator to identify and authenticate the lump source. |
| **Absent event** | The hardware condition raised when `LOAD` encounters an Outform GT. Invokes the Locator as a subroutine; does not suspend the thread. |
| **Mint** | The system component that validates a raw lump binary and, on success, writes the Live NS slot and issues an E-GT. |

---

## Trigger: The Absent Event

The Locator is invoked when **all** of the following are true:

1. A thread executes **`LOAD`** against a c-list slot.
2. The GT in that slot has **`typ = 10`** (Outform).
3. The GT's `gt_seq` matches the stored sequence in the Outform NS slot — the GT is valid, just not yet resident.

The hardware reads the three Outform NS words for `object_id`, extracts the
96-bit IDE token, and invokes the Locator as a secure subroutine `CALL` in
the same thread. The 96-bit IDE token is passed via the `CALL` argument
convention (DR registers).

> **What does NOT happen:** There is no scheduler transfer, no thread park,
> and no interrupt. From the thread's perspective, `LOAD` executes with a
> latency cost but otherwise atomically.

---

## NS Slot States

A namespace slot transitions between two states during the lazy-load lifecycle:

### Outform state (lump not resident)

| NS Word | Contents |
|---------|----------|
| Word 0  | E-GT (Outform typ=10, permissions, `gt_seq`, `object_id`) |
| Word 1  | IDE token bits [95:64] |
| Word 2  | IDE token bits [63:32] |
| Word 3  | IDE token bits [31:0] |

The 96-bit IDE token is opaque to hardware. It is passed to the Locator
verbatim and interpreted to resolve the network source.

### Live state (lump resident)

| NS Word | Contents |
|---------|----------|
| Word 0  | E-GT (Inform typ=01, permissions, `gt_seq`, `object_id`) |
| Word 1  | `base [32]` — physical base address of the lump |
| Word 2  | `gt_seq [7]` \| `limit_offset [21]` |
| Word 3  | `spare [15]` \| `G [1]` \| `CRC-16 [16]` |

The Live NS slot is written atomically by **Mint** after it has validated
the entire lump binary (see Step 8 below). `LOAD` succeeds against a Live slot.

> **Note on the G bit:** `G=1` in a Live NS Word 3 marks the lump for
> eviction (see Eviction below). During normal operation after a fresh lazy
> load, `G=0`.

---

## Protocol — Step by Step

### Step 1 — Absent event fires
**Actor:** Hardware

**Trigger:** Thread executes `LOAD`; GT `typ=10` (Outform).

The hardware reads the three Outform NS words for `object_id`, extracting the
96-bit IDE token, then invokes the Locator as a secure subroutine `CALL` in the
same thread, passing the IDE token via DR registers.

---

### Step 2 — Locator saves the IDE token
**Actor:** Locator

The Locator saves the 96-bit IDE token from the DR registers into its own
working memory before any NS slot modification. This **saved token is the
restore token**: if the lump is later evicted, the NS slot must be reset to
the Outform state, which requires writing the original token back into Words
1–3. Without this save, eviction would be unable to restore the lazy-load path.

---

### Step 3 — Fetch the lump.zip
**Actor:** Locator (via NetworkIO capability)

The Locator resolves the IDE token to a network source (URL, DHT key, or local
cache address). It fetches the `lump.zip` file into a temporary working region
it holds via a NetworkIO-derived RW-GT.

> Inflate (Step 6) reads from this zip buffer and writes to the separately
> allocated lump region. There is no second intermediate copy.

**Failure → fetch error:** Network error, timeout, or resource not found.
No physical memory has been allocated yet; NS slot unchanged (Outform, IDE
token intact). The Locator returns a fault code; `LOAD` raises a fault to
the thread's fault handler. The Outform NS slot is intact — a subsequent
`LOAD` re-triggers the full protocol.

---

### Step 4 — Read ZIP local file header; derive n
**Actor:** Locator

The Locator reads the first ~32 bytes of the zip buffer:

1. Verify signature = `0x04034B50`. Reject on mismatch.
2. Read byte offset 6 (general-purpose bit flags). **Assert bit 3 = 0.**
   (Bit 3 set means streaming mode; CRC-32, compressed size, and uncompressed
   size are all zero in the header and appear only in a trailing Data Descriptor.
   This defeats pre-allocation. Lump zips must be produced with bit 3 clear.)
3. Read `uncompressed_size` from byte offset 24.
4. Derive `n = log₂(uncompressed_size / 4)`.
   Reject if `uncompressed_size` is zero or not a power-of-two multiple of 4.
   Reject if `n < 6` (minimum 64 words) or `n > 14` (maximum 16 384 words).
5. Read CRC-32 at byte offset 16. Save it for Step 7.
6. Compute data start offset: `30 + file_name_length + extra_field_length`
   (lengths at byte offsets 26 and 28).

**Failure → zip format error:** Bad signature, bit 3 set, invalid size.
Any allocated region is freed; NS slot unchanged. Locator returns fault code.

---

### Step 5 — Pre-allocate physical memory
**Actor:** Locator (via Memory Manager capability)

Call `MemoryManager.alloc(n)` → receive `base` (a power-of-two-aligned physical
byte address). The region `[base, base + 2ⁿ × 4)` is reserved for this lump.
Pre-allocation before inflate means inflate writes directly into the destination
with no second copy.

**Failure → allocation error:** Out of memory. NS slot unchanged. Locator
returns fault code; `LOAD` raises a fault.

---

### Step 6 — Inflate zip payload into lump region
**Actor:** Locator

Seek to the data start offset in the zip buffer. Decompress (method 0 = STORE:
copy directly; method 8 = DEFLATE; method = custom RLE) from the zip buffer
into `[base, base + 2ⁿ × 4)`. Inflate reads from the zip buffer and writes to
the pre-allocated lump region — the zip file is the sole intermediate form.

**Failure → zip format error:** Corrupt stream. Free the allocated region;
NS slot unchanged. Locator returns fault code.

---

### Step 7 — Verify zip CRC-32
**Actor:** Locator

Compute CRC-32 over the inflated bytes at `[base, base + 2ⁿ × 4)`. Compare
against the CRC-32 read from the zip local file header (Step 4). Reject on
mismatch.

**Failure → zip format error:** CRC mismatch. Free the allocated region;
NS slot unchanged. Locator returns fault code.

---

### Step 8 — Validate and mint: Mint.Lump(base, n)
**Actor:** Locator → Mint

Call `Mint.Lump(base, n)`. Mint performs its standard 9-step validation
(see `LumpFormat.md § "Mint Validation Sequence"`):

1. Read `Mem[base]` — header word.
2. Verify `magic[31:27] == 0x1F`.
3. Verify `n-6[26:23] <= 8`; cross-check against transport-derived `n`.
4. Derive `lumpSize = 2^(n-6+6)`.
5. Verify `cw <= lumpSize - cc - 2`.
6. Verify `cc <= lumpSize - 2`.
7. Scan freespace words — must all be zero.
8. Validate each c-list slot (well-formed GT Word 0).
9. Issue one E-GT; write Live NS slot.

On success, Mint writes the three NS words for `object_id` (Words 1–3):
- Word 1: `base`
- Word 2: `gt_seq[27:21] | limit_offset[20:0]`
- Word 3: `spare[15] | G[1] | CRC-16[15:0]`

The NS slot transitions **Outform → Live** atomically.

**Failure → Mint rejection:** Mint frees the allocated region. The NS slot
is **never written** by Mint on failure — it remains Outform (IDE token
intact in Words 1–3). No restore operation is needed.

> **Ownership:** Mint owns physical region allocation/free only. NS slot
> ownership stays with the Locator throughout — Mint writes it exactly once
> on success and never touches it on failure.

---

### Step 9 — Locator returns; LOAD retries
**Actor:** Locator → Hardware

The Locator `RETURN`s to the same thread that invoked it. The hardware
automatically retries the **`LOAD`** instruction that fired the Absent event.
The NS slot is now Live; `LOAD` resolves normally, populates the CR, and the
calling thread continues execution.

From the calling thread's perspective, `LOAD` executed atomically (with a
latency cost).

---

## Resolution Summary

```
Thread LOAD ──► GT typ=10 (Outform) ──► Absent event fires
                                                │
                                    Locator invoked as subroutine CALL
                                                │
                         Step 2: Save 96-bit IDE token
                         Step 3: Fetch lump.zip via NetworkIO
                         Step 4: Read ZIP header; derive n, CRC-32
                         Step 5: Pre-allocate lump region (base)
                         Step 6: Inflate into [base, base + 2ⁿ×4)
                         Step 7: Verify CRC-32 over inflated bytes
                         Step 8: Mint.Lump(base, n) → Live NS slot
                                                │
                                    Locator RETURNs
                                                │
                              Hardware retries LOAD ──► Live NS slot
                                                │
                                   Thread continues normally
```

---

## Outform GT and Eviction

The Outform GT (`typ=10` Word 0) in the caller's c-list slot is **not modified**
by the Absent event or the Locator. The c-list slot permanently holds
`typ=10 | object_id` — the NS slot is the source of truth for whether the
lump is currently resident.

The 96-bit IDE token saved in Step 2 allows the Locator to restore the
Outform state on eviction:

```
Locator.evict sequence:
  1. Revoke all issued E-GTs for object_id
       → Mint increments gt_seq in NS Word 2
       → Any holder whose c-list Word 0 gt_seq mismatches faults on next LOAD
  2. Free physical region [base, 2ⁿ × 4 words)
       → MemoryManager.free(base)
  3. Restore NS slot to Outform state
       → Write saved 96-bit IDE token back into NS Words 1–3
       → NS slot is now Outform again
  4. Next LOAD from any holder fires the Absent event and re-triggers
     the full lazy-load protocol transparently
```

Any c-list holder — whether the original caller or any thread that received
a derived E-GT — will trigger a new lazy load on its next `LOAD` attempt
after eviction.

---

## Formal Guarantee

> **Every valid Outform GT that has ever been forged is loadable at any time.**
> If the lump is not resident, the Locator will install it before the
> `LOAD` completes. The caller cannot distinguish a lazy load from a hit
> against a resident lump — except by latency.

This guarantee holds as long as:

- The Lump Library retains the `lump.zip` for the IDE token stored in the
  Outform NS slot.
- The ZIP file's CRC-32 is intact and the binary passes Mint validation.
- Physical memory is available to allocate the lump.

If any condition fails, `LOAD` raises a fault to the thread's fault handler
with a code identifying the failure mode (fetch / zip format / Mint rejection).

---

## Relationship to lump.zip and .patch files

| Artefact | Role | When produced |
|----------|------|---------------|
| `.patch` | Compiled binary frames (CHPF v1). Contains UART frames with CRC for direct FPGA upload. See [quick-start.md](quick-start.md). | At compile time (Export Patch) |
| `lump.zip` | Standard ZIP archive containing the raw lump binary image. The Locator reads the ZIP local file header directly to derive `n` and inflate. | After Navana.Abstraction.Add processes the compiled abstraction |
| Lump Library | Remote store of `lump.zip` archives, addressed by the 96-bit IDE token in the Outform NS slot. | Always available (GitHub-backed or DHT) |

The CLOOMC++ compiler produces compiled abstractions. `Navana.Abstraction.Add`
processes them, allocates the lump, writes code and c-list, calls `Mint.Lump()`
to create the Live NS entry, and packages the result as `lump.zip` for
archival in the Lump Library.

---

## E-GT Lifecycle with Lazy Loading

```
Compile time:
  CLOOMC++ ──► compiled abstraction ──► Navana.Abstraction.Add ──► Mint.Lump()
                                        │
                               ┌────────┴──────────────────────┐
                               │  NS slot created (Outform)     │
                               │  Words 1–3: 96-bit IDE token   │
                               │  GT Word 0: typ=10 (Outform)   │
                               └────────┬──────────────────────┘
                                        │
                               lump.zip archived to Lump Library

Run time (first LOAD against Outform GT):
  Caller holds GT ──► LOAD ──► Absent event ──► Locator invoked
                                                  lump.zip fetched
                                                  inflated + CRC-32 verified
                                                  Mint writes Live NS slot
                                                  LOAD retried ──► GT resolved

Run time (subsequent LOADs):
  Caller holds GT ──► LOAD ──► Live NS slot, lump resident ──► GT resolved immediately

After eviction:
  Caller holds GT ──► LOAD ──► Absent event again ──► Locator re-fetches
```

---

## Security Properties

- **GT revocation works across lazy loads:** Incrementing `gt_seq` in the NS
  entry (via Mint) invalidates all outstanding GTs. The next `LOAD` from any
  holder with a stale `gt_seq` faults without triggering the Locator.
- **Two-layer integrity:** CRC-32 (from ZIP header) is verified over the raw
  inflated bytes. Mint then independently validates the lump's internal
  structure, freespace, and c-list slots. Both checks must pass before the
  Live NS slot is written.
- **Capability isolation preserved:** The Locator runs inside the same
  thread's trust domain. Mint writes the Live NS slot — only Mint has
  `NamespaceWrite` authority. The caller's c-list slot (`typ=10`) is never
  modified by the protocol; the NS slot is the sole source of residence truth.
- **Eviction restores the lazy path cleanly:** Any holder retrying after
  eviction re-triggers the Locator transparently. No stale state is left
  in the NS table.

---

## What This Document Does Not Cover

| Topic | Where documented |
|-------|-----------------|
| Flag pool and CHANGE-based I/O concurrency inside the Locator | `LUMP_ARCHITECTURE.md § "Locator and Flag Pool"` |
| URL resolution (`cm://` scheme, DHT, CDN) | `LUMP_ARCHITECTURE.md § "The Locator Abstraction"` |
| Mint 9-step validation sequence in full | `LumpFormat.md § "Mint Validation Sequence"` |
| ZIP local file header field table | `LUMP_ARCHITECTURE.md § "ZIP Local File Header and Pre-Allocation"` |
| Namespace bundle (multi-lump bootstrap fetch) | `CM_BOOTSTRAP.md § "Phase 3 — Core Chain"` |

---

---

## Loader Modes — Summary

The Locator (this document) is one component of lazy-object management. The
broader **Loader** abstraction (NS[19]) has two distinct modes:

### Mode 1 — Restore (Inform GT, warm-slot eviction)

The lump was previously instantiated and granted a live NS entry. It was
evicted to free memory — the entire lump (header + code + c-list) was zeroed,
leaving the NS entry intact with `magic = 0x00 ≠ 0x1F` in memory.

- Trigger: CALL/LOAD pre-check sees `!lumpHdr.valid` for an Inform GT in the lazy manifest.
- Fault: `CODE_NOT_RESIDENT` → dispatches Loader Mode 1.
- Action: Loader restores the lump at a valid address within the existing NS grant, updates `word0_location`, recomputes the seal. Type, limit, gt_seq unchanged — no new authority minted.
- NS entry authority: **always preserved**.

### Mode 2 — Construct (Abstract GT, never instantiated)

The object type exists as an Abstract GT but has no Inform NS entry and no
lump yet. This is the Outform/Locator protocol described in this document —
the Absent event fires on `LOAD` against an Outform GT, the Locator fetches
`lump.zip`, inflates and validates it, and calls `Mint.Lump()` to write a
new Live NS entry.

- Trigger: hardware Absent event on Outform GT (`typ=10`).
- Action: Locator fetch → inflate → Mint.Lump() → Live NS slot.
- NS entry: **newly minted** by Mint (Navana.Add delegation).

The two modes are architecturally complementary: Mode 1 maintains objects
that exist in the namespace but are temporarily absent from memory; Mode 2
brings into existence objects that have never had a physical lump.

---

## See Also

- [json-information.md](json-information.md) — The abstraction definition format (informational reference).
- [golden-tokens.md](golden-tokens.md) — GT structure, typ field, and revocation.
- [abstractions.md](abstractions.md) — Navana.Abstraction.Add and the lump lifecycle.
