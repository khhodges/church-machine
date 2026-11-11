---
name: Combined runtime approval boundary
description: Expanded local RTL scope and the separate exact-image admission gate.
---

## Vendor receipts versus initialization evidence

A passing routed DRC/timing receipt does not clear earlier synthesis or netlist
critical warnings about dropped initialization properties.

**Why:** Vivado emitted a successful BIT and receipt while reporting Netlist
29-72 warnings that multi-bit initialization values were invalid for scalar
properties. Final DRC did not include those earlier warnings.

**How to apply:** Report build-gate success separately from functional readiness.
Resolve initialization evidence before recommending physical use; preserve the
frozen package and do not silently weaken or reinterpret qualification gates.

Duplicate vector `init` attributes on generated SHA output wires can produce
Netlist 29-72 warnings even when the corresponding routed flip-flop INIT bits
are correct. Do not infer either corruption or harmlessness from the warning
alone.

**Why:** Direct inspection of the exact routed checkpoint preserved all 768
standard SHA-256 state bits across three engines despite those warnings.

**How to apply:** Compare per-bit routed primitive INIT values to independently
known constants and source declarations. This clears the particular suspected
initialization loss, not physical behavior or unrelated configuration warnings.

## Subsequent vendor-build authorization

Configuration-voltage warnings must be checked against the manufacturer's
schematic, not inferred from ordinary user-I/O standards. Wukong V3 schematic
QMTECH-XC7A100T_200T-Wukong-Board-V03-20240121 (ChinaQMTECH's
QM_XC7A100T_WUKONG_BOARD repository, V3/Hardware) independently confirms the
retained configuration-voltage declarations: sheet 1 shows VCCO_0 on 3V3 and
sheet 2 shows CFGBVS_0/AB15 on 3V3.

**Why:** A reduced experimental constraint file omitted board configuration
metadata even though the underlying documented board wiring was compatible.

**How to apply:** Correct repository inputs only with approval, preserve frozen
evidence, and obtain fresh qualification for the changed package. Documentation
does not identify or measure a physical target and does not authorize programming.

After the exact-MMCM correction passed the operator's synthesized-checkpoint
diagnostic, the user instructed proceeding with the corrected combined vendor
build and supplied build-host access. This supersedes the earlier local-only
restriction for that corrected build, not for arbitrary runtime/image changes.

**Why:** Build qualification is the next approved step; physical qualification
and the preserved working system remain separate.

**How to apply:** Bind authorization to the disclosed corrected package,
Verilog and verified toolchain. Preserve approved runtime/image bytes, run one
build at a time, and keep all timing/DRC gates. No board access, programming or
physical activation is authorized by this build approval.

Vivado can include the MMCM in `all_registers` but omit it from
`all_registers -clock` for its generated execution clock.

**Why:** A real synthesized candidate's entire coverage difference was its
clock-generator cell, not an unclocked execution register.

**How to apply:** Exclude only the exact independently validated MMCM from
execution-register coverage; retain every real register check and reject empty
coverage. Never globally exempt clock-like names or use counts alone.

The user chose an onboard pushbutton for physical maintenance enable on the
isolated combined starter, accepting a sustained hold through upload,
verification and START. This is maintenance authority, not a reset or Thread
scheduler action; the existing working system remains untouched.

**Why:** The approved whole-image loader requires a physical enable rather than
UART-granted authority. A momentary button must not silently become a toggle.

**How to apply:** Preserve pressed/held maintenance semantics and fail closed
on early release. The selection authorizes isolated board integration, not
vendor builds, device programming or physical-target selection.

The user approved implementing bounded RTL LUMP admission, SYSTEM-owned
publication and application-controlled side-by-side adoption after the prior
adoption work proved to be simulator-only.

**Why:** Simulator-owned approval tickets and synchronous publication cannot
be connected directly to a hardware UART/memory interface; separate test passes
do not establish a shared hardware configuration.

The user subsequently approved the exact combined candidate images and the
bounded SYSTEM grants recorded in the combined runtime review.
**Why:** This was the separately required admission decision, not implicit
permission from the earlier implementation approval.
**How to apply:** Keep the approved image and received-LUMP hashes pinned.
Changed executable bytes or broader grants require another review; the
approval still excludes vendor tools and physical operations.

**How to apply:** Follow the approved combined-runtime proposal. Review new
whole-image hashes, layout and grants separately before changing the protected
image allowlist. Approval remains local-only; no vendor or physical operations.
Do not treat the earlier simulator bodies as the later cooperative application.

Retained-core instruction-pulse harnesses must allow RETURN's subsequent CR6
cLoad to finish after the NIA pulse.

**Why:** Observing the return PC does not mean the core accepts its next
instruction yet; a one-cycle fetch during reconstruction was lost in preflight.

**How to apply:** Preserve the synchronous fetch/settle contract when extending
CALL/RETURN tests to execute the caller's next instruction. Do not change core
control flow to compensate for a premature testbench fetch.
