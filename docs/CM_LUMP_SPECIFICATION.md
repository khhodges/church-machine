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
freespace = lumpSize - 1 - cw - cc   (verified by Mint at load time: for typ=lump it
                                      carries the 0xAB-tagged self-definition content —
                                      see Freespace Content and Self-Definition; legacy
                                      binaries and all other typ values must be all-zero)
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

The example binaries above were compiled before the freespace content format and carry
all-zero freespace — they are **legacy** binaries (not self-defining), awaiting
recompilation into the `0xAB` content format (see Freespace Content and Self-Definition).

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

### NS Slot Categories

**NS slots are configuration, not binary properties.** A lump binary has no intrinsic slot
number. The programmer defines a configuration that assigns a slot to an abstraction for that
deployment. The same binary may occupy different slots in different configurations. The slot is
a property of the configuration; the binary is the property of the lump.

The four categories describe the behaviour of a slot assignment within a given configuration:

| Category | Loaded at boot? | Slot assigned by | Notes |
|----------|----------------|------------------|-------|
| **Resident** | Yes | Configuration (fixed for this deployment) | Present in boot image; Mint-verified at load time |
| **Lazy-load** | No | Configuration (fixed for this deployment) | Slot reserved in boot image; binary fetched on first demand via Loader/Tunnel |
| **Dynamic** | No | Runtime (Mint.RegisterOutform→Navana.ADD) | No pre-assigned slot; allocated at first use; may differ between reboots |
| **NULL** | — | Never assigned | Never enters the NS table; fetched directly by token |

#### Version Coexistence

Two or more versions of the same abstraction coexist as completely independent objects. There
is no patching. A new version receives a new NS slot and a new GT — the old slot and old GT
are entirely unchanged. Only the parties that need the new version are given the new GT. All
callers holding the old GT continue calling the old version uninterrupted; they are unaware
that a new version exists.

A version is removed only by explicit withdrawal — a deliberate act that revokes the GT and
frees the binary. Until withdrawal, all versions coexist independently and callers are
unaffected by versions they do not hold a GT for.

Category scope: the "new slot" clause applies to versions with a configuration-assigned
slot (Resident / Lazy-load) — the new version's slot is a new assignment in the
configuration, distinct from the old version's slot. Two coexisting versions never share
a slot; slot-sharing via `variant_group` is for alternative implementations of which the
boot image installs exactly one, not for concurrently live versions. For **Dynamic**
versions no slot is pre-assigned — each version is independently allocated a free slot at
first use — and **NULL** versions never enter the NS table at all; for these categories
the invariant reduces to its core: a new version is a new object with a new token and a
new GT, and the old version's GT is unchanged.

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
│                 0xAB content header + embedded API/     │
│                 source, remainder zero (legacy: all     │
│                 zeros) — verified by Mint at load       │
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
| cw    | 22:10 | Code word count (0..8191). Words 1..cw are code; words cw+1..lumpSize-cc-1 are freespace (self-definition content for typ=lump, otherwise all-zero — see Freespace Content and Self-Definition). |
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
- `freespace` (words) = `lumpSize − 1 − cw − cc` — words between the last code word and the c-list; carries the `0xAB`-tagged self-definition content for `typ=lump` (remainder zero-filled), all-zero otherwise (see Freespace Content and Self-Definition)
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
in the freespace (see Freespace Content and Self-Definition). The sidecar is optional
local administrative metadata and is never
transported across cyberspace boundaries.

> **Transition note — freespace invariant.** The freespace content format is now
> specified (see Freespace Content and Self-Definition, and the revised Mint validation
> step 7): a `0xAB`-tagged content header delimits the embedded API/source region, with
> the remainder of freespace staying zero. Binaries compiled before this format have
> all-zero freespace and are **legacy** — a transitional state resolved by recompilation,
> not a permanent category. Tooling that has not yet adopted the format continues to
> deliver the API definition via the sidecar until it is migrated; new tooling must never
> produce legacy (all-zero-freespace) `typ=lump` binaries.

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

The API definition is stored inside the binary's freespace (see Freespace Content and
Self-Definition for the full freespace layout). This makes the binary self-defining: a recipient
region has everything needed to understand the interface without any companion file.

The embedded API definition specifies every method's:
- pet name (the CLOOMC++ identifier callers use)
- branch offset (compiled-in numeric entry point)
- IN and OUT variables, each with an exact register assignment

**Register conventions** (also documented in Freespace Content and Self-Definition):

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

## The Sidecar — IDE-Local Administrative Metadata

**The sidecar is optional administrative metadata local to an IDE region.** It is not part of
the logical lump and is never transported across cyberspace boundaries.

The logical lump is the binary alone (`dot.name.issue.token.lump`). It is self-defining:
the API definition is embedded in its freespace (see Freespace Content and
Self-Definition; binaries predating the format are legacy, resolved by
recompilation). A `.api.json` file may be extracted from the binary by
tooling (compiler, IDE) as a convenience — it is a hidden implementation detail, not a
named artifact and not part of the logical lump.

The sidecar (`dot.name.issue.token.json`) is entirely separate from the binary. It is
IDE-local, never distributed, and not required for the lump to function. It exists solely
to serve the IDE's local discovery, cataloguing, and validation workflows. If a sidecar is
lost, binary-derived fields can be recomputed from the binary. A lump binary is complete
without a sidecar.

### Sidecar Authorship Rule

The sidecar is a **pure mechanical cache** — every field is derived from the binary
(including the API/source content embedded in its freespace per Freespace Content and
Self-Definition, once tooling adopts it) by tooling. There is exactly one write path: `POST /api/lumps/save`,
which reads the binary and writes all fields. Sidecar files must never be edited by hand.

There are no curatorial fields. The former `group` and `doc_refs` fields are **removed
from this specification** — they added no value and introduced a drift risk. Any field
not derivable from the binary does not belong in the sidecar.

> **Transition note — authorship rule enforcement status.** The single-write-path rule is
> *future-normative*, like the embedded-API freespace format it depends on (see the
> freespace transition note in "Canonical Filename Form and File Set"). In the current
> release:
>
> - `POST /api/lumps/save` populates most sidecar fields from the request's `metadata`
>   object (supplied by the compiler/IDE at save time), not by re-deriving them from the
>   binary — because the binary does not yet embed its API/source in freespace.
> - Additional server write paths still exist and remain in service until this rule is
>   enforced. Sidecar-creating: `POST /api/lumps/save-wip` (work-in-progress save),
>   `POST /api/lumps/import` (base64 data-lump import), `POST /api/lumps/upload-lump`
>   (raw binary upload; sidecar generated from the parsed header), and the namespace-build
>   path (writes the Boot.NS sidecar with `namespace_meta`). Sidecar-mutating:
>   `PATCH /api/lump/<token>/meta` (in-place field updates),
>   `PATCH /api/lump/<token>/wip-source` (updates `source` and `last_edited_at`),
>   `PUT /api/lump/<token>/content` (data-lump rewrites),
>   `POST /api/lump/<token>/resize` (updates `lump_size` after freespace removal),
>   `POST /api/lump/<token>/fork-version` (version promotion; also marks the live
>   sidecar with a transient `forked: true` flag), and
>   `POST /api/lump/<token>/mtbf` (mutates the `mtbf` telemetry object in place).
>   Under the enforced rule, each of these either retires or reduces to a
>   recompile-and-save flow through `POST /api/lumps/save` (telemetry and catalogue
>   state moving to the IDE-local stores noted in the field tables below).
> - Sidecars on disk may still carry `group` and `doc_refs`, and some readers still consume
>   them; they are scheduled for removal from the writers, the readers, and the on-disk
>   files as part of the T7 migration.
>
> The freespace content format is now specified (Freespace Content and Self-Definition);
> once tooling adopts it and binaries are self-defining, the save path switches to
> deriving all fields from the binary, the auxiliary write paths are retired or reduced
> to recompile-and-save flows, and the rule above becomes enforced behaviour.

### Sidecar JSON Fields

The tables below list every sidecar field: its on-disk JSON key, type, and meaning
(actual sidecars live under `server/lumps/`).
Under the target authorship rule all of these are binary-derived; the grouping notes
which are decoded from the binary structure today versus recorded from save-time
`metadata` pending the T7 migration.

#### Identity and structure (decoded from the binary header and file naming)

| Field | Type | Meaning |
|:------|:-----|:--------|
| `token` | string | 8-hex-digit token (32-bit lump identity; see The Token — Lump Identity). |
| `abstraction` | string | Abstraction name (the `name` input to the token hash). |
| `dot_name` | string | Canonical dot-form name component used in the filename. |
| `issue_n` | integer | Publication issue number (the `issue` filename component; not part of the token hash). |
| `lump_size` | integer | Total word count, `2^n`. Must equal the header `n-6` field. |
| `cw` | integer | Code word count. Must match header bits 22:10. |
| `cc` | integer | C-list slot count. Must match header bits 7:0. |
| `typ` | integer | Header object type (bits 9:8): 0=lump, 1=data, 2=clist-only, 3=Outform. |
| `dw` | integer | Data word count embedded inside the code section. |
| `data_offset` | integer | Word index (from lump base) of the first data word. |
| `data_word_names` | string[] | Human names for each data word, in order. |
| `content_type` | string | Semantic sub-classification of `typ=0` lumps (`"code"`, `"text"`, `"markdown"`, `"image"`, `"grayscale"`, …). |
| `lump_type` | string | Alternative semantic type label used by some import flows (e.g. `"application_namespace"`). |
| `filename` | string | Name of the `.lump` binary file (canonical `dot.name.issue.token.lump` form). |
| `sidecar_file` | string | Name of this sidecar file (canonical `dot.name.issue.token.json` form). |

#### Integrity (computed over the binary)

| Field | Type | Meaning |
|:------|:-----|:--------|
| `binary_hash` | string | SHA-256 hex digest computed over the binary at save time — the checksum used by staleness and consistency checks. |
| `capBlockHash` | string | *Reserved (not yet emitted by the save path):* hash over the c-list block alone, for c-list drift detection. |

#### Capability and namespace metadata (today: from save-time `metadata` and boot registration; target: decoded from the binary c-list)

