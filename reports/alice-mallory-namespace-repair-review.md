# Alice and Mallory Namespace repair review

Prepared 2026-09-30. **Read-only proposal; no repair approved or performed.**

This review covers the workspace's persisted state, not a claim about a deployed
server or the physical board. No Namespace, source, LUMP, configuration, image,
or hardware changes were made. Only this review document was added.

## Decision needed

1. Choose Alice placement A or B below, retaining **NS[14], saved revision 2,
   issue 1, `ide.Alice.1.a91d33f7.lump`** exactly.
2. Choose Mallory **D (design only)**, **I1 (install the design-selected
   artifact)**, or **I2 (install the top-level selected artifact)**. These are
   different intentions; none is assumed.
3. Separately authorize the exact Namespace diff and derived-image preparation
   after a fresh, revision-bound review. This document is not an executable
   approval, admission certificate, or authorization to flash hardware.

## Frozen evidence

| Evidence | SHA-256 |
|---|---|
| `server/lumps/ns-state.json` bytes | `28f9d54ff8b9e676aff56a08195ac27afcce0df9aa3f1f04e79155e27e7d696e` |
| Canonical complete Namespace row fingerprint (CAS) | `b30e49e03c6746ad8b435d2a485ac7a9b0485fc9472c43b939989cbaef17a681` |
| `server/lumps/boot-image.bin` | `3a6e48f61785ead0830a22646b89767ec9efa187c9bb3dd8c9c4e3eb1cc3f3af` |
| `server/lumps/boot-image.provenance.json` | `d0f94415348298891803c3110f45738eee1079b7e47e8975df23646eb9df2d46` |
| `server/boot-config.json` | `626c2c001d24eea51ef9b8790670dadb9b6eadf305b3e0de86bfad411f4e7426` |

State has no explicit revision (legacy revision 0). Its
`committed_raw_fingerprint` is
`cef05e1a45da9861d974e53d8727395a6ce45347a13cdda58f053061cdcb49e5`;
this is **not** the complete-row CAS fingerprint.

Read-only command run:

```
PYTHONDONTWRITEBYTECODE=1 python3 scripts/check_namespace_authority.py
```

It failed as expected, reporting:

* `Namespace state: NS[15] design placement cannot carry executable or resident identity`
* `Derived image: validate_boot_image: NS slot 7 [272, 1296) overlaps NS slot 14 [1024, 1280)`

The checker stops at the first image failure. These are confirmed failures,
not an exhaustive admission result. The image provenance also lacks
`namespace_fingerprint`, so relocation alone cannot make the old image valid.

## Memory accounting — full allocations, not access limits

All RAM locations below are **word addresses**, as consumed by the image
validator. Byte offsets equal word addresses × 4. Ranges are half-open:
start included, end excluded. MMIO addresses are device addresses, not RAM
offsets to multiply or relocate.

The actual image is 16,384 words / 65,536 bytes. Its V2 header reserves words
`[0,0x10)` and points to a 64-entry tail table at `[0x3F00,0x4000)`.
Do not interpret its V2 word zero as an ordinary executable allocation header.

