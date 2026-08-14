# Golden Token — v2.0 Encoding Specification

**Draft for review — 24 July 2026**
**CONFIDENTIAL**

*Supersedes the GT sections of `golden-tokens.md` v2.0, `abstract-gt.md` v1.0,
and the GT description in `cloomc-foundation.md` §2.*

---

## How to read this document

Every field below carries a **source tag** naming where the claim comes from:

| Tag | Meaning |
|---|---|
| **[SIM]** | `createGT()` / `parseGT()` in `simulator.js` — executable, therefore authoritative for behaviour |
| **[HDL]** | `ctmm_cap_amaranth/` — executable, therefore authoritative for silicon |
| **[GT]** | `golden-tokens.md` v2.0 |
| **[AB]** | `abstract-gt.md` v1.0 |
| **[FND]** | `cloomc-foundation.md` v1.2 |
| **⚠** | Sources disagree — resolve before this document is adopted |

The tags exist because five documents currently describe these 32 bits and
they do not agree. Rather than silently choosing, this draft records the
disagreement so it can be settled once. **Where a source is executable, it
wins; where two executable sources disagree, the one that boots wins.**

---

## 1. The word

A Golden Token is exactly 32 bits. It is the sole unit of authority in the
Church Machine: there is no ambient permission, no privileged mode, and no
path to any resource that does not pass through one of these words.

Three token classes share the word, discriminated by `gt_type` at bits
[26:25]:

| `gt_type` | Class | Authority lives in | Needs an NS slot? |
|---|---|---|---|
| `0b00` | **NULL** | nowhere — always faults | no |
| `0b01` | **Inform** | the NS slot it names | yes |
| `0b10` | **Outform** | the NS slot; body not yet resident | yes |
| `0b11` | **Abstract** | the GT word itself | no |

**All four codes are assigned. None is spare.** Any future token class needs
a different discriminator, not another type code — the two bits are full.

**Resolved 24 July 2026.** The v2.0 field listing supplied that morning
marked `0b10` as *Reserved*; that was an omission in the listing, not a
change to the architecture. Outform is fully implemented in [SIM], [HDL] and
the server, and is documented in §3 below.

### 1.1 NULL is a named type, tested by field

**Resolved 24 July 2026.** `0b00` is NULL by *name*, not merely by value.
The test is:

```
gt_type == 0b00  →  NULL_CAP fault
```

evaluated at ChurchNSGate **before** any bounds check, slot fetch, or
integrity recomputation.

This is not the same as testing `word0 == 0`, and the difference matters.

A token with `gt_type = 0b00` and a non-zero `slot_id` is *also* NULL — its
type field says it has no type. Under an all-zeros test such a word is not
recognised as NULL and is then treated as a live reference to whatever slot
those sixteen bits happen to name.

That case is not hypothetical. It is precisely the single-fault corruption
described in `hardware-fault-detection.md`: one flipped bit turning `0b01`
into `0b00` yields a word that is not all-zeros. **Testing the field catches
it; testing the whole word does not.** The field test is both cheaper and
strictly stronger.

#### Every site must test the field — verified 24 July 2026

There is no fixed number of NULL checks to enumerate; the rule is that
**every** site testing for NULL tests the type field, never the whole word.
A grep across both codebases confirms this holds:

| Codebase | State |
|---|---|
| `hardware/` | Ten sites, all comparing `gt_type` against the named constant `GT_TYPE_NULL = 0b00`: `perm_check`, `lambda_unit`, `ret` (×3), `change`, `fused_unit` (×2), `mload`, `call` (×2). Correct before this change and unaltered by it. |
| `simulator/` | Three sites previously tested `gt === 0`; Task #2159 replaced them with `isNullGT()`, which tests the field. |
| `ctmm_cap_amaranth/` | **Deleted.** The historical `GT_TYPE_NULL = 0b10` divergence is closed by removal of the tree. |

