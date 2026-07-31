# Hardware Fault Detection — Threat Model and Requirement

*Draft for insertion into `golden-tokens.md`, following the integrity32
section. Drafted 21 July 2026.*

---

## The claim, and where it currently holds

The architecture's central guarantee is that **authority cannot come into
existence except through Mint.** A Golden Token is unforgeable: software
cannot fabricate one, because every path that writes a capability register
runs through mLoad, and mLoad validates version, seal, bounds, and permission
before any write occurs.

That guarantee is stated against a *software* threat model. It holds
completely there.

Against a **hardware** threat model it currently does not hold, and this
section states precisely where the gap is.

## Where a Golden Token can be corrupted

A GT exists in three places during its lifetime. Only one of them is
protected.

| Location | Protection today | Consequence of a single-bit flip |
|---|---|---|
| NS SLOT words 0–1 | **integrity32** | Detected. ChurchNSGate faults with `SEAL`. |
| GT word in a capability register | **none** | Executed as valid. |
| GT word stored in a c-list in memory | **none** | Loaded and executed as valid. |

The unprotected cases are not theoretical corner cases, and they are not
equally severe. The severity depends on how many faults are required before
the corruption becomes an exploited action.

### Fields where one fault is sufficient

**`slot_id` — bits [15:0].** Half the token. A flip renames the object.

The program then does exactly what it was already going to do. It holds
legitimate permission, it executes the instruction it was written to execute,
and it operates on the wrong object. `LOAD CR0, CR6, #4` followed by
`CALL CR0` enters a different abstraction. No second fault is required, no
unusual code is required, and the corruption is exercised by the very next
instruction.

Every existing check passes:

| Check | Why it does not help |
|---|---|
| Bounds | The wrong slot is in bounds. |
| `gt_seq` match | The wrong slot has its own valid sequence number. |
| integrity32 | The wrong slot is perfectly consistent with itself. |
| Permission | Unchanged and legitimate. |

This is the crux. **integrity32 answers "is this slot intact?" Nothing
answers "is this the slot you meant?"** Every validation in the mLoad
pipeline validates the slot that was named. None of them can detect that a
different slot was named than the one the program intended.

**`gt_seq` — bits [24:16].** A flip defeats revocation.

The 9-bit sequence counter exists to make stale tokens fail after garbage
collection bumps a reclaimed slot's version. A flip that happens to produce
the new value makes a stale token match — a use-after-free on a reclaimed
namespace entry, silently, with no second fault. This disables the one
mechanism specifically designed to prevent that class of error.

**`dom` — bit [27].** A flip reinterprets all three permission bits at once.

Domain purity is structurally enforced by the encoding: `dom` selects whether
`perm[2:0]` means {X, W, R} or {E, S, L}, which makes a mixed-domain token
impossible to *represent*. A flip in this bit does not create a mixed token —
it converts the token wholesale to the other domain. `L` becomes `R`, `S`
becomes `W`, `E` becomes `X`. A capability for traversing a c-list becomes a
capability for reading it as data. Whether this is immediately exploitable
depends on the code, but unlike a `perm` flip it changes what kind of object
the token is understood to name.

### Fields where a second fault is required

**`perm[2:0]` — bits [30:28].** A flip creates latent authority.

An `L` token becoming an `S` token is harmless until something executes a
SAVE against that register — and code written to hold only `L` has no reason
to contain one. Exploitation requires either a second fault in the
instruction stream, or code that already contains both paths and selects
between them by permission check. TPERM's conditional-execution pattern is
exactly such code, so this is not impossible, but it is a narrow window
requiring coincidence.

**`b_flag` — bit [31].** Latent in the same way: a non-bindable token
becoming bindable matters only when a SAVE attempts delegation.

### Summary

| Field | Bits | Faults to exploit | Effect |
|---|---|---|---|
| `slot_id` | 16 | **one** | Names a different object. All checks pass. |
| `gt_seq` | 9 | **one** | Defeats revocation; use-after-free. |
| `dom` | 1 | one | Reinterprets the token in the opposite domain. |
| `perm` | 3 | two | Latent authority until the operation is executed. |
| `b_flag` | 1 | two | Latent until delegation is attempted. |

**Twenty-six of the thirty-two bits are in the single-fault category, and
sixteen of those are an unprotected pointer into the namespace.**

