# Request-and-load diagnostic: physical capture verification

Date: 2026-11-10.

**PASS for the bounded request, receive, retry, and post-claim challenge.**
This is not general loader qualification, sender authentication, or release approval.

## Artifact and build verification

- Uploaded BIT SHA-256:
  `784ec30f312c8171da6f126e144c7535a2602c95ac22b995868a5da90df89aea`
- Uploaded manifest SHA-256:
  `8c7c889ce8e3694f488f34729019f5227fa2631d2c292a1cb3a7db60cd75d027`
- Uploaded capture SHA-256:
  `29042a6d710caff70688db0f6276a616937b4fc96d5b1503b8e18529776e8051`

The uploaded manifest matches the local prepared package byte for byte.
Receipt schema, image, source-map, object, and request/response hashes match
that manifest. Uploaded BIT, timing, precise-slack, DRC and route-status files
all match their receipt hashes. Uploaded responder and protocol source match
both the prepared host tools and retained source. Uploaded bytecode was not
executed or used as evidence.

Timing parsed from the uploaded report matches the receipt: setup +5.519 ns,
hold +0.070 ns, pulse width +7.000 ns; zero failing endpoints.
All 43,954 routable nets are fully routed, with zero routing errors.
The DRC report contains one RTSTAT-10 warning covering 55 nets with no routable
loads. The supplied build log reports zero pre-bitstream DRC errors and the
final REQUEST_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS marker.
Synthesis and routed checkpoints were not uploaded and were not independently
hashed here.

## Capture replay

Inputs under attached_assets:

- capture_1794317160962.bin
- events_1794317160963.jsonl
- result_1794317160963.json

The 302,212-byte capture was replayed through the retained Session parser using
the event log's actual receive chunk boundaries. Each parser verification event
was checked against the logged event sequence, each generated transmission
against the logged attempted bytes, and receive/transmit totals reconciled.
The reconstructed baseline, post-claim report and terminal snapshot exactly
match result.json.

Frame offsets (zero-based):

| Frame | Offset |
| --- | ---: |
| Exact URQ2 request | 297280 |
| CRC-valid terminal snapshot | 301628 |
| CRC-valid baseline URV2 report | 301920 |
| CRC-valid post-claim URV2 report | 302066 |

The event log records exactly two transmit attempts and completions: the
60-byte response, then the 128-byte challenge, totaling 188 bytes.
The terminal snapshot is reason 3, NIA 0x400C, CR12 0x02070004, DR12 13.

Both reports show five destination writes, one publication, one handoff,
one successful retry, no UART errors and zero post-stop activity.
All five accepted-buffer words and all five destination-memory words equal
the fixture in both reports.

The post-claim report advances sequence 1 to 2, echoes nonce 3203188543,
and reports exactly 128 additional bytes with CRC 0xAA4F, matching the sent
challenge. This positively establishes challenge receipt and unchanged
observed state, rather than inferring immutability from silence.

## Boundaries

Temporary JTAG testing was explicitly authorized and guided; persistent flash
was not authorized. The operator supplied host PASS output and these captures.
The actual Vivado programming-success output and FPGA readback were not
supplied, so the uploaded BIT hash is not independent proof of installed
silicon identity. The physical capture is consistent with this diagnostic.

Replay independently checks the raw evidence, but uses the same retained
protocol implementation rather than a separately authored protocol checker.
The event log is host-side evidence of sends, not a logic-analyzer TX capture.
The board's challenge report supplies the corresponding receive evidence.

This result does not establish arbitrary-duration immunity, malformed-input
coverage beyond this challenge, analog UART margin, canonical LUMP admission,
cryptographic authentication, or production readiness. Original build-receipt
flags remain unchanged as historical build-time facts.
