# Golden Tokens

**v2.0 — 2026-06-25**
**CONFIDENTIAL**

## What Are Golden Tokens?

Golden Tokens (GTs) are the fundamental unit of access control in the Church Machine architecture. Every access to a resource -- whether loading data, calling a service, or switching privilege levels -- requires a valid Golden Token that grants the necessary permissions. Golden Tokens are unforgeable: they cannot be fabricated by software, only created and managed through hardware-enforced mechanisms.

A Golden Token encodes three things:
1. **What** resource it refers to (via `slot_id` — the namespace slot ID)
2. **What operations** are permitted (via permission bits)
3. **Whether its local binding is intact and current** (via NS `integrity32`
   plus `gt_seq`; adversarial identity authentication is a separate boundary)

Without a valid Golden Token, no operation proceeds. Any attempt to use an invalid, expired, or insufficient token results in a FAULT.

---

## GT Format

The Church Machine uses a 32-bit Golden Token with a precisely defined bit layout:

```
31  30 28 27  26  25 24       16 15           0
┌────┬─────┬────┬──────────┬───────────┬─────────────┐
│ b  │perm │dom │ gt_type  │  gt_seq   │   slot_id   │
│[1] │[3]  │[1] │   [2]    │   [9]     │    [16]     │
└────┴─────┴────┴──────────┴───────────┴─────────────┘
```

| Bits    | Field     | Width | Description |
|---------|-----------|-------|-------------|
| [15:0]  | `slot_id` | 16 | Namespace slot ID (0–65,535) |
| [24:16] | `gt_seq`  | 9  | Revocation sequence counter (0–511); must match NS SLOT Word 1 `gt_seq` |
| [26:25] | `gt_type` | 2  | GT class (NULL / Inform / Outform / Abstract) |
| [27]    | `dom`     | 1  | Domain: 0 = Turing {X, W, R}, 1 = Church {E, S, L} |
| [30:28] | `perm`    | 3  | Permission payload (dom=0: perm[2]=X, perm[1]=W, perm[0]=R; dom=1: perm[2]=E, perm[1]=S, perm[0]=L) |
| [31]    | `b_flag`  | 1  | Bind flag — 1 = GT may be propagated via mSave |

Each capability register in Church Machine is **96 bits wide (3 × 32-bit words)**:

| Word  | Content |
|-------|---------|
| word0 | The 32-bit Golden Token (GT_LAYOUT) |
| word1 | Lump base address (from NS SLOT Word 0) |
| word2 | NS SLOT Word 1 (WORD2_LAYOUT): `f_flag[31] \| g_bit[30] \| gt_seq[29:21] \| limit_offset[20:0]` |

integrity32 is verified during LOAD but is **not stored** in the capability register.

---

## GT Permission Bits (Church Machine)

The GT encodes permissions using a **1-bit domain selector (`dom`) and a 3-bit permission payload (`perm[2:0]`)** at bits [30:27]. Turing and Church permissions are mutually exclusive by construction — the `dom` bit selects which set the 3-bit payload refers to:

```
Encoding:  dom=0 (Turing): perm[2]=X, perm[1]=W, perm[0]=R
           dom=1 (Church):  perm[2]=E, perm[1]=S, perm[0]=L
```

| perm bit | dom=0 (Turing) | dom=1 (Church) | Description |
|----------|---------------|----------------|-------------|
| perm[0]  | R | L | Turing: Read data. Church: Load a GT from C-List via mLoad |
| perm[1]  | W | S | Turing: Write data. Church: Save a GT to C-List via mSave |
| perm[2]  | X | E | Turing: Execute code. Church: Enter an abstraction |

### Domain Purity

A GT carries **either** Turing permissions (R, W, X) **or** Church permissions (L, S, E) — never both. Domain purity is **structurally enforced by the encoding**: the `dom` bit selects which interpretation applies, making a mixed-domain GT impossible to represent. The encoder clamps to Church (dom=1) when any Church bit (L, S, E) is present.

### E Isolation