The argument for R1 is therefore not "a bit flip could corrupt permissions,"
which invites the reasonable objection that a second fault would also be
needed. It is that half the token is an unprotected object reference, and a
single flip in it redirects a legitimate operation, performed with legitimate
authority, to the wrong object — with every existing check passing, because
every existing check validates the slot rather than the choice of slot.

## Why this is a regression, not an oversight

PP250 was built from Texas Instruments 74-series devices and carried
**address and data parity on every memory word**. It also used a **stride of
3** for slot entries, so that valid slot addresses were all multiples of
three and any single-bit flip in an address produced a non-multiple —
structurally detectable.

The FPGA implementation has neither.

The stride change was a deliberate and correct trade: a stride of 4 makes
slot addressing a shift rather than a multiply, and the logic saved is worth
more than the BRAM spent on the spare word. Note also that the shift removes
most of the address *arithmetic* that stride-3 detection existed to catch —
the fault class is largely no longer produced, not merely undetected.

The loss of parity has no such compensating trade. It was simply never
specified, because on 74-series hardware parity was standard practice rather
than a requirement anyone wrote down.

The net effect is that the 1972 machine was more resistant to hardware fault
than the 2026 one, on precisely the axis the architecture is about. That
should be an explicit, bounded, scheduled gap rather than an implicit one.

## Requirement

Three measures, in implementation order. The first is the one that closes the
authority hole; the others are defence in depth.

### R1 — GT parity in the capability register file

**Status: committed. This is the next hardening after the Artix-7 boot is
brought up — the decisive first step, undertaken, not conditional.** A single
parity bit is the floor beneath every guarantee the architecture makes: it is
the difference between a single-bit fault that faults and one the machine
silently honours.

Each capability register carries one parity bit over its 32-bit GT word
(word 0).

- **Written** by mLoad, which is already the sole path for every capability
  register write (the Golden Rule) and already the place where validation
  occurs. No new write path is introduced.
- **Checked** whenever the register is read as authority: LOAD, SAVE, CALL,
  RETURN, TPERM, DREAD, DWRITE.
- **On mismatch:** a new fault, `GT_PARITY`. This is a hardware fault, not a
  permission fault, and should be distinguishable in the fault record so that
  a persistent BRAM or LUT failure is diagnosable rather than appearing as
  mysterious permission errors.

Cost: 16 bits of state for the whole register file, plus one XOR tree per
read port. Detects all single-bit and all odd-multiple-bit errors.

Parity covers the whole 32-bit word rather than selected fields. There is no
saving available from protecting only `slot_id` and `gt_seq` — one bit and
one XOR tree covers everything — and partial coverage would need justifying
every time the encoding changed.

### R2 — ECC on block RAM

Xilinx 7-series block RAM supports SECDED (single-error-correct,
double-error-detect) natively in the BRAM primitives. Enable it for:

- the namespace table,
- Lump storage, including c-lists,
- the call stack.

Single-bit errors are corrected transparently. Double-bit errors raise a
fault. This covers stored GTs, which R1 does not.

Cost: BRAM parity bits, which are present in the primitive whether used or
not, plus the ECC logic the primitive already contains.

### R3 — Address parity

Lowest priority. The shift-based addressing introduced with stride 4 removes
most of the arithmetic that address parity would protect, and the remaining
exposure is small relative to R1 and R2.

Revisit only if field experience shows address-path faults.

## Interaction with the seal

integrity32 already covers NS SLOT words 0 and 1. R1 and R2 are complementary
rather than redundant, and the distinction is precise:

- **integrity32** answers *is this slot intact?*
- **R1** answers *is this the token the program was given?*
- **R2** answers *is this the token that was stored?*

The seal cannot answer the second or third question, because a corrupted
`slot_id` names a different slot and that slot's seal is valid. All three
locations must be covered for the unforgeability claim to hold against
hardware fault.

## Status

Specified, not implemented. Scheduled for a subsequent bitstream.

Until implemented, the architecture's unforgeability guarantee should be
understood as holding **against software adversaries only**. This should be
stated wherever that guarantee is claimed, including the README and any
public-facing material, rather than left as a silent qualification.

---
*Confidential — Kenneth Hamer-Hodges*
