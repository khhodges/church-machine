# Current-format guarded Thread checks

The two core Thread suites use the separately identified
`guarded-thread-current-v1` synthetic fixture in
`tests/hardware/current_guarded_thread_fixture.py`. It constructs fresh words
directly, without reading, converting, or overwriting an archived image.
It is local simulation input, not a release, boot image, or hardware candidate.

The fixed guard versions are Namespace 46 and Thread 419 (guard 23971).
The entry object has version 73; the MMIO object has version zero.
Every populated descriptor uses a 21-bit limit, version bits 21–29, and a
seal computed over its original stored words. Typed Thread/entry references
carry the matching versions. Resident locations are words; MMIO is byte-addressed.
The entry body is inert: these tests do not perform the final CALL.

All six activation cases first require successful structural validation and
Namespace admission. Both successes exercise restoration, and four negatives
exercise VERSION, SEAL, OUTFORM_UNAUTH and BOUNDS without partial CR/DR/flags
restoration. Existing no-write, CR13/CR15 preservation, M-state and one-shot
marker checks remain active.

All twelve structural cases require Namespace admission before observing the
Thread outcome. Fault cases retain their exact fault type and slot 2 checks.
The success case still reboots with a resealed version mismatch and requires
fresh rejection rather than retained validation.

## Later failure diagnosed

After the profile correction, the old `root_frame` mutation (XOR bit 13)
was accepted: it changed the saved PC from the root sentinel `0x7fff` to
`0x7ffe`, selecting the supported resume path. Its frame pointer was already
valid for that path. This was not a malformed root frame anymore.
The corrected mutation flips frame-indicator bit 12, retaining the root PC
sentinel while violating the exact root-frame encoding. The expected
STACK_CORRUPT fault is unchanged; no RTL checks were relaxed.

## Verification

Result: **43 passed**, including all 18 assigned core cases, the fixture
contract, historical rejection controls, and Namespace reader controls.

```sh
python3 -m pytest \
  tests/hardware/test_current_guarded_thread_fixture.py \
  tests/hardware/test_core_thread_activation.py \
  tests/hardware/test_core_thread_validation.py \
  tests/hardware/test_guarded_new_layout.py \
  tests/hardware/test_ascending_namespace_bootstrap.py -q -p no:cacheprovider
```

Historical rejection remains in `test_guarded_new_layout.py`, including its
exact candidate hash/reconstruction checks. The archived candidate and guard
remain unchanged. These results establish local guarded-core behavior only,
not unguarded behavior, full-program execution, or physical-board acceptance.
