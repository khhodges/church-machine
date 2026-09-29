---
name: Structured merge corruption
description: Rebase conflict working files can contain corruption outside explicit conflict markers.
---

When resolving generated structural conflicts, compare the full working-file diff against clean Git index stages, not just the marked conflict.

**Why:** The merge machinery substituted unrelated loop headers and variable references outside marked regions in shared simulator scripts. Removing markers and passing a syntax check alone did not establish a correct merge.

**How to apply:** If unrelated lines differ from both stages, start from a clean stage and apply the intended semantic changes. Preserve both features, remove superseded blocks rather than commenting them out, and run focused behavior checks on the merged paths.

An assembler-only success does not rule out a compile-path failure: editor
compilation also resolves capabilities and prepares the candidate. Exercise
that full path in an isolated context. For an undeclared-variable exception,
a scope-aware static scan can locate the defect when the original browser
stack was not captured.

**Why:** A merge-introduced free variable survived syntax checks and pure
assembly tests, failing only during capability resolution.