| Slot | Name | Current physical word range / device address | Full reserved words | Current policy and proposed effect |
|---|---|---|---:|---|
| 0 | Boot.NS | `[0,0x10)` header; table `[0x3F00,0x4000)` | 16 + 256 | Architectural; unchanged |
| 1 | Boot.Thread | `[0x10,0x110)` | 256 | Resident; unchanged |
| 2 | UART_DEV | `0x40000014`, limit 2 | MMIO | Unchanged |
| 3 | LED_DEV | `0x40000000`, limit 4 | MMIO | Unchanged |
| 4 | BTN_DEV | `0x40000028`, limit 0 | MMIO | Unchanged |
| 5 | TIMER_DEV | `0x4000002C`, limit 4 | MMIO | Unchanged |
| 6 | SelfTest | `[0x990,0x1190)` | 2048 | Resident + boot_resident; unchanged |
| 7 | WukongCallHome | `[0x110,0x510)` | 1024 | Resident + boot_resident; restore full exact selected body in derived image |
| 8 | Tunnel | `[0x510,0x550)` | 64 | Policy absent; zero/unloaded catalog reservation; unchanged |
| 9 | Ethernet | `[0x550,0x590)` | 64 | Policy absent; zero/unloaded catalog reservation; unchanged |
| 10 | CapabilityTest | `[0x590,0x990)` | 1024 | Resident + boot_resident + sole boot marker; unchanged |
| 11 | Thread.2 | `[0x1190,0x1290)` | 256 | Resident; unchanged |
| 12 | Thread.3 | `[0x1290,0x1390)` | 256 | Resident; unchanged |
| 13 | M_BIT_DEV | `0xFFFFFF1C`, limit 0 | Device | **Retain approved NS[13], address and all fields** |
| 14 | ide.Alice | `[0x400,0x500)` | 256 | Resident; relocate only after approval |
| 15 | ide.Mallory | Zero placeholder; no installed body | 0 currently | Contradictory symbolic + Resident; choose D/I1/I2 |

Every existing row has generation `seq=0`; this proposal does not request
generation, slot-membership, permission (`type=Inform`, f=0, g=0), or boot-marker
changes. Unlisted slots remain unchanged, including configuration-only labels.
The 64-word reservations at slots 8–9 are verified from zero image bodies;
their library files are larger (512 words each) but are **not installed**.
Installing either would require another allocation review.

Alice overlaps 256 words of WukongCallHome despite its advertised limit of 9.
The selected Alice file's header says 256 words, cw=8, cc=1; the embedded image
at its old address says cw=9, cc=2. Thus the old embedded body is not evidence
for the selected artifact. Do not move/copy those image bytes as the repair.

### Candidate placements

The occupied boot/thread extent ends at word `0x1390`. The free interval up to
the Namespace table is `[0x1390,0x3F00)` (11,120 words), excluding no additional
installed bodies in this snapshot. Conservative 256-word-aligned candidates:

| Choice | Alice NS[14] range | Byte range | Mallory installed candidate, if chosen |
|---|---|---|---|
| A | `[0x1400,0x1500)` | `[0x5000,0x5400)` | NS[15] `[0x1500,0x1600)`; bytes `[0x5400,0x5800)` |
| B | `[0x1600,0x1700)` | `[0x5800,0x5C00)` | NS[15] `[0x1700,0x1800)`; bytes `[0x5C00,0x6000)` |

Both pairs are disjoint from every full installed allocation and the table.
Both Alice and either Mallory candidate file occupy exactly 256 words / 1024
bytes, verified from big-endian binary headers and file lengths, not sidecar
size hints. These are **spatially safe candidates**, not promises that artifact
identity/admission or subsequent generation will succeed.

## Exact identities and proposed field changes

### Alice — preserve the selected artifact

* NS[14], `ide.Alice`, issue 1, saved revision 2, row token `4730c311`.
* Filename: `ide.Alice.1.a91d33f7.lump`.
* Actual SHA-256 matches the row:
  `22e7a47e1c5f1246796731a46d59e1d0dc92eb4594556c424e56b020cf2a4de0`.
* Before: location `0x00000400`, limit `0x00009`, seal `0xDEAE9EEF`,
  resident=true, load_policy=Resident; boot_resident absent.
* Proposed: location `0x00001400` (A) or `0x00001600` (B).
  Preserve filename, file bytes, hash, token, revision, issue, slot, seq and
  current residency/boot-target status. No source edits or recompilation.
* The generator's extended resident descriptor uses allocation-minus-one:
  proposed limit `0x000FF`, not a claim that the old limit reserved ten words.
  Regenerated descriptor integrity/seal must be calculated and displayed by
  the staged review, not copied from the old location or guessed here.

The differently named catalog Alice artifact
`ide.Alice.1.1eec355e.lump` is **not a replacement candidate** in this review.
The selected filename suffix and row token differ, and the matching selected
sidecar is absent. These are admission questions, not permission to normalize
identity. If the exact selected file cannot pass shared selection/admission
validation, stop and report the failure for a separate decision.

