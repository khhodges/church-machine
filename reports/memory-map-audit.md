# Memory-map audit — simulator, IDE, ISA review and LUMP bytes

Date: 2026-10-10. **Read-only audit; no migration or release approval.**

## Conclusion

The current committed image has a coherent, measurable **current-format** map.
It is not an implementation of the red-text Namespace redesign. A single
bit-correct *new* map cannot yet be declared: address-unit normalization,
metadata/slot-role changes and the latest kind encoding need explicit agreement.
The user's current requirement is **W3 remains T**, the IDE LUMP identifier.
The latest W0-low-bit kind scheme is a proposal, not an adopted encoding.

This audit does not validate synthesized initialization, execute the boot path,
check a physical board or establish that execution passes address 0x2E08.
The earlier synthesized-initializer investigation remains incomplete.

## Evidence and reproducibility

- Committed image: `server/lumps/boot-image.bin`, 65,536 bytes / 16,384 words.
- SHA-256: `0ff1b24d76b7010c13b8b50737f4513a771b586be73b8d0fa80a748087070a5b`.
- `memory-map-audit-evidence.json` records source/input hashes, raw descriptors,
  catalog headers, saved-state comparisons and pre-C-list payload comparisons.
- `memory-map-lump-audit.json` retains every non-pass finding from the IDE's
  existing `lumpAudit()` checker over all 92 manifest-referenced binary files.
- `scripts/audit_memory_map_review.py` reproduces the read-only image/header
  inventory and checks that its inputs did not change during the run.
- Run `node scripts/audit_memory_map_lumps.js` afterward to repeat the simulator
  header and IDE structural checks against those exact hashed inputs.
- Master ISA, amendments, simulator, IDE, server parser and image/catalog inputs
  were examined. No running browser state or published database was sampled.
  Server retained revision directories were neither rewritten nor regenerated.

Header checks are not full cryptographic admission. The payload comparisons
exclude localized C-list rows deliberately; zero mismatches there do **not**
prove whole-artifact equality or executable correctness.

## 1. What is implemented today

### Bit contracts

| Structure | Bits / interpretation |
|---|---|
| GT | slot 15:0; sequence 24:16; type 26:25; domain 27; permissions 30:28; B 31 |
| NS W0 | Location; its units depend on the current image/runtime profile |
| NS W1 | Exact inclusive word limit 20:0; sequence 29:21; G 30; F 31 |
| NS W2 | `ROL32(W0,7) XOR ROL32(W1 & 0x3FFFFFFF,13) XOR 0xDEADBEEF` |
| NS W3 | T, described as cache/index token by code; **LUMP ID to the IDE** by user architectural intent |
| Ordinary LUMP header | marker 31:27 = 31; size field 26:23; count 22:10; type 9:8; cc 7:0 |
| Abstraction | allocation `2^(field+6)` words; count is code words; C-list at allocation tail |
| Thread | allocation `2^(field+6)` words; count is stack words; cc=12 in current resident Threads |
| Namespace | capacity `2^(field+13)` words; count is number of slots |

Authority comes from the accessing GT. Namespace fields describe its target.
T may equal a GT during bootstrap but must not be permanently derived from
local GT bits for a networked IDE.

Evidence: `shared/architecture_contracts.json` (`gtWord0`, `nsEntry`);
`simulator/simulator.js:1676–1696` (pack/parse W1), `:1932–1953` (header
decoder), `:2442–2444` (descending slots), `:2562–2610` (entry writes);
`server/boot_image.py:598–627`; `hardware/integrity32.py:33–45`.

### Serialization and address units are separate

| Input/profile | Serialization | Location convention |
|---|---|---|
| Portable `.lump` files | Big-endian 32-bit words | Portable artifact; not a complete destination placement |
| Current `boot-image.bin` | Little-endian 32-bit words | RAM descriptors use word locations in this image |
| Simulator RAM | JS word-indexed memory | Word offsets |
| Wukong UART upload profile | Consult profile-specific image conversion | Byte locations per shared contract |
| MMIO descriptors in current image | Stored as raw 32-bit words | External addresses such as `0x40000014`, not RAM array indices |

