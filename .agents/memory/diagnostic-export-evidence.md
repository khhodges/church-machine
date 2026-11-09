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
