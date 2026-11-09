# Handoff-only RTL results

Date: 2026-11-09  
Execution level: Amaranth RTL simulation on the development computer.
No browser simulator, vendor build, FPGA operation or production RTL change.

## Result

**6 passed, 6 deselected in 14.75 seconds.** The six deselected cases are the
pre-existing full handoff/resume/retry cases; they were not rerun.

| Case | Result | Observed fault | Final NIA | Transition memory writes |
|---|---|---|---|---:|
| Successful handoff | PASS | None | `0x2010` | 32 |
| Stale SYSTEM version | PASS | `0x1D` | `0x4008` | 0 |
| Damaged SYSTEM frame | PASS | `0x1D` | `0x4008` | 0 |
| Stale USER ownership | PASS | `0x1D` | `0x4008` | 0 |
| Corrupt target integrity | PASS | `0x0A` | `0x4008` | 0 |
| Unavailable CALL from SYSTEM | PASS | `0x11` | `0x200C` | 0 |

All negative cases preserved the pre-attempt architectural registers, flags and
memory and produced no retirement. These are preflight controls, not a general
rollback guarantee.

## Successful transition evidence

- SYSTEM active GT: `0x03A30002`.
- SYSTEM continuation addressed: `0x2010`; no instruction was supplied there.
- DR0–DR6: `[0, 0xF8810100, 0, 5, 0, 6, 0x02070004]`.
- Final flags: `0x2` (Z set; restored SYSTEM N/C/V unchanged).
- Saved USER executable GT/frame: `[0x4A000005, 0x900030F3]`.
  Frame continuation remains the original CALL; original USER flags preserved.
- All twelve saved USER capability GT words, including CR2's retained target
  authority, matched the pre-CALL state. Original USER DRs were preserved.
- No CALL retirement and no callee-body insertion. Target header remained
  `0xF8000001`, with `cw=0`.
- All transition writes were within USER's context or SYSTEM's indicator.
  Observed architectural restoration began only after all USER save writes.
- The SYSTEM continuation became visible with the required injected data and
  flags. CR13 stayed unchanged and the boot-only marker remained consumed.

The observer ended at the handoff boundary. It did not execute SYSTEM's next
instruction, send a request, simulate delivery, restore USER or retry CALL.

## Reproduction and retained evidence

```sh
python3 -m pytest hardware/test_phase2_guarded_llr.py \
  -k handoff_only -x -v -p no:cacheprovider -o junit_family=xunit1 \
  --junitxml=generated-artifacts/handoff-only-rtl/results.xml
```

Tools: Python 3.12.11, Amaranth 0.5.9, pytest 9.0.3.

Private fixture hash:
`dc601fe3f0a79b5adaca03d2135532a2151235b2b20125d0080ce752ec6a5ee1`.
Hash encoding is UTF-8 JSON of sorted `(address, word)` pairs, with compact
separators. This is a fixture identity, not a deployed binary image digest.
Each case also records its post-perturbation attempt-fixture hash.

Retained under the Git/deployment-excluded directory
`generated-artifacts/handoff-only-rtl/`:

- `source-manifest.json`: hashes of hardware Python sources/tests and tool versions.
- `results.xml`: per-case outcomes and structured evidence properties.
- `evidence.json`: extracted registers, flags, state changes, writes, issued
  instructions, saved frame/homes and observation endpoints.
- `run.log`: complete test output.

Source hashes were checked unchanged after the run. The observer retains the
existing 3,000-clock per-operation bound; no machine timeout was introduced.
Accepted fixture words and retirement addresses supply instruction evidence;
the poisoned-fetch `retire_instr` limitation is not hidden or treated as fixed.

## Scope and next gate

Changes are confined to test harness/assertions and documentation. The existing
full-retry test calls the same shared harness with its default behavior;
the new endpoint exits before its host memory-patching section.

This is **bounded current-RTL handoff evidence**, not full ISA, watchdog,
transport, delivery, liveness, resume-authority or physical-board acceptance.
Metadata includes zeros; distinct-nonzero F.23 coverage remains separate.
No further tests or board operations are implied.

Next recommended review: identify the exact minimal hardware candidate delta
and its watchdog safety boundary before any vendor build. A passing current-RTL
fixture does not certify a selective backport into the installed baseline.

See [test specification](handoff-only-test-spec.md) and
[baseline assessment](hardware-first-baseline-review.md).