**The reason hardware needed no correction is worth stating, because it is
the general lesson.** The constant is named once in `hw_types.py` and every
site references the name. No site writes the literal `0b00`. A change to the
encoding is therefore a one-line change, and a grep for the literal finds
nothing — because there is nothing to find.

Ten sites under that discipline are as safe as one. Three sites writing
`gt === 0` were not, which is why the simulator needed the fix and the
hardware did not.

#### The subtle site

Transparent suspension is the one to watch. LOAD on a NULL GT in a
pet-named c-list slot **suspends** rather than faults — it emits
`lazyResolvePending` and waits for resolution. That is a second, different
decision made on the same NULL condition.

If the fault path tests the field and the suspension path tests all-zeros,
the two disagree precisely on the corrupted-token case this change exists to
catch: a token flipped to `gt_type = 0b00` with a non-zero `slot_id` would
fault where it should suspend, or suspend where it should fault.

> **Closed.** `abstract-gt.md` records a historical disagreement —
> `GT_TYPE_NULL = 0b10` in ctmm versus `0b00` in hardware. Under v2.0 `0b10`
> is **Outform**, so a tree using it for NULL would have faulted on every
> lazy load. The ctmm tree has since been deleted; one HDL, one constant.
> The stale note in `abstract-gt.md` should be removed with it.

---

## 2. Inform GT — `gt_type = 0b01`

The standard token. Names an NS slot; the slot holds the location, extent,
and revocation state of the object.

```
 31   30     28  27    26  25   24        16  15             0
┌────┬──────────┬─────┬─────────┬────────────┬───────────────┐
│ b  │ perm[2:0]│ dom │ gt_type │   gt_seq   │    slot_id    │
│[1] │   [3]    │ [1] │  [2]    │    [9]     │     [16]      │
└────┴──────────┴─────┴─────────┴────────────┴───────────────┘
```

| Bits | Field | Width | Meaning |
|---|---|---|---|
| [15:0] | `slot_id` | 16 | NS slot index, 0–65,535 |
| [24:16] | `gt_seq` | 9 | Revocation counter; must match NS Word 1 |
| [26:25] | `gt_type` | 2 | `0b01` |
| [27] | `dom` | 1 | 0 = Turing, 1 = Church |
| [30:28] | `perm` | 3 | Interpreted by `dom` |
| [31] | `b_flag` | 1 | Bind — may this token be delegated? |

*Source:* [SIM] and [GT] agree exactly on this layout.

### 2.1 Why `dom` exists

```
dom=0 (Turing):  perm[2]=X  perm[1]=W  perm[0]=R
dom=1 (Church):  perm[2]=E  perm[1]=S  perm[0]=L
```

Domain purity is **structural, not checked**. One bit selects which set the
three permission bits denote, so a token carrying both data rights and
capability rights *cannot be encoded*. There is no validation step to
bypass, because there is no state to validate.

This is the single most important property of the layout, and it is worth
stating explicitly because it is easy to lose: an implementation that stored
six independent permission bits would permit `RL` or `XE` and would then
need a check to reject them. A check can be forgotten, bypassed, or wrong.
An unrepresentable state cannot.

*Source:* [GT], [SIM], [FND] agree. The `church-machine` README described
six independent bits before July 2026; that description was wrong and has
been corrected.

### 2.2 E isolation

Within the Church domain, **E must be standalone.** `E` may not be combined
with `L` or `S`.

`E` is the key to entering an abstraction as a black box. `L` and `S` are
the keys to the c-list that abstraction owns. A holder of both could enter
the box *and* read what is inside it, which defeats the encapsulation the
CALL mechanism exists to provide.

```
Valid   (Turing): R, W, X, RW, RX, RWX
Valid   (Church): L, S, E, LS
Invalid (mixed) : any combination of {R,W,X} with {L,S,E}  — unrepresentable
Invalid (E-iso) : LE, SE, LSE                              — rejected at Mint
```

