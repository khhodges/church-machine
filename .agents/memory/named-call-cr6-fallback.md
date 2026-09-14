---
name: Named CALL CR6 fallback
description: Bare named CALL operands resolve through the active C-List when no loaded-CR binding exists.
---

An unbound named CALL should use the active CR6 C-List pet-name path, lowering to the fused direct ELOADCALL form with selector zero. A prior LOAD binding remains authoritative, so loaded-CR calls and dot-method dispatch keep their existing behavior.

**Why:** Programmers reasonably expect a declared capability name to be callable without manually materializing a temporary CR; otherwise identical named calls behave differently based only on hidden prior LOAD state.

**How to apply:** When changing CALL name resolution, preserve the resolution order: explicit/previously loaded CR binding first, exact dotted C-List labels next, then unbound named C-List fallback. Keep the secondary assembler copy in sync.