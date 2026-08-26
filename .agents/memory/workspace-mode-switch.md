---
name: Workspace mode switching
description: A mode choice in a chat form does not itself switch the editing mode.
---

Use the workspace's actual mode control to switch between planning and building.
A chat response that agrees to switch modes only records the user's intent; it
does not permit environment edits.

**Why:** Documentation work was delayed because an affirmative chat-form answer
left the workspace in Plan mode, so every edit remained blocked.

**How to apply:** Before retrying a blocked edit, confirm the active workspace
mode from the environment status. If it is still Plan mode, ask the user to use
the workspace mode control rather than treating a chat-form response as a
completed switch.