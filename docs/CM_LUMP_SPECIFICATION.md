# Church Machine — Lump Specification

**v1.3 — 2026-08-18**
**CONFIDENTIAL**

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

Lump size is always a power of 2, minimum 64 words, maximum 32 768 words
(32-bit each):

```
lumpSize = 2^n   where 6 ≤ n ≤ 15
freespace = lumpSize - 1 - cw - cc   (must be all-zero; Mint verifies at load time)
```

The maximum is 2^15 = 32 768 words. The header `cw` field (13 bits, max 8 191)
and `cc` field (8 bits, max 255) together cap the maximum useful payload at
1 + 8 191 + 255 = 8 447 words. Mint hard-rejects n-6 > 9 (lumpSize > 32 K).

| Abstraction | Code words (cw) | C-list slots (cc) | Lump size         | Freespace  |
|-------------|-----------------|-------------------|-------------------|------------|
| Decimal     | 107             | 0 *(legacy — cc≥1 planned for typ=lump; see C-list Slot 0 rule)* | 2^7 = 128 words   | 20 words   |
| SlideRule   | 525             | 1                 | 2^10 = 1 024 words | 497 words |
| TestSR      | 604             | 1                 | 2^10 = 1 024 words | 418 words |
| Boot.Abstr  | 17              | 1                 | 2^6 = 64 words    | 45 words   |

---

## NS Slot Assignment — Four Categories

From Release 1.1 the manifest.json schema formally distinguishes four categories
of lump by how they receive a Namespace (NS) slot.

Only **Resident** and **Lazy-load** lumps have an assigned slot in the NS table.
Dynamic lumps receive the next free slot on demand. NULL lumps never enter the
NS table at all.

| Category | `ns_slot` | `boot_resident` | `ns_slot_policy` | Behaviour |
|:---------|:----------|:----------------|:-----------------|:----------|
| **Resident** | integer | `true` | `"static"` | Slot is part of the boot image. NS entry is `Live` at cold boot. |
| **Lazy-load** | integer | `false` / absent | `"static"` | Slot is reserved but the lump is not in the boot image. Loaded into that specific slot on first demand via Loader/Tunnel. |
| **Dynamic** | `null` | — | `"dynamic"` or absent | No assigned slot. Runtime allocates the next free slot at first use. Slot number may differ between reboots; callers hold a GT, not an index. `ns_slot_policy` is optional — absent is treated as `"dynamic"`. |
| **NULL** | `null` | — | `"static"` | Never enters the NS table. Fetched directly by token via Loader/Tunnel. Correct for data, media, and library lumps that require no callable NS slot. Must use explicit `"static"` to distinguish from Dynamic. |

Machine-readable classification (`tests/lump/test_lump_consistency.py`):

| `ns_slot` | `ns_slot_policy` | Classification |
|---|---|---|
| integer | absent / `"static"` | Resident or Lazy-load — fixed assigned slot |
| `null` | `"dynamic"` or absent | Dynamic — allocated by Mint on first use (`ns_slot_policy` is optional; absent = dynamic) |
| `null` | `"static"` | NULL — never enters the NS table; fetched by token |

> **R9 retired.** `ns_slot: null` with an absent `ns_slot_policy` is treated as Dynamic, not an error. Explicit `"dynamic"` is preferred for clarity; `"static"` is required to opt into the NULL (token-only) category.

### Variant Group

Two manifest entries may declare the same `ns_slot` if and only if they both
carry the same non-null `variant_group` string. This declares alternative
implementations of the same abstraction; the boot image installs exactly one.

Example: two alternative implementations of the same abstraction may share the
same `ns_slot` by declaring matching `variant_group` values. The boot image
installs exactly one. This constraint is enforced by consistency gate rule R8.

Canonical examples: Boot.Abstr (NS[3], Resident), Loader (NS[19], Resident),
Tunnel (NS[31], Resident), WordString (ab1e86af, NULL — no NS slot required).

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
| n-6   | 26:23 | lumpSize = 2^(val+6). Valid range 0..9 → 64..32 768 words. Values 10..15 rejected by Mint. |
| cw    | 22:10 | Code word count (0..8191). Words 1..cw are code; words cw+1..lumpSize-cc-1 must be zero. |
| typ   | 9:8   | Object type: `00`=lump, `01`=data, `10`=clist-only, `11`=Outform. |
| cc    | 7:0   | C-list slot count (0..255). |

32 bits total. No spare bits. No dead fields. `code_base = base + 4` always.
`PC = 1` always.

