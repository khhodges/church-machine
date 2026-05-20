# Church Machine IDE — Release History

---

## Release 1.3 — 2026-05-16

### GT format — dom+perm3 compression, f_flag per-token, TPERM EXACT

- **GT bit layout** — compressed 6-bit logical perms (`perms[5:0]`) into 4 bits using
  Turing/Church mutual exclusion: `dom[27]` (0=Turing, 1=Church) + `perm[30:28]` (3-bit payload).
  Freed bits allocated to `f_flag[25]` (Far indicator, per-token) and `spare[26]` (reserved zero).
  Old hardcoded word `0x40800002` → `0x48800002` (`dom=1`, Church E-perm).
- **TPERM EXACT** (preset 14) — bit-exact 32-bit identity check: `CRd.word0 == CRs.word0`.
  Sets Z=1 on match, Z=0 on mismatch. Never faults — pure comparison operator for credential
  pinning. Documented in `docs/instruction-set.md` and `docs/isa_reference.md`.
- **NS Word 1 f_flag removed** — `packNSWord1` / `writeNSEntry` / `packLimitWord` in
  `simulator/simulator.js` no longer carry or set the f_flag bit (bit[30]); it is now
  permanently reserved (always 0) in NS Word 1, matching hardware `ctmm_cap_amaranth/layouts.py`
  (`reserved: unsigned(13)` absorbing the former f_flag). Per-token f_flag lives exclusively
  in the GT word at bit[25].
- **Files changed**: `hardware/layouts.py`, `hardware/hw_types.py`, `hardware/boot_rom.py`,
  `hardware/core.py`, `hardware/perm_check.py`, `ctmm_cap_amaranth/layouts.py`,
  `ctmm_cap_amaranth/types.py`, `ctmm_cap_amaranth/perm_check.py`, `ctmm_cap_amaranth/tperm.py`,
  `simulator/simulator.js`, `server/boot_image.py`, `docs/golden-tokens.md`,
  `docs/isa_reference.md`, `docs/instruction-set.md`, `docs/ctmm-memory-map.md`,
  `docs/cloomc-foundation.md`.

### Ethernet abstraction — NS slot 51 added to boot catalog

- **Boot fault fixed**: `INIT_ABSTR mLoad(Ethernet) failed: namespace index 51 out of bounds`.
  Ethernet (token `00003300`, ns_slot 51, static) was present in `manifest.json` but absent from
  `DEFAULT_ABSTRACTION_CATALOG` in `server/boot_image.py` and `_getAbstractionCatalog()` in
  `simulator/simulator.js`. The boot image therefore allocated only 51 NS entries (slots 0–50),
  making slot 51 unreachable.
- **Fix**: added `("Ethernet", {E:1}, False)` at index 51 of `DEFAULT_ABSTRACTION_CATALOG`
  (`server/boot_image.py`; assert updated 51→52) and the matching entry
  `{ label: 'Ethernet', perms: {R:0,W:0,X:0,L:0,S:0,E:1}, chainable: false }` at position 51
  of `_getAbstractionCatalog()` (`simulator/simulator.js`). Boot image now allocates 52 NS
  entries (slots 0–51); nsCount = 52 on load.
- **All test suites remain green**: assembler-tests 913/913, boot-image-matches-sim 6/6,
  fault-recovery-tests 192/192, lump-consistency 126/126, e2e-tests 19/19,
  hardware-sim ALL PASSED.

### PostFlashSelfTest lump (token `5e1f0081`)

- **New floating lump**: `server/lumps/5e1f0081.lump` — 1024-word lump packaging all 81
  post-flash hardware self-tests (Sections A–L of `simulator/examples/post_flash_selftest.cloomc`).
  Token `5e1f0081`, `ns_slot: null`, `ns_slot_policy: "dynamic"`, `cw=512`, `cc=8`.
- **C-list**: slot 3 = E-GT (`0x48810000`, Church dom=1 E-perm), slot 7 = X-GT (`0x40810000`,
  Turing dom=0 X-perm). Matches `LOAD CR2, CR6, 3` and `LOAD CR1, CR6, 7` in the assembly.
