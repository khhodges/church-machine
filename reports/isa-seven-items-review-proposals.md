# Church Instructions and proposed ISA amendments

**REVIEW DRAFT — NOT APPROVED ISA.** Red text is proposed wording. It must not
be used to change the compiler, simulator, saved binaries, RTL, or FPGA until
reviewed and approved. The unchanged master document follows this addendum.
This edition contains only architectural review items. It does not claim
that unresolved choices have been approved.

**Authority on approval:** The approved form of these amendments shall replace
conflicting passages in the master ISA and derived references. Until then,
the existing master remains authoritative. Existing reports remain historical
evidence, not conformance expectations.

**ISA scope — user decision:** The ISA specifies architectural state,
instruction encodings, capability authority, observable effects and faults.
Implementation mechanisms, software service designs and diagnostic systems
are excluded from this review.

**Compatibility policy — user decision:** No legacy compatibility is required
before liftoff, defined as the first FPGA release. After that release,
compatibility is decided case by case, not promised by default. Old encodings,
ABIs and behavior do not constrain pre-release design choices. Retaining
historical evidence does not require executing or translating old artifacts.
This policy does not itself approve the detailed proposals or authorize
implementation changes, synthesis, programming or physical-board actions.

**Boot and recovery:** [Section 3 — ColdStart, CHANGE and fault
recovery](#3-coldstart-change-and-fault-recovery).

## Church Instructions — top-level architecture

**Agreed architectural direction for this review.** The three Word-0 header
layouts below retain their existing field definitions. The I/O-definition
family uses the agreed header-first arrival contract and Namespace slot word
order. Simple register I/O and large framebuffers are separate classes.
Proposed encodings and a vendor-neutral display interface are defined below;
ordinary Namespace entries do not acquire exponent bounds merely to support
a framebuffer.
The Namespace metadata,
slot assignments and loading rules incorporate the subsequent review decisions.
They replace the earlier sixteen-word Namespace header in this review, not in
the unchanged master, implementations or retained images. Unresolved choices
are listed explicitly; no seal mechanism is assumed.

Church instructions define LUMP structure and extent. Church interprets these
headers; Turing does not execute them. A header grants no access authority by
itself: access still requires the appropriate GT and applicable Church checks.
Fetching a header as a Turing instruction faults.

### Common Word-0 layout

The three already-encoded forms use the same 32-bit field positions. Their meanings depend
on the type; in particular, the Namespace size exponent differs from the
Abstraction and Thread size exponent.

```text
Bits        31:27   26:23        22:10         9:8   7:0
Width           5       4           13           2     8
Abstraction 11111   size_field   code_words      00   c_list_count
Namespace   11111   size_field   slot_count      01   00000000
Thread      11111   size_field   stack_words     10   00001100
```

The fourth form, I/O-definition, uses type `11` and no C-list. The proposal
below distinguishes two explicit subtypes: exact-count simple register I/O
and exponent-sized framebuffer memory. Only the framebuffer uses `2^n`
words without a bias. Existing Abstraction/Thread header biases (+6) and
Namespace header bias (+13) remain unchanged.

### Namespace LUMP header — total RAM and table

The root Namespace header defines the total RAM extent, not just table
capacity. A subordinate Namespace describes its own allocated range.

| Word-0 field | Meaning |
|---|---|
| Bits 31:27 | `11111` — LUMP header marker. |
| Bits 26:23 | `size_field`: capacity is `2^(size_field+13)` 32-bit words. Defined values 0–9 represent 8K–4M words. |
| Bits 22:10 | Plain Namespace slot count N; this is not the inclusive slot limit. |
| Bits 9:8 | `01` — Namespace. |
| Bits 7:0 | Reserved; must be zero. They are not an extension of the slot count. |

### Namespace metadata and fixed slots

Each table slot occupies four 32-bit words, in ascending word order W0–W3.
Slot 0 is the highest-addressed slot and holds metadata, not an ordinary
capability entry.

| Slot | Architectural role |
|---|---|
| 0 | Namespace metadata; not a capability-resolvable target. |
| 1 | Namespace self-entry. |
| 2 | Initial Thread entry. |
| 3 onward | Other Namespace, Thread, Abstraction or I/O entries. |

Slot 0 contains:

| Word | Meaning |
|---|---|
| W0 | Namespace header: type, total capacity and table slot count. |
| W1 | Namespace RAM base byte address, always present, including zero. |
| W2 | Following member LUMP count M: resident member LUMPs plus I/O-definition LUMPs that follow the Namespace. |
| W3 | Reserved. No cold-boot seal for now; no seal meaning or trust source is assigned. |

N counts all table slots, including metadata slot 0. It is distinct from M.
The Namespace self-entry must agree with the metadata's base and extent.
The fixed roles require space for slots 0, 1 and 2.

No separate format marker, stored table offset, boot-entry address word,
seal-boundary word or additional seal area is introduced by this layout.
W3 is reserved, not a pending requirement to introduce a cold-boot seal.

### Namespace RAM and table address rules

**Address range:** let B be the base byte address and C the capacity in words.
Each word is four bytes; each Namespace entry is four words.

```text
RAM bottom byte address       = B
RAM top byte address          = B + 4×C − 1        (inclusive)
Table bottom byte address     = B + 4×(C − 4×N)
Table top byte address        = B + 4×C − 1        (inclusive)
Slot s first-word byte address = B + 4×(C − 4×(s+1))
Valid slot indices            = 0 through N−1
```

Thus slot 0 is the highest-addressed entry, and successive entries descend.
Its W0 begins sixteen bytes before the exclusive end of the RAM range; W3
is the last word of that range. The metadata is part of the table, not a
separate header allocation at the bottom of RAM.
The table must fit within the Namespace's authorized range and must not
overlap resident LUMP bodies.
The slot-index limit N−1 is distinct from the RAM and table address limits.
There is no fixed 64-slot requirement.

The root Namespace describes total RAM. Each additional Namespace describes
its own authorized range, with its table at the top of that range, not
necessarily at the top of all physical RAM.

Header fields, alignment, bounds and table geometry must be valid. A header
cannot grant authority to write its declared range, and address arithmetic
must not wrap into an apparently valid range.

### Abstraction LUMP header

| Word-0 field | Current meaning |
|---|---|
| Bits 31:27 | `11111` — LUMP header marker. |
| Bits 26:23 | `size_field`: allocation is `2^(size_field+6)` words; defined values 0–9 represent 64–32,768 words. |
| Bits 22:10 | Code word count `cw`. Code occupies word offsets 1 through `cw`. |
| Bits 9:8 | `00` — Abstraction. |
| Bits 7:0 | C-list count `cc`. Its entries occupy the final `cc` words of the allocation. |

Word 0 is the header, not code. The region between code and C-list is
freespace, including any defined embedded self-description. All regions
must fit within the allocation.

### Thread LUMP header

| Word-0 field | Current meaning |
|---|---|
| Bits 31:27 | `11111` — LUMP header marker. |
| Bits 26:23 | `size_field`: allocation is `2^(size_field+6)` words. The current Thread definition supports 256–8192 words, in powers of two. |
| Bits 22:10 | Private-stack word count `sw`, not executable code length; must be positive. |
| Bits 9:8 | `10` — Thread. |
| Bits 7:0 | `12` — twelve saved capability homes, CR0–CR11. |

A Thread contains no executable code section. For an allocation of S words:

```text
Word 0                     Header
Words 1–16                 DR homes
Word 17                    Protected Thread indicator
Words 18 … S−12−sw−1       Heap
Words S−12−sw … S−13       Private stack
Words S−12 … S−1           Capability homes CR0–CR11
```

The regions must satisfy the defined Thread geometry and protection rules.
The header does not bypass validation during Thread activation.

### I/O-definition LUMPs — separate register and framebuffer types

**Agreed distinction: arrival format is not slot format.** The I/O definition
arrives header-first. Loading establishes a four-word Namespace entry with
the device base in slot W0. The user-approved separation supersedes the earlier
proposal to use exponent bounds for every ordinary entry.

**Agreed direction:** simple UART-style registers retain exact-count bounds;
large framebuffer allocations use the direct exponent n. They are distinct
classes, not one size format with implicit interpretation.

**Proposed binary encoding, not yet adopted:** both arrival records are
exactly two 32-bit words (8 bytes), with no padding, code or C-list.

An I/O-definition LUMP describes a device mapping, not a RAM-backed executable
or Thread. It participates in the same header-first arrival sequence as other
member LUMPs.

| Architectural information | Meaning |
|---|---|
| I/O-definition identity | Header type `11`, under the LUMP marker `11111`, with an explicit subtype. |
| Device address range | The device base and extent under the defined memory map, not a destination for copying the definition's bytes. |
| Permitted access rights | The device access rights that may be granted, bounded by the authority under which the definition is loaded. |

| Arrival word | Meaning |
|---|---|
| W0 | I/O header: subtype, subtype-specific size and maximum permitted read/write rights. |
| W1 | Word-aligned device base byte address. |

**Proposed W0 bit allocation:**

| Bits | Simple register I/O | Framebuffer memory |
|---|---|---|
| 31–27 | `11111` | `11111` |
| 26–10 | Bits 26–23 zero; bits 22–10 exact register count S, 1–8191. | Bits 26–22 exponent n, 0–30; bits 21–10 zero. |
| 9–8 | `11` | `11` |
| 7–3 | Reserved, zero. | Reserved, zero. |
| 2 | `0` — simple register I/O. | `1` — framebuffer memory. |
| 1 | Write permitted. | Write permitted. |
| 0 | Read permitted. | Read permitted. |

```text
Simple W0 = (0x1F << 27) | (S << 10) | (0b11 << 8) | (W << 1) | R
Frame  W0 = (0x1F << 27) | (n << 22) | (0b11 << 8) | (1 << 2) | (W << 1) | R
W1 = device_base_byte_address

One read-only register (S=1):     W0 = 0xF8000701
Three read/write registers (S=3): W0 = 0xF8000F03
32 MiB read/write frame (n=23):   W0 = 0xFDC00307
```

Here R and W are single-bit access flags, not member counts. At least one
must be set. This form defines no execute or Church capability-transfer
permission. Nonzero reserved bits or an empty rights mask are invalid.
Simple counts outside 1–8191 and framebuffer exponents outside 0–30 must
be rejected, not masked or truncated. Exponent 31 is reserved. These are
proposed encoding limits, not changes to existing ordinary-entry limits.

**Framebuffer size rule only:**

| n | Allocation in words | Allocation in bytes |
|---|---|---|
| 0 | 1 | 4 |
| 1 | 2 | 8 |
| 2 | 4 | 16 |
| 3 | 8 | 32 |
| 21 | 2,097,152 | 8 MiB |
| 23 | 8,388,608 | 32 MiB |
| 30 | 1,073,741,824 | 4 GiB |

Each increment doubles the allocation. There is no +6 adjustment for this
field, and zero means one word, not an empty allocation.

Let S be the simple register count or, for a framebuffer, `2^n` words.
For device base B, the last word begins at `B + 4×(S−1)` and the last byte
is `B + 4×S − 1`.
The complete range must fit the address space without overflow and match an
authorized mapping. A three-register device uses exact count three; it does
not gain access to a fourth register. A framebuffer's entire power-of-two
allocation must exist and be authorized, including any padding. A 4 GiB
allocation fits the 32-bit byte-address space only at base zero; compute end
addresses without wrapping.

**Agreed Namespace entry — base retained in W0, W3 repurposed:**

| Slot word | Meaning |
|---|---|
| W0 | Device base/location. |
| W1 | Ordinary/simple I/O: existing inclusive limit, generation and flags. Framebuffer: exponent n, generation and flags. |
| W2 | Integrity, extended to bind the authoritative entry kind in W3. |
| W3 | Authoritative kind: 0 = ordinary memory; 1 = simple register I/O; 2 = framebuffer. Other values are reserved and invalid. |

**Keep ordinary exact bounds unchanged.** Simple I/O uses the existing
21-bit inclusive-limit field in W1, with generation and flags unchanged.
The previous proposal to replace that field for every resident entry is
withdrawn. W3's cached-token role is explicitly replaced, not preserved in
spare bits or inferred from a token's value. Metadata slot 0 is not a
capability entry: its reserved W3 is unchanged.

**Framebuffer W1:**

| Bits | Meaning |
|---|---|
| 4–0 | Unbiased exponent n, 0–30; extent is 2^n words. |
| 20–5 | Reserved, zero. |
| 29–21 | Existing generation. |
| 30 | Existing G flag. |
| 31 | Existing F flag. |

Arrival W0 is a header, whereas slot W0 is a base address. The two-word
arrival record is not itself a four-word Namespace entry. This conversion
does not change the existing 32-bit GT encoding.

**Agreed capability-resolution semantics:** validate the integrity-bound kind
and generation, then retain the kind as protected capability state.
Ordinary/simple I/O checks `word_offset <= exact_limit`; framebuffer checks
`word_offset < 2^n`. For unsigned framebuffer word offsets, this means the
bits above the lowest n bits must be zero; n=0 permits only offset zero.
All words of a multiword access must fit. Neither I/O kind permits execution
or Church capability transfer. The GT must separately authorize the requested
read/write operation; the entry kind grants no permission by itself.

The kind and corresponding bounds must survive protected save/restore.
Their exact register/context packing still needs specification. A browser
label or an untrusted lookup cannot choose bounds semantics.
Do not infer the subtype from address or size, or
reclassify an ordinary entry when its exact limit happens to resemble an exponent.
Changing the arrival header alone does not solve the old 8 MiB runtime limit.
Large-range bounds checking must reject overflow and out-of-range accesses
without truncating to 21 bits. Ordinary code, C-list and Heap views retain
their exact bounds; this proposal does not widen them.

**Integrity and migration prerequisites:** authority remains in the GT.
W3 describes the target kind; it does not grant permission. Because that kind
determines how bounds are interpreted, include it in the integrity input
alongside the existing protected entry fields. The concrete extension below
is proposed, not yet adopted. Existing cached-token
consumers, including nonresident handling, must be accounted for before this
format is adopted in an implementation. Nonresident entries are not silently
reinterpreted, nor is their migration settled by the new local-entry kind codes.
This is a pre-release review-format change, not permission to reinterpret
retained entries or images in place. No simulator or hardware migration is
authorized by this review.

**Agreed illustrative 1080p example:**

At 1920×1080 and 32 bits per pixel, tightly packed pixels occupy 8,294,400
bytes. An 8 MiB allocation contains 2^21 words, so n=21. With illustrative
base 0x10000000, generation 1 and both flags clear:

| Word | Value | Meaning |
|---|---|---|
| W0 | `0x10000000` | Base byte address. |
| W1 | `0x00200015` | Generation 1 in bits 29–21; n=21 in bits 4–0. |
| W2 | Computed integrity, not a placeholder numeric value | Must bind the entry kind as well as the other protected fields. |
| W3 | `0x00000002` | Framebuffer kind. |

The permitted byte range is 0x10000000–0x107FFFFF; 0x10800000 is the
first forbidden byte for this capability. A second separately bounded
8 MiB buffer may occupy 0x10800000–0x10FFFFFF, totaling 16 MiB.
These are explanatory addresses, not a physical-board mapping. Row stride,
pixel format and actual backing storage still require validation. Display
coordinates ownership and presentation; adjacency does not authorize a
capability for buffer A to access buffer B.

#### Proposed integrity extension — GT authority unchanged

**Scope:** retain the existing 32-bit GT, its permissions and generation
checks, and the existing authorized Namespace-write and loading paths. No
new authority token, permission source, key or authentication protocol is
introduced. W3 is validated target-description data, not an access grant.

Extend the existing calculation by one rotated W3 term:

```text
integrity32_kind(W0, W1, W3) =
    ROL32(W0, 7)
    XOR ROL32(W1 AND 0x3FFFFFFF, 13)
    XOR ROL32(W3, 19)
    XOR 0xDEADBEEF
```

All terms are unsigned 32-bit words; ROL32 rotates left within 32 bits.
W2 stores the result. W1's generation remains covered; G/F remain excluded,
exactly as today. W3 must be a whole-word value 0, 1 or 2; reject reserved
values rather than masking them into a valid kind. For kind 0 the new term
is zero, so the old base/authority calculation is unchanged.

This is an extension of the existing unkeyed consistency check, not a claim
of cryptographic authentication. Authorized access still depends on the GT
and existing Church enforcement. With W0/W1 fixed, changing between valid
kinds changes the check; it cannot silently retain the old W2.

**Resolution and state rules:**

1. Capture one coherent entry under the existing authorized update rules.
   Validate kind and its reserved fields, existing GT/generation conditions,
   and the extended integrity before using the resolved bounds for access.
2. Keep the same capability GT. Retain the validated kind alongside its base
   and bounds. Proposed packing reuses the resolved capability's former
   cache-token word3 for kind; no bits are taken from the GT or exact limit.
3. Apply the agreed exact-limit or framebuffer-exponent check, together with
   the existing GT permissions. A kind alone never authorizes an operation.
4. Carry kind, base and bounds consistently through protected save/restore,
   copies and inspection/writeback. In particular, the existing M-window
   DR15 mirror would carry kind instead of cache token, and its integrity
   check would use that kind. Existing M authority is unchanged. Reject an
   absent or invalid kind; do not default it to ordinary memory.
5. A kind change uses the existing authorized replacement/reissue rules;
   never reinterpret an already resolved live capability by changing a label.

**Checked example under this proposed formula only:** for the 1080p entry
above, the old two-input result is `0xDEAF1EE3`. Kind 2 contributes
`ROL32(2,19) = 0x00100000`, so proposed W2 is `0xDEBF1EE3`.
This conditional example does not adopt the formula or replace retained bytes.

**Cached-token migration:** stop treating Namespace W3, resolved word3 or
their protected copies as a token cache in the new format. Optional cache
state remains non-authoritative and separate from the kind. Each existing
consumer must retain its required token/identity lookup through an explicit
migration; the kind must never be substituted as a token. Nonresident token
resolution must be accounted for before cutover. Do not guess old versus new
format from a small W3 value or reinterpret old saved contexts in place.

Before implementation, enumerate the affected producers, consumers and
protected-context paths. Confirm matching software/RTL calculations, kind
changes with stale W2 faulting, unchanged G/F treatment, generation checks,
exact and exponent boundary accesses, kind-preserving save/restore, M-window
writeback and nonresident resolution. These are required future checks, not
claims of implemented or synthesized hardware evidence.

**Explicit pre-release type reassignment:** header type `11` replaces the
historical Outform header meaning in the new ISA under review. It is not an
unused-code allocation or a dual interpretation. The separate Golden Token
type encoding and nonresident Namespace entries are unchanged.

Loading the definition establishes its intended I/O Namespace entry only
after validating the mapping, range and access authority against the
prepared Namespace and the defined memory map. A definition cannot create
authority that the loading operation does not possess or broaden that authority.
An invalid or unauthorized definition does not satisfy member completion.

The resulting entry refers to the device range, not to the definition record.
Loading the definition does not read or write the device registers, initialize
the device, or copy a LUMP body into its address range. It establishes no code
or Thread execution context.

Each following I/O-definition LUMP counts once toward M. The device itself
is not thereby a RAM-resident LUMP. This section specifies no persistent
RAM allocation for the definition record.

This definition assigns logical 32-bit words; byte serialization follows
the common binary-image contract, not a special I/O-specific byte order.

### Vendor-neutral display interface proposal

**Agreed direction:** keep control-register authority separate from pixel
memory authority, independent of NVIDIA or any other vendor. Start with a
simple framebuffer display controller; GPU acceleration is a later driver
integration, not part of a framebuffer LUMP's meaning.

**Proposed initial interface:**

- A trusted Display abstraction owns the simple-I/O control capabilities.
  A framebuffer capability authorizes only its pixel-memory range; it cannot
  configure the controller, submit arbitrary GPU commands or authorize DMA.
- Display reports supported modes and accepts a selected width, height,
  explicit pixel format and row stride. The initial software-rendered target
  is 1920×1080 with 32-bit pixels; the exact channel order must be reported,
  not guessed. Mode, stride and buffer extent must agree.
- An application receives write access only to an available drawing buffer.
  It requests presentation through Display, not by writing device controls.
  Presentation validates that the exact buffer belongs to the configured
  display and reports completion before the old displayed buffer is reused.
  A pending buffer is not writable by the drawing application. Enforcing this
  handoff, including outstanding aliases, is a prerequisite rather than an
  assumed capability-revocation feature.
- Double buffering is the preferred initial configuration: two separately
  bounded 8 MiB buffers for 1080p, totaling 16 MiB. Two 32 MiB buffers support
  4K at 32 bits per pixel, totaling 64 MiB. These are backing-memory requirements,
  not claims about installed board RAM. Row padding or additional rendering
  surfaces can require more memory. A minimal controller may support only one
  buffer and cannot promise tear-free updates.
- A later NVIDIA or other GPU driver provides the same display operations,
  but handles its own initialization, mappings, command submission and
  completion. A framebuffer capability describes an authorized CPU-visible
  mapping, not an arbitrary VRAM address. If such a mapping is unavailable,
  use driver-mediated transfer rather than fabricate a CPU-access capability.
- DMA requires separately enforced device-access isolation or an explicitly
  trusted, constrained hardware path. CPU capability checks alone do not
  constrain GPU DMA. Do not enable unrestricted bus-master access as a fallback.

The architectural surface is mode discovery/configuration, acquisition of a
safe drawing buffer, presentation and completion. Exact method numbers,
register ABI, buffer handoff enforcement and device bindings require a later
specification. No PCIe controller, GPU driver, DMA authorization, board command
or hardware release is introduced by this documentation proposal.

### Header-first arrival and deterministic placement

Namespace, Abstraction, Thread and I/O-definition LUMPs arrive header first. Arrival order
and final memory placement are distinct: the Namespace header and base are
available before its top-of-range metadata slot must be located.

For RAM-backed LUMPs, the header determines type, allocation size and internal
geometry. Placement remains within an authorized destination range.
For an I/O-definition LUMP, its header identifies a mapping definition;
the device range is not a RAM allocation for its record.
Abstraction and Thread headers acquire no additional base-address word;
their destination is established by the prepared Namespace layout.

The prepared Namespace defines each member's slot, location and extent,
together with an unambiguous association between arriving members and table
entries. Placement follows that layout rather than being independently
chosen again. Addresses may differ between prepared images.

Loading order must be defined against the table; arrival order alone is not
implicit slot numbering. The exact member-to-entry association encoding
remains to be specified.

### Member loading and completion

The Namespace is followed by exactly M member LUMPs, each header first.
M includes the resident member LUMPs and I/O-definition LUMPs. It excludes
the enclosing Namespace itself and nonresident entries whose LUMPs are not
supplied in this loading sequence.

This replaces the earlier resident-only count R. An I/O entry is represented
by its following definition LUMP; it is not skipped solely because the
device has no RAM body.

```text
Namespace metadata and defined table
Member 1 — header first (for example, a Thread)
Member 2 — header first (for example, an I/O definition)
…
Member M — header first
```

The Namespace is ready for execution only after every counted member has
arrived, matched its intended entry and passed the applicable validation.
A missing, duplicate, mismatched or invalid member cannot satisfy completion.
The count proves neither member identity nor access authority.

Loading an Abstraction does not call it. Loading a Thread does not activate
it. Loading an I/O definition does not perform device I/O.
Member completion is a prerequisite for execution, not an instruction
to begin executing.

If a member is itself a Namespace, the same header-first loading and
member-completion rule applies recursively. The precise stream framing and
count scope must express that rule without introducing a separate loading
mechanism.

### I/O entries and capability resolution

Capability resolution first validates the referenced Namespace entry and
the applicable GT authority, permissions, bounds, generation and integrity.
Slot 0 metadata cannot be resolved as an ordinary capability target.

An entry for a RAM-backed LUMP identifies the location at which the applicable
LUMP header is interpreted and checked. An I/O entry instead identifies a
device address range under the defined memory map. It has no LUMP header or
body at the device address to fetch; its I/O-definition LUMP was supplied
separately during loading. A device register must not be interpreted as a
LUMP header.

I/O entries occupy table slots and their following definition LUMPs contribute
to M. They remain subject to the applicable access checks. Headerless device
access is not permission
to bypass capability validation or execute a device register as code.

### Remaining architectural decisions

- Approval of the proposed I/O subtype header bit and per-subtype size fields.
- Approval of the proposed rotated-W3 integrity extension and resolved-word3
  reuse; complete token-cache/context migration inventory, including nonresident
  handling. Kind codes and bounds-checking semantics are already agreed.
- Display method ABI and enforceable buffer ownership/presentation completion.
- Exact association of arriving members with their prepared table entries.
- Precise framing and count scope for the agreed recursive Namespace rule.

W3 reservation, hardwired bootstrap and recovery authority, CR13 reservation,
SecurityRegulator ownership of M, indexed CALL support and conversion of the
header-first I/O definitions to Namespace slot word order are decided.
Simple register I/O and framebuffer memory remain separate classes.
For capability entries, W3 kind codes and framebuffer W1 exponent packing
are agreed; metadata slot 0 still has a reserved W3.
Do not reopen them as feature choices.

## 1. CHANGE encoding and clean cutover

**Status: review-only proposal, adjusted to include relative GT lookup at the
user's request.** Both forms below consume one Thread GT. The current master
excludes indexed CHANGE; this amendment proposes replacing that restriction,
not silently changing the master or any implementation.

### Direct and relative GT selection

CHANGE shall support both a GT already held in a capability register and a GT
located through an authorized capability-relative lookup. Illustrative syntax,
pending final syntax and encoding approval:

```asm
CHANGE CRn                         ; use the GT already held in CRn
CHANGE CRlist[immediate]            ; fetch a GT at a constant C-list index
CHANGE CRlist[DRr + immediate]      ; fetch a GT at a runtime-relative index
```

The relative form calculates a C-list entry index from the pre-instruction DR
value plus the immediate displacement, then fetches exactly one GT through
CRlist's authorized Church L capability. It is capability-relative GT lookup,
not a raw memory address used as a Thread identity. All applicable lookup
capability validity, permission, bounds, generation and integrity checks apply.
An out-of-range effective index faults BOUNDS; arithmetic must not wrap into
an apparently valid entry. The entry stride and address conversion follow the
ordinary C-list lookup rules, not arbitrary byte addressing.

The capability authorizing the lookup is distinct from the selected Thread GT.
The latter must have no permissions and pass the same Thread/context checks
as the direct form. CHANGE's internal save/restore privileges do not authorize
otherwise forbidden reads for GT selection. Lookup does not publish a
temporary architectural CR or change the active Thread.

Both forms activate the Thread identified by the selected GT. Neither takes
two Thread GTs or introduces an implicit Namespace-slot operand. Self-target
CHANGE retains the same save-and-resume semantics, regardless of how its GT
was obtained. Lookup or validation failure faults before context publication.
After encoding validation, a false condition on a valid instruction performs
no lookup and no transition. Invalid encodings hard-fault regardless of flags.

### Candidate encoding

**New allocation for review, not approved or implemented:** the following
single-word layout distinguishes direct and indexed CHANGE explicitly. It
retains opcode 4 and the usual condition field, but repurposes the two legacy
register fields. The indexed operand retains the master's selected LOAD/SAVE
sign and DR-selector positions, but extends CHANGE's magnitude to **13 bits**
using the three former RSV bits. CHANGE's displacement range is **−8191
through +8191**, not the two's-complement range −4096 through +4095.

**This replaces the earlier draft's repeated-register direct encoding.**
For example, the proposed direct `CHANGE CR12` becomes `0x27060000`, not
`0x27660000`. This is an explicit review choice, not an assertion that current
assembler output or saved binaries already use this layout.

```text
Bits       31:27   26:23  22   21:19  18:15  14   13:4   3:0
Field      opcode cond   IDX  mag_hi CR     S    mag_lo DR
Width      5      4      1    3      4      1    10     4
```

| Field | Proposed meaning |
|---|---|
| opcode | `00100` = CHANGE |
| cond | Ordinary condition code; `1110` = AL in all examples below |
| IDX | `0`: use the GT in CR; `1`: fetch a GT through CR's authorized C-list |
| mag_hi | Upper three magnitude bits; **not reserved** in indexed CHANGE |
| CR | Direct GT register when IDX=0; C-list capability register when IDX=1 |
| S | `0`: add magnitude; `1`: subtract magnitude |
| mag_lo | Lower ten magnitude bits |
| DR | Runtime index register DR0–DR15; DR0 is constant zero |

For ordinary direct CHANGE (IDX=0), mag_hi and all low 15 bits must be zero.
For indexed CHANGE (IDX=1), all 13 magnitude bits participate:

```text
magnitude = (mag_hi << 10) | mag_lo
effective_index = unsigned32(DR[DR]) + (S ? -magnitude : magnitude)
word = (4 << 27) | (condition << 23) | (IDX << 22) | (CR << 15)
     | ((magnitude >> 10) << 19)
     | (S << 14) | ((magnitude & 0x3FF) << 4) | DR
```

The effective index is evaluated without arithmetic wraparound. A negative result or
one outside the authorized C-list bounds faults BOUNDS before any context
publication. Reject source displacement magnitudes above 8191 rather than
masking them. Assemblers canonicalize minus zero to plus zero; either zero
sign decodes to the same effective index.

### Binary format for each example

Each grouped binary line below contains **exactly 32 bits**, most significant
bit first. Separators follow the eight fields in the layout above.

**1. Direct GT — `CHANGE CR12`**

```text
00100 | 1110 | 0 | 000 | 1100 | 0 | 0000000000 | 0000
Hex: 0x27060000
```

Use the permissionless Thread GT already in CR12. No C-list lookup occurs.
Likewise, direct `CHANGE CR4` is:

```text
00100 | 1110 | 0 | 000 | 0100 | 0 | 0000000000 | 0000
Hex: 0x27020000
```

**2. Immediate-relative lookup — `CHANGE CR6[3]`**

```text
00100 | 1110 | 1 | 000 | 0110 | 0 | 0000000011 | 0000
Hex: 0x27430030
```

CR6 authorizes the C-list lookup. DR0 supplies zero, so the effective entry
index is 3. Fetch that entry's GT, validate it, then activate its Thread.

**3. Register-plus-immediate lookup — `CHANGE CR6[DR2 + 3]`**

```text
00100 | 1110 | 1 | 000 | 0110 | 0 | 0000000011 | 0010
Hex: 0x27430032
```

Index is the runtime unsigned value of DR2 plus 3; the register value is not
substituted at compile time. If DR2=5, look up C-list entry 8.

**4. Register-minus-immediate lookup — `CHANGE CR6[DR2 - 3]`**

```text
00100 | 1110 | 1 | 000 | 0110 | 1 | 0000000011 | 0010
Hex: 0x27434032
```

If DR2=5, look up entry 2. If DR2=2, the result is −1 and faults BOUNDS rather
than wrapping. These are logical 32-bit instruction words; byte serialization
continues to follow the existing artifact-format rules.

**5. Extended magnitude — `CHANGE CR6[DR2 + 1024]`**

```text
00100 | 1110 | 1 | 001 | 0110 | 0 | 0000000000 | 0010
Hex: 0x274B0002
```

mag_hi=1 and mag_lo=0 encode 1024, demonstrating that the former reserved
bits now affect the lookup. DR2=5 selects entry 1029, only if authorized.

**6. Maximum positive displacement — `CHANGE CR6[DR2 + 8191]`**

```text
00100 | 1110 | 1 | 111 | 0110 | 0 | 1111111111 | 0010
Hex: 0x277B3FF2
```

**7. Maximum negative displacement — `CHANGE CR6[DR2 - 8191]`**

```text
00100 | 1110 | 1 | 111 | 0110 | 1 | 1111111111 | 0010
Hex: 0x277B7FF2
```

All examples remain subject to actual C-list bounds and permissions. The
13-bit magnitude does not enlarge the capability's authorized extent.

### Relationship to other instruction formats

LOAD/SAVE use **two CR selectors, not three**, plus a numeric DR selector:

```asm
LOAD CRd, CRlist[DRr + offset]
SAVE CRlist[DRr + offset], CRs
```

LOAD names the destination CR and authorizing C-list CR. SAVE names the
authorizing C-list CR and source CR. The DR is a numeric index, not a third
capability. Immediate-only indexing selects DR0, but still occupies its
four-bit selector field.

| Bit budget within 32 bits | LOAD/SAVE | Proposed CHANGE |
|---|---|---|
| Opcode + condition | 9 | 9 |
| CR selectors | 8 (two CRs) | 4 (one CR) |
| Addressing-mode bit | None added | 1 |
| Sign + DR selector | 5 | 5 |
| Magnitude | 10 contiguous bits | 13 bits split 3+10 |
| Total | 32 | 32 |

Thus LOAD/SAVE retain **±1023**; CHANGE can support **±8191** without another
word. Both have the same register-plus/minus-immediate semantics, but not the
same constant-offset range. Non-index arithmetic immediates are unaffected.

**Indexed CALL is agreed.** Capability lookup and method selection remain
distinct operands. Apply the agreed runtime DR-plus-displacement semantics
to indexed operands, retaining their defined units and authority checks.
This review does not reproduce a verified complete CALL bit allocation;
that documentation gap is not a proposal to withdraw indexed CALL or require
its approval again. Do not substitute CHANGE's layout or infer approval from
a current decoder's limited row/method split.
Similarly, data-word offsets and branch displacements retain their own units.

Decoding remains opcode-specific: bit 14 is an offset sign for LOAD/SAVE and
this CHANGE proposal, a register/immediate mode bit in the documented
IADD/ISUB formats, and a two's-complement sign in the documented BRANCH
format. BFEXT/BFINS position/width fields and RETURN's keep mask are not
address displacements. A universal immediate sign-extension rule is incorrect.

### Reserved encodings

There is no RSV field in indexed CHANGE. Every mag_hi value 000–111 is usable.
**Special-operation authority is consolidated in section 3.1.** Only its exact
candidate boot marker occupies otherwise-forbidden IDX=0 space.
Apart from that marker, nonzero magnitude/sign/DR
combinations in IDX=0 cause INVALID_OP before condition evaluation. Direct
GT selection still requires mag_hi=0 and low15=0. IDX=1 always denotes ordinary
validated lookup.

**Review decision:** approve or revise this candidate layout, including the
changed direct words, the IDX mode bit, the split ±8191 displacement range,
and the single boot marker defined in section 3 before implementation.

## 2. CHANGE validation and encoding faults

**Status: encoding-before-condition ordering is agreed for this review draft.
Detailed transition checks below remain architectural proposals.
The master ISA and implementations have not been changed by this agreement.**

### Encoding validity is checked before the condition

After an authorized instruction fetch, validate the operation encoding before
evaluating its execution condition. An unassigned or retired opcode, a
reserved condition code, or a forbidden encoding-field combination causes an
**INVALID_OP hard fault regardless of the current condition flags**.
In this review rule, condition code 1111 (NV, marked reserved in the reference)
is invalid, not a way to hide a malformed instruction.

Only a validly encoded instruction may be skipped because its condition is
false. Skipping advances to the next instruction but performs no operand
lookup, target capability validation, Thread transition, or operation-induced
register, flag or memory write. Instruction-fetch access checks are never bypassed.

| Encoding | Condition | Result |
|---|---|---|
| Valid executable instruction | False | Skip the operation and advance |
| Valid executable instruction | True | Validate operands and execute |
| Invalid or reserved instruction encoding | Either | INVALID_OP hard fault |
| WORD data marker fetched for execution | Not applicable | INVALID_OP hard fault |

This distinguishes encoding errors from operand/runtime failures. It does not
inspect a skipped instruction's target capability or invent new reserved
fields where an instruction definition assigns or permits those bits.

### DATA words: existing WORD marker and review status

The encoding reference and assembler already allocate opcode **30 / 0x1E /
11110** to the `WORD` inline-data directive. This is an existing documented
allocation, not a newly selected opcode in this discussion; an explicit prior
user approval of that allocation has not been established from the available
record. No separate `DATA` assembly mnemonic is approved by this paragraph.

```text
Bits       31:27    26:0
Meaning    11110    27-bit payload

WORD 42
Binary:    11110 | 000000000000000000000101010
Hex:       0xF000002A
```

These words have **no condition field**: bits 26:23 are part of the payload,
not flags controlling execution. The review rule requires a hard fault if
execution reaches a WORD marker, regardless of payload or current flags.
An authorized data read is not instruction execution and does not fault merely
because the word carries this marker. The format carries 27 payload bits,
not an unrestricted 32-bit literal. It does not tag every arbitrary data word
or replace instruction-fetch capability checks. Opcode 31 / 0x1F remains the
distinct LUMP-header marker, not a second DATA instruction.

### Transition validation order

Before committing a transition, validate in this order:

1. Authorized fetch, then encoding validation as above. Invalid or reserved
   encodings hard-fault before condition evaluation. Only then evaluate the
   valid instruction's condition; if false, advance without operand access
   or operation effects. Continue with the remaining checks only if true.
2. Select the operand GT. For the direct form, read CRn. For the relative
   form, validate CRlist and its L authority, calculate and bounds-check the
   effective C-list index, then fetch the GT under the ordinary lookup rules.
   Preserve the specific lookup fault, including NULL_CAP, PERM_L, BOUNDS,
   VERSION or SEAL, where applicable. Then, for either form, validate the
   selected Thread GT: reject NULL with NULL_CAP; require every permission bit zero.
   A permission-bearing Thread GT faults.
   Do not strip permissions or replace the supplied identity.
3. Resolve the exact Thread identity through the applicable Namespace bounds,
   generation, integrity/seal and residency checks. Preserve the existing
   specific fault where one applies. An unresolved target may not be activated.
4. Validate Thread type, alignment, allocation, supported size, fixed DR and
   protected-indicator locations, twelve capability homes, and nonoverlapping
   Heap and private-stack geometry.
5. Validate the protected indicator and the exact resumable frame: frame size,
   stack extent, executable Enter GT, code identity, valid continuation offset,
   and flags. A root sentinel is accepted only in the defined fresh-Thread/boot
   case, never as an ordinary executable return address.
6. Validate the resumed abstraction's C-list extent, SELF identity and
   consistency with the saved executable Enter GT. For each nonempty concrete
   entry being restored, run the applicable full mLoad identity/integrity
   checks. Empty homes restore NULL; unresolved Abstract locks remain
   unresolved and confer no executable authority. Do not manufacture a
   replacement C-list or use mutable CR0 as the saved executable identity.
7. Confirm outgoing save capacity and all write destinations before publishing
   either context. Self-target CHANGE uses the newly captured continuation.

Malformed Thread geometry, frames or C-list structure fault. Preserve an
applicable defined fault such as BOUNDS, VERSION, SEAL or NULL_CAP.
This review does not allocate additional fault-code numbers.

## 3. ColdStart, CHANGE and fault recovery

**Status:** The user has selected save-first fault recovery with a fallback
that loads the recovery Thread without completing the failed save. Every
applicable mLoad security check remains required.

### 3.1 Operations and GT authority

**Church–Turing cross-check:** The instruction and its authorizing GT are
independent, **never packed together**. Turing specifies the action; Church
supplies and checks the capability authority for each memory access. They
must coexist throughout the operation.

| Operation | Turing: instruction / event | Church: GT source and access authority | Result |
|---|---|---|---|
| ColdStart Thread activation | Candidate boot word `0x27000001` | Established CR15 Namespace GT for NS[2] access; validated initial Thread GT for its context | Load the initial Thread's state. There is no current Thread state to save. |
| Normal CHANGE | Direct or indexed CHANGE, section 1 | Current CR12 Thread GT for saving state; incoming GT from CRn or the indexed lookup; CRlist's L authority for that lookup; CR15 Namespace authority for resolution | Save the current Thread's state, then load the incoming Thread's state. |
| Fault-recovery CHANGE | Attempt the normal save-and-load transition after the first successful CHANGE | CR12 identifies the faulting Thread; the hardwired recovery Thread GT must pass the incoming checks | Try to save the faulting Thread's state, then load the recovery Thread. |
| Recovery after the save itself faults | Perform the incoming-state part of recovery | The recovery Thread GT must still pass all incoming checks; the failed save grants no additional authority | Load the recovery Thread without completing the failed save of the faulting Thread. |

Each memory access uses its own authority. A C-list lookup GT does not
authorize access to the selected Thread; an incoming Thread GT does not
authorize writing the outgoing Thread.

The previously discussed candidate boot encoding remains for review:

```text
00100 | 1110 | 0 | 000 | 0000 | 0 | 0000000000 | 0001
Hex: 0x27000001
```

Its fixed fields identify the boot operation, not CR0/DR1 operands.
The initial Thread is selected from NS[2] after Namespace establishment.
Boot proceeds to the final CALL after loading that Thread's state.
The fault-recovery Thread is hardwired. CR13 is reserved; it is not an
IRQ or WatchdogFault register and does not select the recovery Thread.
Hardwired authority still passes the applicable Church checks.

### 3.2 Save-first recovery

Normal CHANGE saves the current Thread's state, then loads the incoming
Thread's state.

At ColdStart, there is no current Thread state to save, so only the incoming
Thread is loaded.

After bootstrap passes validation, at least one successful CHANGE must
establish the running Thread's saveable context before save-first fault
recovery can operate as intended. Before that point, the stuck-in-a-loop
condition remains; bootstrap validation alone does not remove it.

Once that prerequisite is met, fault recovery first attempts a normal CHANGE.
If saving the faulting
Thread's state causes another fault, proceed to loading the recovery Thread
without completing that save. Failure to save the old Thread never grants
permission to load an invalid new Thread.

If recovery continues to fail, execution returns through the three-instruction
boot sequence. A persistent detected fault can therefore cause repeated boot
attempts, provided the trusted security base is functioning.

### 3.3 Reserved CR13 and trusted M authority

CR13 is reserved for now. No IRQ/WatchdogFault role or instruction is assigned
by this review.

M authority belongs exclusively to SecurityRegulator, which is trusted as
part of the Trusted Security Base (TSB). It is not ordinary per-Thread state
to be inherited or restored as a grant of privilege. This review adds no
blanket M-clearing rule to CHANGE.

Boot and fault recovery do not bypass Church's security rules. Every memory
access must have its defined GT authority and pass all applicable mLoad checks.

## 4. Namespace bootstrap and CR15 identity

**Status: CR15 bootstrap authority is hardwired. Trust the IDE builder and
the seals, subject to the applicable Church checks. Namespace capacity is
configurable, not fixed at 64 slots.**

Slot 0 supplies metadata; slot 1 describes the Namespace itself; slot 2
describes the initial Thread. The slot-index limit is N−1, distinct from the
RAM address limit. Metadata does not itself grant capability authority.

CR15's initial Namespace authority is hardwired, not supplied by an arbitrary
incoming Thread. The established capability must identify the Namespace
self-entry at slot 1 and agree with the validated Namespace base, extent and
generation. The earlier slot-0 GT example is not applicable to this layout.

Only the initial ROM LOAD into CR15 has M-boot authority. It validates the
Namespace identity against the self-entry under the applicable mLoad checks.
A location word is an address, not a substitute GT.

The successful result is a valid Namespace capability with validated
Namespace geometry and slot limit N−1. Boot authority ends at completion and
is not extended to CHANGE,
CALL or later LOADs. A failed bootstrap check faults without replacing CR15.
CHANGE's separately specified context accesses remain subject to item 2.

Namespace accesses remain subject to the architectural memory map and the
validated Namespace capability.

The trusted builder and seals do not introduce a new seal in metadata W3.
No alternative trust source or extra bootstrap-resolution mechanism is
proposed here. Successful validation must be followed by the first successful
CHANGE described in section 3 before save-first fault recovery is established.

## 5. Heap identity, bounds and derived CALL capabilities

**Status: derivation from validated objects is established. Selecting the
Thread's slot/sequence for the Heap GT is proposed to resolve the mismatch.**

CHANGE constructs CR5 from the validated incoming Thread: Inform GT, the same
Namespace slot and generation as that Thread, Turing R+W permissions, and no
additional authority. The protected Thread GT itself remains permissionless.
CR5 is a bounded derived view, not access to the whole Thread allocation.

For a Thread of N words, twelve capability homes, and sw private-stack words:

```
capsStart  = N - 12
stackStart = capsStart - sw
heapStart  = 18
heapWords  = stackStart - heapStart
CR5.base   = Thread.base + 4 * heapStart       // byte addresses
CR5.limit  = heapWords - 1                    // inclusive word offset
```

Reject invalid geometry or a nonpositive Heap extent. CR5 excludes the header,
DR homes, protected word +17, private stack and capability homes. Revalidation
must not expand this view back to the Namespace descriptor's full Thread
extent; the bounded view is machine-derived and cannot be supplied arbitrarily
by software.

An ordinary LOAD into CR5 receives no special bypass. On Thread activation,
the saved CR5 home cannot override the canonical derived Heap view.

CALL establishes CR6 as the validated callee's Church L-only C-list view and
CR14 as its validated Turing X-only code view, using their respective geometry.
Its source must supply valid E authority. This reconciles the conflicting
baseline wording “CR6 E-only”; no blanket CALL mLoad exemption is authorized.
These view-construction rules do not exempt ordinary LOADs to CR6 or CR14.

## 6. Post-CHANGE architectural state

**Status: deterministic establishment by CHANGE is user-confirmed. The table
retains the architectural state under review and identifies unresolved entries.**

| State | Required result |
|---|---|
| CR0–CR4, CR7–CR11 | Restore the incoming Thread's saved GT homes and validate/resolve full capabilities. Empty homes become fully NULL. CR8 has no scratch role. |
| CR5 | Derive the canonical Heap view under item 5; never trust a saved home to broaden it. |
| CR6 | Reconstruct the C-list view from the saved continuation's validated executable Enter GT, not from mutable CR0 or a stale saved CR6 descriptor. |
| CR12 | Complete permissionless capability of the validated incoming Thread: GT, base and descriptor extent. |
| CR13 | Reserved. No IRQ/WatchdogFault role, recovery-Thread selection or per-Thread saved home is assigned. |
| CR14 | Reconstruct code authority and extent from the saved continuation's validated executable Enter GT. |
| CR15 | Preserve the fully established Namespace capability; a Thread home cannot replace it. |
| DR0 | Architectural constant zero. |
| DR1–DR15 | Restore the incoming Thread's saved data-register homes. |
| NIA, flags, STO, frame-size indicator | Restore the validated canonical continuation and protected indicator, consistently with its frame. |
| M state | Owned exclusively by the TSB-trusted SecurityRegulator, not granted by ordinary Thread restoration. No blanket all-M-clear rule is introduced here. |

General CHANGE saves the outgoing continuation before activating the incoming
one. Self-target CHANGE restores the newly saved continuation. No register
value is inherited accidentally from power-up, a previous Thread or scratch
work; preservation occurs only where the table specifies it.

ColdStart and fault recovery follow section 3. Loading incoming state remains
subject to the same Thread validation even when the outgoing state cannot
be saved.

## 7. Fault effects and transition validity

**Status: architectural effects only; no diagnostic or recovery mechanism
is added by this section.**

Successful CHANGE and CALL each publish one architectural transition.
Validate the applicable inputs and output ranges before committing.
Unvalidated partial results must not be observable in architectural CRs,
Thread memory or Namespace state as a successful transition.
An invalid encoding or failed authority check must not authorize the rejected
operation's effects.

At CALL acceptance, use the installed CR12 Thread capability and validated
geometry. A valid Thread at base zero is allowed by an applicable memory
profile; zero base alone is not a null test. A malformed/incomplete architectural
Thread descriptor faults. Context accesses must refer to the
Thread authorized by CR12, not to a different Thread.

After the first-successful-CHANGE prerequisite, fault recovery follows
section 3: first try saving the faulting Thread and
loading the recovery Thread; if the save itself faults, load the recovery
Thread without completing that save. All applicable security checks remain
required. This fallback does not turn an invalid incoming Thread into a valid one.

## Architectural review checklist

- Approve or revise each numbered proposal separately.
- Reconcile all conflicting master-document passages; do not leave two active
  definitions after adoption.
- Preserve the decided hardwired recovery and CR15 authority, reserved CR13,
  SecurityRegulator M ownership and first-successful-CHANGE prerequisite.
- Complete the remaining representation details without reopening agreed
  indexed CALL support or inventing new mechanisms.
- Retain independent instruction/GT authority and all applicable mLoad checks
  through normal execution, ColdStart and fault recovery.
