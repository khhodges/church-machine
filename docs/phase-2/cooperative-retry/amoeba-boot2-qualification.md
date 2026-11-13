# Amoeba against the actual Boot2 selections

## Boundary

This is an offline qualification, not permission to install or flash anything.
The original 64 KiB Boot2 image, saved Namespace, saved review LUMP and installed
hardware are inputs only. No instruction translation or dependency preloading
is performed.

The source is the manifest-verified retained Boot2 selection under
`generated-artifacts/boot2-offline-check/candidate`. Its original image SHA-256
is `1edceb0e6f1008098ac7a1aebc1c6e1db968d39270dfe509a0974df390f99014`.
The saved `ide.Amoeba.1.0c3e9bc9.lump` is pinned to
`ab367d8598b585e01f6b9b664316865a78655bfe05ad93a1052020073c7dbcba`.
No fresh compilation substitutes for that review artifact.

## Private preparation

The three images retain the actual Namespace, three Thread allocations and
device descriptors. Only in the disposable image, Amoeba replaces the old
AmoebaStartup at slot 21. Its full 2,048-word saved allocation is retained;
only its six declared C-list bindings change. The boot version pair remains
0/0, not the earlier synthetic fixture's 46/419.

All eleven selected dependencies are localized using authenticated binding
snapshots in a temporary directory. Their API-only execution forms retain
instructions and C-list semantics; source text is removed and geometry adjusted
by the existing `api_only` helper. The receipt records source, full-localized,
and little-endian execution hashes separately.

Every dependency initially has a sealed descriptor and absent-code header,
with all remaining body words zero. Private grants at slots 32–42 cover
exactly the corresponding destination allocations; a 64-row table at slot 22
has NULL in every other row. Receiver/control descriptors use slots 23/24.
No Namespace write grant is added to Amoeba.

| Storage | Byte range, end exclusive |
|---|---|
| Namespace and three Threads | 0x0000–0x1000 |
| Saved Amoeba | 0x1000–0x3000 |
| Private target table | 0x3000–0x3100 |
| SelfTest | 0x3100–0x4100 |
| WukongCallHome | 0x4100–0x5100 |
| Mint | 0x5100–0x6100 |
| CapabilityTest | 0x6100–0x6900 |
| PkVerify | 0x6900–0x6a00 |
| MintCleaner | 0x6a00–0x7200 |
| Alice | 0x7200–0x7400 |
| Mallory | 0x7400–0x7600 |
| AliceDriver | 0x7600–0x7a00 |
| MalloryDriver | 0x7a00–0x7c00 |
| ActorManager | 0x7c00–0x8000 |
| Receiver staging | 0x8000–0x9000 |

SYSTEM starts Amoeba with CapabilityTest's slot and E-GT. Independent Alice
and Mallory probes skip SYSTEM startup to measure the USER Lazy path separately.
Each selects its actual Thread and actor using the saved Amoeba UserStart entry.
These are **single-USER component probes**, not evidence of a completed startup
or concurrent two-USER scheduling. The other Thread remains present, not
silently removed.

## Static mismatches retained

- Mint lacks selected bindings for MintState, MintScratch, MintPool,
  MintV4Verifier, MintNamespace and MintApproval.
- MintCleaner lacks CleanerState and CleanerPool. Those references remain
  NULL; no authority is invented to make qualification pass.
- The existing validator warns about an out-of-range C-list index 2 in a
  two-row selected artifact. Runtime checks remain authoritative.
- Boot2 UART_DEV includes address `0x4000001c`, overlapping the local receiver.
  BTN_DEV at `0x40000028` and TIMER_DEV starting at `0x4000002c` overlap the local
  Amoeba receiver/control map. Device descriptors are not relocated to hide
  the incompatibility. This is an integration blocker even if an early probe
  does not exercise those addresses.
- The saved loader supports one optional SYSTEM target and one USER. It does
  not rewrite nested SYSTEM CALLs to insert EnsureResident.

## Reproduction

### Obtain the historical inputs first

A clean checkout contains the reviewable JSON evidence in
[`evidence/amoeba-boot2/`](evidence/amoeba-boot2/), but not the historical
binary inputs or full RTL source snapshot. Those are not reconstructible
from the current live Namespace or current compiler without changing the
experiment. There is no public download URL for these private inputs.

Obtain an unchanged copy of these paths from the originating workspace owner
(or their workspace backup), preserving the relative paths:

1. `generated-artifacts/boot2-offline-check/candidate/`, **including all**
   hidden binding snapshots, private LUMPs, source artifacts, saved/resolved
   designs, `prepared.json`, `boot2.bin` and `manifest.json`.
2. `generated-artifacts/amoeba-boot2-rtl/`, including
   `starter-source-manifest.json` and every file it lists.
3. `server/lumps/ide.Amoeba.1.0c3e9bc9.lump`.

For example, with a read-only mounted copy of the original workspace, copy
those directories/files into the same paths in a **fresh offline checkout**.
Do not copy into a running IDE's LUMP directory or replace existing inputs.
The tracked `input-manifest.json` and `starter-source-manifest.json` list
every required input and its digest, so the owner can supply just those files.
The independently pinned manifest digests are:

- Boot2 input manifest:
  `eb5b4b66406491c287d722251a7e14560bd8f5a07658f76ecc018a37d97b572f`
- RTL source manifest:
  `b478e4bb67ddfb55f6098f18f5f0f44204b2115e5b31494a1bed15f8bdedc8cc`

Both guards reject a replacement manifest even if it consistently describes
replacement files. Preparation separately pins the original image and saved
Amoeba binary. Missing historical inputs are a reproduction blocker: ask the
workspace owner for the exact files, rather than regenerate them from live
selections or change the pins.

### Run the qualification

Use fresh output directories; existing evidence is never overwritten:

```sh
python docs/phase-2/cooperative-retry/qualify_amoeba_boot2.py \
  --output generated-artifacts/amoeba-boot2-NEW
for mode in system alice mallory; do
  python docs/phase-2/cooperative-retry/replay_amoeba_boot2.py \
    --candidate generated-artifacts/amoeba-boot2-NEW \
    --rtl generated-artifacts/amoeba-boot2-rtl --mode "$mode"
done
python -m pytest docs/phase-2/cooperative-retry/test_amoeba_boot2.py -q
```

Alternatively, `prepare_starter.py --output <fresh-generated-artifacts-path>`
can derive the RTL snapshot if its older retained parent packages are already
available. This is optional, not a prerequisite when the exact pinned snapshot
has been supplied. Replay enforces the resulting manifest hash either way.

The replay uses decoded UART bytes, real image and staging RAM SHA checks,
guarded boot and retained RTL instruction execution. Host delivery follows
actual requests and supplies only the selected hashed words. Native writes
are checked for exact-body, header-last publication. A first runtime fault
ends that probe; it is never bypassed. No UART-pin, synthesis, timing or
physical-board acceptance follows from these tests.

## Retained RTL result: not qualified for Boot2

The machine-readable final evidence is committed under
[`evidence/amoeba-boot2/`](evidence/amoeba-boot2/): `preparation.json`,
`system-replay.json`, `alice-replay.json`, `mallory-replay.json`, and both input
manifests. The preparation receipt includes all eleven exact localized word
arrays, grant/binding provenance, memory ranges and image digests. It is a
direct copy of the original run receipt, not a reconstructed result summary.
The generated images remain in `generated-artifacts/amoeba-boot2-final/`
and can be recreated with the pinned input files above. The RTL snapshot is
`generated-artifacts/amoeba-boot2-rtl/`; its source-manifest SHA-256 is
`b478e4bb67ddfb55f6098f18f5f0f44204b2115e5b31494a1bed15f8bdedc8cc`.

All three exact images passed real RAM SHA admission and guarded boot.

| Probe | Observed result |
|---|---|
| SYSTEM startup | Requested slot 10, transaction 1. Amoeba natively copied all 512 CapabilityTest words exactly and published its header last. Receiver reached CONSUMED. Execution then faulted `0x11 ABSENT_OUTFORM` at byte NIA `0x6164`, CapabilityTest word +25 (`0x17040021`). No other target was published. |
| Alice USER | First CHANGE at Amoeba byte NIA `0x102c` (`0x27008000`) faulted `0x1d THREAD_CONTEXT`. No LLR handoff, receiver request, target write or publication occurred. |
| Mallory USER | Same `0x1d THREAD_CONTEXT` at `0x102c`, before any LLR handoff or delivery. |

Final image SHA-256:

- SYSTEM: `722244d7daa7543341966d8dd06c28432b338a03bb91ccd9f26c22c12186ad52`
- Alice: `1e9bd6c03c6ea6ae8f55ec5c7b14e52226479e5e8ad2986a5d75b3844fe42c16`
- Mallory: `b3523e63a7741bdbe1ae4edc826c1e1f4e0f2c98505abdb05a25fb42f8c63025`

The USER probes use the original Thread indicator to locate the active
continuation; they preserve the older root frame. Earlier exploratory images
in `amoeba-boot2-qualification` used the synthetic fixture's root-frame offset
and are superseded, not acceptance evidence.

`THREAD_CONTEXT` is a shared validation category. These observations locate
the failure at first USER activation, but do not identify its individual
internal validation predicate. Zero fault-instruction/GT telemetry fields in
the retained core are not proof of a NULL operand; instruction words above
come from the admitted exact images. No context, permission or seal gate was
relaxed to continue past the fault.

Five preparation safety tests passed: exact selections/input preservation,
saved code/private grants, disjoint allocations/device and continuation
preservation, honest unresolved bindings, and changed-review rejection.
All three RTL probes completed and retained their **negative qualification**
results. This does not claim that all eleven targets executed: SYSTEM's
downstream chain and USER Lazy delivery remain blocked at the first faults
above. The saved Namespace, original image, review artifact, installed
hardware and bitstreams were not modified.

Four additional handoff checks pass: independently pinned Boot2 manifest,
independently pinned original image, independently pinned RTL manifest, and
consistency of the committed receipts with those pins. This makes **nine**
preparation/evidence checks in total. These guard-only changes do not alter the
previously measured images or RTL; the retained replay results remain valid.
