# General-image local loader

The user approved the focused loader correction after rejecting a separate
approval-authority project. This is local implementation and verification only:
no vendor build, device transfer, flashing, or change to an installed image.

## Authority and integrity

The new mode trusts the programmer's selection under the **existing physical
maintenance authorization**. It does not authenticate the UART sender. Anyone
able to supply bytes during that authorized maintenance window can supply the
image and its hash. SHA-256 verifies transfer consistency, not executable
provenance, safety, or runtime permissions. No signature service or manual
installed-bitstream certification gate is added.

The design-review document's signed-manifest recommendation remains a historical
proposal, not an implementation prerequisite for this explicitly selected mode.
The old CSI1 mode remains the default and retains its two-image allowlist.
The general mode must be explicitly instantiated with `general_image=True`
and an explicit `boot_guard` configuration.

## Expected reset versions

The general mode no longer silently inherits the historical demonstration's
Namespace/Thread pair of 46/419. The expected pair is a validated elaboration
setting, packed as `(namespace_version << 9) | thread_version`. Both halves
must be 0–510; reserved 511 is rejected. CSI1 still uses exactly 46/419 and
rejects an override.

For the bounded Boot2 replay, the explicitly selected local pair is **0/0**.
It is fixed before receiving any image. It is not copied from observed RAM,
accepted from UART, adjusted after a fault, or used to rewrite Boot2. Normal
Namespace-stage and Thread-stage VERSION comparisons still run independently,
and the core constructs its reset capabilities from this same fixed setting.

This is a local source-configuration correction, not a new runtime guard
selection mechanism. Loading a different boot pair still requires a matching
core configuration. No saved guard policy, IDE provisioning, or physical
bitstream has been changed.

## CSI2 wire contract

All control headers are 16 bytes:

| Bytes | Value |
| --- | --- |
| 0–3 | ASCII `CSI2` |
| 4 | BEGIN=1, FINISH=2, START=3, ABORT=4 |
| 5–7 | zero (no image selector in this profile) |
| 8–11 | unsigned epoch, big endian |
| 12–15 | 65,536 for BEGIN, zero otherwise |

BEGIN names the current epoch and increments it when accepted. It is followed
by a 32-byte SHA-256 digest in conventional big-endian order, then exactly
65,536 image bytes, interpreted as little-endian RAM words. The length excludes
the digest prefix. FINISH and START name the new epoch. CSI1 and CSI2 are
mutually rejected rather than silently changing selector meaning.

The actual received RAM is hashed after FINISH. The expected digest, its
completion flag, and the epoch are captured for verification. Complete transfer
and matching SHA lead to READY, with execution still held. Only a separate
authorized START releases the existing guarded ROM/core. Previous admitted
identity is cleared on BEGIN.

Partial transfers, missing digest bytes, UART errors, authorization loss during
replacement, malformed active headers, digest mismatch and stale START cannot
release execution. Existing ordered-word, epoch-exhaustion, write exclusion,
and separate FINISH/START rules remain. No instruction, GT, Namespace descriptor,
or Thread state is rewritten to obtain a pass.

## Bounded compatibility scope

The general mode does **not** enable the demonstration CLP1 receiver: its two
fixed revision records and staging/publication assumptions do not generalize
to arbitrary Namespace images. Combining those records with general mode is
explicitly rejected at construction. This does not implement a new Lazy protocol
or claim Boot2 Lazy execution works.

The retained core, guarded ROM, diagnostic MMIO and 64 KiB address wiring remain
unchanged. They may be incompatible with a prepared image. Replay stops at the
first runtime fault; it does not correct the image or broaden runtime support.

## Reproduction

From the workspace root, with the existing Python dependencies available:

```sh
python3 docs/phase-2/cooperative-retry/run_general_image_tests.py \
  --output generated-artifacts/<fresh-check-directory> \
  --boot2-image generated-artifacts/boot2-offline-check/candidate/boot2.bin
```

Omit `--boot2-image` for the transport/SHA/lifecycle tests only. The runner
refuses to overwrite an existing output. It derives an isolated source snapshot,
runs tests from that directory, and records the test/source configuration.
The Boot2 check drives UART pins through the real receiver and SHA readback,
then observes the real retained core from START. The smaller negative tests
drive the transport byte interface, not UART pins.

No IDE Send control or physical bridge is switched to CSI2 by this change.
That integration and a new bitstream are not implied by local test success.

## Earlier Boot2 result with the historical boot pair

The retained image with SHA-256
`1edceb0e6f1008098ac7a1aebc1c6e1db968d39270dfe509a0974df390f99014`
passed CSI2 receipt and actual-RAM SHA verification, reaching READY without
booting. After the separate START, the retained core reported VERSION (9)
at NIA 0, 22 observed execution cycles after release. Namespace admission and
Thread validation were both still false.

The next incompatibility is the reset boot-pair guard: this retained core
expects Namespace version 46 and Thread version 419; the exact Boot2 descriptors
both encode version 0. Namespace admission fails first. No version was rewritten
and no runtime comparison was bypassed. Boot2 Lazy execution remains untested.

Evidence: `generated-artifacts/boot2-general-admission/boot2-replay.json`.
28 targeted checks passed: 26 transport/SHA/lifecycle checks, one historical
CSI1 UART rejection check, and the exact Boot2 UART/core observation. These are
local RTL results, not evidence of changed or running physical hardware.