### Mallory — explicit mutually exclusive alternatives

Before (NS[15], seq=0): location=0, limit=0, seal=`0xDEADBEEF`,
symbolic=true, implementationMissing=true, resident=true, load_policy=Resident.
Two different artifact claims coexist:

| Claim | Filename / row token | SHA-256 |
|---|---|---|
| Nested design selection | `ide.Mallory.1.0ca567b5.lump` / `0ca567b5` | `a220c45f71efffa1ef401a99343967964ab402786b3236688f161d297f07427f` |
| Top-level installed claim, issue 1, saved revision 1 | `ide.Mallory.1.fdaed91d.lump` / `04b2913d` | `8a9e5540721dbb9ff2bc1a5f8c8189cfd082d3e86745cb3452d2ea14ec922b32` |

Both files exist and their actual hashes match those claims. Their allocation
sizes match but their bytes do not. The nested choice does not establish a
saved revision number; do not borrow the top-level revision for it.

**D — design only**

* Retain NS[15], name, seq, zero location/limit and both symbolic flags.
* Preserve the complete existing nested `selection`, including status
  `unresolved` and its diagnostic, token, filename and binaryHash.
* Remove top-level `token`, `filename`, `binary_hash`, `issue_n`,
  `lump_version`, `resident`, and `load_policy`.
* No installed body, no Resident policy, no boot marker. Files remain untouched.
  Physical placeholder integrity is regenerated only as required by image
  validation, and must be shown before approval.

**I1 — install the nested design-selected file**

* Keep NS[15], name, seq. Remove `symbolic`, `implementationMissing`, `selection`.
* Set exact filename/hash/token to the nested choice above; issue=1.
  Resolve its saved revision from verified library evidence; do not invent it.
* Set resident=true, load_policy=Resident; no boot marker and no requested
  addition of boot_resident=true.
* Use the Mallory range paired with A or B above; proposed limit=`0x000FF`.
  Calculate/display the new descriptor seal in the approval-bound stage.

**I2 — install the top-level selected file**

* Same placement/policy/flag removal as I1, but preserve its top-level exact
  filename, hash, token, issue 1 and saved revision 1.
* Do not replace it with the nested choice. Its row token/filename suffix
  discrepancy also requires fail-closed admission, not silent rewriting.

If Lazy installation or a different artifact is intended, that is a fourth
proposal requiring its own explicit fields and review, not a reinterpretation
of D or I1/I2.

## Unchanged selected identities and image consequences

These existing selections remain pinned (all issue 1 where explicitly stored):

| Slot | Saved revision | Token | Exact filename |
|---|---:|---|---|
| 6 | 98 | `4a000006` | `SelfTest.1.8b19abd7.lump` |
| 7 | 16 | `4a000007` | `WukongCallHome.1.7fe59019.lump` |
| 8 | 1 | `00001f00` | `Tunnel.1.9381d362.lump` |
| 9 | 1 | `b169bba4` | `Ethernet.1.fc72b0e3.lump` |
| 10 | 34 | `4a00000a` | `CapabilityTest.1.39f77d6e.lump` |

Slots 0–5, 11–13 have no selected file/token fields in the saved rows.
All unchanged row hashes and other metadata are covered by the complete-row
fingerprint above; approval must retain the original rows verbatim unless a
separately displayed generated-descriptor change is accepted.

* Current image is invalid and must not be patched in place or treated as a
  known-good backup. Its raw Alice cache token is zero despite the rich row's
  selected token. Reconstruct from exact selected files, not corrupt overlaps.
* Slot 7's original allocation remains at `[0x110,0x510)`. Removing the Alice
  overlap means restoring the exact selected WukongCallHome body there (subject
  to validated destination-local c-list binding), not zeroing Alice's old range.
* Alice adds 256 correctly placed words beyond the existing boot/thread extent.
  Installing Mallory adds another 256; design-only adds none. Total image
  capacity remains 16,384 words; no RAM resize is proposed.
