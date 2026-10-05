# Archived LUMP integrity forensics

## Scope and result

Read-only investigation on 2026-10-04, at repository HEAD
`e2cb18ea9846894e7602275ab29188f39c3d0f90`.
All artifact paths below are relative to `server/lumps/`.
No saved binary, symlink, approval, manifest, Namespace, boot image, RTL,
firmware, or integrity test was changed. This report is not an approval to
repair or adopt anything.

The reported failures reproduce exactly:

- **16 R20 failures across eight manifest-referenced archived paths.**
  Four legacy-format names each fail three checks (12 failures); four
  canonical names each fail the content-number check (4 failures).
- **Two coverage failures for the same three SelfTest files**, not six
  additional artifacts.
- The four canonical mismatches are **proven historical path replacement**:
  Git records regular binaries becoming symlinks to newer binaries.
  This is not merely an inference from a short hash mismatch.
- The four legacy-format archives retain their first-committed bytes.
  Their manifest binary hashes agree with those bytes. Their naming and
  approval-locator problems are distinct from byte replacement.
- The three unlisted SelfTest files are identical, unchanged historical
  binaries whose manifest records were removed together. Their filename
  content numbers are correct.
- **All four replaced historical payloads are recoverable exactly**, from
  regular local tracked archives and from original Git blobs. Recovery of
  bytes is not proof of current executability or authorization to restore.

## Method and limits

Inspected `tests/lump/test_lump_consistency.py`, current manifest and
`approvals.json`, Git path history/modes/blobs, and regular local `.lump`
files. Computed:

```text
binary_hash = SHA256(raw file bytes)
Number      = SHA256(dot_name UTF-8 || raw file bytes)[0:8]
```

All examined payload sizes are multiples of four, so this agrees with R20's
whole-word calculation. Used `git show REV:path` to read old bytes without
checking out or restoring files. A Git mode-120000 blob contains the link
target text, not LUMP bytes; it must not be treated as a recovery payload.
Local current-path hashes in this report follow symlinks, as R20 does.

Approval evidence here means equality with the repository's exact full
SHA-256 ledger record and its recorded filename/identity. No secrets were
accessed, signatures newly issued, or current compiler/runtime admission
claimed. Historical repository evidence establishes observed transitions,
not the particular process or user action that caused them. No external
backups, deployment data, or hardware were consulted.

## 1. Legacy-format archives: retained bytes, noncanonical locators

All four rows have `archived: true`, `dot_name`, `issue_n: 1`, and a
`binary_hash` equal to the actual bytes. All are regular files, with one
path-history commit each and byte-for-byte equality to that first blob.

| Archive | History version | Bytes | Recomputed Number | First recorded commit | Current hash-ledger filename |
|---|---:|---:|---|---|---|
| `CapabilityTest_v31.lump` | 31 | 4096 | `8efa26a3` | `ffeeac40` (2026-09-19) | `CapabilityTest.1.8efa26a3.lump` |
| `SelfTest_v97.lump` | 97 | 8192 | `8b19abd7` | `f5eaf5fd` (2026-09-22) | `SelfTest.1.8b19abd7.lump` |
| `WukongCallHome_v13.lump` | 13 | 4096 | `ba8b8e76` | `af816091` (2026-09-22) | `WukongCallHome.1.ba8b8e76.lump` |
| `WukongCallHome_v14.lump` | 14 | 4096 | `ba8b8e76` | `7a056c3d` (2026-09-22) | `WukongCallHome.1.ba8b8e76.lump` |

Full binary digests:

```text
CapabilityTest_v31:
5ade31ec3dff80e622242d889566d24ce301a43ce69c6597669fa9bff9e0e4d3
SelfTest_v97:
65f6e254b1f0a164f2d2163239f28e4521d792d8d96800b26cdbff607f77b5de
WukongCallHome_v13 and v14:
5ceb0eafe823710de8c682e3399fc5aed3313ad5f00ebc5e2f3b290b1b19ef01
```

The ledger has records keyed by these digests, but **none names the `_vN`
path**. In particular, the CapabilityTest ledger names a canonical path that
now redirects elsewhere (section 2); this does not invalidate the surviving
`_v31` bytes as an exact recovery source.

WukongCallHome versions 13 and 14 are separate manifest history events with
different timestamps/operation IDs, but identical bytes. One digest-keyed
approval cannot establish two independent filename-bound approval events.
Do not collapse those history events or infer corruption from duplication.

R20's disk-presence failures for these four files are misleading if read
alone: the test rejects the filename format before checking the disk.
The files are present. R20 deliberately applies to archived rows with
`dot_name`, so archived status does not make these checks optional.

