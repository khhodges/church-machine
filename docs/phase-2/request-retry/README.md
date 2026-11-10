# Isolated request-and-load diagnostic

Scope: local preparation and simulation only. No production RTL, live
Namespace, remote builder, installed BIT, or persistent flash changes.
This is not compatible with the currently installed URX1 UART diagnostic.
Do not send these new frames to that BIT.

## Bounded behavior

The existing unavailable-CALL fixture remains unchanged. SYSTEM's first
authorized read of the receiver status register requests the one known missing
fixture object. This is a diagnostic peripheral read side effect, not a new
ISA instruction, generic loader, or ambient write grant.

The request identifies the five-word payload by SHA-256 and its length.
This is the fixture's content label, **not a canonical LUMP identity or
cryptographic sender authentication**. The hardware compares every response
byte with the known expected frame and buffers the actual received bytes.
It does not implement a general SHA-256 verifier or arbitrary object lookup.

SYSTEM retains R-only receiver access and W-only destination access. Its
ordinary DREAD/DWRITE sequence publishes availability last and CHANGE resumes
USER. The callee RETURN latches the existing terminal stop. No receive timeout,
rearm, execution watchdog, automatic retry, or recovery is introduced.
Host timeout only stops the host observation.

Wrong object, length, payload, CRC, UART errors, bytes before the request is
sent, and excess/claim-collision input fail closed before acceptance.
Partial responses remain pending. After acceptance, extra bytes/errors cannot
change the receiver's words or rearm it; the observer may count/report them.

## Wire protocol

All multibyte numbers are big-endian. CRC is CRC-16-CCITT, initial 0xFFFF,
covering all preceding frame bytes. CRC is error detection, not authentication.

- **Request (40 bytes):** `URQ2`, payload SHA-256 (32 bytes), length 20
  (2 bytes), CRC (2 bytes).
- **Response (60 bytes):** `URS2`, same SHA-256, length 20, five payload
  words (20 bytes), CRC.
- **Observation request (8 bytes):** `URP2`, host-selected nonzero 32-bit nonce.
  Only the post-baseline observer recognizes it. It grants no mutation rights.
- **Report (146 bytes):** `URV2`, sequence (4), nonce (4), object hash (32),
  25 unsigned 32-bit fields, CRC (2).

Report fields, in order:

1. accepted, failed, read index, accepted-response byte count;
2. post-claim byte count, CRC of all post-claim bytes, UART error count;
3. destination write count, availability-word write count, handoff count,
   successful retry retirement count;
4. live NIA, CR12, DR12, post-stop retirement/destination-write activity count;
5. five accepted buffer words;
6. five actual destination RAM words in publication order.

The read-only observer waits for the architectural terminal snapshot to finish,
then reuses its synchronous RAM read port. No additional RAM write path or
general debug-command parser is enabled. Reports freeze metadata and read the
halted destination RAM; buffer words are not reconstructed from expected ROM.

Request/report packets participate in the existing non-preemptive UART packet
arbiter. Their priority is below architectural snapshots and above poll traces,
so a polling SYSTEM cannot starve its own request.

## Positive one-shot evidence

After the normal CRC-valid terminal snapshot, the board emits baseline report
sequence 1, nonce 0. The host validates the baseline before sending any probe.
It then sends a repeated 60-byte response, a response with a changed payload
byte, and URP2 plus a fresh nonce (128 bytes total). A second report must:

- echo that nonce with sequence 2;
- show the exact 128-byte count and matching rolling CRC;
- retain all five accepted words and all five actual destination words;
- retain exactly five writes, one publication, one handoff and one retry;
- retain terminal NIA 0x400C, CR12 0x02070004 and DR12 13;
- show no post-stop retirement or destination write.

This proves receipt and unchanged observed state over that bounded challenge.
It does not prove arbitrary-duration immunity or analog UART qualification.
The core's stop alone is not taken as receiver immutability evidence.
No response, stale nonce, altered state, incomplete capture, or serial exception
can pass the host check.

## Automatic host responder

`responder.py` and `protocol.py` form the host tool. It requires Python and
pyserial on the operator machine. The tool never programs a device or opens
a remote connection. It sends nothing until a complete exact URQ2 request is
observed. It does not reconnect or retry a failed/partial serial write.

The output directory must be new. It retains raw binary RX, timestamped JSONL
events including TX attempts/completions, and a JSON result on success/error.
An open-port failure is recorded distinctly from a completed capture. The
tool uses a normal read loop, not console S/Q keystrokes.

For a **future separately built and approved request-profile BIT only**:

```text
python responder.py --port COM_PORT --out NEW_EVIDENCE_DIR --arm-request-profile
```

No physical use of that command is authorized by this local preparation.
The operator should start capture before programming; if the serial handle
closes, stop and retain the error rather than silently reconnecting/resending.

## Reconstruct and verify locally

`prepare_candidate.py` requires the locally retained, verified parent
`generated-artifacts/uart-retry-build-only` export. It verifies every parent
manifest input, applies only `top-integration.patch`, and adds the two retained
hardware modules. It refuses to overwrite an existing candidate.

```sh
python3 docs/phase-2/request-retry/prepare_candidate.py
# Or verify an already prepared candidate:
python3 docs/phase-2/request-retry/prepare_candidate.py --verify
```

Run from the isolated candidate, not the production source directory:

```sh
cd generated-artifacts/request-retry-candidate
PYTHONPATH="$PWD:/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages" \
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  /home/runner/workspace/docs/phase-2/request-retry/ \
  -q -p no:cacheprovider \
  --confcutdir=/home/runner/workspace/docs/phase-2/request-retry
```

The fixture bytes remain identical to the previous UART image; opt-in RTL
changes the transport and observer. A future export must explicitly set
`diagnostic_uart_request=True`, with receive and terminal-stop enabled.
The old generator does not do that and must not be reused unchanged.

## Retained local evidence

**35 distinct cases have passing evidence:** 12 full-top cases, eight receiver
boundary cases, 14 host cases, and one prior UART-profile regression.
The first full-top run had 11 passes and one failed test expectation: early
input can be rejected while SYSTEM's later status read still emits its request
before the software hard-fault branch. Zero writes and no retry already passed.
Only that test expectation was corrected; its targeted rerun passed in 9.10 s.
The original failure record is retained, not replaced with fabricated clean XML.
The original full-top run took 238.88 s; receiver/host checks took 0.73 s and the
prior-profile regression 24.18 s.

Full-top tests emitted an Amaranth warning that the test UART monitor inherits
the sync domain from the wrapped top, a placement deprecated for future
Amaranth 0.6. This is not claimed as a warning-free qualification.

An independently reconstructed candidate matches source-map SHA-256:
`54a626a8fa35c73803e1d9b92aaf56940b40030a1b81209886b8a6e5992736ca`.

See `generated-artifacts/request-retry-fulltop-results.xml`,
`request-retry-fulltop.log`, `request-retry-early-response-results.xml`,
`request-retry-unit-host-results.xml`, `request-retry-disabled-results.xml`,
`request-retry-local-evidence.json`, and `request-retry-sim-capture.bin`.
`record_evidence.py` checks the explicitly recorded test-result reconciliation,
parent/candidate sources, and hashes the retained inputs and outputs.
The binary is simulated serial output,
**not a physical board capture**.

Vendor timing, resource fit, physical transmission, and physical one-shot
acceptance remain unestablished for this new candidate. The earlier physical
UART success applies only to its prior BIT, not this extension.