- **Method**: `Run()` (offset 0, length 512 words). Returns DR0=0 on full pass; DR0=N (1–81)
  identifies first failing test.
- **Sidecar**: `server/lumps/5e1f0081.json`. Manifest entry added to `server/lumps/manifest.json`.
- **Consistency gate**: lump-consistency 126/126 passed (R1–R12 including the new token).

### Service abstraction c-lists (Task #971)

- **Single-authority model encoded in boot image**: 14 service abstractions (Salvation, Navana,
  Mint, Memory, Scheduler, Stack, DijkstraFlag, Display, Abacus, GC, Thread, Billing,
  TuringMemory, ChurchMemory) now have valid lump headers (`cw=0`, `cc>0`) and correctly
  populated c-list GT tails written into the boot image at cold-boot time.
- **`SERVICE_CLIST_DEFS` table** added to `server/boot_image.py` (line 230) — maps each
  service slot to its POLA-minimum list of capability descriptors (Inform GTs or Abstract GTs).
  `generate_boot_image()` iterates the table after the NS-loop, writes each lump header + c-list
  tail, and corrects NS entry `word1` (`lim17 = lump_size − cc − 1`) and `word2` (seal).
- **Mirrored in `simulator/simulator.js`** `_initNamespaceTable()` — parallel
  `SERVICE_CLIST_DEFS` array at line 1198 uses the same format; applied after the main NS loop
  and Boot.Abstr setup.
- **Authority hierarchy**: Navana (5) sole NS writer — holds R|W token to namespace lump;
  Memory (7) sole physical allocator — calls GC (44) under pressure; Mint (6) sole GT lifecycle
  manager — delegates NS writes to Navana. All other service abstractions reach these three
  exclusively through E-calls.
- **`server/lumps/boot-image.bin` regenerated** to reflect all new c-lists.
- **Files changed**: `server/boot_image.py`, `simulator/simulator.js`,
  `server/lumps/boot-image.bin`.
- **All tests green**: boot-image-matches-sim 6/6, boot-image-loads-and-boots 5/5,
  lump-consistency 299/299, e2e-tests 44/44.

### Keystone lump cc fix (token `50789581`)

- **Dual-file drift corrected**: `server/lumps/50789581.lump` had `cc=0` in its binary header
  (word[0] = `0xF8005800`) while the address-named reference copy `00002000.lump` correctly
  has `cc=2`. This caused the lump viewer CC chip to display `0` for Keystone despite the
  sidecar and manifest recording `cc=2`.
- **Fix**: updated `50789581.lump` binary word[0] from `0xF8005800` → `0xF8005802` (cc: 0→2);
  updated `50789581.json` sidecar `cc: 0 → 2`; updated `manifest.json` entry for token
  `50789581` `cc: 0 → 2`.
- **Files changed**: `server/lumps/50789581.lump`, `server/lumps/50789581.json`,
  `server/lumps/manifest.json`.
- **Consistency gate**: lump-consistency 299/299 passed including R5/R6 three-way cw/cc/lump_size
  agreement for token `50789581`.

---

## Docs 1.2.1 — 2026-05-20

### TPERM documentation correction pass (Release 1.2 definitive design)

Documentation-only correction across four files to match the definitive
Release 1.2 TPERM preset table encoded in `hardware/hw_types.py`.

**Changes**:

- `docs/instruction-matrix.md` — TPERM verification bullet rewritten: codes
  10–12 now described as unconditionally reserved (RSV3/RSV4/RSV5,
  FAULT `TPERM_RSV`); code 13 = FRAME; code 14 = EXACT; code 15 = RSV1.
  Preset table rows 10–15 updated with correct names and rationale.
  B-modifier hardware gap noted in the bullet.

- `docs/instruction-set.md` — Faulting paragraph corrected from
  "codes 11–12 and 15" to "codes 10–12 and 15". Preset table rows 10/11/12
  renamed from LE/SE/LSE to RSV3/RSV4/RSV5. "E isolation" explanatory
  paragraph rewritten: the isolation rule is a **GT creation** rule (enforced
  by Mint and domain-purity checks), not a TPERM preset rule; the former
  LE/SE/LSE names were a design-history artefact.

