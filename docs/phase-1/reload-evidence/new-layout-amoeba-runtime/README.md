# New Layout — both corrected CHANGE revisions bound

Offline only. Saved designs, catalog LUMPs and previous trial images are unchanged.
No physical commands were sent or queued, and nothing was synthesized or flashed.

## Exact image

- Complete 65,536-byte little-endian image.
- SHA-256: `2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451`.
- Parent: retained ActorManager runtime trial.
- Full compiler-built AmoebaStartup API LUMP rebound through the existing linker.
  Original binding was reproduced first against the frozen guarded destination.
- The only changed image word is 3653 (byte `0x3914`):
  `0x27110000` → `0x27010000`.
- Namespace layout, entry at `0x3504`, guard 23971, Namespace version 46,
  initial Thread state and all capability rows remain unchanged.
  In particular, startup's supervisor GT retains root Thread version 419.
- `evidence.json` records exact artifact identities, localization, layout and
  parent chain. No UART byte-order conversion was performed.

## Full-top replay: observed security stop, not hardware acceptance

`full-program-result.json` records the bounded full Wukong model run.
Alice executes and returns; startup yields to ActorManager; ActorManager
switches to Thread.3 and startup calls Mallory.

At cycle 40892, Mallory's `LOAD CR1, CR6, #2` at byte `0x2e08` faults with
**BOUNDS (0x08)**. CR12 identifies Thread.3 (slot 12, base `0x2800`).
Her C-list has only rows 0 and 1. The failing LOAD does not retire and the
following DREAD does not execute. No authority was added to avoid the fault.

This reaches the authored denied-access stop. However, the program comments
expect **NO_CAPABILITY**, whereas the current RTL reports **BOUNDS**. These are
not silently equated. The probe exits 1, retaining the actual fault; this is not
a normal-halt or exact fault-code conformance pass.

The model starts from the image directly, so it proves neither UART transfer,
installed-byte equality, currently installed bitstream support nor physical
execution. Those remain pending. This image remains explicitly non-installable.
The existing loader's ascending-profile incompatibility is not waived.

## Reproduction

Use fresh output directories/files; existing evidence is never overwritten.

```
python3 scripts/prepare_amoeba_runtime_trial.py /tmp/new-amoeba-runtime
python3 scripts/probe_amoeba_runtime_trial.py /tmp/new-amoeba-replay.json
python3 -m pytest tests/hardware/test_amoeba_runtime_trial.py -q
```

Before a physical trial, resolve the fault-category expectation and establish
an approved, compatible loader/installed-board path. Obtain fresh board identity
and explicit trial confirmation; never auto-upload on reconnect.
