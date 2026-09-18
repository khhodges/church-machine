---
name: Simulator Run availability
description: Run-button availability when editor source has no fresh compiled candidate
---

Keep the main simulator Run button enabled whenever Step and Walk can execute.
Run executes the prepared LightningBolt LUMP. Merely opening or compiling
another LUMP must not silently replace that execution target.

**Why:** The user explicitly rejected requiring compilation before Run while
the adjacent execution controls remained enabled, and clarified that Run means
the LightningBolt LUMP.

**How to apply:** Keep candidate compilation, Save, Export, and explicit install
separate from the main simulator toolbar. Apply this rule to the toolbar Run
button and its keyboard command.