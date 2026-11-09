# Isolated UART receive-and-retry diagnostic

Date: 2026-11-09. Local candidate only; no vendor build or board operation.

**Prior local result: 22 passed in 284.75 seconds**, plus **2 passing receiver-disabled
copy/retry regression cases** in 62.85 seconds. The full run emitted two
Amaranth background-sender coroutine cleanup warnings when early fault tests
ended; they did not fail assertions. The retained full log includes these
warnings; this is not a warning-free qualification.

**Extended line-error result: 46 passed in 341.91 seconds**, with two
Amaranth background-sender cleanup warnings in the no-read/no-write controls.
All 22 original cases and 24 added cases passed. This supersedes the original
suite count, not the separate receiver-disabled regression evidence.

## Scope and implementation

The user approved isolated preparation and local testing after the physical
copy-and-retry result. The candidate is at
`generated-artifacts/uart-retry-candidate`, copied from the frozen copy/retry
package source snapshot. Production RTL and prior packages remain unchanged.

Retained sources:

- `uart_retry_receiver.py`: exact-fixture receive buffer.
- `uart-retry-top.patch`: opt-in top-level integration, against the copy/retry
  package source snapshot. The helper must be copied into candidate `hardware/`.
- `test_uart_retry_preparation.py`: fixture, serial-pin sender, full-top checks,
  and receiver boundary tests.

The opt-in `diagnostic_uart_receive` profile exclusively routes incoming
serial bytes to the receiver, not the debug command parser. Thus Run, Halt,
Step, Reboot, Upload, and recovery commands are unavailable in this profile.
It is not appropriate for normal bridge pairing or production use.

## Fixed frame and acceptance boundary

The 30-byte frame is:

1. ASCII `URX1`.
2. Big-endian length `0x0014` (20 payload bytes).
3. Five big-endian words: `2`, `0xAF60400D`, `0x1F000000`, `0x4A000006`,
   `0xF8001001`.
4. ASCII `END!`.

Every byte is compared against this exact fixture, and actual received payload
bytes populate the buffer. There is no source body prepositioned in RAM and no
host-side write into simulated memory. Expected constants in the receiver are
diagnostic allowlisting, not general cryptographic authentication.

Status is pending (0), validated (1), or failed (2). SYSTEM claims a validated
frame by reading status; data is inaccessible before claim. Excess bytes before
claim fail closed, including a byte arriving on the claim cycle. The existing
UART decoder's `error` output is now connected to the isolated receiver.
Any reported framing error before claim latches failed status even without
a decoded byte; an error wins over a simultaneous matching byte or claim.
The status read reports failure on that same cycle. Idle time and subsequent
valid frames cannot clear rejection.
After claim, the buffer is immutable and all subsequent bytes and line errors
are ignored: no second frame,
retry, or rearm is implemented. This explicit one-shot boundary does not promise
to revoke already accepted data because later unrelated bytes arrive.

Partial data waits indefinitely. There is no receiver timeout, elapsed-time
USER resume, or hardware watchdog. Local observer limits are test controls only.

## Capability and bus boundary

SYSTEM CR4 holds an R-only capability to the two-word MMIO view beginning at
`0x4000001C`: data/pop at offset 0, status/claim at offset 1. Its descriptor
retains the byte-addressed MMIO base, unlike word-addressed resident RAM.
SYSTEM CR3 retains explicit destination W authority. Core permission and bounds
checks are unchanged. Diagnostic register responses use exact address matching,
not the existing broad MMIO register-index aliases.

Only these two diagnostic registers latch read data for the next cycle because
DREAD consumes its response in MEM_ACCESS_WAIT. A combinational-only response
let status claim succeed while the instruction consumed unrelated RAM data;
the new local adapter fixes that timing without changing existing MMIO behavior.