**Recoverability:** payloads are already preserved and independently
available from Git. The unresolved issue is how to represent historical
locators and canonical approval identity without rewriting their history.
No evidence of post-commit byte replacement was found for these four paths.

## 2. Canonical names replaced by symlinks

Every row below is archived in the current manifest. None of these four
manifest rows currently carries `binary_hash`; the full expected digest
comes from the approval whose `filename` exactly names that historical path.

| Historical path | Version | Present link target | Number of resolved bytes |
|---|---:|---|---|
| `Adder.1.e437ee2c.lump` | 405 | `Adder.1.0f63efe0.lump` | `0f63efe0` |
| `CapabilityTest.1.3dad236a.lump` | 30 | `CapabilityTest.1.8efa26a3.lump` | `3f7e1c54` |
| `CapabilityTest.1.8efa26a3.lump` | 32 | `CapabilityTest.1.3f7e1c54.lump` | `3f7e1c54` |
| `SelfTest.1.9beaf6e7.lump` | 96 | `SelfTest.1.8b19abd7.lump` | `8b19abd7` |

The CapabilityTest v30 path forms a two-link chain; its visible content
changed again when the intermediate v32 path became a link.

| Historical path | Original regular-file commit | Replacement commit (mode 100644 → 120000) | Verified regular local recovery copy |
|---|---|---|---|
| `Adder.1.e437ee2c.lump` | `cfdcc0ff` (2026-09-13) | `9794fb3c` (2026-09-16) | `Adder_v405.lump` |
| `CapabilityTest.1.3dad236a.lump` | `9e9cadf1` (2026-09-18) | `fc568359` (2026-09-19) | `CapabilityTest_v30.lump` |
| `CapabilityTest.1.8efa26a3.lump` | `fc568359` (2026-09-19) | `fda06115` (2026-09-22) | `CapabilityTest_v32.lump` (also `_v31`) |
| `SelfTest.1.9beaf6e7.lump` | `cf0e7823` (2026-09-20) | `f5eaf5fd` (2026-09-22) | `SelfTest_v96.lump` |

For each recovery copy, the full digest equals both the original Git
regular-file blob's SHA-256 and the ledger record for the historical
canonical filename. Recomputed Numbers equal the historical filename
suffixes. Recovery therefore does not require recompilation, guessing,
reapproval, or adoption of a newer revision.

```text
Historical filename                Expected approved binary SHA-256
Adder.1.e437ee2c.lump
  0ce8213c13afb43932941aa0551444f40409ea96af69cfa315ec59c19325c14b
CapabilityTest.1.3dad236a.lump
  2fc18b2411234ab1b41f9749bbc5b25bea8e8d39798f4312853ab99eb7fb6c68
CapabilityTest.1.8efa26a3.lump
  5ade31ec3dff80e622242d889566d24ce301a43ce69c6597669fa9bff9e0e4d3
SelfTest.1.9beaf6e7.lump
  d2a9819251d0493b440681bedb8dab2646e84ff70289c90126c7ed51055441b2

Present resolved bytes:
Adder.1.e437ee2c.lump
  4e2a163e7c8e1c4f1174cf50fa49631a251c6037619cade8a10d38fc7c40dd21
Both CapabilityTest paths
  68a4971ba81f9158bad4a2b0351d11b946852f1e516087c179dff21ab75f2be6
SelfTest.1.9beaf6e7.lump
  65f6e254b1f0a164f2d2163239f28e4521d792d8d96800b26cdbff607f77b5de
```

The resolved bytes have ledger records naming their newer canonical files,
not the old filenames. Thus a successful hash lookup for the resolved bytes
does not vindicate the old history path. These are provenance violations,
not harmless aliases. The original payloads survived, so “lost history”
would overstate the evidence; “historical path redirected” is precise.

## 3. Three unlisted historical SelfTest files

`SelfTest.80.f37bafd6.lump`, `SelfTest.84.f37bafd6.lump`, and
`SelfTest.86.f37bafd6.lump` are tracked regular 32768-byte files, identical
to one another and to each respective first-committed blob. All recompute
to Number `f37bafd6`, with full SHA-256:

```text
efa0e4323679355a530f0ce9bcf8cf19f962204bba7a45b543ca308f1ece17d7
```

Repository chronology:

1. `5f97f319` (2026-09-08): `.84` appears as a non-archived manifest row
   with token `4a000006`, history version 84. The digest-keyed ledger names
   `.84`, with `issue_n: 84`.
2. `2f50629b` (2026-09-10): `.80` is non-archived, `.84` archived.
   The same digest's ledger record now names `.80`, with `issue_n: 80`.
3. `268f20d4` (2026-09-14): `.86` is non-archived; `.80` and `.84`
   are archived. The ledger record now names `.86`, with `issue_n: 86`.