Note the asymmetry: mixed-domain tokens are *unrepresentable*, E-isolation
violations are *representable but rejected*. The second is enforced by Mint
and by domain-purity checks at creation time. That difference should be
understood rather than blurred — one is a property of the encoding, the
other is a rule the encoding permits you to break.

*Source:* [GT]. The former TPERM presets LE/SE/LSE (codes 10–12) are a
design-history artefact and are now unconditionally reserved.

### 2.3 `gt_seq` — 9 bits, and why the width matters

512 revocation generations before wraparound.

Revocation is a counter comparison, not a list search. When garbage
collection reclaims an NS slot it increments that slot's `gt_seq`. Every
outstanding token naming the slot still carries the old value, so every one
of them fails its next validation — simultaneously, with no sweep, no
revocation list, and no need to know who holds what.

> ⚠ **Corrected from [FND].** `cloomc-foundation.md` §2 states `gt_seq` is
> 7 bits, and repeats "7-bit version counter" in §1. Both are stale: v1 used
> 7 bits at [22:16]; v2.0 widened it to 9 bits at [24:16]. [SIM], [GT] and
> [HDL] agree on 9. The [FND] text should be corrected.
>
> The same §2 field list also totals 31 bits, which is the arithmetic
> consequence of the stale 7-bit value plus the erroneous `f_flag` entry
> (see §4 below). With 9-bit `gt_seq` and no `f_flag`, the fields total
> exactly 32.

### 2.4 `b_flag` — bind

- `b_flag = 0`: the token cannot be copied into another c-list; `mSave` faults.
- `b_flag = 1`: the token is delegable.

Set by the IDE at lump creation. **Cleared by CALL** on preserved CRs passed
to a callee — "no bind by default." A callee receives the authority to use
what it was given, not the authority to pass it on, unless that was
explicitly intended.

*Source:* [SIM], [GT].

---

## 3. Outform GT — `gt_type = 0b10`

**A name whose implementation is not here yet.**

An Outform GT names an NS slot that is registered but whose lump body is not
resident. On first access the Locator fetches the body, installs it, and
promotes the slot Outform → Inform **in place**. Every subsequent access is
an ordinary Inform access. The calling thread sees no difference beyond
latency.

This is the architecture's answer to a question most systems answer badly:
what does it mean to hold authority over something that does not exist yet?
A conventional system would fault, or return a null pointer, or require the
programmer to check. Here the token is valid, the authority is real, and
resolution is deferred until the moment of use.

### 3.1 Where it is intercepted

Four instructions can trigger a fetch. Each checks the type before touching
memory:

| Instruction | Behaviour on `gt_type = 0b10` |
|---|---|
| `LOAD` | Dispatches Loader Mode 2 |
| `CALL` | Dispatches Mode 2, then promotes Outform → Inform |
| `ELOADCALL` | As `CALL` |
| `XLOADLAMBDA` | As `LOAD` |

Promotion is a single dedicated operation — `promoteOutformToInform()` in
[SIM] — that rewrites the NS entry's `gtType` from 2 to 1 once the body is
in memory. In [HDL] the equivalent is `ChurchOutformFSM`, which intercepts
the CALL before the CALL unit starts, installs the lump, promotes the source
CR, and lets the CALL retry normally.

*Source:* [SIM] `simulator.js` LOAD ~3924, CALL ~4098, ELOADCALL ~5463,
XLOADLAMBDA ~5689, promotion ~7181; [HDL] `core.py` `u_outform_fsm`.

### 3.2 Garbage collection

GC skips Outform entries: `if (entryW1.gtType === 2) continue;`

Correct, and worth stating as a rule rather than an implementation detail:
**an Outform slot has no physical backing to mark or reclaim.** It is a
reservation, not an allocation. Marking it would be meaningless; sweeping it
would destroy a valid registration.

### 3.3 Fault codes