- `docs/church-instructions.md` — Faulting paragraph corrected from
  "codes 11–15" to "codes 10–12 and 15". B-modifier hardware gap note added:
  bit 4 of the preset field is recognised by the assembler and simulator but
  the hardware decoder currently reads only 4 bits — B-modifier clears the
  GT B-bit in software only until the field is widened to silicon.

- `docs/isa_reference.md` (section A.7) — Rows 0x0A / 0x0B / 0x0C renamed
  from "— (E isolation: LE/SE/LSE)" to RSV3/RSV4/RSV5 with description
  "unconditionally reserved".

No code, binary, or test changes.

---

## Docs 1.2 — 2026-05-15

### Documentation corrections (audit items H-2 and M-1)

- **H-2 — Max lump size** (`docs/Lump-Architecture.md`): corrected Release 1
  maximum from n ≤ 14 (16 384 words) to **n ≤ 13 (8 192 words)**, matching
  `MAX_EXP = 13` in `simulator/app-lump-editor.js`. n = 14 is now explicitly
  noted as architecturally reserved. Mint validation gate updated accordingly
  (`n-6 ≤ 7`). Boot.NS (n = 14, pre-synthesised system lump) separated into
  its own table as a system-level exception not subject to the user size gate.
- **M-1 — mLoad step count** (`replit.md`, `docs/mload.md`): removed the
  "8-step" fixed step count from `replit.md`; replaced with a functional
  description. Added a supersession note to `docs/mload.md` stating that the
  Release 1 PDF `ctmm-r1-10-mload.pdf` title "Five-step capability validation
  pipeline" is superseded — no specific step count is part of the architecture
  definition.

---

## Release 1.2 — 2026-05-14

### Summary

NS table integrity fix. Removes illegal pool NS entries (slots 50-63) written
by a previous task agent, rewrites Constants.Add() to return a plain data value
(not a malformed GT), adds Constants.Get(), and introduces AbstractGTManager as
the correct home for Abstract GT lifecycle tracking.

### Foundational rules enforced

1. NS table is **only** for Inform (gtType=1) and Outform (gtType=2) abstractions.
2. GTs live in c-lists (CRs at runtime, lump c-list area at rest). Never in the NS table.
3. Abstract GT pool memory is internal to AbstractGTManager; no NS entries pierce it.
4. `writeNSEntry()` now rejects gtType=3 (Abstract GT) with a hard fault.

### Changes

#### Simulator JS (scope: no FPGA binaries touched)

| File | Change |
|---|---|
| `simulator/boot_uploads.js` | Removed `pool-W` capability from Constants c-list boot entry; added `Get` method stub |
| `simulator/simulator.js` | Removed pool block from `lazyLoad()` that wrote NS slots 50-63; added `writeNSEntry()` guard (rejects gtType=3); Node.js shim for `AbstractGTManager`; instantiates `abstractGTManager` in constructor |
| `simulator/system_abstractions.js` | Rewrote `Constants.Add()` to Pi pattern (returns plain integer data value, not malformed GT); added `Constants.Get()` method |
| `simulator/app-run.js` | Fixed two import-path field defaults (undefined → 0); clamped localStorage restore to valid range |
| `simulator/app-lumps.js` | Updated pool display section for new Constants.Add/Get interface |
| `simulator/abstract_gt_manager.js` | **New file.** `AbstractGTManager` class — Map keyed by 7-bit `gt_seq`; `createAtoken`, `get`, `release`, `live`, `GC` methods; never touches NS table |

#### Metadata (00001200 / Constants)

| File | Change |
|---|---|
| `server/lumps/00001200.json` | `Add`/`Get` method descriptions updated; `pool_w`/`pool_ns_base`/`pool_size` fields removed; `cc` stays 2 (matches binary header — slot 1 is NULL GT after boot) |
| `server/lumps/manifest.json` | Same pool field removals; `Get` method entry added; `cc` stays 2 |

