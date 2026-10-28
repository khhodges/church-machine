# New-layout CALL evidence — 2026-10-28

## Status

The service/byte execution divergence is corrected. Following explicit user
approval, AmoebaStartup revision 4 was saved and adopted into live New layout
NS[21] through the normal protected server endpoints, including review and
approval-intent checks. All other Namespace rows and prepared Thread states
remain identical. Historical LUMPs, installed boot images, and FPGA were not changed.

The complete browser acceptance journey remains **blocked**, not passed. A fresh
live browser reproduced the missing-input problem at the protected-change dialog.
Even authorized DOM-button activation did not complete it. The browser was closed
and its write lease was allowed to expire naturally; no lock was stolen.

## Evidence chain

New layout is the original `ascending` profile, not an assumed named copy.

| Stage | Exact evidence |
|---|---|
| Selected historical caller | NS[21], AmoebaStartup revision 3, `ide.AmoebaStartup.1.6695f7d8.lump`, SHA-256 `0f8bc28aaebe1413508e14c5023466048a1359fc5689ea845bc8381559c12fb6` |
| Historical Full source | Retained variant decodes to bare `CALL ide.CapabilityTest ` on line 26. Source SHA-256 `418e290b40f5598351108cae30510040b8a5fb093138a9b0da0b4ed1b438c269` matches its signed compiler record. |
| Historical portable word | Word 3 is `0xF7000000`; symbolic contract names `ide.CapabilityTest`, without a method. |
| Historical bound image | Previously retained image hash `c68dbfd2ccd85840b3488a5756e0b8579a4992e6ad1f0dec3bbe821c9c0c4664` contained `0x17030001`: an invented selector-zero CALL. |
| Corrected source fixture | `tests/fixtures/amoeba-named-call.cloomc`, SHA-256 `894e2af58aa474f94fe613f236ee6cfe1d1e95d8a157ca0f970171d64381f567`; explicit `CALL ide.CapabilityTest, Run`. |
| Exact selected target | NS[10], CapabilityTest revision 7, `ide.CapabilityTest.1.8a9ae900.lump`, SHA-256 `5d4e013b3eaeda2482096b2fe1becfa74bc9bc1de7c0c0ecbd1e2d3d08294171`; embedded Run index 0, branchOffset 2. |
| Compile | Outgoing word 3 is `0x17040021`, independently observed in browser Compile and service Compile. |
| Private Save and reopen | Revision 4, `ide.AmoebaStartup.1.e37d50bd.lump`, SHA-256 `96e1ef3d5659107d68290011f883ca7589446064a85a85f15d00fb6d58255d83`; independent client detail request returns identical source and binary hash. |
| Private selection and Bind/Build | Only the caller selection is explicitly replaced. Image SHA-256 `f107881f9f6abbf781be4ecd53d5c3b7d4524fe9a323a06da688b99351c08631`. |
| Fetched outgoing CALL | Amoeba base 3648, PC 2, word `0x17040021`, CR6.M = 1. |
| Target entry | NS[10], base 1792, PC 1 (body word offset 2), fetched word `0x07030010`, CR6.M = 1. |

The original screenshot does not establish that Save removed `Run`. The saved
source and signed hash instead establish that the selected historical revision
contains the bare call. Whether the screenshot edit was unsaved or belonged to
another revision is not established.

Two incorrect transitions were reproduced:

1. Historical binding manufactured selector zero for an object-only reference.
   It now preserves the unresolved fault and reports an explicit-method repair
   instruction. Named historical relocations use the current indexed encoding;
   old binding cache keys are no longer accepted.
2. For corrected source, Compile and Save preserved `0x17040021`, but normal
   simulator stepping recognized only the former indexed marker. It treated the
   word as a direct CALL to Amoeba method 33. The decoder now recognizes bit 18,
   matching the assembler, and execution reaches the selected target.

## Execution limits

The final replay uses the browser's `beginBoot` setup, including the saved
prepared-Thread slots, and the real three-instruction Boot sequence. It runs 30
steps including Boot, with no fault and without halting. This is a bounded
result, not full Factory Build acceptance.

After live adoption, replay of the actual activated image verified the same
image hash and target entry. Extending the bound to 1,000 steps halted at step 63:
NS[10] CapabilityTest, PC 24, physical word 1817, unresolved word `0xF7000000`.
Its authenticated contract identifies word offset 25/source line 109 as bare
`CALL ide.SelfTest`. The next word/source line 110 is bare
`CALL ide.WukongCallHome`. Neither declares a method. They were not guessed,
rewritten, or silently adopted. This is the next distinct program fault,
not failure of the now-correct outgoing Amoeba CALL.

An intermediate harness used a shortcut entry initializer, and another omitted
prepared-Thread slots. Their M-window/empty-Thread faults are not results of the
normal workflow and must not be reported as subsequent product failures.

## Verification

- 48 focused Python tests passed: symbolic binding, snapshot context, symbolic
  save flow, and named-call save attestation.
- Mandatory CALL dispatch suite passed, including a new test that steps the
  actual assembled indexed word through the decoder.
- CALL CR6 permission suite passed.
- RETURN CR6 fixtures were subsequently updated to include explicit dispatch
  tables and selector one. The suite now passes, retaining keep-mask, M-bit,
  generation/seal, protected-frame, and authority checks without relaxing runtime
  validation.
- Main development workflow restarted and served the landing page.
- Final completion checks exposed a snapshot-helper collection error when normal
  rebinding had removed old Git-tracked derived cache files. The helper now records
  absence explicitly, preserving before/after creation/deletion detection. All 49
  bootstrap identity/migration tests and the browser-identity Node checks pass.

Reproduce the real service chain without changing live data:

```sh
python3 tests/server/new_layout_call_service_check.py --retain-review
```

It clones the current project state, uses real compile/save/review/selection/
binding/preparation services, checks exact target entry, and deletes its private
working copy. It is an opt-in acceptance probe of the current New layout, not a
hermetic CI fixture. Retained review files are under
`generated-artifacts/new-layout-call-review/` (excluded from Git/deployment).
They are review material, not authorization to install or adopt a revision.

## Browser acceptance blocker

The disposable browser session compiled successfully and reached the normal
protected-change save review. Its visible Confirm button was enabled, hit-testable,
and had the expected handler. No click, pointer, or keyboard events reached the
DOM; Tab did not move focus. No handler exception was observed. Neither handler
invocation nor API approval was used to bypass the browser review.

Consequently browser Save completion, reopen, Namespace adoption, Bind/Build,
simulation, and fresh-session persistence remain unverified. Server-side
completion after explicit user approval is separate evidence, not a replacement
claim for those UI checks. Live adoption and replay records are retained as
`live-adoption.json` and `live-replay.json` in the excluded review directory.

For a future isolated browser continuation:

```sh
python3 tests/server/new_layout_call_browser_server.py
```

This serves a disposable clone on port 5127 with hardware endpoints blocked.
Do not run future acceptance writes against port 5000 without separate approval.
The live caller is now revision 4. Further program repairs require exact declared
methods, normal compilation/publication, and explicit selection adoption.
