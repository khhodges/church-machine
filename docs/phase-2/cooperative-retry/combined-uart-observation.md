# Combined starter UART observation

Local RTL only. This does not authorize a vendor build, pin assignment, transfer,
or physical operation. Approved application and received-LUMP bytes are unchanged.

The combined top replaces the obsolete five-word diagnostic transmitter with a
read-only observer on the same packet arbiter and UART TX pin. Image control
replies keep their existing channel. CLP1 receipt and READY/COPYING locks are
unchanged; the observer has no receiver, RAM write port, halt, watchdog kick,
pause, or control authority.

## Wire format

`UCV4`, sequence (32-bit), admitted image SHA-256 (32 bytes), observer input
SHA-256 (32 bytes), sixteen 32-bit fields, CRC-CCITT (16-bit, seed `0xffff`).
All integers are big endian. CRC covers everything before the CRC, as in UCV3.
Total: 138 bytes. CRC detects corruption, not sender authentication.

Fields, in order: epoch, receiver phase, transaction, receiver state,
publication bitmap, result count, three results, three corresponding retired
PCs, USER B progress, successful watchdog renewals, sticky fault, remaining ticks.

Input identity hashes canonical JSON of both complete revision records and both
complete caller records (sorted keys, compact separators), including exact words,
digests and observation addresses. `input_identity` and `decode_report` in
`combined_observer.py` are the host reference. The source manifest separately
binds this observer and the full candidate configuration; wire evidence is not
an independent hardware attestation of the source configuration.

Publication bits observe actual arbitrated CPU RAM writes: the old revision's
exact complete header, and the new revision's Namespace integrity word, each
written last by its respective publication sequence. Phase observes SYSTEM's completed
receiver commit; SHA acceptance alone is not publication. Result slots latch
the first three successful caller observation retirements, including their PCs.
They never overwrite a prior result while UART is busy. Progress counts the
retained USER B progress instruction; fault is sticky for the epoch.

Snapshots are atomic and immutable while sent. The observer waits a quarter
second after each packet, without delaying execution. Counters keep advancing
during arbitration/backpressure. BEGIN resets execution-owned observations and
releases the arbiter; a byte already on the wire may drain. A host must
resynchronize on magic, validate complete length and CRC, check both expected
identities and epoch, and require increasing sequence numbers within that epoch.
Never join old and new epoch snapshots. Sequence starts again at one.

## Reproduce local evidence

From the workspace root, prepare a **fresh** ignored output directory:

```sh
python3 docs/phase-2/cooperative-retry/prepare_combined.py \
  --output generated-artifacts/combined-uart-check
ROOT="$PWD"
cd generated-artifacts/combined-uart-check
PYTHONPATH="$PWD:$PYTHONPATH" python3 -m pytest \
  "$ROOT/docs/phase-2/cooperative-retry/test_combined_top.py" \
  "$ROOT/docs/phase-2/cooperative-retry/test_combined_observer.py" \
  "$ROOT/docs/phase-2/cooperative-retry/test_combined_receiver.py" -q
```

Run from the prepared directory so the retained hardware package wins over the
workspace production package; preserve inherited Python package paths.
The full test decodes UART pins for lazy publication with no completed result,
old/new/old results `17/29/17`, and clean observations after image replacement.
Internal signals remain supplemental safety assertions, not the result source.
The generated `combined-evidence.json` records decoded snapshots and exact
source/input hashes. The fixed enabled watchdog is unchanged.

## Local qualification result (2026-11-11)

Combined observer, receiver, and UART-pin acceptance: **12 passed**.
Lifecycle and SHA regression checks: **17 passed**. The expanded observer
reset/fault test also passed separately. Only the retained harness's two
Amaranth domain-placement deprecation warnings were reported.

Prepared source configuration:
`a6e6223126248bf4ac07edabe891f3cfd123ce0865d5bcc5d06b8fe2c08de8d7`.
Observer inputs:
`9ba8059e092d284b7ba8da89fa7b5d3faf609284bee6ce3cdf561c69731d982b`.

Decoded UART snapshots:

| Observation | Epoch / sequence | Publication bits | Results | Renewals | Fault |
| --- | --- | --- | --- | --- | --- |
| Lazy old publication, RETURN pending | 1 / 14 | 1 | none | 384 | 0 |
| Side-by-side adoption | 1 / 23 | 3 | 17, 29, 17 | 639 | 0 |
| Replacement all-waiting image | 2 / 4 | 0 | none | 85 | 0 |

The new epoch reported zero progress and cleared all result/PC slots, while
watchdog renewal continued. These are local RTL observations, not physical-board
measurements or bitstream qualification.
