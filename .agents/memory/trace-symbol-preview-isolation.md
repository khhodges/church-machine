---
name: Trace-symbol preview isolation
description: Keeps strict hardware artifact validation from unnecessarily taking down the web IDE.
---

Factory-image generation must remain fail-closed when the active SelfTest is not exactly approved. The web IDE’s trace-label import may use its encoded fallback instead, because serving the IDE does not generate or authorize a factory image.

**Why:** The trace-symbol module imported the strict factory boot module, so a legitimate artifact-approval fault aborted the entire server and broke Preview. That hid the fault UI needed to diagnose the artifact.

**How to apply:** Catch only the specific factory-image approval failure at the trace-symbol boundary. Do not relax the validation in the factory boot module or hardware build/release paths.

Changes to hardware ROM encodings also require a web IDE import/startup smoke
check, even when CPU simulations pass.

**Why:** Encoded trace fallbacks are imported by the server and checked against
ROM source words. A stale fallback can remain invisible in a running process
until the next restart, then prevent the IDE from starting.

**How to apply:** Keep source-backed fallback words synchronized without
rebuilding saved artifacts, and verify startup after the encoding change.