> **Lazy-load convention (Mode 1 — Restore):** When a lump is evicted from memory
> the **entire lump** (header + code + c-list) is zeroed. The word at `base`
> becomes 0x00000000 — magic = 0x00 ≠ 0x1F. This is the hardware-visible
> residency signal. CALL/LOAD to such a slot reads the header, sees
> `magic ≠ 0x1F`, and triggers `CODE_NOT_RESIDENT`. The Loader restores the
> lump at any valid address within the existing NS grant, then updates
> `word0_location` and recomputes the seal. **The NS entry authority (type,
> limit, gt_seq, seal) is never changed** — it is the capability reference
> that survives eviction. The freed memory block is available for alternative
> objects while the lump is absent.

### Example Header Words

Encoding formula: `(0x1F << 27) | ((n-6) << 23) | (cw << 10) | (typ << 8) | cc`

```
Decimal    (n=7,  cw=107, cc=0, typ=00):  0xF881_AC00   ← legacy example; cc=0 will be
                                                          invalid for typ=lump once the
                                                          C-list Slot 0 rule is enforced
                                                          (planned; not in this release)
SlideRule  (n=10, cw=525, cc=1, typ=00):  0xFA08_3401
Boot.Abstr (n=6,  cw=17,  cc=1,  typ=00): 0xF800_4401
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
- `lumpSize` (words) = `1 << (n_minus_6 + 6)` — always a power of two, 64..32768
- `freespace` (words) = `lumpSize − 1 − cw − cc` — words between the last code word and the c-list; must be zero-filled
- `CR14.base` = `NS_base + 4` (skips lump header word)
- `CR14.limit_offset` = `lumpSize − cc − 2`
- `CR6.base` = `NS_base + (lumpSize − cc) × 4`
- `CR6.limit_offset` = `cc − 1`

---

## The Token — Lump Identity

Terminology in this specification is precise:

- **Genotype** — the full 2^n-word binary form of a lump: header + code +
  freespace + c-list, zero-padded to the next power-of-two word boundary.
  "Genotype" always means this binary form, never an identifier or hash.
- **Token** — the 32-bit identifier derived from the genotype, defined below.

### Canonical Definition

> **Token** — a 32-bit value computed as:
>
>     token = hash( name || genotype_binary )
>
> where:
> - `name` is the abstraction name string (UTF-8, no null terminator)
> - `||` denotes concatenation
> - `genotype_binary` is the full lump binary padded to the next power-of-two word boundary
>   (i.e. all 2^n words of the genotype, including zero-padding)
>
> The token is the runtime identity of the lump. It appears in GTs, c-list entries, and NS table
> entries. It is also the content fingerprint: two lumps with the same token are guaranteed to have
> the same name and the same binary content.

**Token vs. runtime GT fields — representation note.** The statement that the token "appears
in GTs, c-list entries, and NS table entries" describes the *identity model*, not a claim that
the 32-bit token value is stored verbatim in those structures today. In the current runtime
encoding, a GT Word 0 carries a 16-bit `object_id` that indexes the **NS slot** for the lump;
the NS entry, in turn, is the runtime's binding of that slot to the lump the token identifies
(and Outform entries carry a content-hash prefix for the absent lump). The token is today the
catalogue/filename/content identity; carrying the token itself inside GT or NS words (or
widening `object_id`) is a **future-normative** representation decision, part of the same
migration path as the production hash width. Any runtime check phrased in terms of the token
(such as the planned slot-0 self-GT validation) is therefore expressed against the NS-slot
mapping in the current encoding: slot 0 must hold a GT whose `object_id` resolves, via the NS
table, to this lump — i.e. to the lump this token names.

**Normative algorithm.** `hash` is **SHA-256**. The input is the exact byte sequence formed by:

1. the abstraction `name` as UTF-8 bytes (no null terminator, no length prefix), followed by
2. the full 2^n-word genotype binary, each 32-bit word serialised **big-endian**
   (the on-disk `.lump` byte order), words in ascending address order, including
   header word 0 and all zero-padding.

The token is the **first 8 hexadecimal characters** of the lowercase hex digest, interpreted
as a 32-bit unsigned integer. In filenames it is rendered as exactly those 8 lowercase hex
digits (zero-padded). Any conforming tool in any language computes the identical token from
the identical (name, binary) pair.

**Collision note.** The guarantee above is the identity contract the system relies on, delivered
probabilistically: the token is a 32-bit truncation of the SHA-256 digest, so a collision —
two different (name, binary) pairs producing the same token — is possible in principle, though
astronomically unlikely within a single region's catalogue. As with the forbidden CRC value in
NS entries, collisions are handled at mint time: if Mint detects that a newly computed token
collides with a different lump already in the catalogue, it rejects the publication and the
publisher must perturb the binary (e.g. a freespace-layout change via recompilation) to obtain
a distinct token. Only the truncated 32-bit value is retained and validated by the current
filename-integrity path; retaining and verifying the full digest where adversarial forgery
resistance is required is a planned upgrade, covered under "Choose width" in the Migration
Path below.

Including the name in the hash input binds identity to both content *and* name: transplanting a
binary to a different abstraction name produces a different token.

The **issue number** is explicitly *not* part of the hash input. The same binary published under
a new issue number retains the same token. The issue number tracks publication history; the token
tracks what the lump is.

### Name and Token are Independent

> **The name is the logical identity** — it names the abstraction, the idea. It remains stable
> across versions, hardware targets, and cyberspace regions as long as the same concept is
> being described.
>
> **The token is the physical instantiation** — it changes whenever the binary changes, for any
> reason. Two lumps with the same name but different tokens are different instantiations of the
> same abstraction.
>
> They are independent axes:
>
> | Change | New name? | New token? | New issue? |
> |--------|-----------|-----------|------------|
> | Bug fix or new feature (same abstraction) | No | Yes | Yes (e.g. `.2.`) |
> | Port to new hardware target (same source, different binary) | No | Yes | No (same issue, different variant) |
> | Import from another cyberspace region (same source, compiled locally) | No | Yes | No |
> | Create a genuinely new abstraction | Yes | Yes | Starts at 1 |
>
> When another region imports an abstraction, they compile the source locally and derive their
> own token from their own binary. The name is what makes the abstraction recognisably the same
> across regions; the token is how each region's runtime refers to its local copy.
>
> **A new name is required only when the logical meaning changes enough that the abstraction
> is no longer the same concept.** That is a human judgment. The hash does not make this
> decision — it only records it.

### Canonical Filename Form and File Set

Every lump is named on disk using the canonical form:

```
dot.name.issue.token.lump        ← the logical lump (self-defining binary)
dot.name.issue.token.json        ← sidecar (optional local administrative metadata)
dot.name.issue.token.zip         ← distribution zip (if present)
```

Where:
- `dot` — namespace prefix identifying this as a Church Machine lump
- `name` — abstraction name (matches the name used in the token hash)
- `issue` — publication revision number, starting at 1; not part of the token hash
- `token` — 8 hex digits (the 32-bit token value computed above)

**The logical lump is the binary alone.** It is self-defining: its API definition is embedded
in the freespace (see the Source Code Storage section — *forthcoming; specified in a separate
spec update (T7)*). The sidecar is optional local administrative metadata and is never
transported across cyberspace boundaries.

> **Transition note — freespace invariant.** The current release enforces the all-zero
> freespace invariant (Mint validation step 7, and the layout/example sections): freespace
> today carries no content, and the API definition is delivered via the sidecar/tooling.
> When the Source Code Storage section lands, it will define a delimited region within
> freespace for the embedded API/source, and Mint's freespace scan will be updated to
> verify that region's framing while requiring the remainder to stay zero. Until then,
> the all-zero rule stands and the embedded-API description in this section is normative
> intent, not yet the deployed binary format.

A separate `.api.json` file may be extracted from the binary by tooling (compiler, IDE) as
a convenience — it is a hidden implementation detail, not a named part of the logical lump.

Flat names such as `00000600.lump` are legacy aliases only; they must not appear in new tooling
or documentation.

**Scope and legacy exceptions.** The canonical form governs the on-disk lump file set (the
`.lump` binary, its optional sidecar, and its distribution zip). The following forms elsewhere
in this specification are *intentional legacy or out-of-scope exceptions*, retained until their
own protocol sections are revised:
- `*.bin` members inside `namespace.zip` bundles and the `manifest.json` `file` fields — the
  bundle-internal naming predates the canonical form; a bundle revision will migrate members
  to `dot.name.issue.token.lump`.
- The lazy-load / Home Base fetch URLs (`{label}@sha256:{hash}.lump.zip`) — the network
  protocol addresses lumps by label + full content hash, which is a transport addressing
  scheme, not an on-disk filename; it is unchanged by this policy.
- `*.thread.zip` and `*.namespace.zip` — Thread and Namespace lumps are not function
  abstractions and keep their existing distribution names.

#### API Definition Embedded in Freespace

The API definition is stored inside the binary's freespace (see the Source Code Storage
section — forthcoming, T7 — for the full freespace layout). This makes the binary self-defining: a recipient
region has everything needed to understand the interface without any companion file.

The embedded API definition specifies every method's:
- pet name (the CLOOMC++ identifier callers use)
- branch offset (compiled-in numeric entry point)
- IN and OUT variables, each with an exact register assignment

**Register conventions** (also to be documented in the forthcoming Source Code Storage section):

Each variable specifies the exact register it occupies:
- **`CRn`** — capability register; Church domain; holds a Golden Token
- **`DRn`** — data register; Turing domain; holds an ordinary value

**Reserved registers** — must not be assigned to any parameter:
- `DR0` — hardwired zero on Artix-7
- `CR5` — thread heap
- `CR6` — abstraction c-list
- `CR12` — thread object
- `CR13` — IRQ thread
- `CR14` — executing code (R/W)
- `CR15` — namespace

Valid parameter registers: `DR1`+, `CR0`–`CR4`, `CR7`–`CR11`.

**Success/fail convention:** before executing RETURN, the callee writes non-null to output
registers on success, or null (`DR`=zero, `CR`=null GT) on failure. The caller tests output
registers directly — null means fail, non-null means success. Conditional instructions branch
on this directly; no separate flag is needed.

### Current Form (Bootstrap Compiler, `cloomc.py`)

The bootstrap compiler does not yet implement the canonical definition above.
Its interim token computation is documented here verbatim; the migration path
follows.

```python
# body layout: [header] + clist + method_words, zero-padded to power-of-two
# token = interim content hash (interim scheme) over c-list + code (NOT the header, NOT the pad)
genome   = clist + method_words
h        = hashlib.sha256(bytes(str(genome), "utf-8")).hexdigest()[:8]
token    = int(h, 16)
```

Step by step:

| Step | Action |
|------|--------|
| 1 | **Input** — `clist + method_words`: the c-list rows followed by the code words. Header excluded; zero-padding excluded. |
| 2 | **Serialise** — Python `str()` of that integer list (e.g. `"[2147483651, 2147483667, ...]"`), UTF-8 encoded. |
| 3 | **Hash** — SHA-256 of those bytes. |
| 4 | **Truncate** — first 8 hex characters of the digest. |
| 5 | **Token** — that value as a 32-bit unsigned integer. |

This produced every token in the current catalogue (e.g. `Alice = 0x3FCBF37C`).
To re-verify a lump, recompute `sha256(str(clist + code_words))[:8]` and
compare — a mismatch means tampering or corruption. This is exactly what
`lump_json.py :: _reseal_from_parts` does; all catalogue lumps round-trip and
verify, and a tampered word is rejected.

### Limits of the Current Form

The bootstrap token is deterministic, self-consistent, and sufficient for
integrity and tamper-detection, but it is a **placeholder**, not the production
seal, for four reasons:

1. **Content-only, not identity-covering.** Two lumps with byte-identical
   c-list and code produce the same token even if they carry different
   abstraction names. The canonical definition requires the name in the
   hash input.
2. **`str()` is not a canonical encoding.** It depends on Python's
   list-repr formatting (spaces, commas, integer rendering). A different
   tool, language, or Python version could serialise differently and compute
   a different hash for the same lump. A seal must have a
   language-independent canonical byte encoding.
3. **32 bits is narrow.** Adequate for content-addressing and accidental
   collision detection; too narrow to lean on for adversarial forgery
   resistance. Width is a deliberate choice to make, not a truncation to
   inherit.
4. **Source is not covered.** The lump carries its source (short-form
   CLOOMC++ + long-form assembler) so it can be edited out of context; the
   seal must bind that source to the code so they cannot drift independently.

### Target Form (Per the Design)

The target form is the canonical definition given above:

```
token = hash( name || genotype_binary )
```

The name binds identity to content; the genotype binary covers the full
2^n-word form. Per the canonical definition, the **issue number is excluded**
from the hash input — it tracks publication history, not identity.

| Component | Role | Covered today? |
|-----------|------|:--------------:|
| `name` | Abstraction name string. Binds identity to the name; transplanting a binary to a different name yields a different token. | ✗ |
| c-list | Capability rows (DNA / reachability). | ✓ |
| code | Method words. | ✓ |
| source | Carried source, so source and code cannot drift; editing → new token. | ✗ |
| `H_canonical` | Fixed cryptographic hash over a canonical byte encoding (not `str()` of a list), so any conforming tool in any language computes the identical token for the identical lump. | ✗ |

### Two Gates — Integrity and Ownership

The token is the **integrity gate** — static, public, secretless:

| What changed | Effect |
|---|---|
| Different name (transplanted binary) | Different token → fails *(identity)* |
| Corrupted code or c-list word | Different token → fails *(integrity)* |
| Source edited without recompiling | Source no longer matches → fails *(source-consistency)* |

The token is **not** the ownership gate. Ownership is the separate,
dynamic, secret-based passkey acid test. Integrity (this hash) must be
verifiable without authority; ownership must not be derivable from these
static bits. The two gates stay independent by necessity.

### What the Bootstrap Token Does NOT Cover

The exclusions below apply to the **bootstrap (interim) form only**. Under the
canonical definition the hash covers the full genotype binary — header,
zero-padding, and all.

| Excluded (bootstrap form) | Reason |
|----------|--------|
| Header (Word 0) | Holds derived layout (`cc`, `code_len`) recomputable from the sealed content, and placement-specific bookkeeping. Sealing it would make the seal depend on layout accidents. |
| Zero-padding | Carries no information. |
| Resolved GTs / bindings | Assigned by the locator at load and rebound at runtime (`SAVE`). They are placement, not identity. Their integrity is handled separately by per-GT parity/ECC — **not** by the token. The token never faults on binding because binding does not touch what the token covers. |

### Migration Path (Bootstrap → Production)

Each step is additive; each changes the token values — which is correct
and expected: a lump sealed under the production scheme is a genuinely
different (better-identified) artifact than the same lump under the bootstrap
scheme. Under content-addressing, a better seal is simply a new identity.

| Step | Change |
|------|--------|
| **Now** | `sha256(str(clist + code))[:8]`, 32-bit, content-only. Keep for the bootstrap; self-consistent and sufficient for the current single-author, no-transfer world. |
| **Add identity** | Extend the hashed input to include the abstraction `name` string, per the canonical definition (issue number excluded). First and most important upgrade — turns a content hash into an identity hash. |
| **Add source** | Include the carried source in the hashed input, binding source to code (editing → new token). |
| **Canonicalise** | Replace `str()`-of-list with a defined canonical byte encoding (fixed field order, fixed integer width, explicit lengths), so the token is tool- and language-independent. |
| **Choose width** | Decide the token width deliberately (e.g. full 256-bit digest, or a documented truncation) based on the forgery-resistance required, rather than inheriting the 8-hex-char bootstrap truncation. |

> **Development-status note (source inclusion):** The source included in the
> seal may itself vary by development status — full commented source (active
> development), uncommented source (release), or no source (locked
> production). Each is different content, hence a different token — which
> is consistent: a commented-source lump and its no-source production
> counterpart are legitimately different artifacts with different identities.
> If a three-tier source scheme is adopted, the token computation is
> unchanged — it simply hashes whatever source tier the lump carries, and
> different tiers yield different tokens by construction.

> **Status:** Spec note. Current form documented verbatim from `cloomc.py`
> (`sha256(str(clist+code))[:8]`, 32-bit, content-only). Target form
> specified (identity + c-list + code + source, canonical encoding, chosen
> width) but **not yet implemented** — it is the "confirm the seal
> construction in the compiler" open item. Per-GT parity (not the token)
> covers transient bindings.

---

## Mint Validation Sequence

`Mint.Lump(base, n)` receives a lump already inflated into physical memory.
It validates the header and binary before issuing any GT.

```
Step 1  Read Mem[base] — the header word.
Step 2  magic[31:27] == 0x1F — reject if not.
Step 3  n-6[26:23] <= 9   — reject if n-6 > 9 (lump would exceed 32 K words).
Step 4  lumpSize = 2^(n-6+6).
Step 5  cw[22:10] <= lumpSize - cc - 2  — reject if header is self-contradictory.
Step 6  cc[7:0]   <= lumpSize - 2       — reject if c-list overflows lump.
Step 6b (planned — NOT enforced in this release) typ==00 (lump) requires cc >= 1,
          AND c-list slot 0 must hold the lump's own GT: a well-formed E-GT
          Word 0 whose object_id equals the NS slot Mint is issuing for this
          lump (see "C-list Slot 0 — The Lump's Own GT"). Today the save path
          upgrades cc=0 to cc=1 instead of rejecting, and slot-0 value
          validation is not performed; legacy cc=0 binaries are still accepted.
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