Within the Church domain, E (Enter — invoke an abstraction) must be **standalone**. E may not be combined with L (Load from c-list) or S (Save to c-list). A token that combines E with L or S would allow its holder to both traverse the nodal c-list and enter the abstraction it contains — an attack path that bypasses the separation between the capability list and the code it holds. E is the entry key to a function; L and S are the keys to the capability list that owns it. They must never be the same key.

```
Valid:   R, W, X, RW, RX, RWX             (Turing pure)
Valid:   L, S, E, LS                       (Church pure — E standalone)
Invalid: RL, WL, XE, RE, WS, RWXE, RWXL  (cross-domain — any mix of {R,W,X} with {L,S,E})
Invalid: LE, SE, LSE                       (E isolation — E combined with L or S exposes abstraction internals)
```

### B Flag — Bind

`B` (bit 31 of GT Word 0) controls whether the GT may be propagated to another c-list via mSave:

- **B=0** (default): the GT cannot be copied out of its current c-list — mSave FAULTs.
- **B=1**: the GT is bindable — mSave permits the write.

B is set by the IDE at lump creation time and may be cleared by CALL on preserved CRs passed to the callee ("no bind by default").

### M Permission -- Transient Microcode Elevation

M is **not stored in the GT**. It exists only as a transient signal (`sub_m_elevated`) that microcode asserts during mLoad execution. When mLoad completes, M is gone. No user instruction can set, test, or observe M. This prevents privilege escalation.

---

## GT Type Field (`gt_type`, bits [26:25])

The Church Machine includes a 2-bit type field classifying the nature of the referenced resource:

| Value | Type | Description |
|-------|------|-------------|
| 00 | NULL | Empty / invalid — always faults on use |
| 01 | Inform | GT points to a lump or data object in local memory via an NS SLOT |
| 10 | Outform | GT references an IDE-managed dependency (lazy-loaded via Locator). Whether the resolving IDE node is local or far is determined by `f_flag` in the NS SLOT Word 1, not by the GT word itself. |
| 11 | Abstract | GT IS the value — constants, immutable credentials, PassKey tokens |

NULL is architecturally distinct from all valid reference types. Any GT with `gt_type=00` immediately faults at ChurchNSGate before any NS lookup is performed.

---

## gt_seq Field (bits [24:16])

Church Machine includes a 9-bit `gt_seq` field in bits [24:16] of the Golden Token. This revocation counter is critical for namespace integrity and garbage collection safety:

- Each NS SLOT stores a corresponding `gt_seq` value in SLOT Word 1 bits [29:21].
- When a GT is used (LOAD or CALL), ChurchNSGate compares `gt_word0.gt_seq` against the NS SLOT's `gt_seq`. A mismatch means the GT has been revoked — access FAULTs immediately.
- During garbage collection, reclaimed entries have their `gt_seq` incremented. All outstanding GTs referencing that entry become stale instantly.
- 9 bits gives 512 revocation generations before wraparound.

---

## Namespace Entry Format (NS SLOT)

Each namespace entry (NS SLOT) occupies **4 consecutive 32-bit words** (16 bytes). The slot byte address is `slot_id × 16` from the NS table base. The NS table supports up to **65,536 entries** (bounded by the 16-bit `slot_id` field).

The four words are, canonically:

| Word | Name | Role |
|------|------|------|
| Word 0 | `location` (lump_base) | Physical base address of the lump |
| Word 1 | `authority` | `f_flag`, `g_bit`, `gt_seq` (revocation), `limit_offset` |
| Word 2 | `integrity32` | Corruption/integrity check over Words 0–1; not cryptographic identity proof |
| Word 3 | content token `T` | 32-bit issue-blind content cache/index (see below) |

The **access GT's `gt_type` is the explicit discriminator** for how an entry is
interpreted. A NULL entry (`gt_type = 00`) is never interpreted — the access
faults at ChurchNSGate before any NS lookup. For an Outform entry (`gt_type =
10`) the same four words carry the opaque restore token (`W1 ‖ W2 ‖ W3`, with
`T` in Word 3) rather than a resident descriptor; the four-word layout itself is
unchanged.

