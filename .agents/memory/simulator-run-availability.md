---
name: Simulator Run availability
description: Run-button availability when editor source has no fresh compiled candidate
---

Keep the main simulator Run button enabled whenever Step and Walk can execute.
If the editor has a fresh candidate, Run installs it first. If the candidate is
missing or stale, Run executes the current simulator program without compiling
or silently installing stale editor output.

**Why:** The user explicitly rejected requiring compilation before Run while
the adjacent execution controls remained enabled. Run, Step, and Walk operate
on the same current simulator state when there is no fresh candidate.

**How to apply:** Keep stricter candidate ownership for separate LUMP workspace
surfaces, Save, and Export. Apply this rule to the main simulator toolbar and
its keyboard Run command.