| Code | Name | Meaning |
|---|---|---|
| `0x11` | `ABSENT_OUTFORM` | Slot registered, no binary available |
| `0x15` | `OUTFORM_CRC` | CRC-32 mismatch on the download |
| `0x16` | `OUTFORM_ALLOC` | Insufficient free lump space to install |
| `0x17` | `OUTFORM_MINT` | Minting failed during install |
| `0x18` | `OUTFORM_HDR` | Lump header malformed or truncated |
| `0x19` | `OUTFORM_TIMEOUT` | **[HDL] only** — watchdog on a stalled transfer |

`OUTFORM_TIMEOUT` is deliberately absent from [SIM]. A browser `fetch()` is
governed by the browser's own timeout, so a mid-transfer stall never
produces the partial-receive condition the hardware watchdog exists to
catch. This is a genuine and documented divergence between simulator and
silicon, not drift — the condition it detects cannot arise in one of the two
environments.

*Note the shape of that argument.* It is the only sim/silicon divergence in
this document that is justified rather than corrected, and the justification
is that the two environments have physically different failure modes. Every
other divergence found in this project failed that test.

### 3.4 Transport and integrity

The body is served by `GET /api/lump/<token_hex>` with a CRC-32/ISO-HDLC
check, matching the hardware IoT unit's check. A mismatch raises
`OUTFORM_CRC (0x15)`.

> **Note on two integrity mechanisms.** CRC-32 covers the *transport* — did
> these bytes arrive intact? integrity32 (§6) covers the *NS slot* — is this
> slot descriptor consistent? They are unrelated functions over unrelated
> inputs and both are needed. `CM_LUMP_SPECIFICATION.md` additionally
> specifies SHA-256 content identity for the fetched body, which answers a
> third question — are these the bytes that were published? CRC-32 detects
> corruption; SHA-256 detects substitution. **Confirm whether the live
> endpoint carries the content hash as well as the CRC**, since only the
> hash makes the fetch verifiable rather than merely intact.

### 3.5 Live uses

| Use | Why Outform |
|---|---|
| `Scheduler.IRQ` | Written `gtType=2` at boot; stays absent until the IRQ fires |
| `Keystone.Connect` / Mum tunnel | `createGT(0, KEYSTONE_NS, {E:1}, 2)` — the far-end entity |
| PassKey | `createGT(0, encodedIndex, {E:1}, 2)` |

The `f_flag` is set automatically on all Outform GTs.

> ⚠ **Terminology to reconcile.** "The F-bit is set on all Outform GTs" is
> how [SIM] describes it, but per §5 `f_flag` is a property of the NS **slot**
> (Word 1 bit [31]), not of the GT word. Both can be true — creating an
> Outform GT sets the flag on its slot — but the phrasing invites the error
> corrected in §5. Prefer: *"an Outform registration sets `f_flag` on the
> slot."*

### 3.6 Why this is the extension past one machine

Outform plus `f_flag` is remote β-reduction. A name is bound to a hash; the
body is fetched from wherever it lives; it is verified, installed, and
promoted; execution resumes. The instruction that triggered it is unchanged,
the fault semantics are unchanged, and the token is unchanged.

The trust boundary is the NS slot, and the NS slot is local. Validation
never leaves the machine — `gt_seq`, integrity32 and bounds are all checked
here — while *resolution* travels arbitrarily far. That is why the
architecture scales past a single computer without weakening its guarantee:
nothing about the check depends on trusting the far end.

Scheduler.IRQ is the clearest demonstration. The interrupt handler does not
exist in memory until the first interrupt fires. The authority to call it
exists from boot.


---

## 4. Abstract GT — `gt_type = 0b11`

A token whose entire authority is in the word. No NS slot, no resident lump,
no mLoad. **The GT is the capability.**

```
 31        27  26  25   24  23  22        16  15             0
┌────────────┬─────────┬───┬───┬────────────┬───────────────┐
│  ab_type   │ gt_type │ R │ W │   gt_seq   │    ab_data    │
│    [5]     │   [2]   │[1]│[1]│    [7]     │     [16]      │
└────────────┴─────────┴───┴───┴────────────┴───────────────┘
```

