# Lazy Loader — On-Demand Abstraction Loading

## Overview

The Church Machine uses a **lazy-load architecture** for abstractions.
An abstraction is not copied into the hardware memory space at boot time.
Instead, its compiled binary package — a `lump.zip` file — is fetched from
the **Lump Library** (backed by GitHub) only when the abstraction is first
called. The caller is unaware of the load; from its perspective the CALL
returns normally.

This model keeps the hardware NS table small (256 slots × 16 bytes = 4 KB)
and allows a practically unlimited catalogue of abstractions to be available
without pre-loading them all.

---

## The Lump Library

The Lump Library is the canonical store of compiled Church Machine abstractions.
Each entry is a `lump.zip` archive containing:

| File inside lump.zip | Contents |
|----------------------|----------|
| `lump.bin`           | Raw binary image of the compiled lump (code + c-list, power-of-2 size) |
| `manifest.json`      | Metadata: abstraction name, method names, clistCount, allocSize, CRC-16 seal |
| `source/`            | Optional: original source files used to compile the lump |

The library is addressed by **NS slot index** and **gt_seq** (the 7-bit
revocation counter in the Golden Token). A request for `NS[42] gt_seq=3`
fetches exactly the version of the lump that was current when that GT was forged.

---

## Trigger: The Lazy-Load Fault

The Lazy Loader activates when the hardware raises a **lump-not-resident**
condition. This happens when:

1. A CALL instruction is executed against a Golden Token (GT) whose NS entry's
   `G` (guard) bit is set to `1`. The NS entry itself is valid (the GT's
   `gt_seq` matches the stored sequence), but the lump has not yet been
   physically allocated — `base` is `0` and no memory region has been assigned.
2. The hardware detects `G = 1` during the CALL gate-check, suspends the
   calling thread, and raises an interrupt to the Lazy Loader service.

---

## Resolution Path

```
Thread CALL ──► GT lookup ──► NS entry (G=1, not resident)
                                        │
                                        ▼
                              Lazy Loader wakes
                                        │
                         1. Read NS entry: base, gt_seq, limit_offset
                         2. Request lump.zip from Lump Library
                            (GitHub API or local mirror)
                         3. Decompress lump.zip → lump.bin + manifest.json
                         4. Validate CRC-16 seal (Word 3 of NS entry)
                         5. Allocate physical memory (power-of-2 lump size)
                         6. Write lump.bin into allocated region
                         7. Update NS entry: set G=0, write base address
                         8. Resume suspended thread
                                        │
                                        ▼
                              Thread CALL completes normally
```

The calling thread resumes at the instruction that issued the CALL — the
CALL is retried transparently. From the caller's perspective the abstraction
was always present.

---

## Relationship to the NS Entry

The NS entry for a lazy abstraction has a specific layout before the lump
is loaded:

| Field        | Value when lazy (G=1) | Value after load (G=0) |
|--------------|----------------------|------------------------|
| `base [32]`  | 0 (not yet allocated) | Physical lump address  |
| `G [1]`      | 1                    | 0                      |
| `gt_seq [7]` | Current sequence     | Unchanged              |
| `CRC [16]`   | Pre-computed seal    | Unchanged              |

The `CRC [16]` field (Word 3 of the NS entry) is computed over the GT Word 0
fields plus the `base` and `limit_offset` fields using a 89-bit CRC input.
It is verified by the Lazy Loader before writing the lump to memory, ensuring
the correct binary was fetched.

---

## Relationship to lump.zip and upload.json

| Artefact       | Role | When produced |
|----------------|------|---------------|
| `upload.json`  | Abstraction definition (JSON). Human-readable. Source of truth for the compiler. See [json-information.md](json-information.md). | At compile time |
| `lump.zip`     | Compiled binary package. What the hardware loads. Contains `lump.bin` + `manifest.json`. | After Navana.Abstraction.Add processes upload.json |
| Lump Library   | Remote store of lump.zip archives, addressed by NS slot + gt_seq. | Always available (GitHub-backed) |

The CLOOMC++ compiler produces `upload.json`. `Navana.Abstraction.Add`
processes it, allocates the lump, writes code and c-list, creates the NS
entry, and packages the result as `lump.zip` for archival in the Lump Library.

---

## Formal Guarantee

The Lazy Loader provides the following guarantee to the Church Machine architecture:

> **Every valid GT that has ever been forged is callable at any time.**
> If the lump is not resident, the Lazy Loader will install it before the
> CALL completes. The caller cannot distinguish a lazy load from an immediate
> hit.

This guarantee holds as long as:

- The Lump Library retains the `lump.zip` for the requested NS slot and gt_seq.
- The CRC-16 seal in the NS entry matches the fetched binary.
- Physical memory is available to allocate the lump.

If any condition fails, the CALL raises a `FAULT_LAZY_LOAD` exception, which
the thread's exception handler can inspect.

---

## E-GT Lifecycle with Lazy Loading

```
Compile time:
  CLOOMC++ ──► upload.json ──► Navana.Abstraction.Add
                                        │
                               ┌────────┴──────────────┐
                               │  NS entry created      │
                               │  G=1 (lazy, no memory) │
                               │  CRC sealed            │
                               └────────┬──────────────┘
                                        │
                               lump.zip archived to Lump Library

Run time (first CALL):
  Caller holds GT ──► CALL ──► Lazy Loader ──► lump.zip fetched
                                               lump installed
                                               G=0 written to NS
                                               CALL resumes ──► callee runs

Run time (subsequent CALLs):
  Caller holds GT ──► CALL ──► G=0, lump resident ──► callee runs immediately
```

---

## Security Properties

- **GT revocation still works:** Incrementing `gt_seq` in the NS entry
  invalidates all outstanding GTs even for lazy-loaded abstractions. The
  next CALL with a stale gt_seq faults before the Lazy Loader is invoked.
- **CRC integrity:** The Lump Library cannot silently substitute a different
  binary — the CRC-16 seal is checked before installation.
- **Capability isolation preserved:** The lump is installed into the unified
  address space exactly as if it had been present from boot. CALL splits it
  into code (CR14, X-only) and c-list (CR6, L-only) exactly as normal.

---

## See Also

- [json-information.md](json-information.md) — The `upload.json` abstraction definition format (informational reference).
- [namespace-json.md](namespace-json.md) — NS entry bit layout (base, G, CRC, gt_seq, limit_offset).
- [golden-tokens.md](golden-tokens.md) — GT structure and revocation.
- [abstractions.md](abstractions.md) — Navana.Abstraction.Add and the lump lifecycle.