### Word 0 — lump_base (location)

The 32-bit lump base byte address in DMEM.

### Word 1 — authority (WORD2_LAYOUT)

```
31       30      29       21 20                  0
┌────────┬───────┬──────────┬────────────────────┐
│f_flag  │ g_bit │  gt_seq  │   limit_offset     │
│  [1]   │  [1]  │  [9]     │     [20:0]         │
└────────┴───────┴──────────┴────────────────────┘
```

| Bits    | Field          | Description |
|---------|---------------|-------------|
| [20:0]  | `limit_offset` | Object size in words minus 1 (21-bit) |
| [29:21] | `gt_seq`       | 9-bit revocation counter; compared against GT `gt_seq` by ChurchNSGate |
| [30]    | `g_bit`        | GC mark bit — may be set by GC; masked to 0 before integrity32 check |
| [31]    | `f_flag`       | Far indicator — 0 = local node; 1 = remote IDE node resolves this SLOT. This is a **SLOT property**, not stored in the GT word. Both `g_bit` and `f_flag` are masked to 0 before integrity32 is computed. |

### Word 2 — integrity32 Check

The 32-bit integrity32 parallel check result, computed over NS SLOT Word 0 and Word 1 (with both `g_bit[30]` and `f_flag[31]` masked to zero before the check).

### Word 3 — content token cache/index (T)

Word 3 holds a **32-bit issue-blind content token `T`** — a cache/index of the
resolved lump's content identity (`T = hash(name ‖ genotype_binary)`, issue
number excluded; see [`CM_LUMP_SPECIFICATION.md`](CM_LUMP_SPECIFICATION.md) §
*The Token — Lump Identity*). It is written when the entry becomes resident and
lets validation read the content token name-free, in O(1), without the full
`dot.name.issue.token`.

`T` is a **cache/index only**:

- It is **not** authenticity, ownership, or revocation authority.
  `integrity32` (Word 2) detects local corruption but is not adversarial
  cryptographic authentication; trusted full identity and full binary hash live
  outside the entry. Revocation lives in `gt_seq`; ownership uses the full
  issued identity and its separate authorization path.
- It is **never a seal and never authorizes** any operation. A stale or lost `T`
  is simply recomputed by hashing the resident lump — caching it cannot corrupt
  identity.
- The hardware `word3` register (and its `DR15` mirror) is **diagnostic only**;
  it is never a writeback authority.

For an **Outform** entry, Words 1–3 together hold the exact opaque restore token
(serialized `W1 ‖ W2 ‖ W3`), with `T` carried in Word 3; the entry owns those
words verbatim so eviction can restore them exactly (see
[`locator.md`](locator.md)).

An **Abstract GT never owns an NS entry** — it carries its value in the GT word
itself. Any former Word 3 "abstract GT annotation" is not an NS-entry field; such
annotation now lives in access/catalogue metadata outside the entry.

> **Deprecated alias.** Earlier drafts named this field `abstract_gt` /
> `word3_abstract_gt` and described it as an advisory M-bit-gated annotation.
> That name is a deprecated compatibility alias only; the canonical field is the
> content-token cache `T` described above, and W3 authorizes nothing.

### integrity32 Integrity

ChurchNSGate recomputes integrity32 over NS SLOT Word 0 and Word 1 (`g_bit` and `f_flag` both cleared) and compares against NS SLOT Word 2. A mismatch faults with `SEAL` error, preventing use of any tampered NS SLOT.

---

## Capability Registers (CAP_REG)

Each capability register (CAP_REG) is **96 bits wide (3 × 32-bit words)**. The programmer cannot read the internal words directly — they interact with CRs only through LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, and XLOADLAMBDA. integrity32 is verified by LOAD (ChurchNSGate pipeline) but is **not stored** in the register.

The Church Machine provides 16 capability registers (CR0–CR15), divided into two groups:

### Instruction-Addressable Registers (CR0–CR11)

