# Prepared Thread release replay

**Corrected architectural requirement:** The initial ordinary CHANGE into
Thread.2 must fault with STACK_UNDERFLOW because its poison-root frame has no
suspended continuation. Boot.Thread works because the boot sequence explicitly
executes CALL CR0 after CHANGE. Ordinary CHANGE must not supply an implicit CALL.
The earlier five-loop result relied on an incorrect simulator exception and is
withdrawn as evidence of correct execution.

**Approved correction:** Newly generated Thread.2 and Thread.3 now contain a
real CapabilityTest PC-0 continuation above the poison root. Ordinary CHANGE
pops this initial frame; it does not execute an implicit CALL. Boot.Thread's
root and subsequent explicit boot CALL CR0 are unchanged.

This is isolated simulator evidence, not approval, installation, RTL evidence,
or permission to flash hardware. No selected LUMP was substituted or compiled.

## Reproduce

From the repository root:

```sh
node scripts/probe_selftest_loop.js --selected > /tmp/thread-saved.json
node scripts/probe_selftest_loop.js --selected --regenerate > /tmp/thread-legacy.json
# The saved-image probe exits 1; both newly generated candidates pass.
node scripts/probe_selftest_loop.js --selected --regenerate --preserve-prepared > /tmp/thread-preserved.json
python3 -m pytest tests/boot/test_prepared_thread_entries.py -q
node simulator/test_fresh_thread_root_activation.js
node tests/simulator/sim_boot_three_instruction.js
```

The probe reads the exact Namespace selection, checks binary hashes and resident
instructions, and generates only in a temporary catalog copy. JSON includes
input hashes, image hash, entry homes/root frames before boot, first 32 steps,
CALL/RETURN continuations, CHANGE events, faults, and the last 15 steps.
It checks protected input hashes again on exit. Current input changes require
a fresh replay; the results below do not transfer to another revision.

## Exact observed inputs and results

| Input | SHA-256 |
| --- | --- |
| `SelfTest.1.8b19abd7.lump` | `65f6e254b1f0a164f2d2163239f28e4521d792d8d96800b26cdbff607f77b5de` |
| `CapabilityTest.1.68be391a.lump` | `210e01b002004bc1bdbc7a01d2caa0337aae12eb54b1c13d1fcd7c914fe74a77` |
| `WukongCallHome.1.b29b38e3.lump` | `912eb704c1eedb125de02f00403c425f5fe0d10c7768038be5c06bf6961612af` |
| Saved prepared image | `04d250d130b34c2e18fb23a4ffe9687ea21b35995c99e11c1e5ad9b03ce34a2c` |
| Historical root-only regenerated image (not current output) | `7af0cfb04d60b215db2703edd556faaedda4eb4f172913f90810a4ff0023312a` |
| Current initial-frame candidate (with or without explicit entry preservation) | `6a086ac8f5bf260bf76129638be211dd670f7490506c73a362dbd3b5c43435d7` |

Configuration: boot entry NS[10], 16384 Namespace words, 64 slots,
three 256-word Threads with 32-word stacks. Saved Boot.Thread, Thread.2,
and Thread.3 each have CR0 and root Enter `0x4a00000a`, indicator
`0x10f1`, root frame `0x0ffff0f3`.
Historical generation changed secondary entry choices to `0x4a000006`.
Current Thread.2/3 have protected indicator `0x10ef`, initial Enter
`0x4a00000a`, and initial packed frame `0x10f1` (NIA=0, SZ=1, saved STO=241).
The root Enter and `0x0ffff0f3` poison frame remain underneath.

With corrected semantics, the unchanged saved image faults at step 19:
CapabilityTest PC 20 attempts CHANGE from Thread slot 1 to slot 11. The fault is
STACK_UNDERFLOW, identifying Thread slot 11's poison root as having no suspended
continuation. Both newly generated images instead restore the real PC-0
continuation and complete five intended loops, with ten matched CALL/RETURN
continuations, six CHANGE events, stable stack depth and no faults. This is new
evidence after correcting the frame format, not reuse of the invalid historical
five-loop result. No selected code or immutable artifact was rewritten.

Regressions cover rejected instruction/manual CHANGE without committing either
Thread's private context, successful boot, ordinary suspended-frame resumption,
and self-CHANGE using its actual continuation. Namespace access bits can still
be set by capability lookup; they are not committed Thread context.

## Explicit release input contract

```python
candidate = generate_boot_image(
    cfg, private_catalog_directory,
    prepared_thread_image=exact_saved_image_bytes,
)
```

This keyword is opt-in to keep legacy factory generation separate. Explicit
`None`, empty bytes, stale provenance/selected artifacts, changed Thread
inventory/count or generation/geometry, non-E entry homes, mismatched boot selection, and
noncanonical/suspended frames fail with ValueError. No fallback occurs after
an explicit preparation input fails. Omitting the keyword remains legacy
factory initialization and is **not preservation of a prepared release**.

The preparation image must match its hash-bound provenance and every selected
resident artifact. Each independently supplied entry is validated against the
generated destination generation, descriptor authority, and entire localized
target allocation. Placement seals may change when bodies relocate. Only CR0
and matching entry identity transfer; fresh root and initial frames are generated
canonically. Data registers, stack contents, flags, and other capability homes
are never copied. Thread.3 may intentionally differ from Boot.Thread/Thread.2.

The explicit preservation path accepts validated root-only or initial-frame
preparation as entry identity input, then constructs clean initial frames for
secondary Threads. Arbitrary suspended runtime state is still rejected.
The unchanged saved image remains unfit for its initial Thread.2 CHANGE; the
new candidate is not installed. No publication
endpoint, runtime reset behavior, approvals, saved image, or hardware artifact
was changed here.

## Validation status

Focused validation passed: 17 prepared-entry regressions (including rejection of
three-to-two and three-to-one Thread-count reductions, malformed initial/root
frames, and repeatable initialization), plus the 9 selected SelfTest execution
tests. The poison-root/initial-frame JavaScript checks, all 22 one-GT CHANGE
checks, the three-instruction boot test, and browser cache-key checks pass.

Non-executing frame inspection still accepts canonical roots; ordinary CHANGE
explicitly rejects them. This avoids breaking Setup-only frame inspection in
the Alice/Mallory lab.

Broader legacy checks remain blocked and are not claimed green:

- `node simulator/test_round_robin_threads.js` reaches the legacy static
  descriptor-shape assertion (“exact manual selection invokes the decoded
  CHANGE descriptor shape”). Its initial-frame fixtures and bounds have been
  reconciled, but that assertion still expects the older CHANGE call shape.
- `node simulator/test_alice_mallory_lab_ui.js` passes Setup-only but fails its
  roundtrip scenario because the driver executes the retired indexed/two-register
  CHANGE form.
- `node simulator/test_alice_mallory_thread_setup.js` rejects two catalog
  candidates where it expects a unique saved Alice binary.

These unrelated encoding/catalog test migrations were not used as grounds to
weaken CHANGE or rewrite saved LUMPs.

Earlier completion attempts reported `Incomplete or stale release evidence`
for the checks below. The final configured completion validation passed,
including both checks, and the task completed:

```sh
python3 scripts/check_method_dispatch_release.py --verify-bundle && python3 -m pytest scripts/test_wukong_build_provenance.py -q
python3 -m pytest scripts/test_method_dispatch_release.py -q && python3 scripts/check_method_dispatch_release.py
```

No release-check waiver or change to unrelated release machinery was made.
The broader legacy checks listed above are not part of that passing result.
Successful simulator loops and configured completion checks do not constitute
approval to install this candidate or flash hardware.
