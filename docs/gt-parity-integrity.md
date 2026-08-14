# Integrity With the Grain — Per-GT Parity, Not an Aggregate CRC

**Design decision — Church Machine (CTMM)**
**Recorded August 2026**

*Companion to `hardware-fault-detection.md`, `golden-tokens-v2.md` §6, and
`LUMP_SECURITY_1773863015123.md`. Supersedes the aggregate placement-CRC
described in `LUMP_SECURITY_1773863015123.md` Phase 1 §4.*

---

## The conundrum

The c-list is the DNA of a lump — it defines what a lump can reach — so it
must be integrity-protected. But an aggregate check over the whole c-list (a
CRC or hash spanning all rows) breaks under the machine's own dynamics:

- **At load**, the Locator binds pet-name references into resolved Inform GTs.
  The c-list bytes change — so a compile-time CRC over them faults on
  legitimate binding.
- **At runtime**, `ClistN.SAVE(GTx)` rebinds a row. The bytes change again —
  so the placement CRC goes stale on every legitimate SAVE.

Protecting the c-list as an aggregate fights the fact that binding is supposed
to change it.

---

## The resolution

The conundrum is an artefact of aggregation, not of integrity. Remove the
aggregation and it dissolves.

**Integrity is intrinsic to each GT, not aggregate over the c-list.**

Each Golden Token is a parity/ECC-protected word. The check lives in the word,
not beside the c-list:

- Binding a row touches one GT and its parity. Nothing else's check moves.
- `SAVE(GTx)` writes one GT with its parity, atomically. No aggregate to go
  stale.
- The hardware checks each GT's parity on every fetch. A bit-flip faults at
  the offending word, per-access, deterministically.

There is no whole-c-list checksum, so there is nothing for legitimate binding
or SAVE to invalidate.

---

## Why this is with the grain

Pure lambda calculus is typeless: no tags, no apparatus over terms. An
aggregate CRC is exactly such apparatus — external machinery standing beside
the data, maintained in lock-step. Per-GT parity is not apparatus; it is a
property of the value. A GT with bad parity is not "a GT that failed a check"
— it is not a well-formed GT at all, the way a corrupted word is not a number.
Integrity is in the term, like redex-hood, not *about* it.

This is also how fail-safe hardware already works: ECC per memory word, checked
transparently on read — not CRC over structures. Per-GT parity is that
discipline applied to Golden Tokens.

---

## What this replaces, and what it does NOT

### Replaced — dropped

**The aggregate placement CRC over the c-list GTs.** Redundant now; per-GT
parity covers it, better and without the conundrum. Keeping both would
reintroduce the aggregation problem.

> **Impact on `LUMP_SECURITY_1773863015123.md`:** Phase 1 §4 describes Mint
> computing a "CRC-16/CCITT" over the GT. That step is the aggregate that this
> decision eliminates. The Phase 1 doc requires updating: parity is computed
> per-GT at write time (mLoad and BRAM ECC at store time), not as a separate
> Mint-computed field. See §"Implementation" below.

### NOT replaced — these are different mechanisms for different threats

| Mechanism | Threat it covers | Why it stays |
|---|---|---|
| **DNA seal** (`integrity32`) | Forgery — parity is trivially recomputable by an adversary; it is no defence against a forged identity. The seal covers invariant target-identities so it never faults on binding. | Stays. |
| **Capability authorization** — containment reduction-condition | Whether a row *may* hold a given reach. A GT can have perfect parity and still be an unauthorized reach. This is capability reduction (may this application happen), separate from corruption. | Stays. |
| **Transport integrity** — lump in flight | A lump over the wire (Call Home / Ethernet) needs whole-lump corruption protection for its code and structure, which per-GT parity (resident, per-word) does not cover. | Stays (served by the DNA seal or a transport CRC/hash). |
| **NS-entry metadata checks** | Slot bookkeeping not covered by GT parity. | Keep only if covering what parity does not. |

**The test for any remaining CRC field:** does per-GT parity already cover its
domain? If yes, drop it. If it covers something parity does not — entry
metadata, a lump in transit — it may still earn its place.

---

## Three intrinsic checks, no aggregate seal

| Question | Mechanism | Nature |
|---|---|---|
| Is this GT intact? | Per-GT parity / ECC | Intrinsic to the word; hardware, per-fetch |
| May this reach happen? | Capability reduction-condition | Intrinsic to reduction |
| Is this genuinely who it claims? | DNA seal (`integrity32`) | Term identity; catches forgery |

None is an aggregate checksum standing beside the data. Corruption,
containment, and identity are three separate intrinsic properties — which is
why disaggregating them dissolved the conundrum: binding and SAVE change only
the first, touch one word, and disturb nothing else.