Do not byte-swap an address to convert units, and do not multiply MMIO locations
by four as though they were simulator RAM indices. Evidence:
`shared/architecture_contracts.json:isa.nsEntry.locationUnitByProfile`;
`server/boot_image.py:1776,1855,1958`; `simulator/app-lumps.js:5031,5666`.

## 2. Exact current committed RAM map

The image has 64 four-word slots at word offsets `0x3F00–0x3FFF`.
Slot s starts at word `0x4000 - 4*(s+1)`. Multiply by four for byte offsets
within this zero-based RAM image. Ranges below are inclusive.

| Region | Word range | Byte-offset range | Size |
|---|---|---|---|
| Namespace Header V2 | 0000–000F | 0000–003F | 16 words |
| Boot.Thread | 0010–010F | 0040–043F | 256 words |
| WukongCallHome | 0110–050F | 0440–143F | 1,024 words |
| CapabilityTest | 0510–090F | 1440–243F | 1,024 words |
| SelfTest | 0910–110F | 2440–443F | 2,048 words |
| Thread.2 | 1110–120F | 4440–483F | 256 words |
| Thread.3 | 1210–130F | 4840–4C3F | 256 words |
| Gap before table | 1310–3EFF | 4C40–FBFF | Not certified wholly free; includes possible auxiliary/sentinel data |
| Namespace table | 3F00–3FFF | FC00–FFFF | 256 words |

No overlap was found among the decoded resident allocations, physical header
and table. This is not a complete audit of every auxiliary word in the gap.
The current boot selection is slot 10, CapabilityTest. These are observations,
not permission to alter the selected boot inputs.

### Raw occupied descriptors

W0 is shown **as stored**, not normalized to byte addresses.

| Slot | Name | W0 | W1 | W2 | W3 / T |
|---:|---|---|---|---|---|
| 0 | Boot.NS | 00000000 | 000000FF | DEB25EEF | 00000000 |
| 1 | Boot.Thread | 00000010 | 000000FF | DEB256EF | 00000000 |
| 2 | UART_DEV | 40000014 | 00000002 | DEADF4CF | 00000000 |
| 3 | LED_DEV | 40000000 | 00000004 | DEAD3ECF | 00000000 |
| 4 | BTN_DEV | 40000028 | 00000000 | DEADAACF | 00000000 |
| 5 | TIMER_DEV | 4000002C | 00000004 | DEAD28CF | 00000000 |
| 6 | SelfTest | 00000910 | 000007FE | DE56F6EF | 4A000006 |
| 7 | WukongCallHome | 00000110 | 000003FC | DED2B6EF | 4A000007 |
| 10 | CapabilityTest | 00000510 | 000003F4 | DED1B6EF | 4A00000A |
| 11 | Thread.2 | 00001110 | 000000FF | DEBAD6EF | 00000000 |
| 12 | Thread.3 | 00001210 | 000000FF | DEBB56EF | 00000000 |
| 13 | M_BIT_DEV | FFFFFF1C | 00000000 | 21523090 | 00000000 |

All 12 W2 values match the current calculation. Saved ns-state location, limit,
sequence and seal fields match the corresponding raw descriptors in this
snapshot. No claim is made that sidecars can replace raw-image authority.

Boot.NS's stored exact limit is 255, while the physical Namespace header
declares a capacity of 16,384 words. These are different quantities in the
current image; the descriptor alone must not be used to infer RAM capacity
or table size. The new review's requirement that the self-entry agree with
metadata extent needs explicit reconciliation, not copying this old limit.

W3 values in slots 6, 7 and 10 decode as bootstrap GT-shaped values with their
respective slot numbers. The zero W3 values elsewhere mean this image does
not demonstrate a populated T for every target. That must be specified for
foundational and I/O entries in the new map.

### Thread and C-list boundaries

The resident Threads have 256 words, stack count 32 and 12 capability homes.
Relative to each Thread base: header +0, DR homes +1…+16, protected indicator
+17, Heap +18…+211, private stack +212…+243, capability homes +244…+255.
Their root/private-stack execution semantics were not exercised by this audit.
Source: `shared/thread_design.json`, `simulator/thread_design.js`.

