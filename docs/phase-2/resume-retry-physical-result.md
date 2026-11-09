# Resume/retry diagnostic: verified physical result

Date: 2026-11-09.

**Result: PASS for the bounded synthetic resume/retry terminal checks.**
This is not full lazy-loading, DELIVER, watchdog, or production-release acceptance.

## Authority and provenance

The user manually built the isolated package, then explicitly approved and
performed temporary JTAG programming and passive UART capture. The supplied
Vivado console identifies `xc7a100t_0`, selects the candidate BIT, and reports
`End of startup status: HIGH`. No persistent-flash programming was authorized
or reported. The agent did not operate the remote builder or board.

The build receipt is preserved unchanged: its `physicalBoardTested`,
`releaseApproved`, and `programmingAuthorized` fields were false at build time.
This document records the subsequent bounded physical test, not a rewrite of
that historical receipt. The programmed-file association is supported by the
operator's console and uploaded file hash, not independent device readback.

## Exact identities

| Artifact | SHA-256 |
|---|---|
| Build-only ZIP | `c4984c9a2d815316b78c89f7b3738129df62b30038a531678c24440bcabab7f6` |
| Manifest | `a4064fde8e1ae697cc2141897b3d84e8cae9725d12e7bb13569cbfa6c60c22e5` |
| Synthetic image | `fe6e7cc5fe8d1ae99d840e77b762176a18b5d1d5888159576edb19d9abd19dc9` |
| Candidate BIT | `4aefe44187481597c1f17eca34c5ee0b4ebda5f060317329fcc969c2a012681c` |
| Raw UART capture | `678723a46a582345281c93fcd8a5dc1b1bb7d7ca95049c1b92abdc26bc3ff791` |

## Build verification

Vivado 2026.1; build exit code 0; final log marker
`RESUME_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS`.

- Setup slack: +3.399 ns; hold slack: +0.083 ns.
- Zero failing setup, hold, and pulse-width endpoints.
- 41,387 of 41,387 routable nets fully routed; zero routing errors.
- DRC: one RTSTAT-10 warning for 26 nets with no routable loads (debug fault
  nets shown in the report); no reported DRC errors.
- Uploaded BIT, timing, precise-slack, DRC, and route-status files each matched
  their receipt hashes. Uploaded manifest matched the receipt manifest hash.
- Remote checkpoint hashes are recorded in the receipt; checkpoint files
  were not uploaded and were not independently rehashed here.

## Physical capture verification

Passive UART capture was performed at 57600 baud, with the paired bridge
stopped and capture started before programming, per the supplied procedure.
The operator reported 556 received bytes and uploaded the raw file.

The existing pure decoder in `hardware/wukong_bridge.py` was used without
starting the bridge or accessing a device. One complete 292-byte version-1
snapshot begins at byte offset 264 and ends at the end of the capture.
Its 284-byte payload has sequence 1 and a valid CRC-16-CCITT (`0xCAA6`).
The preceding 264 bytes are not claimed as independently decoded instruction
retirement evidence in this result.

| Terminal check | Expected | Observed |
|---|---|---|
| Stop reason | 3 | 3 |
| Live NIA | `0x400C` | `0x400C` |
| Live CR12 GT | `0x02070004` | `0x02070004` |
| DR12 callee result | 13 | 13 |

Additional decoded fields: Thread base `0x3000`, STO 0, wire flags `0x9`,
M flag false. The separate stored-CR12 field is 0; the identity check above
uses the live CR12 tuple, not that stored field.

## Interpretation and limits

Together with the exact synthetic fixture and earlier local RTL checks, this
terminal result supports SYSTEM making the prepositioned target available,
USER resuming, the retried CALL reaching the callee, and RETURN reaching
`0x400C`. SYSTEM uses an explicit fixture write capability and ordinary DWRITE;
this test does not fetch or install a missing body.

The physical snapshot establishes the terminal values, not an independent
instruction-by-instruction trace. Exact retirement counts, preserved-state
checks, and post-stop inactivity remain supported by the earlier 18-case
local RTL evidence, not newly proven by this single physical snapshot.

The execution watchdog remains absent. No production RTL, live Namespace,
persistent flash, or release approval is changed by recording this result.

## Uploaded evidence

Paths are relative to the repository root:

- `attached_assets/build-launch_1794249151696.log`
- `attached_assets/build-receipt_1794249151697.json`
- `attached_assets/build_1794249151697.exitcode`
- `attached_assets/candidate-EXPERIMENTAL_1794249151697.bit`
- `attached_assets/manifest_1794249151698.json`
- `attached_assets/precise-slack_1794249151698.txt`
- `attached_assets/drc_1794249151697.txt`
- `attached_assets/route-status_1794249151698.txt`
- `attached_assets/timing_1794249151698.txt`
- `attached_assets/resume-retry-uart-20261109-132710_1794249151698.bin`

Related records: [package](resume-retry-build-package.md) and
[local preparation](resume-retry-diagnostic-preparation.md).
