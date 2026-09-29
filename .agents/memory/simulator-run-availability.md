---
name: Simulator Run availability
description: Run-button availability when editor source has no fresh compiled candidate
---

Keep the main simulator Run button enabled whenever Step and Walk can execute.
Run executes the currently loaded image/target. Merely opening or compiling
another LUMP must not silently replace that execution target.

**Why:** The user explicitly rejected requiring compilation before Run while
the adjacent execution controls remained enabled, and clarified that Run means
the LightningBolt LUMP.

**How to apply:** Keep candidate compilation, Save, Export, and explicit install
separate from the main simulator toolbar. Apply this rule to the toolbar Run
button and its keyboard command.

Preparation status, newer saved revisions, and deployment approval must not
disable volatile simulator testing. Keep stale/mismatched evidence visible as
warnings, and offer an explicit choice to test a compiled candidate.
**Why:** The programmer explicitly rejected these additional IDE lockouts and
confirmed successful testing after they were removed. That confirms the
workflow choice, not a blanket security verdict on the executed artifact.
**How to apply:** Keep ISA GT/M/bounds enforcement and true missing/malformed
input errors, but do not confuse hardware/publication policy with simulator use.

Boot-image changes during development are neutral facts, not yellow security
warnings. Yellow is reserved for actionable uncertainty (such as an unconfirmed
handoff write) or an evidenced mismatch with the programmer's explicit intent.
**Why:** The programmer confirmed that image improvement is the purpose of testing,
and approved facts-first presentation without additional testing gates.
**How to apply:** Keep viewing and loaded identities separate, say unknown when
evidence is absent, and scope administrative warnings to their own controls.