#### Documentation

| File | Change |
|---|---|
| `docs/plans/ns-table-integrity.md` | New plan doc — foundational rules, AbstractGTManager spec, all 9 fixes |

### Test results

| Suite | Before | After |
|---|---|---|
| lump-consistency | 106 passed | **106 passed** |
| assembler-tests | 862 passed | **862 passed** |
| boot-image-matches-sim | 6 passed | **6 passed** |
| boot-image-loads-and-boots | **5 failed** (pool wrote NS slot 50, pushing nsCount to 51) | **5 passed** |
| fault-recovery-tests | 192 passed | **192 passed** |

---

## Release 1.1 — 2026-05-03

### Summary

LUMP metadata integrity overhaul. Establishes automated consistency gate,
formalises the floating-lump concept as a first-class architectural pattern,
and introduces formal change control (this document).

### Changes

#### Metadata corrections

| File | Change |
|---|---|
| `manifest.json` — TestBoundary (00006000) | `cw` 0 → 1, `cc` 0 → 9 (was stale; binary had real code and 9 c-list slots) |
| `manifest.json` — TestLazy (00006100) | `cw` 0 → 1 (binary had a LOAD instruction) |
| `manifest.json` — TestConsistent (00006200) | `cw` 0 → 1, `cc` 0 → 1 (binary had real code + live LED Abstract GT in c-list) |
| `manifest.json` — TestInconsistent (00006300) | `cw` 0 → 1, `cc` 0 → 1 |
| `manifest.json` — WordString (ab1e86af) | `cw` 281 → 294 (manifest was 13 words behind the compiled binary) |
| `00006000.json` sidecar | `cw` 0 → 1, `cc` 0 → 9 |
| `00006100.json` sidecar | `cw` 0 → 1 |
| `00006200.json` sidecar | `cw` 0 → 1, `cc` 0 → 1 |
| `00006300.json` sidecar | `cw` 0 → 1, `cc` 0 → 1 |

#### File removals

| File | Reason |
|---|---|
| `server/lumps/00000003.json` | Orphan sidecar. Described a historical 256-word, cc=18 Boot.Abstr that no longer exists. No matching `.lump` on disk. Server already ignored it in favour of `00000300.json`. |

#### New sidecar files created

Six manifest entries had no per-lump `.json` sidecar. Sidecars created:
`00000c00.json` (LED), `00001000.json` (SlideRule), `00001001.json` (SlideRuleHS),
`00001f00.json` (Tunnel), `00130000.json` (Loader), `00002000.json` (Keystone).

#### Schema additions (manifest.json)

| Field | Applies to | Meaning |
|---|---|---|
| `variant_group` | SlideRule, SlideRuleHS | Both share `"variant_group": "sliderule"`. Two entries may claim the same `ns_slot` if and only if they share a non-null `variant_group`. The boot image installs exactly one at a time; the other is an alternative implementation. |
| `ns_slot_policy` | WordString | `"ns_slot_policy": "dynamic"` — formally declares the floating-lump pattern (see Architecture section below). |

#### Architecture: floating lumps formalised

A **floating lump** is a lump with `ns_slot: null` and `ns_slot_policy: "dynamic"`.
It has no fixed NS slot at boot. The Loader fetches its binary on first use,
Mint allocates an ephemeral NS slot, and the lump is installed there. The slot
number may differ between runs. The caller holds a GT — not a slot number —
so the slot's ephemerality is invisible to callers.

WordString (ab1e86af) is the prototype. Any abstraction that is not on the
cold-boot critical path should be a floating lump to conserve NS table space.

Slot-assignment rule (machine-enforceable):

| `ns_slot` | `ns_slot_policy` | Classification |
|---|---|---|
| integer | absent | Boot-resident — fixed slot, placed by boot image generator |
| `null` | `"dynamic"` | Floating — allocated by Mint on first use; may be evicted |
| `null` | absent | **Error** — caught by R9 in the consistency test |

