# Independent offline wire cross-check

This adds a separately authored reader, not a new physical experiment.
The original capture, result, protocol, responder, physical-result.md and
previously generated archives remain unchanged. The historical disclosure
that the original replay used the retained parser remains accurate.

Run from a newly built/extracted v2 bundle, with Python 3.9 or newer:

```sh
python3 -B -S independent_decode.py
```

An optional positional directory selects a different extracted bundle.
The reader imports only Python standard-library modules. It does not import,
execute, subclass or call Session, protocol.py, replay.py, bridge code, RTL,
or the bundle builder. It reads only capture.bin, events.jsonl and result.json;
no serial, network, hardware or simulator access occurs. It uses a bitwise
CRC implementation, not the retained parser's binascii.crc_hqx.
This is implementation independence, not a blind clean-room claim: the retained
tooling and results were inspected to understand packaging and comparison targets.

## Wire sources and interpretation

The source specifications are `docs/phase-2/request-retry/README.md` (Wire
protocol and Positive one-shot evidence), `docs/debug-packet-protocol.md`
(snapshot), and `docs/phase-2/uart-retry-diagnostic-preparation.md` (fixed
five-word fixture). The following restates the needed wire contract so the
standalone archive does not depend on the repository:

- All integers are unsigned big-endian.
- CRC-16-CCITT-FALSE: polynomial 0x1021, initial FFFF, no reflection, xorout 0.
  Every sealed frame covers all bytes except its final two-byte CRC.
  The check value for ASCII `123456789` is 29B1.
- Payload: five words `00000002 AF60400D 1F000000 4A000006 F8001001`.
  Its SHA-256 is the object label, not sender authentication.
- URQ2: four-byte magic, 32-byte payload hash, two-byte length (20), CRC.
- URS2: same structure but 20 payload bytes before CRC (60 bytes total).
- URV2: magic, sequence u32, nonce u32, hash[32], 25 u32 fields, CRC
  (146 bytes total). Fields in order: accepted, failed, read index,
  response-byte count, post-claim-byte count, rolling post-claim CRC,
  UART errors, destination writes, publication writes, handoffs, retries,
  live NIA, live CR12, DR12, post-stop activity, five buffer words,
  five destination words.
- Snapshot: AC, version 01, payload length 011C, sequence u16,
  payload[284], CRC (292 total). Payload offset 0 is reason; offsets
  1–3 carry flags/M/reserved; NIA is u32 at 4. The scalar prefix is
  28 bytes, followed by sixteen three-word CR records and sixteen DR words.
  Live CR12 word zero is at payload 172; DR12 at 268. The stored
  suspended-thread CR12 in the scalar prefix is **not** live CR12.
- Challenge: exact repeated URS2 (60), altered URS2 (60), then URP2
  and nonce u32 (8). For this pinned challenge, response byte 40 is XORed
  with 80 while its CRC remains unchanged. The 128-byte aggregate has
  rolling CRC AA4F. The altered subframe is deliberately CRC-invalid.

The reader locates every occurrence of the diagnostic magic strings and
requires the published counts, order, offsets and lengths. It checks each
frame CRC, response payload/hash, both report identities and all 25 fields,
the terminal snapshot, host transmission content/completions, receive totals,
event order and availability of received evidence before host decisions.
It compares every baseline/post-claim/snapshot result field, not just PASS.
Baseline requires sequence 1/nonce 0; post-claim requires sequence 2 and the
host nonce, exactly 128 bytes, matching computed CRC and unchanged state.

## Pins and negative controls

Capture and result SHA-256 pins are embedded independently of manifest.json.
Events are pinned after replacing only the opening port label with
`[REDACTED]` and serializing each JSON object with sorted keys plus newline.
Thus the reader accepts the original or sanitized event log without carrying
the original machine-local label. Pins detect drift, not authentication.

`test_independent_decode.py` exercises CRC check vectors, all single-bit
changes in a request, truncation/appending, duplicate/missing frames,
wrong endian/CRC coverage, CRC-resealed wrong identities, lengths, snapshot
values, every report field, report sequence/nonce, altered challenge and
event/result disagreements. Semantic mutations bypass hash pins intentionally;
some also alter result.json to agree with the wrong wire values, ensuring
shared agreement alone cannot validate them. Separate tests exercise pins
and run with retained modules absent and site packages disabled.

## Scope of the result

### Recorded cross-check — 2026-11-10

The pinned capture passed the independent reader. The complete offline suite
passed 20 tests with:

```sh
python3 -B -m unittest discover -s docs/phase-2/request-retry/offline -p 'test_*.py'
```

| Frame | Offset / direction | Stored CRC = independently computed CRC |
| --- | --- | --- |
| URQ2 | RX 297280 | 0x7255 |
| Terminal snapshot | RX 301628 | 0xCAA6 |
| Baseline URV2 | RX 301920 | 0x77C2 |
| Post-claim URV2 | RX 302066 | 0x1101 |
| URS2 response | host TX attempt | 0xC992 |

Payload SHA-256:
`e77df91cc5c59cdb1b5e13075bc356220bcd02b4bff10044efe127339e6ad390`.
Terminal values: `[3, 16396, 34013188, 13]`. Both reports matched every
retained field: five buffer/destination words, five destination writes,
one publication, one handoff, one retry, no UART errors or post-stop activity.
Sequence advanced 1 to 2 with nonce 3203188543; 128 post-claim bytes produced
CRC 0xAA4F. RX totaled 302212 bytes; two TX attempts/completions totaled 188.
The tests also rebuilt identical v2 archives twice and verified all original
input pins, including the unchanged historical physical-result.md.

`INDEPENDENT_DECODE_PASS` means independently decoded historical wire data
agrees with the bounded fixture contract and retained result. JSON output
includes computed/stored CRC pairs, payload, snapshot and both reports.
The intervening trace traffic is not decoded or CRC-qualified by this reader.
Host send records are not logic-analyzer TX evidence. This adds no FPGA
readback, installed-bitstream identity, independent physical reproduction,
arbitrary-duration claim, general loader qualification, authentication,
hardware authorization or release approval.