These registers are directly accessible by Church instructions through a 4-bit register encoding field. Software can freely read and manipulate GTs in these registers using LOAD, SAVE, and other Church instructions.

### Privileged Registers (CR12–CR15)

These registers are protected from direct instruction access. The only way to write to a privileged register is through the SWITCH instruction, which requires appropriate permissions. This architectural constraint prevents privilege escalation through direct register manipulation.

### Special Register Roles

| Register | Name | Role |
|----------|------|------|
| **CR6**  | C-List | Current capability list — the set of capabilities available to running code |
| **CR12** | Thread Stack | Thread stack capability (privileged, system-wide; loaded at boot B:02) |
| **CR13** | Interrupt | System-wide interrupt handler capability (privileged, unchanged by CHANGE) |
| **CR14** | Code/[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) | Current code GT — instruction fetch source (privileged, per-thread; re-derived by CALL) |
| **CR15** | Namespace | Namespace root — defines the security boundary of the entire system |

CR6 and CR14 are re-derived by CALL/RETURN via mLoad. CR12 is saved and restored by CHANGE (thread switching). CR13 and CR15 are system-wide and unchanged by CHANGE. The privileged zone (CR12–CR15) cannot be addressed by normal programmer instructions.

---

## Bank Lockbox Credentials

`Bank` is a canonical dynamic **CLOOMC LUMP** as well as a dynamically issued
system service. Its canonical binary carries the `Bank#1` SELF identity in
c-list row 0 and is registered in the LUMP manifest with `ns_slot: null` and
`ns_slot_policy: "dynamic"`. That symbolic identity lets the IDE and loader
resolve the Bank abstraction without reserving a hardware boot slot.

Installing or calling Bank still mints its live authority through the runtime;
the packaged SELF identity is not a custody authority. The Bank inner sanctum
creates private records and mints typed Golden Tokens for internal use; it
never returns an owner key or proof:

```text
{ register: CR0, secure_type: BankVariable, gt: Abstract GT,
  proof: internal-only }
```

The GT is the only authority crossing the public Bank boundary. The independent
proof is retained by the sanctum and validated internally. A copied GT, proof
words, object ID, Namespace address, or reconstructed handle supplied in DRs
fails. Capacity, offsets, word counts, kinds, and status values are ordinary
DR values.

| Bank method | Required authority | Result |
|---|---|---|
| `Create` | M elevation + CR1 Inform `R` | CR0 `BankVariable` E capability or NULL |
| `Read` | CR0 `BankVariable` E | Fresh Inform `R` capability |
| `InspectVariable` | CR0 `BankVariable` E | Safe scalar metadata in DRs |
| `Release` | CR0 `BankVariable` E | Zeroize and retire private custody |
| `RevokeVariable` | CR0 `BankVariable` E | Revoke, zeroize, and quarantine private custody |

### Verified Bank variables

`Create(lump)` is the abstraction-custody operation. It accepts either a
complete LUMP value or a **typed Inform `R` capability in CR1** that resolves
the complete LUMP bytes. On success it returns a separate proof-bound
`BankVariable` Abstract `E` capability in **CR0**. That capability represents
the created Bank-managed variable; it is not a raw GT integer, proof tuple,
Namespace slot, or private address.

| Method | Required typed authority | Result |
|---|---|---|
| `Create` | M elevation + CR1 Inform `R` LUMP capability (or verified LUMP value) | CR0 nullable `BankVariable E`; DR0 status |
| `InspectVariable` | CR0 `BankVariable E` | DR0 status; DR1 words; DR2 capacity; DR3 issue; DR4 lifecycle; safe identity/provenance metadata |
| `Read` | CR0 `BankVariable E` + DR1/DR2 bounds | CR4 fresh bounded Inform `R` capability |
| `Release` | CR0 `BankVariable E` | Wipe and retire the private variable allocation |
| `RevokeVariable` | CR0 `BankVariable E` | Revoke authority, wipe and retire the private allocation |

