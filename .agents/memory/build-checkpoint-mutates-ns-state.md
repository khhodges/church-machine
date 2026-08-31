---
name: Build checkpoint mutates NS state
description: Side-effect warning for regenerating Wukong build checkpoint metadata.
---

Running the Wukong build checkpoint generator can rewrite the committed Namespace state as an import-time side effect. Treat the generator as stateful, even though its intended output is documentation.

**Why:** A verified hardware build temporarily acquired unrelated Namespace diffs, which then made boot tests consume altered runtime state and obscured the hardware validation result.

**How to apply:** After generating a build checkpoint, inspect and restore unintended Namespace-state changes before generating final provenance. Confirm source directories are clean and rerun provenance verification.