SYSTEM polls status, executes an invalid instruction on explicit rejection,
and otherwise reads and copies the five words through ordinary DREAD/DWRITE.
It publishes availability last, then CHANGE at `0x2054` resumes USER.
Expected terminal evidence remains reason 3, NIA `0x400C`,
live CR12 `0x02070004`, and DR12 13.

## Verification scope

The full-top suite drives serial bits into the actual UART RX pin at two
simulated rates. It covers success, a mid-frame delay, partial input,
malformed payload, absent R/W rights, debug-command bytes, and excess input
before claim. Receiver unit cases cover partial frame, wrong length, wrong
terminator, overflow, claim/byte collision, and immutable claimed data.

The extended full-top cases inject a bad stop bit mid-payload, a held-low
break, and a changed data bit through the serial pin at both rates. They
require the SYSTEM rejection hard fault, zero destination writes, and no
USER retry. Direct UART-plus-receiver tests also cover bad stop bits in the
first and final frame bytes, repeated errors during a break, a one-clock
false-start pulse, a mid-data-bit noise pulse spanning the sampling point,
and errors after claim. Rejection remains sticky through 5000 idle clocks,
a later exact frame, and claim/pop requests. Unit tests cover error/claim
and error/byte collisions both pending and ready.

A short false start rejected by the existing UART sampler produces neither
a byte nor an error. It cannot make the receiver ready: only the subsequent
complete exact frame can do so. A sampled data-bit corruption can produce a
valid UART byte without a framing error; the exact-fixture comparison rejects
it. This is digital sampling evidence, not a claim that every physical noise
pulse is observable or that analog signal integrity has been qualified.

Success assertions require exact destination write order, one unavailable-CALL
handoff, one successful retry, the final copy/CHANGE/CALL/RETURN sequence,
CRC-valid terminal snapshot, and post-stop inactivity. Negative cases observe
the first explicit hard fault before any destination write. Partial input
must remain pending during the observation window.

Snapshot observation budgets include draining polling trace traffic; increasing
that test budget does not change machine waiting behavior.

Evidence paths:

- `generated-artifacts/uart-retry-results.xml` (full run)
- `generated-artifacts/uart-retry-test.log` (full output, including warnings)
- `generated-artifacts/uart-receiver-unit-results.xml` (receiver-only run)
- `generated-artifacts/uart-disabled-regression-results.xml`
- `generated-artifacts/uart-retry-local-hashes.json`
- `generated-artifacts/uart-retry-fixture.bin` (65536 bytes)
- `generated-artifacts/uart-retry-frame.bin` (30 bytes; NOT for the installed BIT)
- `generated-artifacts/uart-line-errors-results.xml` (extended suite)
- `generated-artifacts/uart-line-errors-test.log` (extended suite output)

Fixture SHA-256:
`930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7`.
Frame SHA-256:
`e5c4b31714c214060cf7f66d2cdf5273b1adc961b75bf4ffeef905baa88a3cca`.

Reproduce from the isolated candidate root (not the production source root):

```sh
cd generated-artifacts/uart-retry-candidate
PYTHONPATH="$PWD:/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages" \
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  /home/runner/workspace/docs/phase-2/test_uart_retry_preparation.py \
  -q -p no:cacheprovider --confcutdir=/home/runner/workspace/docs/phase-2
```

## Remaining acceptance

No physical UART transfer result, bitstream, vendor timing, general DELIVER,
external lookup service, stale/wrong-GT retry acceptance, concurrent USER
progress, or execution watchdog is established by this candidate.
The existing private build-admission digest is still for the prior image;
any future build-only export must admit and identify this new image explicitly.
Do not send this frame to the currently installed BIT.
Selected digital serial-pin framing-error/noise cases are covered by the
extended suite. Analog noise, metastability, baud mismatch, phase sweeps, and
physical-link qualification remain unestablished. Exact-fixture matching
does not authenticate a sender, establish freshness, or authorize general
external loading. No production UART RTL, board state, or installed BIT is
changed by these tests.
