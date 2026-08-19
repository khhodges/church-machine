# Locator — Absent-Lump Fetch Protocol

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

---

## Overview

When a thread accesses an `Outform` (`typ=10`) GT, the lump is not resident.
The **current hardware implementation fails closed with `OUTFORM_UNAUTH`**:
its fused transport provides CRC/integrity checks but no trusted full identity
or full binary SHA-256 authenticator, so it must not fetch, allocate, Mint, or
publish an Inform capability. Resident Inform operation is unaffected.

The simulator/host resolver implements the authenticated lifecycle described
below: it preserves the exact restore token, verifies external canonical
identity and full bytes, and only then promotes through the authorized writer.
The hardware subroutine protocol later in this document is a **future design**
and must remain disabled until an externally authenticated Mint input exists.

This model keeps the hardware NS table small (256 slots × 16 bytes = 4 KB)
and allows a practically unlimited catalogue of abstractions to be available
without pre-loading them all.

---

## Terminology

| Term | Definition |
|------|------------|
| **Outform GT** | A c-list slot Word 0 with `typ=10`. Signals that the lump is registered but not yet resident. The `object_id` field identifies which NS slot holds the recovery token. |
| **Outform NS slot** | The access GT (held in a c-list or CR, not in the NS entry) has `gt_type=10`. NS Words 1–3 hold a **96-bit opaque restore token**; Word 0 is non-authoritative locator/reserved data. The authenticated host resolver preserves Words 1–3 verbatim. |
| **Resident Inform NS slot** | The access GT has `gt_type=01`. NS Word 0 is `location`, Word 1 is authority, Word 2 is `integrity32`, and Word 3 is cache token `T`. `LOAD` succeeds only after the normal GT, integrity, sequence, permission, and range checks. |
| **Locator** | Host/simulator authenticated resolver. A future hardware implementation requires a trusted full-identity/hash input before it may reach Mint. |
| **Restore token** | The 96-bit value stored in Outform NS Words 1–3. It is opaque to hardware and contains the 32-bit lookup value `T` in W3. It selects a candidate fetch; it does not authenticate that candidate. |
| **Absent event** | Simulator/host resolution trigger. Current hardware converts this condition to `OUTFORM_UNAUTH` without starting transport. |
| **Mint** | The system component that validates a raw lump binary and, on success, writes the Live NS slot and issues an E-GT. |

---

## Trigger: The Absent Event

The simulator/host Locator is invoked when **all** of the following are true:

1. A thread executes **`LOAD`** against a c-list slot.
2. The GT in that slot has **`typ = 10`** (Outform).
3. A matching trusted external generation/identity record exists for the slot.

The host snapshots all three Outform words before fetch. Current hardware does
not read them into the CRC-only transport path; it faults before `outform_start`.

> **What does NOT happen:** There is no scheduler transfer, no thread park,
> and no interrupt. From the thread's perspective, `LOAD` executes with a
> latency cost but otherwise atomically.

---

## NS Slot States

The **access GT's `gt_type` is the only state discriminator**. The entry words
must not be inspected to infer the state.

| Access GT state | W0 | W1 | W2 | W3 | External identity record |
|---|---|---|---|---|---|
| NULL (`00`) | 0 | 0 | 0 | 0 | Cleared |
| Outform (`10`) | Locator/reserved, non-authoritative | Restore token [95:64] | Restore token [63:32] | Restore token [31:0], including `T` | Required: canonical name, positive issue, identity hash, binary hash, cache `T`, sequence/generation, and exact W1–W3 snapshot |
| Resident Inform (`01`) | Location | Authority (`f`, `g`, `gt_seq`, limit) | `integrity32(W0,W1)` | 32-bit cache/index `T` | Same trusted full identity retained outside the entry |

An Abstract GT (`11`) is value-in-token and never owns an NS entry.

### Outform state (lump not resident)

| NS Word | Contents |
|---------|----------|
| Word 0  | Locator/reserved data; never trusted as identity |
| Word 1  | Restore token bits [95:64] |
| Word 2  | Restore token bits [63:32] |
| Word 3  | Restore token bits [31:0], including cache/index `T` |

The 96-bit token is opaque restore data. The authenticated host resolver
preserves it verbatim; current hardware does not pass it to transport.

### Resident Inform state (lump resident)

| NS Word | Contents |
|---------|----------|
| Word 0  | `location [32]` — physical base address of the lump |
| Word 1  | `f_flag[1]` \| `g_bit[1]` \| `gt_seq[9]` \| `limit_offset[21]` |
| Word 2  | `integrity32` over Words 0–1 with mutable flags masked |
| Word 3  | 32-bit issue-blind cache/index `T` |

The Live NS slot is written atomically by **Mint** after it has validated
the entire lump binary (see Step 8 below). `LOAD` succeeds against a Live slot.

`T = SHA-256(canonical UTF-8 dot_name || exact big-endian lump bytes)[31:0]`
(represented by the first eight lowercase hex digits in filenames). Issue is
excluded so code-equivalent issues may share `T`; issued identity, ownership,
and revocation always use the full name plus positive issue. `T`, W3, and DR15
are never authority. `integrity32` detects corruption of W0–W1 but is not an
adversarial cryptographic authenticator; promotion requires the trusted full
identity and full SHA-256 binary hash held outside the four words.

---

## Authenticated Host Protocol — Step by Step

### Step 1 — Absent event fires
**Actor:** Simulator/host resolver

**Trigger:** Thread executes `LOAD`; GT `typ=10` (Outform).