---

## The razor (the general principle)

A check that is a condition-on-reduction (capability) or a term-identity (seal)
is **with the grain** and stays. A check that is external apparatus (an
aggregate checksum maintained beside the data) is **against the grain** and
must either collapse into capability-or-seal, or be cut.

Per-GT parity is this razor applied: corruption-integrity moved from
apparatus-over-the-c-list to a property-of-each-GT. Typelessness preserved;
the conundrum gone.

---

## Implementation

Two distinct locations where GTs live require separate mechanisms:

### Capability registers — R1 (parity)

*From `hardware-fault-detection.md` §R1.*

Each capability register carries **one parity bit** over its 32-bit GT word
(word 0).

- **Written** by mLoad — already the sole write path; no new path introduced.
- **Checked** on every read as authority: LOAD, SAVE, CALL, RETURN, TPERM,
  DREAD, DWRITE.
- **Fault on mismatch:** `GT_PARITY` — a hardware fault, distinguishable from
  permission faults so that a persistent BRAM or LUT failure is diagnosable.

Cost: 16 bits of state for the whole register file, plus one XOR tree per read
port.

**Status: committed. Scheduled for a subsequent bitstream after Artix-7 boot.**

### Block RAM (NS table, lump storage including c-lists, call stack) — R2 (SECDED)

*From `hardware-fault-detection.md` §R2.*

**SECDED (single-error-correct, double-error-detect) preferred for the
MTBF-first reliability target.** Xilinx 7-series BRAM primitives support
SECDED natively — single-bit errors are corrected transparently, double-bit
errors raise a fault. The parity bits are present in the primitive whether
used or not; the only cost is enabling the ECC logic the primitive already
contains.

Enable SECDED for:

- The **namespace table** — stored GTs in NS slot words.
- **Lump storage** — stored GTs in c-lists (the primary target of this design
  decision).
- The **call stack**.

This directly closes the c-list integrity gap described in §"The conundrum":
the BRAM ECC word-level check replaces the aggregate placement-CRC. Each GT
word is individually protected as it is read from storage, and a correctable
flip is handled transparently. No aggregate over the c-list is needed or
desired.

**Status: specified, not yet implemented. This is the immediate next hardware
hardening target after R1.**

### Address parity — R3 (lower priority)

Stride-4 addressing (shift rather than multiply) removes most of the
arithmetic that address parity would protect. Revisit only if field experience
shows address-path faults. See `hardware-fault-detection.md` §R3.

---

## Interaction with the existing seal

`integrity32` (§6.2 of `golden-tokens-v2.md`) already covers NS Slot words 0
and 1. Per-GT parity and ECC are complementary, not redundant:

- **`integrity32`** answers *is this slot intact?*
- **R1 (cap-register parity)** answers *is this the token the program was
  given?*
- **R2 (BRAM ECC)** answers *is this the token that was stored?*

A corrupted `slot_id` names a different slot — and that slot's `integrity32`
is valid. R1 and R2 catch the corruption before it reaches the NS lookup. All
three locations must be covered for the unforgeability claim to hold against
hardware fault.

---

## What changes in the Phase 1 security doc

`LUMP_SECURITY_1773863015123.md` Phase 1 §4 currently reads:

> *"Build X-GT and L-GT CRs, compute CRC-16/CCITT"*

Under this decision, **that CRC-16/CCITT step is eliminated.** The replacement
is:

1. mLoad writes the GT and its parity bit to the capability register (R1, cap
   register file).
2. The BRAM primitive's SECDED ECC protects the GT as stored in the c-list (R2,
   block RAM).

There is no separately-computed CRC field on the GT. The `trusted-security-base.md`
validation pipeline step "CRC-16/CCITT Integrity (ChurchNSGate)" refers to
`integrity32` (the NS slot seal, not the GT parity) and is correctly named
there as covering 89 bits over the NS entry words — that check is retained,
unchanged, for a different purpose.

---

## Status

**Design decision — adopted August 2026.**

The aggregate c-list CRC is replaced by per-GT parity/ECC (SECDED preferred
for the MTBF-first reliability target: single-error-correct, double-error-detect).

The DNA seal (`integrity32`), capability authorization, and transport integrity
are distinct mechanisms covering distinct threats and are retained.

---

*Companion documents: `hardware-fault-detection.md` (threat model and R1/R2/R3
requirements), `golden-tokens-v2.md` §6 (`integrity32` and the c-list parity
gap), `LUMP_SECURITY_1773863015123.md` (Phase 1 security pipeline, requires
update).*

*Kenneth Hamer-Hodges — August 2026*