| Bits | Field | Width | Meaning |
|---|---|---|---|
| [15:0] | `ab_data` | 16 | Type-specific payload |
| [22:16] | `gt_seq` | 7 | Revocation counter |
| [23] | `W` | 1 | Write permission |
| [24] | `R` | 1 | Read permission |
| [26:25] | `gt_type` | 2 | `0b11` |
| [31:27] | `ab_type` | 5 | Abstract category, 32 possible |

*Source:* [SIM], 24 July. **This supersedes [AB] v1.0**, which places
`gt_type` at [24:23], `R` at [26], `W` at [25], and `ab_type` at [31:27]
overlapping what are permission bits in an Inform GT.

### 4.1 The change from v1, and why it is an improvement

In v1 the Abstract GT's `ab_type` occupied bits [31:27] — the same bits that
hold `b_flag` and `perm[2:0]` in an Inform GT — and `abstract-gt.md` guarded
this with prose: *"X, L, S, E, B are repurposed as `ab_type` bits and must
never be treated as permissions on an Abstract GT."*

A rule enforced by a warning in a document is the weakest kind of
enforcement available. v2.0 removes the need for it: `gt_type` now sits at
[26:25] in **both** classes, so a reader decodes the type field first and
then knows unambiguously how to read everything else. The discriminator is
in a fixed position regardless of class.

This is the same principle as `dom`: make the invalid interpretation
impossible to reach rather than forbidden by instruction.

### 4.2 Abstract type registry

| `ab_type` | Category |
|---|---|
| `0x00` | I/O — hardware device pins and registers |
| `0x01` | M-elevation — sets CRn M-bit |
| `0x02`–`0x1F` | Reserved |

For `ab_type = 0x00`:

```
ab_data[15:8] = device_class
ab_data[7:0]  = device_data
```

| `device_class` | Device | `device_data` |
|---|---|---|
| `0x01` | LED | pin index |
| `0x02` | UART | TX=0, STATUS=1, RX=2 |
| `0x03` | Button | 0 |
| `0x04` | Timer | TICKS_LO=0 … CTL=4 |
| `0x05` | Display | DMA register offset |

> ⚠ **Encoded examples in [AB] are stale.** `abstract-gt.md` lists literal
> GT words (`0x07800100` for LED[0], and the c-list slot 8–13 table) built
> against the v1 bit positions. Every one of them must be recomputed against
> the v2.0 layout, and `BOOT_IMAGE_FORMAT_TAG` bumped, or a v1 boot image
> will be decoded as garbage by a v2.0 reader. **This is a silent-corruption
> risk, not a documentation nit.**

### 4.3 Why Abstract GTs matter more than device drivers

`abstract-gt.md` justifies the Abstract GT as a space saving: six LEDs cost
six self-describing tokens instead of an NS slot plus a 64-word lump.

That is true and it undersells the mechanism. An Inform GT names something
in *this* machine's memory. An Abstract GT names something that need not be
in memory at all — its authority travels with the word. That is precisely
the property required for authority to cross a machine boundary, and it is
currently spent on a timer register.

The `f_flag` mechanism (§5) is the other half of that story.

---

## 5. `f_flag` — a slot property, **not** a GT field

> ⚠ **Corrected from [FND].** `cloomc-foundation.md` §2 lists `f_flag` as a
> per-token bit in the GT word. It is not. `f_flag` is **bit [31] of NS Slot
> Word 1** — a property of the slot, not of any token naming it.

This is not a filing detail. It is the mechanism by which the architecture
reaches past a single machine, and putting the bit in the wrong place
destroys it.

The integrity check over an NS slot **masks both `f_flag` and `g_bit` to
zero before computing.** The seal therefore certifies the object's identity
and extent while remaining silent about *where it lives* and *whether it is
currently marked for collection*.

