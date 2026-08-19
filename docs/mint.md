# Mint

**v1.0 — 2026-04-30**
**CONFIDENTIAL**

## The GT Issuance Mechanism

**Status: DRAFT**
**Author: design session 2026-04-30**
**Depends on: `docs/memory-manager.md §2`, `docs/abstraction-manager.md §4`**

---

## 1. Purpose

Mint is the only mechanism in the Church Turing Machine that may produce a valid Golden Token (GT). It sits just inside the Abstraction Manager (AM) boundary: the AM accepts a cryptographic identity string and decides what capabilities to grant; Mint encodes those capabilities into the 32-bit GT word and returns it as the local session handle.

No user-visible code path reaches Mint directly. Every GT a program holds was issued through Mint. Every permission bit the hardware enforces on every instruction was set by Mint at issuance time.

This document is self-standing. A reader who understands the GT bit layout in `docs/memory-manager.md §2` can follow every claim here without reading the rest of the memory manager.

---

## 2. The GT Word: A Reminder of the Layout

A GT is a single 32-bit word. The hardware checks specific bits on every instruction that names a GT as an operand. The full layout, reproduced from `docs/memory-manager.md §2`, is:

```
Bit  31   30────28   27   26─25   24────16   15────────0
     ┌────┬──────────┬────┬───────┬──────────┬───────────┐
     │ B  │  perm3   │dom │ type  │  gt_seq  │ object_id │
     └────┴──────────┴────┴───────┴──────────┴───────────┘
```

| Field | Bits | Width | Meaning |
|---|---|---|---|
| `object_id` | [15:0] | 16 | Namespace slot, or Abstract inline value |
| `gt_seq` | [24:16] | 9 | Revocation freshness counter; matches NS W1[29:21] |
| `type` | [26:25] | 2 | `00`=NULL `01`=Inform `10`=Outform `11`=Abstract |
| `dom` | [27] | 1 | 0=Turing (`R/W/X`), 1=Church (`L/S/E`) |
| `perm3` | [30:28] | 3 | Domain-relative permission bits |
| `B` | [31] | 1 | Bind — GT may be propagated to another c-list |

Mint is the only code path that writes a GT word with a valid `gt_seq`. All other code receives GTs from Mint; it cannot construct a fresh one.

---

## 3. Public Interface

Mint exposes one primary operation:

```
Encode(base, exp, type, dom, perm3, bindable) → GT
```

**Implementation note:** the current simulator stub names this method `Create` (in
`simulator/cloomc/mint.cloomc` and `simulator/system_abstractions.js`). The name `Encode`
is the canonical specification name. The stub's `Create` and this spec's `Encode` are the
same operation; future versions of the implementation are expected to adopt the spec name.

### Parameters

| Parameter | Type | Maps to GT field |
|---|---|---|
| `base` | 16-bit unsigned | `slot_id` [15:0] |
| `exp` | 9-bit unsigned | `gt_seq` [24:16] |
| `type` | 2-bit discriminator | `gt_type` [26:25] |
| `dom`, `perm3` | domain bit + 3-bit permissions | bits [30:27] |
| `bindable` | boolean | `B` bit [31] |

**`base`** is the Namespace slot index that identifies the entity this GT refers to. The hardware uses `slot_id` to look up the entity's physical base address and limit in the Namespace table. Mint receives this index from the Namespace (Navana) after the entity's lump has been registered; it does not choose or guess the slot number.

**`exp`** is the current 9-bit `gt_seq`, read from NS Entry Word 1 for an
issued Namespace capability. Abstract values use zero. Issue remains part of
the external issued identity even though code-cache `T` is issue-blind.

**`dom` and `perm3`** encode one permission domain at a time: `dom=0` maps
`perm3` to R/W/X; `dom=1` maps it to L/S/E.

**`bindable`** controls the B bit [31] independently of the six capability bits. Setting B permits the holder to copy this GT into another c-list via `mSave`. Clearing B confines the GT to the c-list it was placed in at issuance. Mint sets B as a separate parameter because the decision of whether a token may propagate is a policy choice made by the AM, not a consequence of any capability combination.

### The `type` field

The 2-bit `type` field at GT[26:25] is explicitly supplied by the authorized
issuance path. It is never decoded from
an NS word. The valid non-NULL types are:

| Value | Name | Meaning |
|---|---|---|
| `01` | Inform | Concrete lump, local or lazy-loaded |
| `10` | Outform | Remote lump, always far-loaded |
| `11` | Abstract | Value-in-token; no lump behind it |

Mint rejects `type = 00` (NULL). See §9 for Abstract GT specifics.

### Return value

Mint returns the fully assembled 32-bit GT word:

```
GT = (bindable << 31) | (perm3 << 28) | (dom << 27)
   | (type << 25) | ((exp & 0x1FF) << 16) | (base & 0xFFFF)
```

The word is ready for the hardware to check on the first instruction that names it as an operand.