Word 0 of every GT encodes the permission+domain field at [31:25], the GT
class at [24:23], and identity fields below that.

The encoding uses a **dom+perm3** scheme: bit 31 is the standalone **B** flag;
bits 30:28 are a 3-bit permission field (`perm3`) whose meaning depends on the
**dom** bit at position 27 (0 = Turing, 1 = Church):

| Bits  | Field   | Domain        | Instruction   | Meaning |
|-------|---------|---------------|---------------|---------|
| 31    | B       | —             | SAVE          | Bind — B=1 allows SAVE; B=0 causes SAVE to fault |
| 30    | X / E   | Turing/Church | — / CALL      | perm[2]: Turing = Execute (PC may enter). Church = Enter / Call an abstraction. |
| 29    | W / S   | Turing/Church | DWRITE / SAVE | perm[1]: Turing = Write data words. Church = Save a capability into this region. |
| 28    | R / L   | Turing/Church | DREAD / LOAD  | perm[0]: Turing = Read data words. Church = Load a capability out of this region. |
| 27    | dom     | —             | —             | Domain select: `0` = Turing {R, W, X}; `1` = Church {L, S, E}. |
| 26    | spare   | —             | —             | Reserved; always `0`. |
| 25    | f_flag  | —             | —             | Per-token flag (reserved for future use). |
| 24:23 | typ     | —             | —             | GT class: 00=NULL, 01=Inform, 10=Outform, 11=Abstract — CRC covered. |

