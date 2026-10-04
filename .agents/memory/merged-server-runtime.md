---
name: Merged server runtime
description: A merged Python fix may not be loaded by the serving IDE process.
---

Verify the serving process was restarted after a Python merge; a merged commit alone is not evidence that the IDE is running it.

**Why:** A merged SELF-materialization fix was on disk while the IDE process still predated the merge. Restarting the IDE let the real refresh preparation endpoint build the selected revision successfully.

**How to apply:** Compare process start time with merge time, restart the managed IDE workflow, then exercise the non-committing preparation endpoint. Never equate successful preparation with committed installation or simulator activation.