## Boot2 replay with the explicit 0/0 boot pair

The unchanged image passed RAM SHA admission, Namespace admission, entry-Thread
validation and activation, and completed guarded boot. Both independent
version comparisons remained enabled.

The first subsequent runtime fault was **SEAL (10)** at byte NIA **0x101c**,
246 observed execution cycles after START. The frozen prepared-image trace map
identifies this as `ide.AmoebaStartup.7`, word `0x17040021`, displayed as
`CALL CR0, CR8[0x0021]`. This identifies the failing instruction, not the reason
for its seal mismatch; that cause has not been diagnosed or corrected.
The replay stopped there without altering image bytes, GTs or runtime checks.

All **42** targeted tests passed, including configuration validation,
independent positive/negative version checks and the exact-byte UART/core
replay. The reproduction command above now uses this explicit local profile.
Evidence and source/test receipt are in
`generated-artifacts/boot2-explicit-boot-guard/boot2-replay.json` and
`generated-artifacts/boot2-explicit-boot-guard/general-image-check.json`.
The earlier 46/419 observation remains historical evidence.

## Seal-fault diagnosis

A local decoded-byte replay reproduced the same SEAL fault at cycle 246 and
NIA 0x101c with unchanged image SHA. Only UART serial decoding was replaced
by a byte driver; transport, received RAM, SHA, boot and core remained real RTL.
This is not additional UART-pin or physical evidence.

The retained decoder treats word `0x17040021` as an indexed CALL through
implicit CR6, row DR0+1, method DR0+1. DR0 was zero. The earlier
`CALL CR0, CR8[0x0021]` text is the prepared disassembler's display, not the
actual retained decoder's operand interpretation.

At the CALL, CR6's base was 0x13f4 with inclusive limit 2. The core read row 1
at 0x13f8 and obtained E-GT `0x4a00000a`, selecting `ide.CapabilityTest` at
NS[10], version zero. It then read descriptor addresses 0xa0, 0xa4 and 0xa8:
location, authority and stored integrity were all zero. No preceding runtime
write touched that descriptor. The expected integrity of (0, 0) is
`0xdeadbeef`, not zero, so the Namespace gate correctly raised SEAL.

The image builder marks Lazy rows unresolved and leaves their descriptors
empty. The retained CALL Lazy path instead requires a valid, sealed descriptor
and allocated LUMP header with code-word count zero; only then can it reach
the code-not-resident handoff. The failure is a prepared-image/retained-runtime
Lazy representation mismatch, not transfer corruption or a shifted descriptor
read.

The smallest correction to assess is preparing the retained runtime's valid
absent-LUMP representation for selected Lazy entries, with explicit bounded
allocation and a zero-code header. Merely writing a seal into an empty slot
would not supply that contract and is not a fix. No image-generation, RTL,
GT, or hardware correction was made during diagnosis. Lazy delivery/publication
compatibility remains unproved.

Diagnostic script and bus/register evidence:
`generated-artifacts/boot2-seal-diagnosis/probe.py` and `evidence.json`.

## Local absent-LUMP candidate

`prepare_lazy_candidate.py` prepares a separate candidate from the verified
retained inputs. It reserves API-only allocation sizes for all eleven selected
Lazy LUMPs, writes sealed descriptors and zero-code headers, and updates the
member count. Bodies and C-lists remain absent; no executable code is installed.
Existing resident allocations, instructions and GTs remain byte-for-byte intact.
The new reservations use 5,056 words and fit the existing 64 KiB image.
The original image and saved design are not modified.

Six preparation tests passed, covering resident preservation, disjoint bounds,
seals/header geometry, hash mismatch, overflow, occupied memory, existing
descriptors and duplicate slots. The existing Mallory warning remains authored
and is not repaired.

The resulting image SHA-256 is
`d565923b951c608042e72c8c491dc823cfaaec1546bc4aed05b99853e112e95d`.
Replay at the decoded-byte transport boundary passed RAM SHA admission and
guarded boot. The CALL passed descriptor integrity and read CapabilityTest's
zero-code header at 0x4400. The first fault is now **ABSENT_OUTFORM (17)** at
NIA **0x101c**, cycle 284, not SEAL.

This is the retained runtime's intentional SYSTEM-originated absent-dependency
fault: startup is executing in slot-2 Boot.Thread, which cannot suspend into
itself to service a Lazy request. No CALL frame or callee capabilities were
published before the fault. Successful Lazy delivery is still unproved.
The next design choice is making startup-required dependencies resident or
moving their calls into USER execution; neither change was made here.

Reproduction:

```sh
python3 -m pytest docs/phase-2/cooperative-retry/test_lazy_candidate.py -q
python3 docs/phase-2/cooperative-retry/prepare_lazy_candidate.py \
  --source generated-artifacts/boot2-offline-check/candidate \
  --output generated-artifacts/<fresh-local-candidate>
python3 docs/phase-2/cooperative-retry/replay_lazy_candidate.py \
  --candidate generated-artifacts/<fresh-local-candidate>
```

Current preparation and replay receipts are under
`generated-artifacts/boot2-lazy-candidate/`. This candidate is not integrated
into IDE preparation or Send; no RTL, vendor build or physical operation was
changed.
