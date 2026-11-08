# Guarded startup baseline: 18 failures explained

Date: 2026-11-08. Read-only diagnosis; no implementation correction applied.

## Finding

All 18 failures share **historical fixture/current guarded-profile drift**.
The current RTL correctly rejects the retained candidate's Namespace self
descriptor before admitting the Namespace. The tests still expect that old
candidate to reach Thread checks. This is not evidence of 18 independent
Thread defects, nor a memory-response timing defect.

The retained `baseline.xml` records 141 tests, 123 passes, 18 failures, no
errors or skips (130.396 seconds). All failures are in the two assigned
modules. The six activation cases stop at their initial `assert not
fault_valid`; the twelve validation cases stop at `assert
boot_namespace_admitted`. Neither group reaches its intended observation.

## Exact inputs and provenance

Both modules load
`docs/phase-1/reload-evidence/new-layout-guarded/candidate-le.bin` and
`guard.json`. The candidate is 65,536 bytes, SHA-256:

`866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879`

Guard: 23971 = `(46 << 9) | 419`; Namespace version 46, Thread version 419.
The `inputSha256` in the guard file identifies the **original pre-guard
source**, not the candidate. Its difference from the candidate hash is not
corruption.

Baseline XML SHA-256:
`55da886572f3f56265420eb9cf8c3dc2f74d072d997c1defcec118dffb131b1e`

Baseline log SHA-256:
`aa7123ee533811bd6f144ce35f1e32f8e6ce593ce098779feab94548ff72cd77`

The historical candidate README matches the actual candidate hash. Its old
component-test success describes the earlier RTL, not current acceptance.
The October 28 format alignment (`57c3b7cd7`) changed the guarded readers to
21-bit limits / version bits 21–29 and explicitly changed
`test_guarded_new_layout.py` to require rejection of historical guarded
bytes. The two assigned test modules were not aligned by that change.

## First causal fault

The metadata header specifies 64 slots, so the table occupies 256 words and
its self-descriptor limit must be 255 (`0xff`).

| Input | Exact word | Historical interpretation | Current interpretation |
|---|---|---|---|
| Namespace authority, word 5 | `0x005c00ff` | limit 255, version 46 at bit 17 | limit `0x1c00ff`, version 2 at bit 21 |
| Thread authority, word 9 | `0x034600ff` | limit 255, version 419 at bit 17 | limit `0x600ff`, version 26 at bit 21 |

`hardware/ascending_namespace.py`, `CHECK`, tests
`(words[5] & 0x801fffff) != table_words - 1`. Here that is
`0x1c00ff != 0xff`, so it emits reader error **2 (self identity)**.
This precedes self-seal verification and the version-pair comparison.
`hardware/core.py` maps reader error 2 to **BOUNDS (8), fault slot 1**.
No Namespace commit occurs, so Thread validation never starts.

The Namespace version would also be misinterpreted, but VERSION is **not**
the observed first fault. The Thread descriptor is not read at all. Its
misinterpretation is a static observation, not a later runtime fault claimed
by this investigation.

## Isolated replay evidence

An observation-only wrapper ran the original test functions with their
original inputs, mutations, memory-response cadence and assertions. It
intercepted the simulation context only to record reads and capture state
at the assertion. It did not change RTL, inject responses, translate words,
skip assertions, or allow a failed test to continue.

| Module | Cases replayed | Result for every case |
|---|---|---|
| Activation (6) | exact, restore_values, home_version, entry_seal, outform, slot_zero | BOUNDS 8, slot 1, before structural validation |
| Validation (12) | None, version, seal, base, limit, type, size, stack, indicator, root_gt, root_frame, cr0 | BOUNDS 8, slot 1, before Namespace admission |

For **every** case:

- `fault_valid=1`, `boot_namespace_admitted=0`.
- `boot_thread_validated=0`, `boot_thread_activated=0`, `boot_complete=0`.
- CR12 GT and CR15 GT remain zero.
- Memory request addresses are exactly `0,0,4,4,...,28,28` (byte addresses).
  There are no slot-2 descriptor or Thread-body reads. Repeated request
  addresses are consistent with the reader's armed handshake.
- The original no-write assertions remain active and do not fail.

Both test harness cadences produce the same first fault. All per-case
mutations lie outside the first eight words, so they cannot affect this
Namespace failure. The original tests' later local reboot branches are not
reached.

Separate component controls: **21 passed in 0.70 seconds**:

```sh
python3 -m pytest \
  tests/hardware/test_guarded_new_layout.py::test_historical_guarded_bytes_are_rejected_by_current_rtl \
  tests/hardware/test_ascending_namespace_bootstrap.py \
  -q -p no:cacheprovider
```

These include exact historical rejection, current geometry, nonzero
current-format versions, high-limit rejection and malformed metadata/seals.
They corroborate the field-layout diagnosis; they do not certify full-core
Thread activation.

Local diagnostic evidence (ignored generated output, not release artifacts):

- `generated-artifacts/phase2-rtl-readiness/diagnose-startup.py`
- `generated-artifacts/phase2-rtl-readiness/startup-diagnostic.json`
  (all 18 traces, terminal state, exact input/test/RTL hashes)
- `generated-artifacts/phase2-rtl-readiness/startup-controls.log`

Replay command, from the workspace root:

```sh
python3 generated-artifacts/phase2-rtl-readiness/diagnose-startup.py
```

The wrapper's successful exit means it reproduced and explained the failures;
it does **not** mean the original tests pass. The baseline files were not
overwritten.

