---
name: Resident installation execution isolation
description: Background installation must not splice capability and code contexts.
---
Treat executable code and its c-list as one live execution context. Installing an unrelated resident is not permission to activate it; explicit direct-run activation is separate from the prepared boot selection.

**Why:** A background resident installation reproduced a WukongCallHome DWRITE permission fault by replacing CR6 while retaining Wukong CR14. It reproduced the fault class, not the exact BTN capability shown in the original screenshot.

**How to apply:** For loading, lazy deployment, and direct-run changes, verify both live views stay paired, unrelated installations leave them untouched, and explicit activation does not change the prepared boot selection.