* A corrected image changes NS[14]'s descriptor and its payload destination;
  NS[15]'s descriptor/payload depends on D/I1/I2. It also restores overwritten
  bytes in NS[7]'s body. Other descriptor changes are not blanket-approved.
* Recompute localized c-lists, descriptor seals, image hash and provenance
  through the normal generator/validator, with the exact current complete
  Namespace fingerprint. Portable LUMP files remain unchanged.
* NS[10] CapabilityTest remains the boot target. Header boot entry byte address
  `0x1640` corresponds to word `0x590`. Neither Alice nor Mallory becomes the
  boot target. NS[13] M_BIT_DEV is never moved.
* No upload, simulator activation, bridge command, FPGA build or flash is part
  of this approval request.

## Approval and execution boundary

No mutation endpoint, web-server application import, image generator, or hardware command was
run to prepare this report. The only validation invoked was the explicitly
read-only authority checker and direct JSON/binary inspection.

After separate explicit approval of an exact choice:

1. Re-read and compare the complete-row fingerprint, exact selected file hashes,
   image/config/provenance hashes, row generations and saved revisions. Any
   drift invalidates this review; do not retry with a newly accepted baseline.
2. Construct the complete proposed rows in private staged storage. Run shared
   `validate_namespace_rows` and the server's
   `_validate_namespace_publication`, symbolic and exact-artifact admission
   checks. Do not bypass a failure to preserve a preferred outcome.
3. Use the existing `POST /api/boot-image/save-ns` protected, fingerprint-bound
   transaction path (`namespaceFingerprint`, `_namespace_commit_guard`) rather
   than direct JSON writes or unrelated boot-marker changes. It stages derived
   image work before atomic publication. Do not commit a partial repair first.
4. Through that path, prepare the derived image only under the separately
   approved operation, validate full body ranges and resident artifact bindings,
   and bind provenance to the final Namespace revision. Review any normalized
   limits, seals, or additional affected rows before committing. If staging
   exposes a broader diff, stop for new approval.
5. Publish only the approved Namespace/image transaction. Verify the read-only
   authority gate against the result and unchanged LUMP/source hashes.
   Hardware delivery remains separately unauthorized.

**Status:** review complete; repair and image preparation intentionally await
explicit approval. Spatial safety is established for A/B, but successful
admission of historical selected artifacts is not asserted.

## Completion-check limitation

The configured completion checks subsequently ran, and task completion was
blocked by `bootstrap-resident-identity-tests`:

```
python3 -m pytest tests/server/test_bootstrap_identity_3321.py tests/server/test_bootstrap_migration_atomic_3321.py -q && node simulator/test_bootstrap_resident_identity.js
```

The Python portion reported 17 failed / 31 passed, so the chained simulator
test did not run. Failures included missing `namespaceFingerprint` in test
save requests and fixture image preparation rejecting slot 15 with
`IDX1 boot/hardware preparation is unsupported`. The latter is an additional
reason not to promise that an installed Mallory choice will produce a usable
derived image. Do not remove ISA/admission checks to force that choice through.
Other configured checks and completion code review passed.

After those checks, all seven recorded state/config/image/provenance and
Alice/Mallory binary hashes were rechecked and remained unchanged. Resolving
the failing test suite required separately authorized work outside this
read-only review.

### Authorized validation-fixture follow-up

Following authorization to investigate the failures, isolated test fixtures
were corrected to supply the current Namespace fingerprint through review and
commit and to exclude unrelated IDE design installations from bootstrap-only
test images. The Namespace-change assertion now expects the precise stale
review rejection. Production validation was not relaxed.

The focused command above now passes: 48 Python tests and the chained simulator
test. The 429 tracked runtime/artifact file hashes checked during this follow-up
remained unchanged. Only test files and this report were updated; the real
Namespace remains invalid and awaiting an explicit repair choice. These passing
fixture tests do not certify either proposed Mallory installation.