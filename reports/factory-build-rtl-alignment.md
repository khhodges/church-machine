# Factory Build RTL alignment — partial, not FPGA acceptance

The user reported a successful IDE simulator run beyond 8,000 instructions.
The saved design and all LUMP bytes remain unchanged.

## Implemented

- Indexed CHANGE uses the documented CR12/CR6 field marker and unsigned
  literal row. It captures its source, row and M permission, validates source
  Namespace identity and bounds, then obtains one Thread GT without scratch
  CR writes. Existing Thread admission precedes context writes.
- Indexed CALL accepts CR6.M as C-list read authority without adding L to
  its E-only token. Both the core permission gate and CALL unit enforce this;
  CALL captures the M permission at acceptance.
- Handoff fixtures now use code-relative saved NIAs, with code base after
  the LUMP header. The pre-change direct/self/SWITCH fixtures already failed
  because they still supplied absolute continuation addresses.

## Exact-image full-top observation

Focused validation: 109 tests passed across `hardware/test_phase1_handoff.py`,
`hardware/test_phase1_rtl_operands.py`, and `hardware/test_boot_change.py`.
`git diff --check` passed. These results are instruction/boot regression
evidence, not acceptance of the complete Factory Build image.

Run `python3 scripts/probe_factory_build_rtl.py`.
This uses the unchanged admitted image, SHA-256
`1ebc229c2c046d69638118211afc04c812e15e1af14dad1ffafd0aa027be5741`,
in ChurchWukongXC7A100T. Boot-pair build constant is explicitly zero for the
saved design's two sequence-zero bootstrap entries, not inferred from RAM.
There is no UART upload, instruction translation, or host register injection.

After the CALL correction, seven instructions retire. At cycle 19,997,
LOAD word `0x07130030`, byte address `0x2818`, faults VERSION (9).
Its target is GT `0x32010008`, NS[8], version 1.
The exact stored descriptor is:

```
40000014 00200002 deadf4cb 00000000
```

The shared architecture contract and image generator encode version 1 at bit
21. The guarded RTL gate reads bit 17 and therefore sees version 16.
This is not an instruction encoding failure or an absent permission.

## Namespace format decision and correction

The user explicitly approved the current format. Guarded bootstrap, Thread
validation/activation, mLoad, cLoad, CHANGE and stored/cache authority now use
limit bits 0–20 and version bits 21–29, preserving G/F and original-word seals.
There is no auto-detection or alternate version comparison. Historical
17-bit-format bytes remain immutable; the frozen production-profile entry
point now refuses them explicitly rather than building incompatible RTL.

175 focused tests passed after this correction, covering the earlier handoff,
operand and boot checks plus Namespace bootstrap, mLoad, cLoad, nonzero
versions, high-limit rejection, and rejection of the historical guarded image.
This is not a claim that all historical retained-profile suites pass against
current RTL; those still encode the superseded profile.

## Latest exact-image observation

Command: `python3 scripts/probe_factory_build_rtl.py generated-artifacts/factory-build 2000000`

The image hash is unchanged. The model retires **444 instructions**, then
faults BOUNDS (8) at cycle **466716**, byte PC **0x1964**, raw word
**0x87414198**, in WukongCallHome (NS[7]). This is not the intentional Mallory
denial, and is not an end-to-end acceptance pass.

The source is `DREAD DR8, CR2, #408`. The saved compiler/simulator encoding
uses bit 14 as immediate mode and payload 408. The current documented compact
data-access encoding/RTL reads this word as index DR8 minus magnitude 25.
These interpretations cannot both apply to the same word. No test-local
translation, instruction skip or saved-artifact rewrite was performed.

Aligning compiler/simulator data-access encoding and publishing new immutable
revisions is separate from the approved Namespace-field migration.

The full image has NOT passed RTL execution. No synthesis, timing closure,
bitstream build, upload or physical FPGA test was performed.

An additional simulator regression attempt (`test_change_one_gt.js`) fails
in its initial boot fixture before reaching CHANGE. Simulator code was not
modified by this RTL work; this is not a passing simulator regression.