**{R, W, X} and {L, S, E} are mutually exclusive groups.** The dom bit enforces
this: a GT cannot mix Turing and Church permissions. Any GT with perm3 ≠ 0 and
dom-inconsistent bits is rejected by Mint as malformed.

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

### Outform GT (typ = 10)

A GT issued by the IDE as a dependency placeholder. The GT itself (Word 0
only) is the IDE's key to identify the lump — no NS slot is required until
the lump is resolved. When the lump is first LOAD-ed, an Absent event fires;
the Locator fetches the zip, inflates it, determines the lump size and all
metadata from the header word, and then allocates an NS slot and calls
`Mint.Lump` to promote the slot to Live (typ = 01). The IDE may issue many
Outform GTs for the same lump; they all resolve to the same Live slot when
inflated.

### Abstract GT (typ = 11)

Self-defining. No memory region, no Object NS slot. Hardware maps
`object_id → value` internally. Covers physical constants (DREAD returns a
fixed value) and PassKey credentials (opaque identity tokens). Abstract GTs
are distributed by writing the full CR directly into c-list slots — no NS
slot consumed.

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
31  30 29 28 27 26 25 24  23 22      16 15            0
+───┬──┬──┬──┬───┬──┬──┬──────┬──────────┬──────────────+
│ B │p2│p1│p0│dom│ 0│ f│ typ  │  gt_seq  │  object_id   │
│1b │  3b perm3  │  2b  │ 2b  │   [7]    │    [16]      │
+───┴──┴──┴──┴───┴──┴──┴──────┴──────────┴──────────────+
```

The permission field at bits [31:25] uses a **dom+perm3** encoding:

| Field         | Bits  | Meaning |
|---------------|-------|---------|
| B             | 31    | Bind — TPERM-changeable, **excluded from CRC**. Must be 1 for SAVE. |
| perm[2:0]     | 30:28 | 3-bit permission field (TPERM-changeable, **excluded from CRC**). Turing (dom=0): bit30=X, bit29=W, bit28=R. Church (dom=1): bit30=E, bit29=S, bit28=L. |
| dom           | 27    | Domain select (TPERM-changeable, **excluded from CRC**): `0`=Turing {R,W,X}; `1`=Church {L,S,E}. |
| spare         | 26    | Reserved; always `0`. |
| f_flag        | 25    | Per-token flag (TPERM-changeable, excluded from CRC). |
| typ           | 24:23 | GT class: 00=NULL, 01=Inform, 10=Outform, 11=Abstract — **CRC covered** |
| gt_seq        | 22:16 | Revocation sequence number — **CRC covered** |
| object_id     | 15:0  | Object index, unique per lump issuance — **CRC covered** |

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
  3. Fetch NS[object_id] — 4 words: base, gt_seq_ns, limit_offset, reserved
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

### C-list Slot 0 — The Lump's Own GT

> **C-list slot 0 is always the GT for the lump itself.** This GT is valid for both:
> - **Inform** — a caller passes a GT to this lump; the lump can refer to its own GT in
>   slot 0 to identify itself in the exchange
> - **Outform** — the lump passes its own GT (slot 0) to another abstraction, granting
>   that abstraction the ability to call back
>
> For `typ=lump`, `cc >= 1` is therefore always required. A lump with `cc = 0` has no
> self-GT and cannot participate in inform or outform exchanges. **Planned enforcement:**
> Mint will reject `typ=lump` binaries with `cc = 0` once the transition below completes.

> **Transition note — enforcement status.** The `cc >= 1` rule is *future-normative*:
> rejection is **not deployed anywhere in this release**. The current save path *upgrades*
> `cc = 0` lumps to `cc = 1` (inserting the self-GT slot) rather than rejecting them, and
> legacy `cc = 0` paths are still exercised by existing simulator/boot coverage. The Mint
> validation sequence gains the rejection step (see planned step 6b there) once those
> legacy paths are retired; until then, upgrade-on-save is the accepted behaviour and a
> `cc = 0` binary is still accepted. Full enforcement additionally requires validating
> the *value* of slot 0 — that it holds the lump's own GT (`object_id` matching the NS
> slot Mint is issuing for this lump) — not merely that `cc >= 1`.

---

## Zip Distribution Format

Lump binaries are distributed as zip files. File names for single-lump
distribution follow the canonical `dot.name.issue.token.*` form (see
"Canonical Filename Form and File Set", including its list of intentional
legacy exceptions — bundle-internal `*.bin` members and hash-addressed fetch
URLs below are among them). Flat names such as `00000600.lump` are legacy
aliases only and must not appear in new tooling or documentation.

### Single Lump Upload

```
dot.SlideRule.1.a3f9c2b1.zip
+-- dot.SlideRule.1.a3f9c2b1.lump   ← the logical lump (self-defining binary):
                                       header + code + freespace + c-list
