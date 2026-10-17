# Alice/Mallory tuple validation

## Simulator evidence

The isolated tuple lab has seven bounded scenarios: Alice's own write/read,
Mallory's absent-capability read, Mallory's own-tuple read, foreign indexed
read/write attempts, and read/write attempts past Mallory's authorized Thread
range. The capability rules are unchanged; the range gate uses the owning
Thread's Namespace descriptor, not a tuple ACL or the narrower heap layout.

The following checks passed for this implementation:

- `node simulator/test_alice_mallory_tuple_lab.js`
- `node simulator/test_alice_mallory_tuple_ui.cjs`

The checks cover exact first-fault instruction and reason, unchanged data
registers and all 58 Alice tuple words, a successful read of Mallory's own
tuple, and bounded Run/Step/Reset behavior. They are simulator evidence only.

## Deferred release validation — 2026-10-17

The user authorized deferring unfinished release checks to FPGA qualification
if the local validation timeout could not be resolved. Two completion attempts
exhausted their waiting budget while these configured commands were unfinished:

```sh
python3 scripts/check_method_dispatch_release.py --verify-bundle && python3 -m pytest scripts/test_wukong_build_provenance.py -q
python3 -m pytest scripts/test_method_dispatch_release.py -q && python3 scripts/check_method_dispatch_release.py
```

The available replay logs reported passing individual cases, but neither run
produced a final release evidence report. The release driver allows up to four
hours for its replay matrix. Partial progress and a supervision timeout are
neither a release pass nor evidence of an RTL assertion failure.

These commands remain deferred, not waived from hardware acceptance. Run them
with sufficient supervision time during FPGA qualification, preserve complete
source-bound evidence, and separately perform the required physical-board
checks against the exact candidate bitstream. Board testing does not replace
the unfinished release replay or provenance checks.

The main project subsequently separated full release replays from automatic
completion validation, retaining gate/provenance regression tests in the
automatic checks. This removes the need for a completion-validation bypass;
it does not supply the deferred full replay or board evidence.

After incorporating that main-project update, both tuple checks above and
`node simulator/test_alice_mallory_lab_ui.js` passed.

This tuple change does not weaken release assertions or change capability
rules, saved Namespace data, or hardware artifacts.