Selected executable pre-C-list spans match their pinned portable files:

| LUMP | Allocation | C-list words | Compared words | Mismatches |
|---|---:|---:|---:|---:|
| SelfTest | 2048 | 1 | 2047 | 0 |
| WukongCallHome | 1024 | 3 | 1021 | 0 |
| CapabilityTest | 1024 | 11 | 1013 | 0 |

The saved binary hashes match those exact file bytes. C-list GTs are
destination-localized and were excluded, not assumed equal or fully verified.
The entry limits reflect allocation minus C-list minus one, not simply the
whole physical allocation. Preserve this distinction in any new map.

## 3. Conflicts that block a single new bit-correct map

### A. Critical: proposed address tags cannot be applied to current word locations

The proposed W0 low-bit kinds depend on a word-aligned **byte** base.
Current RAM W0 is a **word** location. For example Boot.Thread raw W0=0x10
means byte offset 0x40 here. Treating it as byte address 0x10 silently moves
the target. Other valid word locations may have nonzero low bits.

Decision needed: an explicit new byte-addressed resident profile and conversion
at every boundary. Validate base alignment before OR-ing a tag; never round
an unaligned input down. Mask the tag before address arithmetic, but include
the tagged W0 in integrity. Nonresident representations need separate handling.

### B. Critical: the review's slot roles are not the current slot roles

Current code/image: 16-word NSH2 header at bottom; slot 0 self, slot 1 Thread,
slot 2 UART. Review: metadata at slot 0, self at slot 1, initial Thread at
slot 2, and no separate 16-word header.

Both use descending four-word slots, but their contents are incompatible.
Migration needs rebuilt slot bindings, GTs, localized C-lists and Thread homes;
relabeling UI rows or moving a header is insufficient. The selected bytes
must remain immutable until an explicitly approved replacement image exists.
Sources: `shared/namespace_header.py:1–23`, current image, review
“Namespace metadata and fixed slots”.

### C. Critical: saved red-text review is stale relative to the conversation

`reports/isa-seven-items-review-proposals.md` still assigns kind to W3,
proposes an extra rotated-W3 integrity term and reuses resolved cache-token
storage for kind. The user's later requirement explicitly retains W3 as T.

Those W3-kind passages are superseded design material, not the latest
authority. The subsequent W0 tag proposal has not been approved or encoded
in the review. This audit does not silently approve it or rewrite that history.
Keep a single active decision table before building a new image.

### D. High: new I/O arrival records are not supported by existing decoders

The general simulator header decoder still interprets cc/count/size using
existing LUMP fields; it has no two-word simple-I/O/framebuffer branch.
Its `valid` flag primarily checks marker bits; specialized consumers perform
further checks. Proposed subtype records must not be passed as ordinary
RAM-backed LUMPs merely because their marker is valid.

Current MMIO entries have numeric descriptors, not evidence of the proposed
two-word definition stream. Sizes, subtype and exact transfer length require
matched IDE emitter, server validator, simulator decoder and hardware support.

### E. High: IDE and simulator currently agree on the old interpretation

The IDE displays raw location, exact W1 limit, integrity and T; current
save/restore paths preserve that ABI. `app-memory.js:2839–2868` explicitly
uses the canonical W1 parser and W3 cache token. `parse_ns_table_raw()` returns
the committed image's raw words rather than synthesizing them from UI fields.
This consistency is useful, but is not conformance to the new review.

The current image proves why T must be retained. The same resident LUMP's
manifest/pinned token can differ from its bootstrap GT-shaped descriptor T.
For example WukongCallHome's selected saved token is `313e637c`, while raw
slot W3 is `4a000007`. Do not treat every field named “token” as the same
namespace or strip one identity merely because bootstrap sometimes equates them.

Static path audit does not establish that an open browser's unsaved design,
loaded simulator state and committed image are identical. The report's exact
map is the committed image above, not a claim about every IDE view at runtime.

### F. High: master authority must be read with its correction preface