```

The logical lump is the binary alone; the optional `.json` sidecar is local
administrative metadata and is never included in the distribution zip.

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

### Decimal (n=7, cw=107, cc=0) — legacy example

> **Note:** this example predates the C-list Slot 0 rule. Under that (future-normative)
> rule every lump must carry its own GT in c-list slot 0, so `cc = 0` will not be valid
> for `typ=lump` once Mint enforcement lands (planned step 6b — not enforced in this
> release; the current save path upgrades `cc = 0` to `cc = 1` instead). The example is
> retained for its header-encoding arithmetic only.

```
Header:  0xF881_AC00
  magic=0x1F  n-6=1 (2^7=128)  cw=107  typ=00  cc=0

Layout (128 words):
  Word 0:         0xF881_AC00  [header]
  Words 1..107:   [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) code  [107 words]
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
  Words 1..525:    [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) code  [525 words]
  Words 526..1022: freespace    [497 zeros]
  Word 1023:       PI abstract GT (Word 0 only)  [c-list, cc=1]

NS Slot (gt_seq=0x01, base=0x10000000):
  Word 1:  0x10000000
  Word 2:  0x002003FF  (gt_seq=0x01, limit_offset=1023)
  Word 3:  0x000048F3  (E-GT CRC — illustrative)
```

### Boot.Abstr (n=6, cw=17, cc=1) — simulator boot-time abstraction lump

```
Header:  0xF800_4401
  magic=0x1F  n-6=0 (2^6=64)  cw=17  typ=00  cc=1

