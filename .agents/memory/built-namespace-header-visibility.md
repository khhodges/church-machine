---
name: Built Namespace header visibility
description: Keep the as-built title, refresh control and Thread tabs visible while inspecting content.
---

The as-built Namespace title, Refresh control and Thread tabs must not scroll
away with the inspected content.

**Why:** The user explicitly rejected scrolling these headings out of view.

**How to apply:** Keep navigation outside the content scroll area, including on
small screens and when switching between Namespace and individual Threads.

All as-built tabs share one scroll position rather than resetting or remembering
separate positions.

**Why:** The user wants to switch Threads to cross-check values at the same level.

**How to apply:** Apply the last scrolled position to the next tab, keep headings
pinned, and do not discard that position merely because a shorter tab clamps it.