## Guarded versus unguarded

Both failing modules explicitly instantiate
`ChurchCore(expected_boot_guard=config["guard18"])`. That selects the ascending
Namespace reader and guard path.

`ChurchCore()` without the guard retains the historical bootstrap path.
The core's historical boot-state switch is disabled when a guard is supplied.
Removing the guard is not a correction: it changes the execution profile and
does not make this ascending candidate supported. There is no fallback after
guarded failure. This investigation does not claim a new unguarded regression,
and did not use unguarded success as a substitute for guarded coverage.

## Proposed correction — not applied

1. Preserve the archived candidate and its guard/evidence byte-for-byte.
   Keep explicit current-RTL rejection coverage for it; do not make the RTL
   auto-detect the old format or weaken the self-geometry check.
2. Give the positive and targeted-negative Thread tests a **new, separately
   identified current-format fixture**, with independently pinned nonzero
   Namespace/Thread versions, correctly sealed descriptors and typed
   capabilities. Do not convert the archive in place or silently translate
   it during replay. Use the approved format across every referenced
   descriptor, not just slot 1.
3. Align mutation semantics with that fixture: the validation test's version
   and repeat-reset mutations currently flip bit 17; they must target version
   bits 21–29. Its limit mask currently uses `0x1ffff`; use the current 21-bit
   field. Keep version and seal faults independent by resealing only the
   intentional version/geometry mutations.
4. Preserve all substantive expectations: correct fault type and slot,
   no partial restore, no premature activation/writes, unchanged CR13/CR15,
   marker one-shot/provenance checks, and reset invalidation. Establish
   Namespace admission before attributing negative results to Thread checks.
   Derive cached-authority expectations from the new fixture's declared
   profile, without old-field reinterpretation.
5. Rerun all 18 cases against the new fixture and separately retain exact
   historical rejection. Any later failure is new evidence to diagnose, not
   permission to relax an assertion. Keep guarded and unguarded controls
   explicitly separate.

The adjacent `test_core_namespace_admission.py` also contains historical
fixture/bit-17 assumptions; it was inspected, not executed or changed here.
It should be considered in a bounded follow-up test audit, not counted among
these 18 failures.

## Scope and conclusion

Cause established; correction proposed, not implemented. No RTL, existing
tests, archived fixtures, live boot images or application files were changed.
No app restart, board contact, upload, reset or flash was performed.
All execution was local Amaranth simulation. Existing unrelated working-tree
edits were left untouched.

This removes ambiguity about the baseline blocker; it does **not** establish
passing Thread validation/activation, Phase 2 readiness, matching bitstream
behavior, or physical-board acceptance.

## Subsequent bounded Namespace-test audit (2026-11-08)

The adjacent `tests/hardware/test_core_namespace_admission.py` has now been
corrected and executed separately. This does not change the original 18-case
baseline or claim that those Thread tests have been corrected.

No replacement Thread fixture was available in this checkout: both Thread
modules still loaded the historical candidate. Rather than duplicate their
fixture correction, the Namespace suite uses a separately authored synthetic
metadata/self prefix, with 64 slots, a 255-word-index self limit, Namespace
version 302 and independently pinned Thread guard version 419. It is not a
bootable candidate: memory responses stop at Namespace admission, before any
Thread descriptor is consumed. A future shared Thread fixture may replace this
prefix only while retaining these Namespace-stage observation boundaries.

Current-format controls now establish:

| Control | First result |
|---|---|
| Valid self descriptor, including an independently changed unread Thread word | Namespace admitted; CR15 caches the exact current-format authority |
| Resealed version-bit-21 change (also with unread Thread corruption) | VERSION, slot 1 |
| Self seal corruption | SEAL, slot 1 |
| Metadata reserved word | BOUNDS, slot 0 |
| Resealed wrong self limit, high limit bit 17, or nonzero base; nonzero self reserved word | BOUNDS, slot 1 |
| Wrong version plus bad seal | SEAL, slot 1, before version comparison |
| Wrong geometry plus bad seal | BOUNDS, slot 1, before seal comparison |
| Exact hash-pinned historical candidate with its original guard | BOUNDS, slot 1; no admission or Thread reads |

Every first result requires reads of only the eight metadata/self words,
no memory/Namespace/c-list writes, no Thread validation or activation, no boot
completion, no CR12 activation and unchanged CR13. Failure controls require
zero CR15 and a held first fault without further memory reads. Positive
controls additionally reboot against a resealed current-format version change
and require VERSION at slot 1 with cleared admission and CR15.

Verification (local Amaranth simulation only):

```sh
python3 -m pytest tests/hardware/test_core_namespace_admission.py \
  tests/hardware/test_ascending_namespace_bootstrap.py \
  tests/hardware/test_guarded_new_layout.py::test_historical_guarded_bytes_are_rejected_by_current_rtl \
  tests/hardware/test_boot_pair_guard.py -q -p no:cacheprovider
# 46 passed, including 13 Namespace core controls.

python3 -m pytest tests/hardware/test_core_reset_marker_gate.py \
  -q -p no:cacheprovider
# 2 passed: separate unguarded bootstrap/marker controls.
```

The unguarded controls instantiate `ChurchCore()` and demonstrate that ordinary
bootstrap completion does not grant guarded marker admission. They are not
counted as guarded Namespace successes. No RTL, archived inputs, live images,
board state, or Thread-test fixtures were changed.