Layout (64 words):
  Word 0:         0xF800_4401  [header]
  Words 1..17:    CLOOMC code  [17 words — dispatcher + boot entry]
  Words 18..62:   freespace    [45 zeros]
  Word 63:        c-list       [1 GT word — self-referential E-GT]

Note: clistStart = lumpSize - cc = 64 - 1 = 63
```

---

---

# Appendix A — Thread as a Lump

## Overview

The Thread is a specialised lump. Like every other lump it is a
capability-secured, power-of-2 memory region with a header word at Word 0
and a c-list at its tail and freespace for stack and heap growth in between. The Thread GT occupies one Object NS slot and is assigned a single zero permissions GT by Mint at creation time. Access rights are under M (TSB microcode) control like the NS and CR6.

What makes the Thread distinct is how the rest of the lump is used.
A function abstraction lump holds executable [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) code followed by
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

> **Convention — Zone ① CR0 (offset +244): First-LUMP E-GT**
> CR0 (the first slot of Zone ①, at word offset +244 in the thread data
> structure) conventionally holds the **E-GT for the first LUMP** — the
> boot-entry lump marked ⚡ in the IDE's Abstractions view. The E-GT Word 0
> is computed as `createGT(gt_seq=0, object_id=bootEntrySlot, perms={E:1}, typ=01)`,
> which encodes permission bit E at bit 30, Inform type (`01`) at bits 24:23,
> sequence number at bits 22:16, and the NS slot index at bits 15:0. The IDE
> writes this word into thread memory at offset +244 when the user
> double-clicks the boot-entry LUMP in the Lump Repository or double-clicks
> the CR0 row in the Zone ① table (when CR0 is NULL). The thread memory view
> refreshes immediately to show the installed E-GT instead of NULL.

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

**CR12 — Thread Stack.** CR12 holds the privileged thread stack capability. Its NS entry encodes the Thread lump's base address and total word count, which the hardware uses as the anchor for the stack: the effective stack zone spans `stack_min` (= `lumpSize−12−sw`,
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
the only DR with an architecture-level convention beyond DR0; DR1–DR4
and DR6–DR15 remain fully general-purpose. DR0 is hardwired zero —
the simulator writes 0 to DR0 unconditionally after every instruction.

---

## CHANGE Context Save

On every **CHANGE** (context switch), the hardware saves the outgoing
thread's per-thread state and restores the incoming thread's saved state.

**Saved and restored by CHANGE (per-thread):**

| Register | Role |
|----------|------|
| **CR0–CR11** | Programmer-accessible capability registers (GT zone) — already persisted live by mLoad |
| **CR14** | Code register (Priv zone, per-thread) — X-only code GT for instruction fetch |
| **CR15** | Namespace root (Priv zone, per-thread) — re-installed from saved state |
| **CR5** | Heap GT — re-installed from incoming Zone ④ bounds automatically |
| **STO** | Stack Top Offset hidden register — current stack depth |
| **DR0–DR15** | All 16 data registers |
| **PC** | Program counter |
| **FLAGS** | Condition flags |
| **LAMBDA state** | LAMBDA_PC and LAMBDA-active flag |

**Never touched by CHANGE (system-wide):**

| Register | Role |
|----------|------|
| **CR12** | Thread stack (Priv zone, system-wide) — shared across all threads; cannot be written by CHANGE |
| **CR13** | Interrupt handler (Priv zone, system-wide) — one handler for the whole machine; CHANGE must not re-point it |

CR0–CR11 (Zone ①, the programmer-accessible capability registers) are
**implicitly** kept in sync by mLoad — every time mLoad loads a GT into
CR_N it writes the same word back to lump word N. CHANGE does not need to
explicitly save them; they are always current in the lump. On restore,
CHANGE reads the incoming thread's GT zone from its lump to reload CR0–CR11.
CR5 is additionally re-installed from the incoming thread's Zone ④ bounds.

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
│  Words NS_TABLE_START..NS_TABLE_END  NS Table           │  ← N × 4 words (Binary Data)
│  Words NS_TABLE_END+1..lumpSize-1  Trailing zeros       │
└─────────────────────────────────────────────────────────┘  ← base + lumpSize - 1
```

