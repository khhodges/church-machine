---
name: Lazy retry breakpoint E2E timing
description: How to make browser coverage distinguish a suspended lazy-load attempt from the later retry.
---

For a browser test of the lazy-load retry breakpoint, intercept and hold the LUMP response until the simulator is awaiting the download, then arm the breakpoint and release the response. Arming it before the first Step only tests the ordinary pre-execution path.

Use the successful-retirement counter plus unchanged PC and destination register to prove that the retry did not execute. The general step counter includes the suspended attempt.

**Why:** A breakpoint armed too early can produce a convincing but false-positive test, while attempt accounting can make a correct pause look like an executed instruction.

**How to apply:** Use this synchronization and assertion pattern whenever a browser test targets the continuation of an asynchronous execution suspension.