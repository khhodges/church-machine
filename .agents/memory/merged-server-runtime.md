---
name: Merged server runtime
description: A merged Python fix may not be loaded by the serving IDE process.
---

Verify the serving process was restarted after a Python merge; a merged commit alone is not evidence that the IDE is running it.

**Why:** A merged SELF-materialization fix was on disk while the IDE process still predated the merge. Restarting the IDE let the real refresh preparation endpoint build the selected revision successfully.

**How to apply:** Compare process start time with merge time, restart the managed IDE workflow, then exercise the non-committing preparation endpoint. Never equate successful preparation with committed installation or simulator activation.

Verify the user's actual origin before attributing repeated stale History to
another UI bug. Compare served JavaScript and saved-record identities in the
published IDE versus the workspace preview.

**Why:** Workspace-only History fixes were reported as resolved while the
published site still served older code and a different saved-LUMP catalog.
Restarting the workspace did not establish that the user's site had the fix.

**How to apply:** Obtain the current published URL, inspect both origins
read-only, and confirm which one the user is using. Do not promise that
publishing code synchronizes saved artifacts or automatically copy live data.