| Field | Type | Meaning |
|:------|:-----|:--------|
| `ns_slot` | integer\|null | Assigned NS slot (Resident / Lazy-load), or `null` (Dynamic / NULL). See NS Slot Assignment. |
| `ns_slot_policy` | string | `"static"` or `"dynamic"` (absent with `ns_slot: null` = dynamic; R9 retired). |
| `variant_group` | string | Declares alternative implementations sharing an `ns_slot` (rule R8). |
| `boot_resident` | boolean | `true` if the lump is part of the boot image. |
| `grants` | string[] | Top-level permissions this lump confers (usually `["E"]`). |
| `self_data_r` | boolean | `true` if c-list row 0 is a self-referential read-only data capability. |
| `capabilities` | object[] | C-list row descriptors: `row`, `name`, `grants`/`rights`, `gt`, `note`. |
| `clist_note` | string | Free-text note on the c-list layout, extracted at compile time. |
| `domain` | string | Security domain label (e.g. `"Church"`). |
| `domain_perms` | string | Permission string granted within the domain (e.g. `"L+S+E"`). |
| `media_tags` | object | Tag registry for data lumps: tag name → `{hex, description}` (e.g. `"TEXT": {"hex": "0x54455854", ...}`). |
| `image_width` | integer | Pixel width of an imported image data lump (written by `POST /api/lumps/import`; decodable from the image payload). |
| `image_height` | integer | Pixel height of an imported image data lump (written by `POST /api/lumps/import`; decodable from the image payload). |
| `namespace_meta` | object | Boot.NS (Namespace lump) only: decoded NS-table view (`entries[]` of slot/label/state), derived from the namespace binary by the namespace-build path. |
| `permBits` | string | *Reserved (not yet emitted by the save path):* canonical permission-bit summary of the lump's own GT. |
| `gtWord0` | string | *Reserved (not yet emitted by the save path):* the lump's own GT Word 0 (c-list slot 0 self-GT), as hex. |

#### API and source (today: recorded from save-time `metadata`; target: extracted from the embedded freespace content)

| Field | Type | Meaning |
|:------|:-----|:--------|
| `methods` | object[] | Method descriptors: `name`, `offset`, `length`, `description`, `inputs`, `outputs`, `comments`, `pet_names`, `aliasOf`. |
| `pet_names` | object | Register aliases: `{"DR": {...}, "CR": {...}}`. |
| `language` | string | Source language: `"cloomc"`, `"assembly"`, `"haskell"`, `"lambda"`, `"ISA"`, `"unknown"`. |
| `source` | string | Full source text as carried by the binary. Omitted from list projections. |
| `sourceStorageTier` | integer (0, 1, or 2) | Written by API / compiler. Tier of the embedded freespace content. `0` = API only, `1` = API + minimal source, `2` = API + full source. Absent = legacy (all-zero freespace, not self-defining). See Freespace Content and Self-Definition. |

#### Build and lifecycle metadata (recorded at save time; not binary-derived today)

These fields are **not derivable from the binary in the current release** — they are
recorded from save-time `metadata` or updated by the server. Their target disposition
under the mechanical-cache rule is stated per field: fields whose content becomes part of
the source carried in freespace (T7) become binary-derived; the remainder are IDE-local
lifecycle/telemetry annotations that migrate **out of the sidecar** to a separate
IDE-local store when the authorship rule is enforced.

| Field | Type | Meaning | Target disposition |
|:------|:-----|:--------|:-------------------|
| `author` | string | Creator name recorded at compile time. | Embedded in the source tier (T7) → binary-derived. |
| `version` | string | Human version string (e.g. `"2.0"`). | Embedded in the source tier (T7) → binary-derived. |
| `release_notes` | string\|object | Change description per version. | Embedded in the source tier (T7) → binary-derived. |
| `compiled_at` | float | Unix timestamp of compilation. | Embedded in the source tier (T7) → binary-derived. |
| `lump_version` | integer | Monotonic compile counter, bumped by `POST /api/lumps/save`. | Migrates to the IDE-local catalogue store. |
| `status` | string | Lifecycle status label (e.g. `"stable"`, `"released"`, `"wip"`). *Legacy/catalogue-curated: present on disk but not emitted by the current save path.* | Migrates to the IDE-local catalogue store. |
| `description` | string | One-line description of the abstraction. *Legacy/catalogue-curated: present on disk but not emitted by the current save path.* | Embedded in the source tier (T7) → binary-derived. |
| `source_file` | string | Repository path of the source file the binary was compiled from. *Legacy/catalogue-curated: present on disk but not emitted by the current save path.* | Superseded by embedded source (T7); dropped. |
| `forked` | boolean | Transient marker written to the live sidecar by `POST /api/lump/<token>/fork-version`; cleared on the next save. | Migrates to the IDE-local catalogue store. |
| `profile` | string | Target hardware profile (e.g. `"IoT"`, `"wukong-a7"`, `"example"`). | Embedded in the source tier (T7) → binary-derived. |
| `last_edited_at` | float | Unix timestamp of the most recent save. | Migrates to the IDE-local catalogue store. |
| `deployment` | object | Build environment metadata: `target_board`, `profile`, `built_at`, `builder`. | Migrates to the IDE-local catalogue store. |
| `mtbf` | object | Mutable reliability telemetry: `status`, `consecutive_clean`, `total_runs`, `source_hash`. | Migrates to the IDE-local telemetry store (mutable data can never live in a mechanical cache). |

#### Pet-name identity fields (written by the save path when a pet name is supplied)

The dual-seal identity scheme records both an identity seal (over the pet-name identity
string) and the content checksum (`binary_hash` above). These fields are emitted by
`POST /api/lumps/save` and appear in canonical sidecars as well as archived snapshots.

| Field | Type | Meaning |
|:------|:-----|:--------|
| `petname` | string | Global pet-name identity component (`petname.Abstraction#n`). |
| `issue_number` | integer | Issue component of the identity string (alias of `issue_n` in this role). |
| `identity_string` | string | The exact identity input string, `petname.Abstraction#issue` (or `Abstraction#issue` when no pet name is set). |
| `identity_hash` | string | SHA-256 hex digest of `identity_string` — the identity seal. |

#### Archive-only fields (present only in archived `*_vN` sidecars written by the fork-version path)

| Field | Type | Meaning |
|:------|:-----|:--------|
| `archived_version` | integer | Version number of this archived snapshot. |
| `archive_note` | string | Reason the version was archived. |

> **Removed fields.** `group` and `doc_refs` are removed from the sidecar schema in this
> specification. They were curatorial (not derivable from the binary) and introduced a
> drift risk. Sidecars on disk still carrying them, and readers still consuming them, are
> cleaned up as part of the T7 migration (see the authorship-rule transition note above).

---

## Manifest Architecture

**The binary is the single source of truth.** The manifest is a mechanical index derived
from the binaries on disk — a performance cache, not a truth document.

**What it is:**
The manifest (`server/lumps/manifest.json`) is a mechanically-derived index of the lumps
available in this IDE's local region of cyberspace. It is generated by scanning the lumps
directory and reading each binary — the header word (Word 0) for the structural fields and,
for self-defining binaries, the API/source content embedded in the binary's freespace
(see Freespace Content and Self-Definition). It is a cache —
if it is lost or stale, it is regenerated from the binaries.

**Why it exists:**

- **Discovery without scanning** — the server reads one file to know what lumps exist.
- **Field caching** — key binary-derived fields are cached so the server answers queries
  without opening every binary on each request.

**Truth hierarchy:** binary > manifest. When they disagree, regenerate the manifest from
the binary. The manifest is never edited by hand.

**Configuration is not cached truth.** Per the NS Slot Categories subsection, an NS slot
assignment is a property of the deployment configuration, not of the binary. Manifest
fields that record deployment configuration (`ns_slot`, `ns_slot_policy`, `boot_resident`,
`variant_group`) are therefore *not* recoverable from the binaries: regenerating the
manifest rebuilds all binary-derived fields, while configuration fields are re-applied
from the deployment configuration (today, the values carried in the sidecars written at
save/registration time; under the enforced rule, an explicit IDE-local configuration
store). The truth hierarchy is thus two-sourced: the binary is truth for everything the
binary defines; the deployment configuration is truth for slot assignment. The manifest
remains a cache of both — never the truth for either.

> **Transition note — mechanical regeneration status.** The freespace content format is
> now specified (Freespace Content and Self-Definition), but full regeneration from
> binaries is gated on tooling adopting it. Binaries compiled before the format have
> all-zero (legacy) freespace, so API/source fields cannot be read from them; the
> manifest is maintained incrementally by the save/delete API from save-time `metadata`
> (see the sidecar authorship-rule transition note). Only the structural header fields
> (`lump_size`, `cw`, `cc`, `typ`) are derivable from legacy binaries. As recompilation
> retires legacy binaries, the regeneration rule above becomes enforced behaviour.

### Why Tokens Do Not Cross Cyberspace Boundaries

A token is computed from `hash(name || genotype_binary)` for a binary compiled against a
specific hardware target (Ti60, Wukong, etc.). That token is valid only within the region
where that binary was compiled. A Ti60 token means nothing to a Wukong region because the
binary — and therefore the hash — differs.

**Cross-region sharing is logical, not physical.** The exchange protocol is:

```
Export:  pet name  +  source (extracted from lump freespace, Tier 1 or Tier 2)
Import:  compile locally  →  locally-valid token  →  index in local manifest
```

Pet names are hardware-neutral, owner-neutral, and human-meaningful. They name the idea;
the token names the instantiation. Each region produces its own binary and its own token
from the shared source.

> **Transition note — source extraction status.** The freespace layout for embedded
> source is now specified (Freespace Content and Self-Definition, Tier 1/2). For legacy
> binaries (all-zero freespace) the source still travels in the sidecar's `source`
> field / the save-time `metadata`, so an export of a legacy lump takes the source from
> the sidecar until recompilation retires it. The exchange model itself (pet name +
> source out, local compile + local token in) is unchanged by this transition.

---

## Publication and Distribution

**The binary is the single source of truth.** All other representations (sidecar, manifest)
are mechanically derived by tools. There are no curatorial fields, no approval documents,
no sync scripts, and no ghost entries. Any representation that could drift from the binary
is eliminated.

1. **Compiler output** — the CLOOMC++ compiler produces one file: `dot.name.issue.token.lump`.
   The binary is self-defining; freespace contains the API definition (all tiers) and
   optionally source (Tier 1 and 2). No companion files are required.

2. **Publication** — placing the binary in `server/lumps/` makes it available. The manifest
   and sidecar are derived mechanically from the binary by tooling. No editorial gate.

3. **Manifest** — regenerated from the lumps directory on demand. A binary on disk not yet
   in the manifest is not yet indexed; regeneration adds it.

