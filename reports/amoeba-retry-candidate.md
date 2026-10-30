# Isolated Amoeba retry candidate

Initial scope: source, disposable simulator checks, and offline frozen-RTL
whole-image replay. Subsequent explicit approvals covered the vendor build,
temporary FPGA programming, and one captured manual reboot described below.
No live catalog publication, Namespace save, or configuration-flash write.

Candidate: `simulator/examples/candidates/amoeba-retry.cloomc`.
Check: `node simulator/test_amoeba_retry_candidate.js`.

All three entries are declared `main method`. After the selected application
returns they branch back to its CALL, not to the one-time initialization/status
reporting. They contain no RETURN. Unreachable NOP padding preserves the frozen
dispatch offsets 4, 10 and 13; it is not a stop mechanism.

Compared against executable words in the frozen image with SHA-256
`e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102`,
only the three terminal pairs change: zero/RETURN becomes backward-branch/NOP.
This comparison is not artifact signing or admission. Do not patch these words
into an installed image: a deployable candidate requires normal compilation,
identity, binding and image validation.

## Focused verification

- Compiler rejects an explicit RETURN in a main entry.
- Each entry completes 100 calls and retries with constant stack depth.
- Existing-status reporting runs once even across repeated application returns.
- Root sentinel and the unrelated worker Thread remain unchanged.
- A missing-capability application faults in Mallory's Thread. The observer
  stops on the first fault; it does not exercise or authorize fault recovery.

These use small returning/faulting application fixtures in a disposable copy
of the pinned image, not the actual whole application workload. The Start
entry's repeat logic is exercised in a worker fixture, not claimed as a complete
Boot/Alice/Mallory scheduling test.

The generic current-catalog boot fixture failed before entering this candidate,
so the checks use the exact frozen image. Its imported non-authoritative
metadata is copied for fixture-only residents; runtime guards are not changed.
The initial fault test inadvertently continued into simulator fault handling;
the observer now stops at the first fault so later recovery execution cannot
be misattributed to the tested application.

## Remaining acceptance

The candidate passed the bounded RTL replay and the physical single-retry test
below. Indefinite recovery and long-run stack stability are not established.
The retry loop does not clear a hard fault or send a
recovery command; the existing explicit fault disposition remains separate.

## Offline whole-image replay preparation

`scripts/prepare_amoeba_retry_image.py` runs the existing compiler and symbolic
destination binder against exact dependency identities from the frozen image.
The separately compiled API artifact retains its 256-word allocation. The
resulting replay image differs at only six words, the three terminal pairs.
Namespace descriptors, other artifacts, grants, and initial Thread bytes are
unchanged. Output evidence is in `generated-artifacts/amoeba-retry-image/`.

Candidate SHA-256:
`5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d`.

This is an offline bound replay fixture, not server save/admission or permission
to install. The whole-image replay uses the unchanged frozen RTL and a simulated
manual reboot after the first complete fault snapshot. Its acceptance condition
is the original Mallory fault followed by the same intended Mallory fault after
execution traverses the retry branch, not STACK_UNDERFLOW.

## Completed frozen-RTL result

The replay exited 0 with `AMOEBA_RETRY_RTL_TWO_MALLORY_FAULTS_PASS`.
The before/after frozen-input checksum checks passed.

- First fault: code 8, instruction `0x070B0020`, address `0x3A08`,
  Thread GT `0x0200000C` (Mallory), at cycle 1,890,190.
- First snapshot was CRC-validated; Run could not bypass the fault hold.
- The simulated manual reboot completed; 1,854 subsequent retirements covered
  Boot (601), Alice (639), and Mallory (614).
- Mallory executed Amoeba's backward branch `0xBF040001` at `0x4638`
  at post-reboot event index 1245, instead of falling into the old root RETURN.
- Second fault: the same code, instruction, address and Mallory Thread GT,
  at cycle 3,858,251. No Boot/Alice fault or STACK_UNDERFLOW occurred in this run.

Evidence: `generated-artifacts/amoeba-retry-image/results/result.json`,
`results/recovery-snapshot.bin`, `results/uart.bin`, and `replay.log`.
The observer stops at the second fault; this proves one retry through the actual
workload, not indefinite repeated recovery or long-run stack stability. The
100-repeat constant-stack checks above remain separate fixture evidence.

After results and checksum verification, Amaranth emitted the previously observed
ignored coroutine cleanup warning (`aclose(): asynchronous generator is already
running`). It did not prevent completion or change the exit status.

## Vendor build and physical single-retry acceptance — 2026-10-30

The operator supplied a successful Vivado 2026.1 build log and receipt (exit 0).
Setup slack was +2.927 ns, hold +0.039 ns, pulse-width +7.000 ns; all
reported failing-endpoint counts were zero. The receipt's manifest and image
hashes were independently matched to the local prepared package.

- Manifest SHA-256: `5ab35bf4d2060ca4fad7b36d4a1cd5f8f4498f960a8d717f56580e0c54a1604b`.
- BIT SHA-256: `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`.
- The operator verified the downloaded BIT checksum and supplied Vivado output
  showing that selected file programmed successfully, startup status HIGH.
  This is operator programming provenance, not live UART hash attestation.

Startup capture:
`attached_assets/amoeba-retry-startup-20261030-190911-786619_1793387477299.bin`.
SHA-256 `3d3d55d228729fe156abae8aed8a396bf396025e9a030f094942a00e39ec21bb`.
23,281 bytes: 1,907 trace packets and one complete CRC-valid reason-2 snapshot,
sequence 1. Fault code 8 at `0x3A08`; snapshot CR12 `0x0200000C` identifies Mallory.

Explicitly authorized manual-reboot capture:
`attached_assets/amoeba-retry-manual-reboot-20261030-191344-489410_1793387733633.bin`.
SHA-256 `a5d98bc704f818968b5d313966792aee04e2a029bbbe4123c3ea518776e03b39`.
23,996 bytes: 1,968 trace packets, a build-20 boot sentinel, and one complete
CRC-valid reason-2 snapshot, sequence 2, ending exactly at EOF.

The second capture includes the retry-branch address `0x4638` at trace index 1330
and no event at the old root RETURN address `0x463C`. Application output advances
from `Alice=42` to `Alice=43`. The terminal fault remains code 8 at `0x3A08`,
with snapshot CR12 `0x0200000C`; no Boot/Alice fault or STACK_UNDERFLOW appears.
The two fault-marked packets describe one instruction's two trace events, not
two separate faults. Remaining bytes decode as expected ASCII application text.

This accepts the bounded physical startup/manual-reboot/retry scenario. It does
not authorize automatic fault release, further board commands, flash programming,
or a general production release. Passive captures are not server-correlated live
incidents. No automatic recovery authorization was sent.