### Boot.NS Physical Map (simulator)

| Region | Start | End | Size | Contents |
|--------|-------|-----|------|----------|
| NS LUMP freespace | 0x0001 | 0xFCFF | variable | All zero — Mint verified by CRC scan per slot |
| NS Table | 0xFC00 | 0xFCFF | 64 × 4 = 256 words | 64 NS slots × 4 words each (Binary Data) |

The NS Table lives at a **hardware-known fixed offset** within Boot.NS.
On Tang Nano 20 K, `NS_TABLE_BASE = 0xFD00` is wired in the decoder;
on the Wukong A7, the base is parameterised but fixed at synthesis time.

---

## Namespace Table — Entry Format

The NS Table is a flat array of **N entries × 4 words** (word3 reserved/zero). N is the total
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
| N (NS Table entries) | Current entries are listed in `server/lumps/manifest.json`. | App-specific count |
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
| **Words 1..cw** | [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) code (dispatcher + methods) | Absent — `cw = 0` | Boot / init microcode and SWITCH |
| **Freespace zone** | Compile-time fixed · all-zero · immutable per release | Dynamic 131 words — Stack ↓ and Heap ↑ collide | Between init code and NS Table · all-zero |
| **C-list zone** | Last `cc` words · list E-GTs · compiler-set | Last 12 words · CR0–CR11 + LIFO Stack | BINARY DATA |
| **Unique body** | Code and C-List | 5 zones: Header · Caps · Stack · Free · Heap · DR | NS Table (N × 4-word entries: Inform GT + reserved) |
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
| **Distribution format** | `dot.name.issue.token.zip` | `*.thread.zip` | `*.namespace.zip` |
| **Simulator NS slot** | Most slots (Salvation=4, Mint=6, …) | Slots 1 and 45 | Slot 0 (Boot.NS) |
| **CALL target** | Yes | No | No |