Create is a staged T3 policy: T3.1 recomputes content identity from submitted
bytes, T3.2 compares every requested identity field, T3.3 records the deferred
human-IDE authority decision (not certificate verification), and T3.4 requires
SELF to equal the derived E identity. Only after these gates pass is private
custody committed atomically, with every allocation,
Namespace, object, and copy failure cleaned up; only after that commit does the
binding materialize the nullable typed capability in CR0. DR0 remains status
data only. The CLOOMC source carries this control flow, while the proof-bound
runtime alone performs validation, custody, and credential retention. An absent
or contradictory deferred-authority decision fails closed.

Bank verifies the binary header and encoded size, the `0xAB` embedded API and
declared name, full binary hash, canonical name-plus-binary token, identity
seal, and the compiler-owned SELF word at c-list row zero before it allocates
or writes a private Outform record. All accompanying identity metadata is an
assertion cross-checked against those bytes, never caller authority. The result
is one LUMP per Bank variable. Its exposed `capacity` is the actual private
allocator result (including any allocator rounding), while its exposed `words`
is the encoded LUMP size; `Read`/`Create` is the explicit nested-value
round-trip and never aliases private parent memory.

Cryptographic seals prove integrity and the declared identity relationships;
they do **not** prove publisher history or trusted genesis. A deployment that
requires a stronger origin assertion must verify a trusted registry or
attestation chain separately. An arbitrary caller-provided provenance label is
recorded only as non-authoritative provenance and cannot elevate trust.

Deposits validate the source GT type, current Namespace sequence, `R`
permission, and offset/length bounds before writing any lockbox state. A
withdrawal creates and registers the new region before retiring the lockbox
entry, so an allocation or Namespace failure leaves the original valuable in
custody. Before a withdrawn or revoked backing allocation can return to the
free list, Bank zeroizes the *entire* allocation. The backing Namespace record
uses Outform type rather than a public Inform memory capability (Abstract GTs
never occupy Namespace entries). Active Bank physical ranges also reject
overlapping Namespace registrations and memory resolution, so a copied or
guessed alias cannot bypass custody. The record is shown
only as opaque “Bank private custody” in the Namespace UI. UI status may show a
lockbox’s state and word count, but never its location, Namespace entry number,
stored contents, proof, or private key.

### Restart recovery

`ExportRecovery` serializes a deposited valuable as an authenticated ciphertext.
Its encryption key is derived from the original owner GT, its independent
128-bit proof, and the fixed Bank recovery policy. The envelope contains a
proof commitment, ciphertext, nonce, and authentication tag — **never raw proof
words**. The server’s `/api/bank-custody` vault stores that already-protected
envelope inside a separate authenticated encryption layer derived from the
deployment secret. Recovery and revocation requests present the proof only in
memory for comparison; the server neither stores nor logs it.

After a simulator reset, `Recover` validates the original credential and
envelope before allocating anything. It registers a new private Outform
Namespace entry with a sequence distinct from the retired entry's sequence,
copies the
valuable only after every allocation succeeds, and issues a new owner PassKey.
The old credential cannot operate on the restored lockbox. A bad tag,
malformed payload, stale GT/proof, replayed envelope, or a revoked vault is
rejected without publishing a Namespace entry or changing the existing
allocation state. The server atomically claims a vault before returning its
envelope, so it cannot issue a second recovery response; a server-side revoke
records a durable tombstone, so an exported pre-revocation envelope cannot be
recovered later through the server. If any local Namespace registration fails,
the simulator releases the unregistered allocation before publishing the
valuable; a failed withdrawal cleanup instead wipes and quarantines its
destination allocation so a live alias can never observe reused memory.

---

## Cross-references

- [`architecture.md`](architecture.md) — Overall Church Machine architecture
- [`CM_LUMP_SPECIFICATION.md`](CM_LUMP_SPECIFICATION.md) — Lump object model, binary encoding, and field specification
- [`CM_LUMP_SPECIFICATION.md`](CM_LUMP_SPECIFICATION.md) — Authoritative binary encoding and field specification

---
*Confidential — Kenneth Hamer-Hodges — April 2026*