The consequence: **a local object and a remote one carry the same authority,
differing only in resolution path.** The same token, unchanged, names an
object here or on another node. Validation stays local — ChurchNSGate still
checks `gt_seq`, still recomputes integrity, still enforces bounds — while
resolution travels. The trust boundary is the NS slot, and the NS slot is
local by construction.

Move `f_flag` into the GT word and the seal would have to cover it, locality
would become part of the token's identity, and a token would stop meaning
the same thing in two places.

*Source:* [GT], §"Word 1 — authority".

---

## 6. NS Slot Word 1 and the integrity check

### 6.1 Word 1 layout

```
 31       30      29       21  20                  0
┌────────┬───────┬───────────┬────────────────────┐
│ f_flag │ g_bit │  gt_seq   │   limit_offset     │
│  [1]   │  [1]  │   [9]     │      [21]          │
└────────┴───────┴───────────┴────────────────────┘
```

*Source:* [GT]. The 24 July listing gives `gt_seq` at [31:25] as 7 bits with
[24:16] unused and a 16-bit seal at [15:0] — the **v1** layout. [GT] v2.0
moved `g_bit` from [28] to [30] and widened `gt_seq` to 9 bits, and the
per-slot seal moved to its own word (Word 2). The listing's own change table
confirms the `g_bit` move, so the Word 2 description in that listing is
internally inconsistent with its own summary.

> ⚠ **Confirm which Word 1 the HDL reads.** A 7-vs-9 bit `gt_seq` mismatch
> between GT and slot would make every revocation check compare different
> fields — and would fail silently in the common case where the high bits
> are zero.

### 6.2 integrity32

```
integrity32(w0, w1) = ROL32(w0, 7) ^ ROL32(w1 & 0x3FFFFFFF, 13) ^ 0xDEADBEEF
```

where the mask clears bit [30] (`g_bit`) and bit [31] (`f_flag`).

Result is stored in **NS Slot Word 2** and recomputed by ChurchNSGate on
every access. Mismatch faults with `SEAL`.

> ⚠ **Three descriptions exist and must be reduced to one.**
>
> | Source | Claim |
> |---|---|
> | [HDL] `core.py` | calls `integrity32_amaranth` — executable |
> | 24 July listing | "CRC-16 seal of (location, limit17)" then a note that it is actually ROL-XOR |
> | `boot-permission-rules.md` | CRC-16/CCITT poly 0x1021 over exactly 89 bits, with a note that the simulator covers only 56 |
>
> The ROL-XOR formula above and the [GT] integrity32 description are the
> same function — the masking of bits 30 and 31 matches exactly. **The
> CRC-16 text in both places is a fossil and should be deleted**, not
> footnoted. A footnote saying "the code actually does something else"
> guarantees the wrong one gets implemented eventually.

### 6.3 What integrity32 does and does not answer

It answers: **is this slot intact?**

It does not answer: *is this the slot you meant?* A single-bit flip in a
GT's `slot_id` names a different slot — and that slot is intact, in bounds,
correctly sealed, with its own valid `gt_seq`. Every check passes.

26 of a GT's 32 bits can be corrupted by a single fault into a token the
hardware honours, and 16 of them are an unprotected namespace pointer. See
`hardware-fault-detection.md` for the threat model and the R1/R2 parity and
ECC requirements. On the current FPGA the unforgeability guarantee holds
**against software adversaries only** — a limitation the 74-series PP250,
with address and data parity on every word, did not have.

### 6.4 Why there is no aggregate CRC over the c-list

There is no CRC over all c-list GTs as a group. See `gt-parity-integrity.md`
for the full reasoning; the short version is that binding (at load time) and
SAVE (at runtime) legitimately change c-list bytes, so any aggregate check
would fault on normal operation. Per-word parity/ECC — intrinsic to each GT
word — is the replacement: it checks exactly what integrity32 does not
(whether each token is what the program was given / stored), and it never
needs updating when a row is rebound.

---

## 7. Summary of corrections

