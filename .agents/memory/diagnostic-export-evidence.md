---
name: Diagnostic export evidence
description: Keep build-only exports aligned with isolated diagnostic receiver changes.
---

When isolated diagnostic sources change, check for a separately prepared
build-only export before declaring the work complete. Test acceptance of the
candidate does not qualify an earlier exported design.

**Why:** Parallel preparation can publish a manual-build package before a
receiver safety change lands. Its internal hashes may still verify perfectly
while proving only the older design, not the newly tested behavior.

**How to apply:** Rebind updated source and behavioral evidence, regenerate
only the isolated export, verify the extracted package, and identify the
superseded archive explicitly. Keep vendor builds and board operations behind
their separate approval boundaries.

For these isolated FPGA diagnostics, proceed to the next authorized handoff
once actual technical blockers are resolved; optional qualification and
regression work must not become additional release gates.

**Why:** The user explicitly required forward progress rather than repeated
optional checks delaying the manual build.

**How to apply:** Distinguish a bounded diagnostic from general qualification.
Keep essential package-integrity, timing/DRC, and separate board-operation
approval boundaries, but do not expand scope before handing over build commands.