4. **Distribution** — the distribution unit depends on the boundary crossed:

   - **Within a region** (same hardware target, same cyberspace region): the binary alone
     is the distribution unit: `dot.name.issue.token.lump`. The sidecar stays in the home
     region. The recipient derives its own sidecar and manifest entry from the received
     binary — except NS slot assignment, which is deployment configuration and must be
     supplied by the recipient's own configuration, never read from the binary (see
     Manifest Architecture).
   - **Across regions** (different hardware target or cyberspace region): the binary does
     not travel. The exchange is pet name + source (see "Why Tokens Do Not Cross
     Cyberspace Boundaries"): the recipient compiles locally, obtains a locally-valid
     token and binary, derives its own sidecar and manifest entry from that local binary,
     and assigns any NS slot from its own deployment configuration.

> **Transition note — publication workflow status.** Steps 1–4 describe the target
> workflow and are *future-normative*, gated on tooling adopting the freespace content
> format (Freespace Content and Self-Definition) and the sidecar single-write-path rule
> (see the authorship-rule transition note). Until compilers emit self-defining binaries,
> publication runs through `POST /api/lumps/save` with compiler-supplied `metadata`, and
> the sidecar/manifest are written from that metadata rather than re-derived from the
> binary. NS slot assignment remains deployment configuration in both the current and
> target workflows — it is never derived from the binary (see Manifest Architecture).

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
Step 7  Freespace validation (Zone ③, words cw+1 .. lumpSize-cc-1):
          For typ=lump only: inspect word cw+1. If bits [31:24] equal 0xAB,
          treat this as a content header (see Freespace Content and
          Self-Definition) and validate the full framing:
            7a  flags (bits [23:16]) must be 0x00, 0x01, or 0x03 — reject
                any other value.
            7b  api_byte_length (bits [15:0]) must be non-zero, and the API
                region (⌈api_byte_length/4⌉ words starting at word cw+2)
                must fit entirely within freespace — reject on overflow.
            7c  If flags.has_source: the word after the padded API region is
                source_byte_length; it must be non-zero, and the source
                region (⌈source_byte_length/4⌉ words following it) must fit
                entirely within freespace — reject on overflow. If
                flags.has_source is clear, no source-length word is present.
            7d  Zero-padding bytes inside the last word of each padded
                region must be zero, and every freespace word after the last
                content word must be zero — scan and reject any non-zero
                remainder. Arbitrary trailing data is never accepted.
          Mint validates framing, bounds, and the zero remainder only. It
          does not decode the payload: UTF-8 decoding, JSON parsing, and API
          schema validation (see the API definition format and register
          rules) are performed by tooling at extraction time, and a payload
          that fails them is malformed even though Mint accepted the frame.
          If bits [31:24] do not equal 0xAB, require ALL freespace words to
          be zero (legacy rule — the lump is a legacy binary, tolerated only
          until recompilation).
          For typ=data, typ=clist-only, and typ=Outform: scan words
          cw+1 .. lumpSize-cc-1 and reject if any word is non-zero — the
          all-zero rule is unchanged.
Step 8  Validate c-list slots (each must be a well-formed GT Word 0).
Step 9  Issue E-GT, write NS slot.
```

Steps 2–6 are pure arithmetic on the 32-bit header — no memory access beyond
the header word. Step 7 is the freespace validation (content-header check for
`typ=lump`, all-zero scan otherwise), protected by the cheap consistency gates
in steps 3–6. A malformed or malicious header is caught before Mint touches
the binary body.

---

## Freespace Content and Self-Definition

Every `typ=lump` binary is self-defining. Its freespace carries an embedded API definition
that describes the abstraction's interface: method pet names, branch offsets, and typed
IN/OUT variables with register assignments. A recipient region can compile a CALL to this
abstraction using only the binary — no companion file is required.

(*Legacy exception:* binaries compiled before this format have all-zero freespace and are
not yet self-defining. Legacy is a transitional state resolved by recompilation — see
"Legacy lumps" below. The self-definition statement above is the normative rule for all
newly compiled `typ=lump` binaries.)

Source code may additionally be embedded in freespace to make the lump portable across
cyberspace regions (enabling the recipient to recompile it locally). Three tiers govern
what freespace contains.

A lump's token identifies it within a local cyberspace region. Crossing a region boundary
requires the source — because each region compiles its own binary and derives its own token
(see Manifest Architecture and "Why Tokens Do Not Cross Cyberspace Boundaries"). The API
definition enables callers to compile against the abstraction; the source enables the
recipient region to recompile it.

### The Three Storage Tiers

**All three tiers embed the API definition.** The tiers describe only whether source code is
*additionally* present. A Tier 0 lump is self-defining — it carries its full API definition
in freespace. "Tier 0" means *API without source*, not *no freespace content*.

The tier is chosen by the lump author at compile time:

| Tier | Name | Freespace contents | Cross-region? | When to use |
|------|------|--------------------|---------------|-------------|
| 0 | **API only** | API definition only (no source) | ❌ Interface-only | Mature designs with MTBF approaching infinity — so thoroughly validated that every region that needs them already has them compiled locally |
| 1 | **API + minimal source** | API definition + source with comments stripped | ✅ Portable | Production-grade designs; auditability without storage overhead |
| 2 | **API + full source** | API definition + complete source including all comments | ✅ Fully portable | Active development; intent and rationale travel with the lump |

**Tier 0 and MTBF → ∞:** a deliberate declaration of maturity, not a default for convenience.
The lump has reached cyberspace infrastructure status — universally known, universally compiled,
no longer needing to travel as source. Choosing Tier 0 for an immature design is an error.

**Legacy lumps (all-zero freespace):** pre-existing binaries compiled before this spec have
all-zero freespace and are not self-defining. **Legacy is a transitional state, not a permanent
category.** The correct resolution is recompilation: recompiling a legacy lump against its
source produces a new self-defining binary (Tier 0, 1, or 2) with a new token, retiring the
legacy binary. Legacy lumps are tolerated only until recompilation is complete; they must not
be created by new tooling.

**Same abstraction, different tiers → different tokens:** a lump compiled at Tier 2 has a
larger binary (more freespace) than the same code compiled at Tier 0. Different binary =
different token. This is correct — the tier is baked into the identity.

### Freespace Layout

When freespace carries content, it is structured as follows:

```
Word 0:  Content header
  [31:24]  magic = 0xAB  (identifies this word as a content header)
  [23:16]  flags:  bit0 = has_source,  bit1 = source_has_comments
  [15:0]   api_byte_length  (byte count of the embedded API JSON)

Words 1 … ⌈api_byte_length/4⌉:
         API definition JSON bytes (UTF-8, packed big-endian, zero-padded to word boundary)

If flags.has_source (tier 1 or 2):
  Next word:  source_byte_length  (32 bits, byte count of source)
  Following:  source bytes (UTF-8, packed big-endian, zero-padded to word boundary)

Remaining freespace words: all zero
```

The zero remainder is mandatory: every freespace word after the last content word, and
every padding byte inside the last word of a padded region, must be zero. Mint enforces
the framing, bounds, and zero remainder at load time (validation step 7); freespace
outside the declared content regions can never carry data.

Tier-to-flags mapping:

- Tier 0: `flags = 0x00` (API only)
- Tier 1: `flags = 0x01` (API + source, no comments)
- Tier 2: `flags = 0x03` (API + source + comments)

**Legacy lumps:** if `word[cw+1]` bits [31:24] ≠ `0xAB`, the lump is a legacy binary
(all-zero freespace). Legacy is a transitional state — the correct resolution is
recompilation, which produces a new self-defining binary and retires the legacy one.
Legacy lumps are tolerated only until recompilation is complete; new tooling must never
produce them.

### API Definition JSON Format (Embedded)

The API definition embedded in freespace is a UTF-8 JSON object:

```json
{
  "name": "<abstraction name>",
  "methods": [
    {
      "petName": "<method pet name>",
      "branchOffset": <integer>,
      "in":  [ { "name": "<var>", "reg": "CRn|DRn", "comment": "<optional>" } ],
      "out": [ { "name": "<var>", "reg": "CRn|DRn", "comment": "<optional>" } ]
    }
  ]
}
```

**Identity fields are external — never embedded.** The embedded payload MUST NOT contain
`token` or `issue` fields:

- The **token** is `hash(name || genotype_binary)` — a function of the complete genotype
  *including this freespace content*. Embedding the token would require knowing the hash
  of bytes that contain the hash (a circular fixed point). The token therefore lives only
  outside the binary: in the canonical filename, the catalogue, and GT/NS bindings.
- The **issue** number is explicitly excluded from token identity (see The Token — Lump
  Identity): the same binary republished under a new issue keeps its token. Embedding the
  issue would bake a publication revision into the hashed bytes and break that rule. The
  issue lives only in the filename and catalogue.

When tooling extracts the payload to a `.api.json` cache file, it MAY annotate the
extracted JSON with `token` and `issue` taken from the binary's canonical filename —
those annotations are extraction-time metadata, present in the cache file only, never in
the binary.

**Register rules:**

- `reg` must be `CR` + non-negative integer, or `DR` + non-negative integer
- Reserved (must not be used for parameters): `DR0`, `CR5`, `CR6`, `CR12`, `CR13`, `CR14`, `CR15`
- Valid parameter registers: `DR1`+, `CR0`–`CR4`, `CR7`–`CR11`
- `comment` is present for Tier 2 (source has comments), absent for Tier 0/1
- Success/fail: callee writes non-null to `out` registers on success, null on failure —
  no separate flag; caller branches on null vs non-null directly

### Construction and Verification (Normative Tier 0 Example)

This sequence proves the format is constructible without circularity — a compiler can
emit a Tier 0 lump and any tool can independently verify its token:

```
Encode (compiler):
  1. Compile the abstraction → code words 1..cw, c-list (cc slots).
  2. Build the API JSON from compile-time facts only: name + methods
     (petName, branchOffset, in/out register assignments). No token,
     no issue — nothing in the payload depends on the final binary.
  3. Serialise the JSON as UTF-8; api_byte_length = byte count.
  4. Choose lumpSize = smallest 2^n (n ≥ 6) that fits
     1 + cw + 1 + ⌈api_byte_length/4⌉ + cc words.
  5. Assemble the genotype: header word (typ=00) · code · content header
     (0xAB, flags=0x00, api_byte_length) · packed API bytes (big-endian,
     zero-padded to word boundary) · zero remainder · c-list.
  6. token = first 8 hex chars of SHA-256(name_utf8 || genotype_bytes),
     each word serialised big-endian. Deterministic — computable only
     after step 5, which is why the token is never inside the binary.
  7. Write dot.name.issue.token.lump. Issue is assigned at publication;
     changing it renames the file but never changes the bytes or token.

Verify / extract (any tool):
  1. Recompute SHA-256(name || binary) and compare to the filename token.
  2. Read word cw+1, check magic 0xAB, validate framing (Mint step 7 rules).
  3. Decode api_byte_length bytes from word cw+2 as UTF-8 JSON; validate
     against the API schema above.
```

### Tooling Extraction Note

To extract the API definition from a lump binary: read word cw+1, check magic `0xAB`,
read `api_byte_length` bytes starting at word cw+2, and decode as UTF-8 JSON. The
resulting JSON is the same structure that tooling may cache as a `.api.json` file
(optionally annotated with `token` and `issue` from the filename, per the identity-fields
rule above) — this file is a hidden implementation detail derived from the binary, not a
separate artifact. It is not a named part of the logical lump and is not exported or
imported separately.

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

An IDE-issued dependency placeholder whose `slot_id` selects an allocated NS
slot. That slot owns exact opaque restore data in W1–W3; W3 contains the
32-bit cache/index `T`. A trusted full identity record outside the entry binds
the slot and generation to canonical name, positive issue, full identity hash,
full binary hash, `T`, and the saved W1–W3. First use fires resolution.
Promotion to resident Inform occurs only after full verification; matching `T`
alone never authorizes it.

### Abstract GT (typ = 11)

Self-defining. No memory region, no Object NS slot. Hardware maps
`object_id → value` internally. Covers physical constants (DREAD returns a
fixed value) and PassKey credentials (opaque identity tokens). Abstract GTs
are distributed by writing the full CR directly into c-list slots — no NS
slot consumed.

---

## Context Register (CR) — 96-bit Structure

A CR is three 32-bit words stored in a hardware register file (CR0..CR15 per
thread). NS Word 3 is not part of the ordinary capability register.

```
┌──────────────────────────────────────────────────────────────┐
│  Word 2 [95:64]   Authority snapshot                         │
│                   (f[1] | g[1] | gt_seq[9] | limit[21])     │
├──────────────────────────────────────────────────────────────┤
│  Word 1 [63:32]   Base address [32]                         │
├──────────────────────────────────────────────────────────────┤
│  Word 0 [31:0]    GT — the holder's credential (per-holder) │
│                   SAVE copies this word only                 │
└──────────────────────────────────────────────────────────────┘
```

### Word 0 — The Golden Token (per-holder credential)

```
31 30    28 27 26   25 24       16 15            0
+───┬────────┬───┬────────┬───────────┬──────────────+
│ B │ perm3  │dom│gt_type │ gt_seq[9] │   slot_id    │
+───┴────────┴───┴────────┴───────────┴──────────────+
```

The permission field at bits [31:25] uses a **dom+perm3** encoding:

| Field         | Bits  | Meaning |
|---------------|-------|---------|
| B             | 31    | Bind — TPERM-changeable. Must be 1 for user-level SAVE. |
| perm[2:0]     | 30:28 | Turing (dom=0): X/W/R. Church (dom=1): E/S/L. |
| dom           | 27    | Domain select: `0`=Turing, `1`=Church. |
| gt_type       | 26:25 | 00=NULL, 01=Inform, 10=Outform, 11=Abstract |
| gt_seq        | 24:16 | 9-bit revocation sequence |
| slot_id       | 15:0  | Namespace slot ID; Abstract reuses this as value data |

TPERM clears any subset of bits [31:25] to produce a weaker GT. Permission
escalation is architecturally impossible.

### Word 1 — Base Address

Physical base address copied from resident NS Word 0 after validation.

### Word 2 — Limit and Revocation

```
95 94 93       85 84                          64
+──┬──┬───────────┬────────────────────────────+
│f │g │ gt_seq[9] │       limit_offset [21]     │
+──┴──┴───────────┴────────────────────────────+
```

**Revocation:** Mint increments gt_seq in the Object NS slot. On LOAD,
hardware checks Word 0 gt_seq against Word 2 gt_seq — a mismatch means the
GT has been revoked and the LOAD faults and the GT is set to NULL.

NS `integrity32` is checked during resolution/LOAD but is not copied into the
CR. NS W3 cache `T` is likewise absent from ordinary CRs. M-elevated hardware
may expose W3 in DR15 for diagnostics only; DR15 never gates writeback.

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

Each lump occupies exactly one Object NS slot (four 32-bit words). The access
GT is held by its holder and is never stored in the NS slot.

```
NS Word 0  location [32]           — physical address of lump word 0
NS Word 1  f | g | gt_seq[9] | limit_offset[21]
NS Word 2  integrity32             — corruption check over W0-W1
NS Word 3  cache/index T [32]      — non-authoritative
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

### Dynamic System LUMPs — Bank

`Bank` is a canonical CLOOMC LUMP with a dynamic Namespace policy. Its binary
is a normal self-defining `typ=00` LUMP: it has a compiler-owned SELF identity
in c-list row 0, an `E` caller grant, a canonical filename/identity seal, and
the full Bank source/API frame. It deliberately has **no fixed `ns_slot` and
is not boot-resident**.

The c-list SELF word identifies `Bank#1`; it is not a live lockbox credential
and has no authority over private custody memory. When a Bank call is installed
or dispatched, the dynamic system binding mints the live E-GT and enforces
proof validation, private Outform storage, complete zeroization, and
server-authorized recovery. A LUMP implementation must never embed a PassKey
proof, a private lockbox address, or a reusable custody GT.

Bank exposes one custody interface. Its inner sanctum may mint and rotate a
typed Golden Token for private use, but that passkey, proof, object identifier,
and Namespace address never cross the Bank boundary. The public interface
starts with `Create(lump)`:

| Method | Inputs | Outputs | Meaning |
|---|---|---|---|
| `Create` | CR1 typed Inform `R` LUMP capability **or** a complete LUMP value; its canonical identity metadata accompanies the value | CR0 `BankVariable` Abstract + `E` capability on success, otherwise NULL; DR0=1 on success or a specific Bank error code | Verify and privately commit exactly one complete self-defining `typ=lump` binary, then issue the typed Enter authority in CR0. Callers test CR0 before use; DR0 is diagnostic only. |
| `InspectVariable` | CR0 `BankVariable` | DR0=1 on success or a specific Bank error code; DR1 word count; DR2 capacity; DR3 issue; DR4 lifecycle | Accept only the typed CR0 capability; return scalar inspection fields plus non-sensitive identity/provenance metadata without a private location. |
| `Read` | CR0 `BankVariable`; DR1 offset; DR2 word count | DR0=1 on success or a specific Bank error code; CR4 fresh Inform `R` capability | Copy only the requested in-bounds words into a new public readable allocation. |
| `Release` | CR0 `BankVariable` | DR0=1 on success or a specific Bank error code | Zeroize and retire the private allocation; clear CR0 so the variable capability is stale thereafter. |
| `RevokeVariable` | CR0 `BankVariable` | DR0=1 on success or a specific Bank error code | Revoke the variable authority, clear CR0, and zeroize and retire its private allocation. |

The capability registers above are type checked by the live binding. A raw GT,
proof words, a Namespace index, a memory address, scalar object identifier, or
a reconstructed handle in DRs is not authority. `Create` returns only the
typed BankVariable Golden Token in CR0; its private proof remains in the
sanctum. `CR0` is the only returned authority for the verified Bank variable;
`DR0` reports `1` for success or a specific nonzero Bank error code for failure,
and must never be used as a capability. `CR0` is a capability-or-NULL result:
callers must test it before entering the verified abstraction.

The executable Create policy has three ordered stages: validate the complete
submitted LUMP, atomically commit private custody (or clean up every partial
allocation/Namespace/object state), and issue the nullable typed
`BankVariable E` capability in CR0 only after that commit succeeds. The
source-level flow records validation failure, custody commit, and post-commit
issuance; only the proof-bound runtime may execute the private validation,
credential, and custody operations. DR0 remains status data and never becomes
authority.

For `Create`, the canonical diagnostic codes are: `0x101` no typed capability,
`0x102` wrong capability type, `0x103` identity/seal validation failed,
`0x104` permission denied, `0x109` allocation failed, `0x10A` no private
Namespace slot, `0x10B` capability minting failed, and `0x10C` private
Namespace cleanup failed. The complete machine-readable mapping is embedded in
the Bank LUMP's `capability_abi.Create.error_codes` object.
There is no public `MintKey`, owner-key, raw-proof, or scalar-handle lifecycle.
Allocation, proof validation, rotation, zeroization, and recovery are inner
sanctum operations reached only after validating the BankVariable Golden Token.
This prevents callers from treating the static LUMP identity or a scalar value
as custody authority.

Before `Create` reserves an allocation or writes a Namespace entry, it applies
these ordered gates:

1. **Structural LUMP validity.** Verify header magic, an exact power-of-two
   allocation, `typ=lump`, `cw`/`cc` bounds, a complete `0xAB`
   API-and-source frame, and zero padding through the c-list boundary.
   Public API methods must resolve to executable dispatch entries.
2. **E-abstraction/type validity.** The SELF c-list row must be the exact
   Church-domain Inform E capability derived for the declared identity.
   Method capabilities must never combine Turing execute (`X`) and Church
   enter (`E`) rights.
3. **Requested identity validity.** Recompute the binary hash, canonical
   `SHA-256(name || complete_big_endian_binary)[:8]` token, and
   `SHA-256(name#issue)` identity seal; compare each supplied metadata
   assertion (`dot_name`, issue, token, binary hash, identity hash, SELF GT,
   and optional identity string) with those independently derived values.

Thus metadata tells Bank what relationship the caller is asserting, but cannot
make forged bytes acceptable. A malformed header, a stale/copy-pasted token,
an altered code word, a forged API name, a mismatched identity hash, or a
different c-list SELF fails before any private custody state is published.

These checks establish **mechanical tampering-and-substitution detection**, not
historical genesis. A modified binary or swapped name/token combination fails
Gate 3 before custody is allocated. The provenance of the name-to-token binding
is currently human-vouched: a matching token and identity seal prove the
submitted bytes are self-consistent under the declared `name#issue`, but not
who first published the abstraction. A future genesis-rooted certificate
verifier may strengthen Gate 3 without weakening these mechanical checks.

The owner capability and verified variable capability are intentionally
different authorities. Owner methods manage a Bank lockbox; variable methods
mediate reads, release, revocation, and explicit nested `Create(Read(...))`
workflows. A successful status in `DR0` does not grant either authority, and
retirement clears the corresponding capability register.

A Bank variable contains **one complete LUMP**, not an indexed collection.
`words` is the exact encoded binary size. `capacity` is the actual private
Namespace-backed allocation returned by the allocator: an exact fit remains an
exact fit, while allocator power-of-two rounding is visible only through the
safe capacity projection. Nested custody is explicit: `Read` produces a fresh
bounded Inform capability, and `Create` may validate that returned complete
LUMP into a distinct Bank variable. No nested value receives an implicit
alias to the parent’s private storage.

The packaged manifest/binary/sidecar are validated during Bank artifact build,
then emit a browser runtime identity projection. `SystemAbstractions` binds the
Bank methods only when that generated projection still names the canonical
dynamic Bank LUMP and matches the dynamic registry descriptor. A bad identity
fails closed: it cannot create a private custody allocation or dispatch a Bank
operation.

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

## Distribution Formats

The per-type distribution containers are:

| Lump type | File extension | Contents |
|-----------|---------------|----------|
| Abstraction | `dot.name.issue.token.zip` | Single `dot.name.issue.token.lump` binary — header + code + freespace + c-list |
| Thread | `*.thread.zip` | Single `.bin` file — header + five zones |
| Namespace | `*.namespace.zip` | `manifest.json` + NS LUMP `.bin` + optional bundled deps |
| Data | `*.data.zip` | Single `.bin` file — header + raw data |

**The distribution unit for an abstraction lump is the binary alone:**
`dot.name.issue.token.lump`.

- **No sidecar is included** — the `.json` sidecar is local administrative
  metadata and stays in the home region; it never crosses a distribution
  boundary.
- **No `.api.json` file is included** — the API definition is embedded in
  the binary's freespace (see Freespace Content and Self-Definition). The
  binary is self-defining; a recipient needs no companion file to
  understand the interface.
- **The recipient region derives its own sidecar and manifest entry
  mechanically from the received binary.** NS slot assignment remains the
  recipient's own deployment configuration and is never read from the
  binary (see Manifest Architecture).

Any older file-set description listing sidecars, `.api.json` files, or other
companion members inside a distribution zip is superseded by the binary-only
rule above.

### ZIP Container Convention

All ZIP containers: bit 3 of the general-purpose flags must be `0`
(uncompressed size present in the local file header). The Locator reads the
uncompressed size before downloading the body and pre-allocates physical
memory accordingly (see ZIP Pre-Allocation Sequence). ZIP files where bit 3
is `1` are rejected.

### Directory Layout Inside a Distribution Zip

The zip is flat — no subdirectories. A single-lump distribution zip contains
exactly one member, the binary, named identically to the zip minus the
`.zip` extension:

```
dot.SlideRule.1.a3f9c2b1.zip
+-- dot.SlideRule.1.a3f9c2b1.lump
```

Thread and Namespace bundles keep their existing layouts (see Single Thread
Upload and Namespace Bundle above); bundle-internal `*.bin` member names are
an intentional legacy exception pending a bundle revision (see "Canonical
Filename Form and File Set").

---

## Boot Image Design

The boot image is the self-contained binary the IDE produces to initialise
a Church Machine system. This section defines the design rules the boot
image must obey.

### IDE Role — Design-Time Only

The IDE configures the boot image; **its role ends at boot**. Once the
binary boot image is produced and the device boots, the IDE may disconnect
at any time — network failure, programmer closing the browser, device
powered off and back on, or the device deployed to a remote site that never
sees the IDE again. Every Church Machine deployment must be designed so
that after boot, the system is fully self-supporting and operates under its
own authority.

That means the following services are not IDE features — they are runtime
system services that must be part of the boot image itself:

- **Lazy loading** — fetching and resident-loading lumps on first CALL
- **NS slot allocation** — claiming empty slots from the reserved pool
- **Memory management** — allocating and reclaiming lump-sized regions
- **Garbage collection** — sweeping unreachable NS entries and lumps
- **Error recovery** — handling faults, thread crashes, and resource
  exhaustion

The IDE produces the image. The runtime owns the system from boot onwards.
Every service the running system needs must be either resident in the boot
image or reachable through the lazy-load mechanism the boot image installs.

### Digital Object Lifecycle

A lump is a **digital object**: it is born via Mint commissioning, lives in
NS slots, and retires when all references to it are gone.

Thread-internal variables — short-lived scalars, intermediate calculations,
local arrays — use the thread's own heap. No NS machinery is needed and no
GTs are minted.

Digital objects are different. An image, a document, a piece of work output
created by the running system has an independent existence and may outlive
any single thread interaction. While a digital object is *online*, it
requires:

- An **NS slot** — so the namespace knows it exists
- A **memory window** — the physical region it occupies (allocated by the
  memory manager from the namespace's memory)
- **GTs** in any c-list that needs to reference it

All three are dynamic — minted when the object is created, evolving as the
object changes, referenced from one or many threads simultaneously, and
revoked when the object goes away.

When a digital object is **exported** — packaged as a lump and moved
offline (written to disk, sent over the network, archived) — it leaves the
namespace entirely. Its NS slot, memory window, and outstanding GTs all
become redundant and are eligible for garbage collection:

1. Revoke the GTs (bump the NS entry's `gt_seq` so all stale references
   fault)
2. Release the memory window back to the memory manager for re-allocation
3. Free the NS slot for reuse by the next dynamic object

The garbage collector runs without IDE involvement.

### C-list Rule at Boot Time

**The c-list of a resident lump is fixed at boot time.** Dynamic extension
of capability sets is the domain of runtime Mint operations, not the boot
image. A c-list is strictly an array of 32-bit GT words — one GT per slot;
no raw address, scalar, or data word may occupy a c-list slot (a null word
`0x00000000` is a valid GT encoding meaning empty/invalid). The hardware
and simulator refuse to load anything but a validated GT from a c-list
slot.

### NS Slot 0 Semantics

**Slot 0 is the namespace's own NS entry — the root Namespace LUMP
(Boot.NS); it is not a general-purpose slot.** Slot 0 of the Namespace
table describes the total physical memory allocated
to the namespace. It is a *descriptor*, not a GT container. The Namespace
table never holds GTs — GTs live only in c-lists. Slot 0 tells you what
physical memory exists and where; it does not grant the right to act on
that memory.

The right to act on the namespace's memory is held by the **memory
manager**, which has in its own c-list a GT covering the full namespace
memory region. It uses that GT to allocate lumps on demand.

| Holds what | Where |
|------------|-------|
| Description of "this memory exists" | NS slot 0 in the Namespace table |
| Authority to allocate from it | A GT in the memory manager's c-list |

### Three-Step Boot Initialisation

The IDE walks the programmer through three sequential steps when generating
a boot image. The IDE provides hardware information (memory budget, address
map for the chosen target board) so the programmer can make informed
decisions; it never derives sizes automatically.

**Step 1 — Namespace setup (foundational lumps, always present).** The
programmer specifies the total namespace physical memory and the sizes of
the three foundational lumps:

- **Namespace Lump** — anchors the namespace; defines NS slot 0 and the
  initial NS table layout.
- **Thread Lump** — physical region for the initial thread (its registers,
  stack, heap).
- **Abstraction Lump** — physical region for the initial abstraction the
  thread runs in (its code and c-list).

All three lump sizes are programmer choices, informed by the target
hardware profile shown by the IDE. The Namespace Lump is sized based on how
many NS entries the design will need over its lifetime (resident + lazy +
reserved empty slots, plus headroom for digital-object slots).

**Step 2 — C-list injection (resident lumps, zero or many).** The
programmer declares which additional lumps are baked into the boot image at
fixed physical addresses — it is the programmer's call which abstractions
need to be resident from the first clock cycle (e.g. memory manager, lazy
loader, garbage collector, fault handler) versus which can be lazy-loaded.
For each resident lump, the IDE places its body in the binary image at a
fixed address inside the namespace memory region, with its c-list fixed at
boot time (per the c-list rule above). Lumps not declared resident use the
lazy-load mechanism: their NS entry exists in the namespace table (so GTs
can be minted against them from the start), but the lump body is fetched
into memory at first CALL.

**Step 3 — Thread activation (empty NS slots, open-ended growth).** The
programmer reserves a number of empty NS slots in the namespace table for
lumps that do not exist at design time. The IDE cannot know what those
lumps will contain — only how much headroom to leave. These slots are
filled at runtime by the lazy loader when new lumps are created (a new
abstraction installed, a new digital object minted, a remote lump cached
locally). The boot image then activates the initial thread, and the running
system operates under its own authority from that point on.

**What the IDE produces** — a self-contained binary boot image whose byte
layout is:

- The NS table (foundational + resident + reserved empty slots)
- The three foundational lump bodies at fixed addresses
- All resident lump bodies at fixed addresses
- The memory manager's c-list, including a GT covering the full namespace
  memory region

After the device boots from this image, the IDE plays no further role. The
boot architecture rules above apply without exception; any divergence is a
bug.

---

## Security Properties

### Architectural (hardware-enforced, not bypassable)

| Property | Mechanism |
|----------|-----------|
| Turing/Church mutual exclusion | Data and capability instructions operate on strictly separate rights |
| GT unforgeable | Only Mint issues GTs — raw bytes cannot be reinterpreted as capabilities |
| Execute isolation | Transient CR14 grants X only — code is execute-only, DREAD cannot reach it |
| C-list isolation | Transient CR6 grants E+M only — callers can load capabilities out but cannot SAVE into slots without B=1 |
| Permission non-escalation | TPERM can only remove bits, never add |
| Entry point integrity | PC always starts at 1 — the header word cannot be executed |
| NS integrity check | Every LOAD validates `integrity32` over resident NS W0–W1; this detects corruption but is not identity authentication |
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

NS Slot (gt_seq=0x01, location=0x20000000):
  Word 0:  0x20000000
  Word 1:  0x0020007F  (gt_seq=0x01, limit_offset=127)
  Word 2:  integrity32(Word0, Word1)
  Word 3:  cache/index T
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

NS Slot (gt_seq=0x01, location=0x10000000):
  Word 0:  0x10000000
  Word 1:  0x002003FF  (gt_seq=0x01, limit_offset=1023)
  Word 2:  integrity32(Word0, Word1)
  Word 3:  cache/index T
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

## IDE Views

Every lump-related view in the IDE is a **dynamic tool** — it reads binary data at runtime
and renders a live view. None are resident documents; none can drift from the truth. The
binary is the source; the view is always derived. No view is an editorial gate; all views
are read-only windows onto binary-derived data.

### LUMP Detail Panel

Reached via the **Lumps tab** in the full IDE. Selecting any LUMP from the sidebar opens the
detail view, which is split into eight sub-tabs plus a header strip, all reading
binary-derived data.

#### Header Strip

Always visible. Shows:

| Element | Description |
|:--------|:------------|
| Token | 8-hex token, copyable. |
| NS Slot | Assigned slot number (Resident or Lazy-load), or `—` for Dynamic LUMPs. |
| Version | `lump_version` integer. |
| Size | `lump_size` in words. |
| CW / CC | Code word count / C-List count. |
| **Edit** button | Opens the source editor preloaded with this LUMP's source. |
| **Audit** button | Runs all lump-audit rules against the binary (see Lump Audit Rules). |
| **Run** button | Loads the binary into the simulator and boots. |
| **Shrink** button | Calls `/api/lump/<token>/resize` to remove freespace. |

#### Sub-Tab: Overview

Shows identity and authorship metadata — pet names (DR/CR register aliases) and NS table
slot/state/hash.

**For code LUMPs:**
- Author, version, compiled date
- Token, size, cw, cc, language, grants
- **Pet Names** — table of DR and CR register aliases
- **MTBF Reliability** — status badge, consecutive-clean count, total runs
- **Deployment** — target board, profile, builder, build timestamp

**For the Namespace LUMP (Boot.NS, slot 0, `typ=1`):**
- SVG dependency graph of the namespace hierarchy
- NS Table: slot index, label, state, and hash/file for each resident abstraction

#### Sub-Tab: API

The call contract for this abstraction.

- **Methods table**: index, name, offset (word), length (words), description
- **Caller Grants**: what permissions a caller must have to enter this LUMP
- **C-List / Capabilities table**: row index, name, grants, note for every C-List row

#### Sub-Tab: Content

Renders the LUMP's logical content (binary content breakdown) based on `content_type` / `typ`:

| Content Type | Rendering |
|:-------------|:----------|
| `code` | Disassembled instructions with semantic comments, branch-target arrows, method-boundary markers, and stub-method warnings (amber) for bare-`RETURN` methods. |
| `text` / `markdown` | Plain text editor or formatted Markdown render. |
| `image` / `grayscale` | Reconstructed image canvas + "Replace file" utility. |
| `thread` | Thread state: PC, call depth, all 16 Data Registers. |

#### Sub-Tab: Tokens *(MyGoldenTokens)*

C-List viewer and POLA editor.

- **GT chips**: one chip per C-List row, showing the raw GT word, permissions, object_id, and pet name.
- **POLA tools**: strip excess permissions from individual rows (Principle of Least Authority).
- **Push Names**: writes this LUMP's pet names into the running simulator's namespace so the Memory and GT views use them.

#### Sub-Tab: Source

Displays the original CLOOMC++ / Assembly source that produced this binary — extracted from
freespace if Tier 1 or 2 (fetched from `/api/lumps/<token>/detail`). Shows a `binary_only`
notice if no source was saved.

#### Sub-Tab: Versions *(Version Telemetry)*

Per-version fault telemetry from FPGA call-home data.

- Table of every archived version with: version number, fault count, Tier-1/2/3 recovery breakdown, MTBF estimate.
- **Bulk upgrade** button: pushes the current version to all registered devices still on an older version.

#### Sub-Tab: History *(Binary Version Archive)*

Archived `.lump` binaries stored as `<token>-v<N>.lump`.

- Lists every archived version with timestamp and word count.
- **Preview**: fetches the old binary and renders its hex dump.
- **Restore**: promotes the archived version to the active binary (writes it back as `<token>.lump` and updates the sidecar).

#### Sub-Tab: Hex Dump

Raw binary view of the `.lump` file, with inline header decode.

- One 32-bit word per row, colour-coded by region:
  - **Header** (word 0): gold
  - **Code** (words 1–cw): blue/white
  - **Freespace**: dim grey
  - **C-List** (tail cc words): amber
- ASCII sidecar alongside each word.
- Header decode panel: expands `magic`, `n-6`, `cw`, `typ`, `cc` inline.

### DNA Viewer (`app-gt-view.js`)

The top-level design surface of the IDE. Displays every Golden Token of any type across all
configured namespaces. Each GT is identified by its `dot.name.token` ID. Four GT types appear
in the DNA Viewer:

- **Abstract** — the conceptual identity of an abstraction: its pet name and interface
  contract, independent of any binary or NS slot; the idea itself
- **Outform** — the GT an abstraction presents to the outside world; makes it callable
  from a configured NS slot; the face an abstraction shows to callers
- **Inform** — the binary lump in memory being executed; the physical compiled form:
  header, code, freespace, c-list
- **NULL** — a c-list row that is currently empty; the slot is always useable. Filled at
  runtime either by the Lazy Load protocol or by code calling a system abstraction that
  returns a GT. The returned GT must have `B=1` (binding bit set) for code to save it into
  the slot. NULL GTs are visible in the DNA Viewer so the programmer can see which c-list
  slots are unresolved at design time

Clicking any GT reveals the full details of that node. The DNA Viewer is the primary
navigation surface: the programmer starts here and navigates outward to any lump or
namespace node. All other views are subordinate; the DNA Viewer is not subordinate to
any other panel.

### Manifest Viewer

Fetches `/api/lumps/list`; shows the mechanically derived manifest index as a flat list of
available lumps.

### Other IDE Panels that Show LUMP Data

| Panel | Location | What it shows |
|:------|:---------|:--------------|
| **Memory View** | `app-memory.js` | Physical address space map — shows where each LUMP is loaded as a coloured block with its token and size. |
| **CR Detail** | `app-cr-detail.js` | Deep inspection of a specific Capability Register: resolves the underlying LUMP token, base, limit, and permissions. |
| **Namespace tab** | Main IDE sidebar | Shows all NS slots with their resident LUMP token, state (loaded/absent/outform), and size. |
| **Lesson 5 form** | `/start` (starter IDE) | "Start from an existing abstraction" picker: populates `absName`, `absDesc`, and method rows from a selected LUMP's sidecar data via `/api/lumps/list`. |

All views are read-only tools derived from binary truth. No view is an editorial gate.

---

## API Endpoints

All lump-related HTTP endpoints are served by the Flask backend (`server/app.py`).

### Read / Retrieve

| Method | Path | Description |
|:-------|:-----|:------------|
| `GET` | `/api/lumps/list` | JSON array of all lumps (sidecar minus `source`). Includes `binary_valid` flag. |
| `GET` | `/api/lumps/<token>/detail` | Full sidecar JSON including `source`. |
| `GET` | `/api/lump/<token_hex>` | Raw binary (`application/octet-stream`). Falls back to Mum Tunnel Library on GitHub. `X-Lump-Source` header indicates origin. |
| `GET` | `/api/lump/<token_hex>/words` | `{token, words: uint32[], count}` — word array as JSON. |
| `GET` | `/api/lump-source/<name>` | `{name, source}` for the named abstraction. Returns `{binary_only: true}` if no source exists. |
| `GET` | `/api/lumps/bundle.zip` | ZIP of all `.lump` binaries + `manifest.json`. |
| `GET` | `/api/lumps/<token>/history` | `{history: [{version, filename, compiled_at, lump_size}]}`. |

### Create / Save

| Method | Path | Description |
|:-------|:-----|:------------|
| `POST` | `/api/lumps/save` | Save a compiled LUMP. Body: `{binary: uint32[], metadata: {...}}`. Runs c-list bounds check. Returns `{token, lump_path, sidecar_path}`. |
| `POST` | `/api/lumps/import` | Pack a base64 file into a data LUMP. Body: `{name, content_type, data_b64, width?, height?}`. |
| `POST` | `/api/lumps/upload-lump` | Import a raw `.lump` binary. Body: `{name, data_b64}`. Parses header to generate sidecar. |

### Update / Modify

| Method | Path | Description |
|:-------|:-----|:------------|
| `PUT` | `/api/lump/<token>/content` | Overwrite the content of a data/text LUMP in-place. Body: `{text?} \| {data_b64?}`. Returns `{cw, lump_size}`. |
| `PATCH` | `/api/lump/<token>/meta` | Update sidecar fields (`author`, `version`, `pet_names`, etc.). |
| `PATCH` | `/api/lump/<token_hex>/clist/<row>` | Write one GT word into a specific C-List row. Body: `{gt_word: uint32}`. |
| `POST` | `/api/lump/<token_hex>/resize` | Repack to minimum power-of-2, removing freespace. Returns `{old_size, new_size, saved_words}`. |
| `POST` | `/api/lump/<token>/fork-version` | Archive current binary as `-vN`, promote new compile as primary. |

### Delete

| Method | Path | Description |
|:-------|:-----|:------------|
| `DELETE` | `/api/lumps/<token>` | Remove binary, sidecar, and manifest entry. Returns list of deleted files. |

### Telemetry

| Method | Path | Description |
|:-------|:-----|:------------|
| `GET` | `/api/lump/version-telemetry/<name>` | Per-version fault statistics for the named abstraction. Used by the Versions sub-tab. |

---

## Lump Audit Rules

The audit system (`simulator/lump-audit.js`) runs structural consistency checks on LUMP
binaries. Invoked from the **Audit** button in the IDE detail-panel header strip and by
its direct test consumers.

The auditor operates in two modes:

- **Manifest-guided**: sidecar metadata is available; all rules apply.
- **Binary-only**: no sidecar; only binary-derivable rules apply (R0, R1, R2, RB1, RB2, RFS, RCI, RNC).

| Rule ID | Name | What it checks | Failure means |
|:--------|:-----|:---------------|:--------------|
| **R0** | Empty Binary | Word array must not be empty. | No binary content to audit — the file is empty or unreadable. |
| **R1** | Header Magic | Bits 31:27 of word 0 must equal `0x1F`. | Word 0 is not a valid LUMP header; the file is not a lump or is corrupted/evicted. |
| **R2** | Word Count | Actual word count must equal `2^(n-6+6)` as encoded in the header exponent field. | The binary is truncated or padded inconsistently with its declared size. |
| **RB1** | Code Word Count | `cw >= 1` — at least one code word must exist. | The lump declares no code section; nothing can execute at PC = 1. |
| **RB2** | Layout Bounds | `1 + cw + cc <= lump_size` — header + code + c-list must fit. | Declared regions overflow the lump; header fields are inconsistent. |
| **RFS** | Freespace Zone | For `typ=lump`, freespace must either begin with a valid `0xAB` content header whose framing passes Mint validation step 7 (bounds + zero remainder), or be entirely zero (legacy binary). For all other `typ` values, all freespace words must be zero. | Freespace fails both forms — a malformed content frame, non-zero trailing words after the declared content, or non-zero words in a legacy/non-lump binary; corruption or an out-of-bounds write; Mint would reject the lump at load time. |
| **RMC** | Manifest Coherence | If a sidecar is provided, its `cw`, `cc`, and `lump_size` must exactly match the binary header. | The sidecar has drifted from the binary; the binary header is ground truth. |
| **RCI** | Instruction Range | `LOAD`/`SAVE`/`ELOADCALL`/`XLOADLAMBDA` must reference rows `0 … cc-1`. `BRANCH` targets must land within the code section. | Code references a c-list row or branch target outside the lump's declared bounds — a fault at runtime. |
| **RNC** | NULL GT Check | Warns if code accesses a C-List row that holds a NULL (all-zero) Golden Token. | The row is expected to be filled at runtime (Lazy Load or a system abstraction returning a `B=1` GT); if it is not, the access faults. |
| **RPN** | Pet Name Coverage | Every C-List row referenced by code must have a corresponding pet name in the sidecar. | The sidecar's documentation of the c-list is incomplete. |
| **RSM** | Stub Method | Detects methods whose entire body is a single bare `RETURN` with no implementation. Flagged as amber warnings in the Content sub-tab. | A declared method has no real body — likely unfinished code. |

Failures at R0–RFS are hard errors; RMC–RPN are reported as warnings that block merge
(enforced by `tests/lump/test_lump_consistency.py` — 11 rules, R1–R11 in that file). RSM is
advisory only.

---

## Developer Tooling

The scripts below are the supported workflow for rebuilding and validating `.lump`
binaries and keeping example sources in sync.

> **Token discovery.** Bitstream membership, slot assignment, residency, and
> displayed build metadata come from the committed Namespace Table and its
> assigned slot/LUMP data. `manifest.json` is an untrusted catalog/lookup aid
> only; it never establishes membership or content identity. The content token
> is `sha256(canonical_dot_name ‖ sealed_genotype_binary)[:8]` and excludes
> the re-issuable issue number. CRC/parity fields are per-GT checks, not seals.

### `scripts/update-lump.js` — one-command LUMP rebuild

Changing a sealed lump requires assembling a **new** `.cloomc` source and
publishing a new immutable LUMP; existing sealed bytes are never patched in
place. The Namespace Table is updated by the trusted installation path.

**Invocation:**

```bash
node scripts/update-lump.js --token <hex>           # rebuild lump
node scripts/update-lump.js --token <hex> --check   # drift check (no writes)
make update-lump TOKEN=<hex>                        # Makefile shorthand
```

**Inputs read:**

1. The Namespace Table entry assigned to `<token>` (the manifest may be used
   only to locate an untrusted source/catalog record).
2. The `.cloomc` source, discovered in this order:
   1. the manifest entry's `"source"` field (explicit path relative to repo root)
   2. `simulator/examples/<token>.cloomc`
   3. `simulator/examples/<normalised-abstraction>.cloomc`
   4. `server/lumps/<token>.cloomc`
3. The existing `.lump` binary — its c-list GT words (the `cc` tail entries) are extracted
   and preserved unchanged in the rebuilt binary; only the code words change. On a first
   build with no existing binary, the c-list is initialised to all zeros.

**Scope of assembly.** The script assembles with `ChurchAssembler` — it handles
assembler-level `.cloomc` sources only. Sources written in higher-level CLOOMC++
constructs require the CLOOMC compiler and are not rebuildable by this script even if a
manifest `"source"` field points at them; assembly fails with an error and nothing is
written. Lumps with no discoverable `.cloomc` source (binary-only data lumps,
hardware-compiled binaries) are likewise out of scope; adding a `"source"` field to the
manifest entry enables rebuild only when that source is assembler-level.

**Outputs written (on success):**

- the rebuilt `.lump` binary (header + new code words + zero pad + preserved c-list)
- the sidecar JSON — `cw` / `cc` / `lump_size` fields only; all other fields preserved
- the matching `manifest.json` entry — same three fields

On success it prints `Updated <token>: cw=N cc=N lump_size=N` and exits 0. Any failure
detected before the write phase (missing token, undiscoverable source, assembly error,
oversized code) exits non-zero with a clear message and writes nothing. The writes
themselves are sequential (binary, then sidecar, then manifest), not transactional; if a
write fails partway, re-run the script — a rebuild is idempotent — or run `--check` plus
the consistency gate to confirm the three files agree.

**Flags:** `--token <hex>` (required) selects the lump. `--check` assembles the source and
compares the result against the current binary on disk without writing anything — exit 0
if identical, exit 1 with a `DRIFT` message if different; designed for CI / pre-commit
drift detection.

After rebuilding, run the consistency gate to confirm the output is gate-clean:
`python -m pytest tests/lump/test_lump_consistency.py -v` (or
`./scripts/run-all-tests.sh --group lump`).

### `scripts/sync-canonical-examples.js` — canonical example sync

The inline assembly examples embedded in `simulator/app-run.js` must stay identical to the
canonical source files in `simulator/examples/*.cloomc`. Run the sync script whenever an
inline example string in `app-run.js` is edited.

**Invocation:**

```bash
node scripts/sync-canonical-examples.js           # repair drift (writes files)
node scripts/sync-canonical-examples.js --check   # CI guard (no writes)
```

**Inputs:** every inline example string in `simulator/app-run.js`.

**Outputs:** overwrites any `simulator/examples/<key>.cloomc` file that differs from its
inline counterpart; exits 0 on success. In `--check` mode it writes nothing and exits
non-zero listing drifted files if any canonical file is out of date.

Exception: the `led_dr_test` key is a variable reference in `app-run.js` (not a backtick
literal), so the sync script cannot extract it; its source is verified separately by the
assembler test suite.

### `scripts/sync_lump_viewer_to_sidecars.py` — **removed (V1.3)**

This script copied `group` and `doc_refs` fields from the Lump Viewer HTML
(`docs/figures/lumps-directory.html`) into per-lump sidecar JSONs, treating the Viewer as
an authoritative curatorial source. Both fields and the Lump Viewer approval role have
been removed from this specification: under the specified model the binary is the single
source of truth and the sidecar carries no curatorial fields. The script and its tests
have been deleted, the live catalogue's sidecars no longer carry `group`/`doc_refs`, and
the server runs an idempotent startup migration that strips the two keys from any sidecar
that reappears with them. CI enforces the invariant with a check that no live sidecar
carries either key.

### `simulator/lump-audit.js` — audit engine

The audit rules engine. It is a library, not a standalone CLI: it is invoked from the
**Audit** button in the IDE detail-panel header strip and loaded as a module by its
direct test consumers. (The separate `lump-consistency` CI gate,
`tests/lump/test_lump_consistency.py`, implements its own independent checks and does
not invoke this engine.) The full rule list (R0–RSM, both manifest-guided and
binary-only modes) lives in the **Lump Audit Rules** section above.

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

The NS Table is a flat array of **N entries × 4 words**. N is the total
number of object slots in the namespace. Only the object owner holds
GT Word 0 (the per-holder credential) in their c-list — GT Word 0 is
never stored in the NS Table.

Each entry has one of three states: **Live** (resident Inform), **Outform**, or
**NULL**. The **access GT's `gt_type` is the explicit discriminator** for the
state; a **NULL** entry is never interpreted.

> **Canonical NS Word 3 (content token cache `T`).** The NS entry is four words,
> and that count is fixed. For a **resident Inform** entry the four words are
> Word 0 = `location`, Word 1 = `authority`, Word 2 = `integrity32`, and **Word 3
> = a 32-bit issue-blind content token `T`** — a name-free cache/index of the
> resolved lump's content identity (`T = hash(name ‖ genotype_binary)`, issue
> number excluded; see *The Token — Lump Identity*). For an **Outform** entry the
> same four words carry the **exact opaque restore token** (serialized
> `W1 ‖ W2 ‖ W3`, with `T` in Word 3); the entry owns those words verbatim so
> eviction restores them exactly (see [`locator.md`](locator.md)).
>
> `T` is a **cache/index only**: it is never authenticity (`integrity32` detects
> local corruption but is not cryptographic identity proof), never revocation
> (that is `gt_seq`), and never ownership. Ownership uses full issued identity
> and its separate policy path.
>
> W3 — and the hardware `word3` register / `DR15` mirror that reflects it — is
> **diagnostic only and never a
> writeback authority**; it authorizes and seals nothing. A stale `T` is simply
> recomputed by hashing the resident lump. The full trusted identity
> (`dot.name`, positive `issue`, identity hash, binary hash) lives **outside the
> entry**, in access/catalogue metadata. An **Abstract GT never owns an NS
> entry**; any annotation belongs to access/catalogue metadata outside the
> four-word entry.

```
NULL access GT (00):
  Word 0:  0x00000000
  Word 1:  0x00000000
  Word 2:  0x00000000
  Word 3:  0x00000000
  External trusted identity/cache record: cleared

Outform access GT (10; lump absent):
  Word 0:  locator/reserved data; non-authoritative
  Word 1:  opaque restore token [95:64]
  Word 2:  opaque restore token [63:32]
  Word 3:  opaque restore token [31:0], including 32-bit cache/index T
  External record: canonical dot_name, positive issue_n, identity_hash,
                   binary_hash, T, gt_seq/generation, exact W1-W3 snapshot

Resident Inform access GT (01):
  Word 0:  location [32]
  Word 1:  f_flag[1] | g_bit[1] | gt_seq[9] | limit_offset[21]
  Word 2:  integrity32(Word0, Word1 with mutable flags masked)
  Word 3:  issue-blind 32-bit cache/index T
  External record: same trusted full issued identity retained
```

### Distinguishing NULL, Outform, and Resident Inform

The hardware uses **only the access GT's `gt_type` bits [26:25]**. It never
infers lifecycle state from W3, `T`, a CRC value, location, or an Outform
marker. NULL faults before NS interpretation; Outform invokes resolution;
Inform enters the normal integrity, sequence, permission, and range gates.

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
| NULL → Live | Mint.Lump() | Binary and full trusted identity validated; resident W0–W3 staged; Inform GT published last |
| NULL → Outform | IDE install | Trusted external identity registered first; exact Outform W1–W3 written; Outform GT published last |
| Outform → Live | Locator + Mint.Lump() | Candidate selected by `T`; full identity and full binary hash independently verified before atomic resident promotion |
| Live → Outform | Memory Manager (eviction) | Lump binary freed; exact saved W1–W3 restored from the trusted external record |
| Live → NULL | Mint.Revoke() | `gt_seq` bumped in the authority path, slot zeroed, external identity/cache record cleared |
| Outform → NULL | Mint.Revoke() | Slot zeroed; content hash discarded |

---

## Outform Token Detail

The 96-bit Outform token is the exact opaque concatenation `W1 ‖ W2 ‖ W3`.
The only standardized subfield is the 32-bit cache/index `T` in W3:

```
NS Word 1  [31:0]   opaque restore data
NS Word 2  [31:0]   opaque restore data
NS Word 3  [31:0]   issue-blind cache/index T
```

The 96 bits are **recovery data, not identity proof**. Before installation,
the authorized Namespace/Mint path must already hold an external trusted
record containing canonical `dot_name`, positive `issue_n`, full
`identity_hash`, full `binary_hash`, `T`, `gt_seq`/slot generation, and the
exact W1–W3 snapshot. The resolver may use `T` to find a candidate but must
reject ambiguous collisions and compare every full field and the fetched
bytes before promotion. Matching `T` alone never suffices.

---

## Lazy Load Protocol — Step by Step

This is the full thread-level sequence when a LOAD or CALL targets an
Outform NS slot. The calling thread is never aware of the pause.

```
① Thread issues:  LOAD CR_d, CR6, #slot_idx
                  (or CALL CR_s  where CR_s.object_id → Outform NS slot)

② Hardware classifies the access GT by gt_type=Outform.
   It passes NS[slot_idx] W1||W2||W3 verbatim to Locator; W3 contains T.

③ Locator uses T only as a cache/index to find a candidate.
   Ambiguous T mappings fail closed. The calling thread remains at the
   retry instruction until resolution reaches a terminal result.

④ Locator loads the trusted external identity record for slot+generation:
     canonical dot_name, positive issue_n, identity_hash, binary_hash,
     cache T, gt_seq/generation, and exact Outform W1-W3.

⑤ Locator sends HTTP GET to Home Base IDE:
     GET /lump/{label}@sha256:{hash}.lump.zip  HTTP/1.1
     Authorization: Bearer <PassKey credential>
   Response: ZIP file with the lump binary.

⑥ Locator verifies ZIP:
   a. Signature = 0x04034B50 ✓
   b. Bit 3 of flags = 0 (no data descriptor) ✓
   c. uncompressed_size → derive n = log2(size / 4) ✓
   d. n in [6..14] ✓

⑦ Locator calls Memory Manager (via RW-GT):
   base = MemoryManager.alloc(n)   → returns physical base address

⑧ Locator inflates ZIP payload into staging memory.

⑨ Locator verifies the full SHA-256 binary hash and canonical issued identity.
   It recomputes T only as a cache-consistency check. A T match alone is rejected.

⑩ Locator calls Mint.Lump(base, n):
   Mint validates header, scans freespace, validates c-list.
   Authorized Namespace writer commits resident NS state:
     NS[slot_idx].Word0 = location
     NS[slot_idx].Word1 = authority (f,g,gt_seq,limit)
     NS[slot_idx].Word2 = integrity32
     NS[slot_idx].Word3 = T
   The dependent Inform c-list GT is published last.

⑪ On any failure or interrupted promotion:
   staging is discarded; exact Outform W1-W3 remain/restored; no Inform GT
   is published; the full trusted identity record remains for retry.

⑫ Locator RETURNs.

⑬ Thread retries LOAD / CALL.
   NS slot is now Live — LOAD reconstructs GT normally.
   Execution continues as if the lump had always been present.
```

The calling thread observes a retry boundary, never a partially resident
entry. Transport latency and scheduling policy do not change the identity or
atomic-promotion rules above.

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
| **Freespace zone** | Compile-time fixed · `0xAB` content header + embedded API/source, zero remainder (legacy: all-zero) · immutable per release | Dynamic 131 words — Stack ↓ and Heap ↑ collide | Between init code and NS Table · all-zero |
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
| **GC interaction** | G bit in NS slot Word 1 authority | G bits in live CR authority snapshots in Zone ① | Live & Dead slots |
| **lumpSize** | 2^n compiler-chosen (64–16 384 words) | IDE defined 2^n < 1024 | 2^n IDE-chosen; Boot.NS = 2^14 = 16 384 words |
| **Freespace verified by Mint** | Yes — words cw+1..lumpSize-cc-1: `0xAB` content-frame validation (bounds + zero remainder, step 7) or all-zero (legacy) | Zone ③ only (words 45..175); Zone ① skipped | Scan CRC per slot |
| **Distribution format** | `dot.name.issue.token.zip` | `*.thread.zip` | `*.namespace.zip` |
| **Simulator NS slot** | Most slots (Salvation=4, Mint=6, …) | Slots 1 and 45 | Slot 0 (Boot.NS) |
| **CALL target** | Yes | No | No |

---

## Cross-references

- [`architecture.md`](architecture.md) — Overall Church Machine architecture
- [`golden-tokens.md`](golden-tokens.md) — GT format, encoding, and capability rules

> The former `Lump-Architecture.md`, `foundation-lump-design.md`, `lump-reference.md`, and
> `lump-tooling.md` documents have been consolidated into this specification and archived
> as redirect stubs (2026-08-18). Their content lives in the sections above (object model,
> lump design, sidecar/manifest field reference, and Developer Tooling respectively).

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

---

# Developer Traps and Implementation Rules

> **Scope:** This section is **simulator/IDE implementation guidance** — hard-won rules for the
> tooling and UI code that manipulates lumps. It is **not** part of the binary format rules
> above. Nothing here changes the on-disk lump encoding; it documents how implementation code
> must handle it.

## Trap: LUMP binary files are big-endian

Raw `.lump` file words are stored **big-endian** (`readUInt32BE`/`writeUInt32BE` in Node).
This is not obvious from the runtime `.js` code, which mostly works with in-memory
`Uint32Array`/decoded words rather than raw file bytes. Any ad-hoc little-endian read or write
silently corrupts the header and c-list — the header magic, `cw`/`cc` fields, and c-list GT
words all decode as nonsense, while the file size and general shape still look plausible.

**Rule:** any ad-hoc code that inspects or patches `.lump` bytes directly must use big-endian
word reads/writes, and must verify the result with `lump-audit.js` (or at minimum the magic
check `(word0 >>> 27) & 0x1F === 0x1F`) after any manual binary manipulation.

## Trap: Abstraction-name drift check must exempt certain lumps

The drift check that compares a lump's in-memory abstraction name against the registry
(`simulator/abstractions.js`) must exempt:

- **User-compiled lumps** (`lump_version >= 1`) — compiled in-session with arbitrary names;
  the name is not necessarily (and is not meant to be) in the registry.
- **Dynamic/NULL slot lumps** (`ns_slot` is `null`) — allocated/fetched by token, never wired
  into the Abstractions view; there is no name to check by design.

Applying the check to these categories produces false failures even though nothing is wrong.
Scope the check to `lump_version` 0/absent AND non-null `ns_slot`, and keep one explicit,
documented exception set for legitimate historical mismatches (see
`tests/lump/test_lump_consistency.py` R16, `KNOWN_NON_REGISTRY_ABSTRACTIONS`).

## Trap: IRQ lazy-load gate must verify the manifest entry exists

The lazy-load body gate inside `_fireSchedulerIRQ()` must check that `lazyManifest[slot]`
exists before proceeding. If no manifest entry exists for the slot, the gate must be skipped
so the dispatcher falls through to the `abstractionRegistry` path.

Test harnesses that pre-seed `irqLumpSlot` without a corresponding manifest entry bypass the
gate and access `abstractionRegistry` directly — masking the bug in tests while it fails at
runtime (an unguarded gate would call `lazyLoad(slot)` and crash on
`lazyManifest[slot].loaded` being undefined).

**Rule:** any future code that adds a lazy-load gate for a dynamic slot must include
`&& this.lazyManifest[slot]` in the condition.

## Trap: the "Viewing" label must be updated synchronously, never via deferred data loading

`showLumpDetail()` is itself a synchronous function, but the detail panel's *data* arrives
via nested asynchronous fetches (word arrays, source, etc.). The historical bug was wiring
the "Viewing: <name>" label update to the completion of that deferred data loading — on page
reload the label flickered or never appeared depending on fetch timing.

The fix (still present in the current code) is two synchronous update points:
`showLumpDetail()` calls `_updateLumpViewingLabel(token)` at its very start, and
`renderLumps()` additionally calls `_updateLumpViewingLabel(_selTok)` directly after
invoking `showLumpDetail`, covering the synchronous restore path (e.g. page reload with the
registry already populated).

**Rule:** label sync must never depend on completion of any deferred detail-data fetch. Keep
both synchronous call sites; the call is idempotent — it returns early when the registry has
no data yet.

**Also — cross-script call convention:** functions defined in one script file that are
called from another (such as `showLumpDetail`, called from `app-abstractions.js`) are
explicitly exported via `window.showLumpDetail = showLumpDetail` and invoked as
`window.showLumpDetail` behind a `typeof` guard at cross-script call sites. Follow this
convention for any new cross-script function — it makes the dependency explicit and keeps
call sites robust to script load order and future module/scoping changes.

## Trap: Staleness guards are keyed by the exact abstraction-name string (case-sensitive)

Per-lump staleness/build scripts find "the" lump by matching
`manifest.entry.abstraction === '<ExactName>'`. A casing mismatch between the sidecar's
`abstraction` field and the registry key hides an orphaned lump from all staleness checks
permanently — it sits in `server/lumps/` and `manifest.json` forever, fully "consistent" by
the consistency-gate rules, but semantically dead and loadable by anyone browsing lumps.
(Every recompile mints a brand-new token; nothing deletes the previous one, and the build
scripts only replace an entry whose name string matches exactly.)

**Rule:** when adding or renaming a lump, verify that the sidecar/manifest `abstraction` field exactly
matches the registry key — character for character. When a lump's disassembly or behaviour
looks wrong or dated, suspect a stale duplicate before assuming the disassembler is broken:
use the lump's `check_*_stale.js` script to find the actual canonical token, and grep the
tree for the token you were viewing. Also grep UI code for hardcoded lump tokens — these can
independently rot to a no-longer-existent token when the lump is rebuilt.
