---
name: Interrupted process fixtures
description: Avoid fake-wrapper behavior masking inherited-lock lifetime during interruption tests.
---

Python `subprocess.run()` kills its child when an exception, including a signal handler's `SystemExit`, unwinds the call. Use explicit `Popen` and `wait` when a fake wrapper must leave a child alive after termination.

**Why:** Otherwise an interruption test can mistake wrapper-driven child destruction for correct release of an inherited build lock, never exercising the surviving-owner case.

**How to apply:** For Linux process-tree tests, keep deliberately orphaned children under subreaper custody, explicitly preserve inherited lock descriptors, and assert both eventual lock release and complete reaping. Do not rely on the container's PID 1 to reap test descendants.
