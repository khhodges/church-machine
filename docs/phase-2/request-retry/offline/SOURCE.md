# Corresponding Source and release scope

This archive supplies source directly, not a written offer or a download-only
promise. The Python files are the preferred editable form of all distributed
programs. No compiled executable, FPGA firmware, vendor tool, interpreter or
third-party runtime is distributed.

| Supplied file | Role |
| --- | --- |
| protocol.py | Complete retained protocol definitions and parser helpers |
| session.py | Complete extracted Session implementation with offline imports |
| replay.py | Offline entry point, inventory and evidence checks |
| independent_decode.py, independent-reader.md | Independent reader source and evidence limits |
| build_bundle.py | Repository extraction and standalone repacking script |
| test_replay.py | Regression test source for maintainers |
| capture.bin, events.jsonl, result.json | Fixed historical inputs to replay |
| README.md, physical-result.md | Editable guide and unchanged historical report |
| COPYING, NOTICE.md, REDISTRIBUTION.md, SOURCE.md | License, notices and source/scope information |
| manifest.json | Sizes, hashes, original provenance and transformations |

Python 3.9+ with its standard library is the only runtime prerequisite.
There is no compilation, installation, special key or authorization step.
From the extracted directory run `python3 -B -S replay.py`.

To recreate the exact archive from its supplied source and data, without
repository access, original uploads, network access or hardware:

```sh
python3 -B -S build_bundle.py --from-bundle . --out ../offline-repacked
```

The output directory must not already exist. Repacking validates the inventory
and all hashes and executes the replay before writing the archive. On the same
Python/zlib implementation it reproduces the archive bytes; different compressor
versions can produce a different ZIP digest with identical member bytes.
The ZIP, manifest and SHA256SUMS are written together.

For development, edit the Python source directly. After intentional edits,
update the affected manifest size/hash records before repacking; record your
changes and date in a prominent notice. A hash manifest is an integrity
inventory, not a signature or a restriction on modification.

The original repository builder mode and test_replay.py additionally require
the pinned historical uploads and responder in the repository layout described
in README.md. Those are provenance/extraction tests, not prerequisites for
running, modifying or repacking this distributed program. The excluded serial
driver is neither imported nor needed by the complete extracted Session.

## Excluded from this release

No FPGA BIT/MCS, vendor binaries, reports or checkpoints, hardware programming
tools, serial driver, pyserial, credentials, environment files, pairing grants,
signing keys, unrelated uploads, or surrounding IDE source is conveyed.
Historical references to them do not include them or grant rights to them.
The raw capture is the reviewed diagnostic fixture, not FPGA object code.
This archive does not convey a User Product or software installed into one;
no Installation Information or signing secrets are needed for offline replay.

Use only the explicit archive inventory; never ZIP the repository or upload
directory wholesale. Verify SHA256SUMS, every manifest member, the full COPYING
hash and replay before a separately authorized release. Retain notices and
provide the source in the same archive. Publication remains a separate decision.

COPYING is the unmodified https://www.gnu.org/licenses/gpl-3.0.txt, obtained
2026-11-10, 35149 bytes, SHA-256
`3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`.