The master contains 32 repeated “Church Machine Instruction Set” titles and
historical instruction sections. Its opening authority section explicitly
prioritizes current corrections and rejects retired fused instructions.
Repeated historical CR13/recovery and fused-opcode descriptions must not be
used to override that preface or the review's separately agreed direction.
Neither a broad text search nor a late occurrence alone is a normative spec.

### G. Catalog finding requiring separate investigation

92 distinct manifest-referenced LUMP files have valid header magic and their
file word counts match both the independent decoder and the current simulator
header decoder. The IDE structural checker reports:

- One file with errors: `SlideRule.Haskell.1.3542a2db.lump`.
- RCI: branches at instruction positions 126, 131 and 133 target 141, 144
  and 147, beyond the checker's code range 0…136.
- Eight files have warnings; full messages are retained in the JSON.
- A `PostFlashSelftest` manifest record has no filename. This is incomplete
  catalog evidence, not proof that a particular file was deleted.

The jump report is a checker finding, not a confirmed runtime diagnosis; no
automatic repair was attempted. That file is not one of the three executable
residents compared above. No claim that all catalog LUMPs are release-ready.

## 4. Candidate new map specification — pending approval

Keep identities and authority separate: GT for access, T for IDE LUMP identity,
both retaining their full current widths. Do not require permanent T=GT.

For a new byte-addressed Namespace with base B, capacity C words and N slots:

```text
slot(s).byte_address = B + 4*C - 16*(s+1)
table.byte_range    = [B + 4*(C-4*N), B + 4*C)
RAM.byte_range      = [B, B + 4*C)
```

Require alignment, nonwrapping arithmetic, N>=3 and enough room for table and
the explicit prepared resident allocations. No blanket 64-slot assumption.

| Slot | Proposed review role |
|---|---|
| 0 | Metadata: W0 Namespace header, W1 B, W2 following-member count M, W3 reserved zero |
| 1 | Namespace self-entry |
| 2 | Initial Thread |
| Others | Explicit prepared bindings, not inferred from arrival order |

For resident entries, the **latest unapproved** proposal is:

```text
W0 = aligned_base_byte_address OR kind
kind = 0 ordinary, 1 simple I/O, 2 framebuffer; 3 invalid
W1 ordinary/simple = existing limit[20:0], sequence[29:21], G[30], F[31]
W1 framebuffer     = n[4:0], zero[20:5], sequence[29:21], G[30], F[31]
W2 = existing integrity32(tagged W0, W1)
W3 = T
```

GT permissions and generation checks remain unchanged. Code/C-list/Heap
views retain exact bounds. Framebuffer word offsets must be below 2^n, with
n=0…30 and whole-access/byte-address overflow checks. Save/restore must carry
kind without misusing T. No new term involving W3 is needed merely to bind kind.

For this snapshot's C=16384, N=64, B=0, slot 0 would still begin at byte
0xFFF0, but would contain metadata rather than today's self-entry. Its header
would be 0xF8810100. M cannot be taken blindly from occupied-slot count:
the agreed arriving-member and recursive-stream rules must define it.

The ISA words and their serialization should be specified independently:
retain explicit BE portable-LUMP and LE current-image boundaries unless a
separate migration changes them. Do not call the two formats interchangeable.

## 5. Ordered steps to obtain an implementation-ready map

1. Reconcile the review: retain W3=T; decide the W0 tag proposal and remove
   superseded W3-kind formulas from the active edition.
2. Freeze one byte-addressed profile, including MMIO and overflow rules.
3. Define T population/lookup for every new local entry and nonresident cases.
4. Define member-to-slot and nested-stream rules; resolve the current UART
   slot-2 conflict with the proposed initial-Thread slot.
5. Build an isolated candidate from exact pinned artifact hashes. Check
   physical allocation, exact view limits, embedded content, C-list relocation,
   boot target, Thread homes and all integrity words together.
6. Require IDE/server/simulator decoders to agree on every emitted word.
   Exercise boundaries and tag/permission/generation failures before hardware.
7. Only then seek separately authorized synthesized execution evidence.

No live catalog rewriting, boot regeneration, routing, image programming,
physical-board command or task-completion claim accompanies this audit.