### Normative issuance pseudocode

The following pseudocode captures the canonical order of operations for a single GT issuance.
Steps 1–3 are caller responsibilities; steps 4–8 are Mint's.

```
1.  size    ← nextPow2(requestedSize)          ; caller: quantise to 2ⁿ words (§8)
2.  loc     ← Memory.Allocate(size)            ; caller: obtain backing lump
3.  (base, exp) ← Navana.Add(loc, size)
                                               ; caller: register in Namespace;
                                               ;   base = assigned slot_id
                                               ;   exp  = initial gt_seq (= 0)
4.  type, dom, perm3 ← authorised issuance decision

5.  assert type ≠ NULL
6.  assert perm3 is valid for dom
7.  GT ← (bindable << 31) | (perm3 << 28) | (dom << 27)
              | (type << 25) | ((exp & 0x1FF) << 16) | (base & 0xFFFF)
    return GT
```

Steps 4–6 may fault and abort; no GT is returned if any check fails.

---

## 4. Preconditions and Invariant Checks

Mint enforces two structural invariants before assembling any GT word. Both are checked at mint time, not at use time. A violation raises a fault and returns no GT.

### 4.1 Domain Purity

The six capability bits divide into two groups:

```
Turing domain:  R (bit 25)   W (bit 26)   X (bit 27)
Church domain:  L (bit 28)   S (bit 29)   E (bit 30)
```

**A GT may carry Turing bits or Church bits, but never both.** A `permsBits` mask that sets any Turing bit alongside any Church bit raises `DOMAIN_PURITY` and Mint returns no GT.

The rationale is architectural: a region of memory that is readable or writable as data (`R`, `W`) and simultaneously callable as a capability (`L`, `S`, `E`) breaks the hardware's ability to enforce different access rules on different instruction classes. The two domains are physically distinct at the hardware level; Mint enforces the separation at issuance so no mixed token can ever reach user code.

Valid combinations:

```
Turing-only:   R   W   X   RW   RX   WX   RWX
Church-only:   L   S   E   LS
Invalid:       RL  WE  XE  RE   LS+any Turing   (any cross-domain mix)
```

### 4.2 E Isolation

Within the Church domain, the Enter bit (E) must stand alone.

**`LE`, `SE`, and `LSE` are all invalid.** An E-GT is the key to invoke an abstraction; an LS-GT is the key to read and write the capability list inside the same abstraction. These must never be the same key. A `permsBits` mask that sets E alongside L or S raises `E_ISOLATION` and Mint returns no GT.

```
Valid Church:    L   S   LS   E
Invalid Church:  LE  SE  LSE
```

E isolation ensures that code which holds only an Enter token cannot inspect or replace the capabilities inside the abstraction it calls.

### 4.3 Non-NULL type

Mint refuses to issue a GT with `type = 00` (NULL). The NULL GT is the zero word and represents the absence of a capability. It is never constructed by Mint; it appears only as the initial contents of uninitialised c-list slots.

---

## 5. The `gt_seq` Freshness Counter

### 5.1 What it is

Every resident Namespace entry carries a 9-bit `gt_seq` in W1[29:21].
Mint copies it into GT[24:16]. Hardware compares those fields on use.

### 5.2 Where it comes from

Mint reads `gt_seq` from the Namespace at the moment Navana.Add completes. Navana.Add assigns the slot and initialises `gt_seq` to 0 for a newly registered entity. Mint receives `(nsIndex, version)` from Navana.Add and uses `version` directly as `exp` in the Encode call. Mint does not choose the sequence number; the Namespace owns it.

### 5.3 How it is incremented: Mint.Revoke

Mint exposes a second operation for the system:

```
Revoke(nsIndex) → newSeq
```

Revoke reads NS W1, increments `gt_seq` modulo 512, rewrites W1, and regenerates
W2 `integrity32`. It never uses W3 cache `T` as revocation authority.

The effect is immediate and total: every GT that was ever issued for this slot carries the old `gt_seq` value. Every use of any of those GTs will now fail the hardware freshness check. The hardware enforces the revocation; no software sweep is needed. The slot remains valid in the Namespace; a new GT can be issued at any time by calling Encode with the new `gt_seq` value.

**The counter wraps.** After 511 increments, `gt_seq` returns to 0; lifecycle
policy must prevent ancient issued GTs from surviving that full generation.

---

## 6. Mint.Transfer

Mint exposes one further helper:

```
Transfer(gt, targetCList, targetSlot)
```

Transfer writes a GT word into a specific slot of a specific c-list. This is the only way to place a GT that Mint has just issued into a c-list other than the one Mint itself runs in. No permission bit is changed; the GT is copied verbatim. If the GT has `B=0`, Transfer is still permitted because the copy is performed by Mint — a system actor — not by user code. `B=0` constrains user-level `mSave`; it does not constrain Mint's internal placement.

---

## 7. Mint's Position in the AM Boundary