#### Automated consistency gate

New test file: `tests/lump/test_lump_consistency.py`

Eleven rules enforced on every run:

| Rule | What it checks |
|---|---|
| R1 | Every `.lump` has valid header magic (0x1F) |
| R2 | File size in words == header-declared lump_size |
| R3 | Every `.lump` token has a manifest.json entry |
| R4 | No orphan sidecar `.json` without a matching `.lump` |
| R5 | manifest.cw / cc / lump_size == binary header |
| R6 | sidecar.cw / cc / lump_size == binary header |
| R7 | sidecar fields agree with manifest where both exist |
| R8 | No duplicate ns_slot values unless all claimants share a `variant_group` |
| R9 | ns_slot=null entries carry `ns_slot_policy: "dynamic"` |
| R10 | Every manifest entry with lump_size has a `.lump` file on disk |
| R11 | Every manifest entry with lump_size has a sidecar `.json` on disk |

#### Documentation updates

`docs/CM_LUMP_SPECIFICATION.md`, `docs/Lump-Architecture.md`, and
`docs/json-information.md` bumped from v1.0 to v1.1. Floating-lump concept
and updated schema fields added to all three.

---

## Release 1.0 — 2026-04-29

Initial documented release.

- Lump binary format specified: header word `[31:27]=magic [26:23]=n-6 [22:10]=cw [9:8]=typ [7:0]=cc`.
- manifest.json schema defined covering `token`, `abstraction`, `ns_slot`, `lump_size`, `cw`, `cc`, `methods`, `grants`, `capabilities`.
- Boot image generator (`server/boot_image.py`) producing 65 536-byte image with NS table at `memory.length - 0x400`.
- Boot-resident lumps: Boot.Abstr (NS[3]), LED (NS[12]), Constants (NS[18]), Loader (NS[19]), Tunnel (NS[31]), Keystone (NS[32]).
- Test lumps: TestBoundary (NS[96]), TestLazy (NS[97]), TestConsistent (NS[98]), TestInconsistent (NS[99]).
- WordString (ab1e86af) present in repository with `ns_slot: null` (undocumented floating pattern).
- Editor source persistence implemented (localStorage auto-save per NS slot).

---

## Change Control Rules — effective Release 1.1

The following rules apply to every commit touching a lump binary, manifest,
or sidecar from this release onwards. No exceptions.

### Rule 1 — Consistency gate must pass

`tests/lump/test_lump_consistency.py` must pass (all 11 rules, zero failures)
before any lump-related change is merged.

To run locally:
```bash
python -m pytest tests/lump/test_lump_consistency.py -v
```

### Rule 2 — Binary change requires metadata update

Any recompilation or hand-edit of a `.lump` binary that changes `cw`, `cc`,
or `lump_size` MUST be accompanied by:

1. An update to the matching `<token>.json` sidecar.
2. An update to the `manifest.json` entry for that token.
3. Both changes in the same commit as the binary.

### Rule 3 — New lump requires three files

Adding a new lump to the repository requires:

1. `<token>.lump` — the binary.
2. `<token>.json` — the sidecar (at minimum: token, abstraction, ns_slot or ns_slot_policy, lump_size, cw, cc, grants).
3. An entry in `manifest.json`.

If the lump is floating (no fixed boot slot), `ns_slot` must be `null` and
`ns_slot_policy` must be `"dynamic"`.

### Rule 4 — NS slot collision requires variant_group

If two lumps claim the same `ns_slot` (alternative implementations), both
entries MUST carry the same non-null `variant_group` string. The consistency
test (R8) enforces this.

### Rule 5 — CHANGELOG entry required

Every structural change — new lump, binary rebuild, schema field addition,
metadata correction — MUST add an entry to this file under the current
release heading before the change is considered complete.

### Rule 6 — Spec documents bump version

If a change affects the manifest schema, the lump header format, or the
floating-lump policy, the version line in the affected spec document
(`CM_LUMP_SPECIFICATION.md`, `Lump-Architecture.md`, `json-information.md`)
must be bumped to the new release number.