| # | Where | Says | Should say | Severity |
|---|---|---|---|---|
| 1 | [FND] §2 | `gt_seq` is 7 bits | 9 bits at [24:16] | doc only |
| 2 | [FND] §1 | "7-bit version counter" | 9-bit | doc only |
| 3 | [FND] §2 | `f_flag` is a GT field | NS Word 1 bit [31] | **architectural** |
| 4 | [FND] §2 | field list totals 31 bits | 32, once 1 and 3 are fixed | doc only |
| 5 | [FND] §1 | GTs are "forged with machine secret" | *formed* / *signed* — the first law says unforgeable | **wording** |
| 6 | [AB] | `gt_type` at [24:23], R[26], W[25] | `gt_type` [26:25], R[24], W[23] | **code-affecting** |
| 7 | [AB] | literal GT words for LED/UART/etc. | recompute all; bump `BOOT_IMAGE_FORMAT_TAG` | **silent corruption** |
| 8 | `boot-permission-rules.md` | CRC-16/CCITT over 89 bits | integrity32 ROL-XOR | **code-affecting** |
| 9 | 24 July listing | Word 2 has 7-bit `gt_seq` at [31:25] | that is v1; v2.0 is Word 1, 9 bits at [29:21] | **code-affecting** |
| 10 | 24 July listing | `0b10` Reserved | Outform — **resolved 24 Jul**, listing was incomplete | closed |
| 11 | [SIM] phrasing | "F-bit set on all Outform GTs" | `f_flag` is set on the **slot**, not the GT | wording |
| 12 | [SIM] 3 sites | NULL tested as `gt === 0` | `isNullGT()` — **done, Task #2159** | closed |
| 13 | ctmm tree | `GT_TYPE_NULL = 0b10` | tree deleted — **closed by removal** | closed |
| 14 | [AB] | records the ctmm/hardware NULL divergence | delete the note; the tree is gone | doc only |

Items 6, 7, 8 and 9 change how bits are read. Item 10 is closed. None of
these are style.

---

## 8. What this document does not settle

**Does the lump-fetch endpoint carry a content hash?** §3.4: CRC-32 detects
corruption in transit; `CM_LUMP_SPECIFICATION.md` specifies SHA-256 content
identity, which detects *substitution*. Only the hash makes a fetched body
verifiable rather than merely intact — and a fetch that is merely intact is
a trust boundary the architecture does not otherwise have.

**NS Word 1 `gt_seq` width in the HDL.** [GT] says 9 bits at [29:21]. The
24 July listing implies 7. A mismatch fails silently whenever the high bits
are zero, which is most of the time — the worst possible failure mode.

**Where the second thread lives.** `switch.py` uses `CR8_BASE` with a target
bit to select two adjacent thread registers. The spec's register map assigns
CR12 thread, CR13 interrupt, CR14 code, CR15 namespace — leaving no adjacent
pair. If the two-thread scheme survives the CR8→CR12 migration, the register
map needs to say where the second thread lives.

---

## Why this document is structured this way

Every failure this project has traced has one shape: a second description of
the truth, created in good faith, drifting from the first. ECO-002. The
README's GT layout. The `typ` field written by ten encoders and validated by
none. Two method-table formats with one dispatcher checking both. Two HDL
trees. Two full copies of the repository. CR8 versus CR12.

Consolidating five descriptions into a sixth would repeat the pattern. So
this draft does two things differently:

**It tags every claim with its source**, so a reader can check rather than
trust — and so the next divergence is visible as a tag mismatch rather than
discovered by a boot failure.

**It refuses to silently resolve disagreements.** Where sources conflict the
conflict is stated and marked. A specification that quietly picks a side
looks authoritative and is worse than one that says "these two documents
disagree and here is which one the code implements."

The durable fix is not this document. It is extending
`tests/lump/test_lump_consistency.py` so that every table appearing in both
a document and the source is checked before merge. This draft is the input
to those rules, not a substitute for them.

---
*Draft — Kenneth Hamer-Hodges — July 2026*