---

## Cross-references

- [`architecture.md`](architecture.md) — Overall Church Machine architecture
- [`Lump-Architecture.md`](Lump-Architecture.md) — Accessible overview of the Lump object model
- [`foundation-lump-design.md`](foundation-lump-design.md) — Lump design rationale and layout rules
- [`golden-tokens.md`](golden-tokens.md) — GT format, encoding, and capability rules

---

*Document applies to: Church Machine IDE simulator · Boot.NS slots 0 (Boot.NS), 1 (Boot.Thread), 2 (Boot.Abstr), 45 (Thread) · Tang Nano 20 K + Wukong A7 XC7A100T targets.*

---

## Release History

| Version | Date | Summary |
|---|---|---|
| v1.3 | 2026-08-18 | Naming consistency (T1): canonical **Token** definition (`hash(name ‖ genotype_binary)`; issue number excluded); "genotype" reserved for the 2^n-word binary form only; canonical `dot.name.issue.token.*` filename form and logical file set documented (binary is self-defining; API definition embedded in freespace, register conventions, success/fail convention); "Name and Token are Independent" subsection; C-list Slot 0 self-GT rule (`cc ≥ 1` required for `typ=lump`; Decimal cc=0 examples annotated as legacy); hardcoded NS entry count replaced with a `server/lumps/manifest.json` reference. |
| v1.2.1 | 2026-08-17 | New section: **The Genotype Field — How It Is Computed** — documents the current bootstrap form (`sha256(str(clist+code))[:8]`, 32-bit), its four known limits, the target production form (`H_canonical(identity ‖ c-list ‖ code ‖ source)`), the two-gate model (integrity vs ownership), the excluded fields (header, padding, resolved GTs), and the four-step migration path (identity → source → canonical encoding → chosen width). |
| v1.2 | 2026-06-20 | (prior release) |
| v1.1 | 2026-05-03 | Floating-lump concept formalised (new section); `variant_group` and `ns_slot_policy` added to manifest schema; Boot.Abstr example table corrected (cw=17, cc=1, 64 words, `0xF800_4401`); automated consistency gate (`tests/lump/test_lump_consistency.py`, 11 rules). |
| v1.0 | 2026-04-29 | Initial documented release. |

See [`CHANGELOG.md`](../CHANGELOG.md) for full change details and formal change control rules.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