The resolver snapshots the exact W1–W3 restore token and trusted generation.
On physical hardware this trigger currently faults `OUTFORM_UNAUTH`.

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

On success, the authorized Namespace/Mint writer stages and commits all four
resident words:
- Word 0: `location`
- Word 1: authority (`f`, `g`, `gt_seq`, `limit_offset`)
- Word 2: `integrity32`
- Word 3: cache/index `T`

The NS slot transitions **Outform → Live** atomically.

> **Promotion verifies full identity and bytes before commit.** Outform → Inform
> promotion completes only after Mint has recomputed `T` as a cache consistency
> check **and independently verified** the full trusted identity (`dot.name`,
> positive `issue`, identity hash, and full binary hash — all held outside the
> NS entry). Matching `T` alone is never accepted. Only then
> is the NS slot (and any dependent c-list binding) committed to Live. On any
> failure the promotion is abandoned and the Outform state is **restored /
> preserved** exactly — Words 1–3 (the opaque restore token, `T` in Word 3)
> remain intact.

**Failure → Mint rejection:** Mint frees the allocated region. The NS slot
is **never written** by Mint on failure — it remains Outform (restore token,
including `T`, intact in Words 1–3). No restore operation is needed.

> **Ownership:** Mint owns physical region allocation/free only. NS slot
> ownership stays with the Locator throughout — Mint writes it exactly once
> on success and never touches it on failure.

---

### Step 9 — Resolver returns; LOAD retries
**Actor:** Simulator/host resolver

The simulator resumes the suspended thread and retries the **`LOAD`**.
The NS slot is now Live; `LOAD` resolves normally, populates the CR, and the
calling thread continues execution.

From the calling thread's perspective, `LOAD` executed atomically (with a
latency cost).

---

## Resolution Summary (simulator/host implementation)

```
Thread LOAD ──► GT typ=10 (Outform) ──► host resolution suspends
                                                │
                                     authenticated resolver invoked
                                                │
                         Step 2: Save 96-bit IDE token
                         Step 3: Fetch lump.zip via NetworkIO
                         Step 4: Read ZIP header; derive n, CRC-32
                         Step 5: Pre-allocate lump region (base)
                         Step 6: Inflate into [base, base + 2ⁿ×4)
                         Step 7: Verify CRC-32 over inflated bytes
                         Step 8: Mint.Lump(base, n) → Live NS slot
                                                │
                                     thread resumes
                                                │
                              Simulator retries LOAD ──► Live NS slot
                                                │
                                   Thread continues normally
```

---

## Outform GT and Eviction

The triggering c-list GT remains Outform until verification completes. A
successful authenticated commit atomically replaces it with Inform; eviction
restores that exact Outform GT. The access GT, never an NS word or UI hint, is
the state discriminator.

The 96-bit IDE token saved in Step 2 allows the Locator to restore the
Outform state on eviction:

```
Locator.evict sequence:
  1. Revoke all issued E-GTs for object_id
       → Mint increments gt_seq in NS Word 1 and regenerates Word 2 integrity
       → Any holder whose c-list Word 0 gt_seq mismatches faults on next LOAD
  2. Free physical region [base, 2ⁿ × 4 words)
       → MemoryManager.free(base)
  3. Restore NS slot to Outform state
       → Write the saved opaque restore token back into NS Words 1–3
         *exactly* (W1‖W2‖W3, with content token T in Word 3)
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

Simulator/host run time (first LOAD against Outform GT):
  Caller GT ─► suspend ─► authenticated resolver verifies identity + bytes
                         ─► authorized atomic promotion ─► retry LOAD

Current hardware run time:
  Caller GT ─► OUTFORM_UNAUTH fault (no transport, allocation, Mint, or publish)

Run time (subsequent LOADs):
  Caller holds GT ──► LOAD ──► Live NS slot, lump resident ──► GT resolved immediately

After simulator eviction:
  exact Outform GT and W1–W3 restore token return; host resolution may retry
```

---

## Security Properties

- **GT revocation works across lazy loads:** Incrementing `gt_seq` in the NS
  entry (via Mint) invalidates all outstanding GTs. The next `LOAD` from any
  holder with a stale `gt_seq` faults without triggering the Locator.
- **Authenticated promotion:** CRC/integrity checks are only corruption
  detection. Host promotion additionally requires canonical identity and full
  binary SHA-256, and replaces the triggering GT only at atomic commit.
- **Hardware containment:** CRC-only physical ingress always faults
  `OUTFORM_UNAUTH` before transport or publication.
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

### Mode 2 — Authenticated host construct

The host/simulator may construct a resident Inform entry from an Outform GT
only after the full external identity and exact bytes verify.

- Trigger: simulator/host access to Outform GT (`typ=10`).
- Action: authenticated fetch → full verification → authorized atomic commit.
- Hardware: `OUTFORM_UNAUTH`; this mode is disabled without authenticated input.
- NS entry: **newly minted** by Mint (Navana.Add delegation).

The two modes are architecturally complementary: Mode 1 maintains objects
that exist in the namespace but are temporarily absent from memory; Mode 2
brings into existence objects that have never had a physical lump.

---

## See Also

- [cloomc-foundation.md](cloomc-foundation.md) — **Authoritative architectural overview**: explains the 3-LUMP starter kit, the TSB principle, and why lazy load is the correct model for everything above the foundation.
- [json-information.md](json-information.md) — The abstraction definition format (informational reference).
- [golden-tokens.md](golden-tokens.md) — GT structure, typ field, and revocation.
- [abstractions.md](abstractions.md) — Navana.Abstraction.Add and the lump lifecycle.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
