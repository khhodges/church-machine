# Isolated Amoeba retry candidate

Scope: source and disposable simulator checks only. No publication, image
admission, Namespace save, FPGA build, upload, programming, or board commands.

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

The new candidate has not undergone full three-Thread RTL replay, vendor
synthesis, timing, or physical acceptance. Those earlier results cover the old
image, not this candidate. The retry loop does not clear a hard fault or send a
recovery command; the existing explicit fault disposition remains separate.
