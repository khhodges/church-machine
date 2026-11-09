# Isolated copy-and-retry diagnostic

Date: 2026-11-09. **Local full-top RTL result: 6 passed in 92.38 seconds.**

## Scope

The user approved implementation and local testing of a bounded
memory-to-memory loading fixture. This does not authorize a vendor build,
board programming, persistent flash, live Namespace changes, or production
RTL changes. The successful resume/retry package is unchanged.

This fixture reuses the isolated candidate RTL at
`generated-artifacts/resume-retry-candidate`, including its existing terminal
RETURN stop. No RTL changes were needed. The new fixture/test is
`docs/phase-2/test_copy_retry_preparation.py`.

## Executed sequence

- Destination NS[6] at `0x5000` begins unavailable, with words 1–63 zero.
- Source NS[7] at `0x6000` contains five fixture words, with limit 4.
- SYSTEM has an explicit W-only destination capability in CR3 and R-only
  source capability in CR4. USER's existing target capability remains E-only.
- After the unavailable CALL handoff, SYSTEM executes five DREAD/DWRITE pairs.
  It copies method entry, two body instructions, and c-list row, then writes
  the availability header **last**.
- CHANGE at `0x2038` resumes USER. CALL at `0x4008` retries once; the copied
  callee sets DR12 to 13 and RETURN reaches `0x400C`.
- The existing diagnostic latch stops before the caller continuation executes.

Expected destination writes, in order:

| Address | Value |
|---|---|
| `0x5004` | `0x00000002` |
| `0x5008` | `0xAF60400D` |
| `0x500C` | `0x1F000000` |
| `0x50FC` | `0x4A000006` |
| `0x5000` | `0xF8001001` |

The testbench supplies initial boot bytes only; it never inserts destination
data during execution. The source is already in RAM, not fetched externally.

## Checks and controls

At each of two simulated UART rates (125000 and 62500 baud with a 1 MHz
simulation clock):

1. Success: exact destination writes and order, no source writes, one handoff,
   exact committed instruction sequence, one successful CALL, CRC-valid
   292-byte snapshot with reason 3, NIA `0x400C`, live CR12 `0x02070004`,
   and DR12 13. No fetch acceptance or writes during 100 post-stop cycles.
2. Missing source R: first hard fault is PERM_R at `0x2010`; no destination
   writes, publication, or callee execution.
3. Missing destination W: the first source read commits, then PERM_W at
   `0x2014`; no destination writes, publication, or callee execution.

Controls stop observation at the first hard fault and do not claim recovery
behavior. UART rates exercise the local serializer, not physical timing.
The observer's finite test timeout is not an integrated watchdog.

Two test-authoring corrections preceded the passing run:

- DREAD/DWRITE constant offsets use DR0 plus magnitude in bits 13:4; raw
  nonzero imm15 values instead select DR indices. Only the new fixture was
  corrected; no shared encoder or RTL was changed.
- The existing retirement trace also emits fault events. Successful commits
  are counted separately; negative cases explicitly verify the fault event
  address rather than misclassifying it as a successful instruction.

## Retained local evidence

- Image: `generated-artifacts/copy-retry-fixture.bin` (65536 bytes).
- Image SHA-256:
  `99a67ec2ca9ab7638d3a2ca0e6b74fc74c3800a8409fb484f601727fc81b3f02`.
- JUnit: `generated-artifacts/copy-retry-results.xml`.
- Hash inventory: `generated-artifacts/copy-retry-local-hashes.json`,
  including test source, image, JUnit, and candidate hardware Python tree.

Reproduction:

```sh
cd generated-artifacts/resume-retry-candidate
PYTHONPATH="$PWD:/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages" \
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  /home/runner/workspace/docs/phase-2/test_copy_retry_preparation.py \
  -q -p no:cacheprovider --confcutdir=/home/runner/workspace/docs/phase-2 \
  --junitxml=/home/runner/workspace/generated-artifacts/copy-retry-results.xml
```

## Remaining boundary

This is local evidence for a fixed five-word copy, not authenticated admission,
general allocation, interruption-safe delivery, external transport, DELIVER,
or full lazy loading. At local preparation, no new bitstream or physical result
existed. Subsequent build and physical evidence is recorded separately in
[copy-retry-physical-result.md](copy-retry-physical-result.md). The prior
physical test remains separately recorded in
[resume-retry-physical-result.md](resume-retry-physical-result.md).
The subsequent separate build-only export uses this image's own exact-image
admission digest, not the old package's digest.