4. Immediately before `43f910b8`, **all three** manifest rows are archived,
   with `variant_group: selftest-history` and history versions 80/84/86.
5. `43f910b8` (2026-09-16) removes all three manifest rows. The binaries
   remain tracked. The ledger still names `.86`; that remains true today.

This establishes a metadata/reference loss, not a content-number mismatch
or a demonstrated binary replacement. The approval ledger's successive
filename/issue changes are also real historical metadata changes: identical
bytes do not prove that all three identities are simultaneously approved.
The old manifest rows omit `issue_n`; do not silently infer identity from
their history version when reconstructing provenance.

R3 and R25 see canonical-shaped files, not `_vN`/`-vN` archive patterns.
No current manifest filename or represented-binary match accounts for
these bytes. Both checks therefore report the same three files.
`docs/namespace-plan-contract.md` also contains `.86` in an example; that
documentation reference is not a live manifest entry or admission evidence.

**Recoverability:** binaries, deleted manifest rows, and successive approval
snapshots survive in Git. There is no need to regenerate bytes. Restoration
of historical discoverability still needs an explicit policy for the
single-digest/multiple-historical-locators case; copying the `.86` approval
onto `.80` or `.84` would invent evidence.

## Proposed correction strategy — not executed

1. **Preserve evidence before any separately authorized repair.** Record
   current link text, original blobs, full hashes, exact manifest rows,
   approval snapshots, and affected revision events. Keep current artifacts
   and all Namespace/boot/firmware state out of the repair.
2. **For the four redirected canonical paths**, propose a narrowly reviewed
   recovery using only the verified original bytes above. Any authorized
   restoration must preserve the displaced link evidence, match both the
   full historical approval hash and Number, retain the existing approval,
   and leave newer targets unchanged. Perform no automatic adoption or
   current-execution validation bypass. Recompiling old source is not
   recovery of an immutable artifact.
3. **For legacy names**, first agree on an explicit immutable historical
   locator/provenance representation. Preserve each recorded filename and
   history event, verify full payload hashes, and distinguish an archive
   locator from a filename-bound canonical approval. If new canonical
   copies are later authorized, they must be additive and retain the exact
   original evidence; do not rename historical files or rewrite past
   approval records. This requires a reviewed contract change, not a
   blanket R20 archive exemption or stripping `dot_name` to evade R20.
4. **For the three SelfTest orphans**, propose recovering their exact
   historical reference records from `43f910b8^` into the approved history
   representation, with explicit inactive status and the corresponding
   historical approval snapshots. Do not reinstate them as live entries,
   infer new ownership issues, or alter current approvals to accommodate
   aliases. Evaluate duplicate-token and filename-bound identity rules
   before any metadata repair.
5. **Keep release checks failing until actual invariants are satisfied.**
   A future history-aware check must validate historical references and
   exact digest evidence, not skip mismatches. Cover regular→symlink
   replacement, multi-link drift, duplicate-payload history events, and
   historical reference removal. Confirm all active selections and
   executable outputs remain unchanged.

Do **not** follow R20's generic “rerun `scripts/migrate_lump_names.py`”
suggestion here. That migration reads the currently resolved bytes and
describes renaming plus compatibility symlink creation. Applied blindly,
it could canonize the newer payload under the historical event rather than
recover the originally approved payload.

## Verification and reproduction

Ran the focused read-only checks (no pytest cache or bytecode writes):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider \
  tests/lump/test_lump_consistency.py::TestR20_CanonicalFilenameIntegrity \
  tests/lump/test_lump_consistency.py::TestR3_LumpHasManifestEntry \
  tests/lump/test_lump_consistency.py::TestR25_GitTrackedLumpsInManifest \
  -q --tb=no
```

Result: **18 failed, 33 passed**. The failures are the expected 16 R20 and
two coverage failures described above; they are intentionally unresolved.
This was not a run of the full release suite.

Useful read-only reproduction commands:

```sh
git log --format='%h %ad %s' --date=iso -- server/lumps/Adder.1.e437ee2c.lump
git ls-tree cfdcc0ff -- server/lumps/Adder.1.e437ee2c.lump
git ls-tree 9794fb3c -- server/lumps/Adder.1.e437ee2c.lump
git show cfdcc0ff:server/lumps/Adder.1.e437ee2c.lump | sha256sum
sha256sum server/lumps/Adder_v405.lump
readlink server/lumps/Adder.1.e437ee2c.lump
git show 43f910b8 -- server/lumps/manifest.json
git show 43f910b8^:server/lumps/manifest.json
```

No repair command was run. No application behavior changed, so no server
restart, UI test, or hardware operation was needed.