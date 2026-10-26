# New Layout — guarded offline hardware candidate

**Not upload-ready. No synthesis, FPGA flashing or hardware command performed.**

The user approved preparing this separate guarded candidate. The saved New
Layout, source LUMPs and prior retained simulator image were not modified.

| Item | Retained value |
|---|---|
| Image | `candidate-le.bin` |
| Size | 65,536 bytes, little-endian words |
| SHA-256 | `866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879` |
| Namespace slot 1 version | 46 |
| Entry-Thread slot 2 version | 419 |
| Expected bitstream guard | 23971 (`(46 << 9) \| 419`) |
| Geometry | 64 ascending slots, metadata at address zero |
| Entry Thread | word 256, 256-word allocation |
| Startup | `ide.ActorManager`, slot 20, unchanged CR0 `0x4a000014` |
| CR0-only change policy | Retain guard, per approved default |

`guard.json` is the retained build input for this isolated candidate, not a
replacement for a production provisioning schema. Versions were independently
sampled once from 0–510. Do not regenerate them during verification or rebuild.

`evidence.json` records every changed word, original artifact hashes, the
resident byte hashes, initial entry-Thread fields, and Namespace descriptors.
Only seven words differ from the pinned simulator image: boot descriptor
versions and seals, plus typed capability rows in slots 10, 18 and 21 referring
to slot 2. No instruction/data scanning or legacy conversion was used.

The source graph still has unresolved selections `ide.Mint`, `ide.PkVerify` and
`ide.MintCleaner`; these were preserved rather than invented or substituted.
No claim of successful program execution is made.

Verification reconstructs the complete candidate from the pinned input and
retained guard; it rejects altered bytes or evidence and never regenerates a
guard:

```sh
python3 scripts/prepare_guarded_new_layout.py \
  docs/phase-1/reload-evidence/new-layout-guarded --verify
```

Focused RTL tests feed these actual metadata words to the geometry/seal reader
and compare their versions against the separately retained build configuration.
Negative fixtures change and re-seal each slot independently; VERSION rejection
must still identify the mismatched slot. These are component-level tests:
ChurchCore/WukongTop integration, full-image execution, loader integration and
physical verification remain pending. No transport framing or byte-order
conversion has been performed on this candidate.
