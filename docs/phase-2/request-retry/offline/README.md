# Bounded FPGA loading result — offline reproduction

This package replays **historical host evidence**, not an FPGA, simulator or
new physical experiment. No serial device, board command, synthesis tool,
network connection, credential, pyserial, or third-party Python package is
needed. Do not run the original responder or program hardware for this replay.

## Replay on a clean machine

Use Python 3.9 or newer. Obtain the ZIP and its separately supplied SHA256SUMS
from the bundle provider. Compare the ZIP SHA-256 against that supplied value
before extraction (`sha256sum -c SHA256SUMS` on Linux). Extract into a new
directory, then run:

```sh
cd request-retry-offline
python3 -B replay.py
```

On Windows, `py -3 -B replay.py` is equivalent. Only local files are read.
Exit code 0 and `OFFLINE_REPLAY_PASS` mean the included capture, event log and
result agree under the retained parser. Any mismatch exits nonzero. No replay
output is written into the evidence directory. Hashes detect changes relative
to the supplied manifest; an unsigned manifest is not independent provenance
or authentication. Obtain the archive digest through a trusted channel.

Expected output: RX 302212, TX 188, two attempts and two completions; frame
offsets 297280 / 301628 / 301920 / 302066; nonce 3203188543; post-claim CRC
43599 (0xAA4F); snapshot [3, 16396, 34013188, 13].
Baseline and post-claim report equality to result.json is checked field by
field, including five accepted/destination words, five writes, one
publication/handoff/retry and zero post-stop activity. Receive boundaries,
verification events, attempted TX bytes and completion counts are checked in
their original order. Relative timestamps are checked for ordering, not used
as independently measured latency.

## Publication-safe inventory and provenance

`manifest.json` lists SHA-256 and size of every packaged file, plus exact
original input hashes and transformations. `capture.bin`, `result.json`,
`protocol.py` and `physical-result.md` are unchanged retained bytes.
`events.jsonl` removes only the opening machine-local serial-port label and
normalizes JSON formatting; it preserves all relative times, receive chunks,
transmitted bytes, counts, event order and the public challenge nonce.
This nonce is diagnostic correlation data, not a credential.

`session.py` contains the verbatim Session class extracted from the pinned
responder source, plus only its offline imports. The serial driver, CLI,
random nonce generator and pyserial import are deliberately not distributed.
`replay.py` is the new agreement checker. `README.md` is this guide.
No BIT, vendor reports/checkpoints, signing material, pairing grants,
environment variables, local directory names or unrelated uploads are copied.
The raw binary is the pinned diagnostic RX capture, not redacted or truncated;
it contains diagnostic wire frames and register/memory observations. The
scope here is this reviewed fixed fixture, not a generic capture sanitizer.

The historical report is included unchanged: its build-verification statements
describe the earlier review, **not checks performed by this bundle**. BIT and
manifest hashes quoted there are historical references, not packaged inputs.
Original files and build-time flags are never rewritten.

## Evidence limits

This reproduces the parser result for the bounded fixed five-word
request/receive/retry and 128-byte post-claim challenge. It is not a separately
authored protocol implementation or independent physical reproduction.
Host events record send attempts/completions, not logic-analyzer TX.
The board report supplies challenge-receipt evidence. Programming-success
output and FPGA readback were not supplied; the named uploaded BIT hash
does not independently establish installed silicon identity.

No general LUMP loader, on-device general SHA-256 verifier, sender
authentication, enabled execution watchdog, arbitrary-duration immunity,
comprehensive malformed-input coverage, analog UART margin, complete
mediation, formal security proof, production readiness or three-demonstration
starter qualification is established. This does not authorize release,
hardware operation, application replacement or revision adoption.

License/redistribution: the rights holder explicitly authorized GPL-3.0 for
the entire offline package, including Session, protocol, offline tooling,
guide and retained evidence. See `REDISTRIBUTION.md` for the recorded decision,
scope, exclusions and release requirements. GPL-compliant commercial use is
permitted; an optional separate commercial license can cover permissions
outside GPL-3.0. This is not a repository-wide license or an instruction to
publish. No third-party runtime code or vendor binary is included. Python's
standard library is supplied by the evaluator's interpreter.

## Rebuild from the repository (maintainers only)

From the repository root:

```sh
python3 docs/phase-2/request-retry/offline/build_bundle.py
python3 -m unittest discover -s docs/phase-2/request-retry/offline -p 'test_*.py'
```

The builder requires the three original uploads named in
`physical-result.md`, the pinned retained parser/protocol/report, and these
offline tooling files. Missing or altered inputs fail closed. A source checkout
alone lacks ignored uploads; obtain the packaged ZIP rather than fabricating
substitutes. Output is confined to a new directory beneath
`generated-artifacts/`, excluded by both .gitignore and .replitignore.
Use `--out generated-artifacts/ANOTHER_NEW_DIRECTORY` for another build.
The archive uses fixed member timestamps and sorted inventory for reproducibility.
No source evidence is modified, no existing bundle is overwritten, and no
build/programming command is invoked.

The publication scope follows
`docs/phase-2/cooperative-retry/release-publication-audit.md`, especially its
evidence-class separation, bounded-loading claim and safe-artifact inventory.
