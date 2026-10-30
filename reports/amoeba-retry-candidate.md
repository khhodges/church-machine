# Isolated Amoeba retry candidate

Scope: source, disposable simulator checks, and offline frozen-RTL whole-image
replay. No publication, image admission, Namespace save, FPGA build, upload,
programming, or board commands.

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

The new candidate passed the bounded three-Thread RTL replay below, but has not
undergone vendor synthesis, timing, or physical acceptance. Earlier physical
results cover the old image, not this candidate. The retry loop does not clear a hard fault or send a
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
