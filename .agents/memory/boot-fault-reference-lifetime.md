---
name: Boot fault reference lifetime
description: User selected immediate-only fault references, not preservation across Boot suspension.
---

The user selected “Immediate handoff only” on 2026-11-08 when asked whether
Boot must retain usable fault references after resuming.

**Why:** Resumable foreign-root references require a separate approved storage
contract; immediate handoff approval does not authorize that extension.

**How to apply:** Keep later preservation out of scope. Do not serialize cached
authority or resolve foreign GTs under Boot. Distinguish the handler obligation
to finish using and retire the pair before suspension from implemented
enforcement; obtain review of the retirement/enforcement rule before claiming
release safety.
