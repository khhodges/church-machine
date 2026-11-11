---
name: Combined runtime approval boundary
description: Expanded local RTL scope and the separate exact-image admission gate.
---

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