The AM boundary, from `docs/abstraction-manager.md §4`, is:

```
cryptographic identity string  →  [verify → authorise → issue]  →  local session handle
```

Mint implements the `issue` step. The AM has already verified the cryptographic string and decided which capabilities the session may receive. It passes the authorised permission set to Mint as `permsBits` and `bindable`. Mint enforces the structural invariants (§4), reads `gt_seq` from the Namespace (§5.2), and returns the assembled GT word. The AM hands that word to the caller as the local session handle.

```
                   ┌─────────────────────────────────────────────────────┐
                   │                Abstraction Manager                   │
                   │                                                       │
 cryptographic ──► │  verify → authorise ──► Mint.Encode(base, exp,     │ ──► GT (local session handle)
 identity string   │                          type,dom,perm3,bindable)  │
                   └─────────────────────────────────────────────────────┘
                                              ▲
                                      Mint enforces:
                                      · domain purity
                                      · E isolation
                                      · non-NULL type
                                      · reads gt_seq from Namespace
```

Mint knows nothing about the cryptographic identity string. It knows nothing about why a particular permission set was authorised. It receives numbers and a type, checks the two invariants, and produces a word. This narrow scope is intentional: capability issuance is a mechanical encoding step, not a policy step. Policy belongs to the AM.

---

## 8. Relationship to the Namespace

Mint does not allocate Namespace slots directly. The sequence for issuing a GT to a new entity is:

1. **Memory.Allocate(size)** — a backing lump is obtained from the physical pool. Size must be 2ⁿ words (6 ≤ n ≤ 14) per the quantisation rules in `docs/memory-manager.md §3.1`.
2. **Navana.Add(location, limit, …)** — the lump is registered in the Namespace. Navana assigns `object_id` and initialises W1 `gt_seq = 0`.
3. **Mint.Encode(base=nsIndex, exp=version, type, dom, perm3, bindable)** — the GT word is assembled from the authorized decision.

Mint is step 3. It has no side-effects on the Namespace or on memory. It reads `gt_seq` (supplied by the caller as `exp`) and writes nothing. The only state change Mint makes in the wider system is through `Mint.Revoke`, which writes a new `gt_seq` value back to one NS entry word.

> **NS Word 3 content token (`T`) and promotion.** A resident (Inform) NS entry
> is four words: Word 0 = `location`, Word 1 = `authority`, Word 2 =
> `integrity32`, Word 3 = a 32-bit **issue-blind content token `T`**
> (`T = hash(name ‖ genotype_binary)`, issue excluded). `T` is a name-free
> cache/index only — it is **never** authenticity (`integrity32` detects local
> corruption but is not cryptographic identity proof), revocation (that is
> `gt_seq`), or ownership (which uses full issued identity and authorization),
> and it authorizes nothing. Issue is excluded from the code-content token `T`
> but is **mandatory for value/ownership**, where it lives outside `T` in the
> full `dot.name.issue.token` name. When `Mint.Lump` promotes an Outform entry
> to Live, it commits the NS slot (and any dependent c-list binding) **only after
> verifying the fetched bytes hash to `T` and the full trusted identity
> matches**; on failure the Outform restore token (Words 1–3, `T` in Word 3) is
> preserved exactly. See `docs/locator.md` and
> `docs/CM_LUMP_SPECIFICATION.md § "Namespace Table — Entry Format"`.

---

## 9. Abstract GT Note

When `type = 11` (Abstract), the GT word carries its value directly rather than
through a Namespace lookup. `object_id` is reused as inline data. `gt_seq` is
not meaningful for this value-in-token type and must be zero.

**An Abstract GT never owns an NS entry.** Because its value lives in the GT word
itself, no NS slot is allocated or consumed for an Abstract GT, and no NS entry
Word 3 annotation is written on its behalf. The deprecated per-abstraction
annotation once imagined for an NS Word 3 (the retired `abstract_gt` alias)
migrates to **access/catalogue metadata**, outside the NS entry — see
`docs/golden-tokens.md § "Word 3 — content token cache/index (T)"`.

---

## 10. Summary

| Question | Answer |
|---|---|
| Who may call Mint? | The AM issuance path only. No user-visible E-GT for Mint is ever issued. |
| What does Mint check? | Domain purity, E isolation, non-NULL type. Nothing else. |
| Where does `gt_seq` come from? | The Namespace entry, at the moment Navana.Add registers the lump. |
| How does revocation work? | Mint.Revoke increments `gt_seq` in one NS entry. The hardware rejects all outstanding GTs for that slot. |
| What does `bindable` control? | Whether the GT holder can propagate the token via `mSave` (B bit [31]). |
| Does Mint allocate memory? | No. Memory.Allocate and Navana.Add precede Mint. Mint only encodes. |

---

*This document describes design intent only. No source files have been modified as a result of this specification.*

---
*Confidential — Kenneth Hamer-Hodges — April 2026*
