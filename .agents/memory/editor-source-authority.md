---
name: Editor source authority
description: Rules for reopening saved editor documents without stale browser state replacing current persisted source.
---

Saved source files, built-in examples, and LUMPs must reopen from their current authoritative source. A divergent browser buffer is a draft, not the default reopened document, and must remain available through explicit Restore Draft or Discard Draft actions.

**Why:** Generic editor snapshots can outlive newer server files or immutable LUMP revisions. Treating the snapshot as authoritative silently replaces newer saved work and can also lose binary-only LUMP state.

**How to apply:** Persist document identity independently of navigation DOM. Re-resolve that identity when entering Code or reloading, guard asynchronous reconciliation against owner changes and new typing, and restore LUMPs through their canonical artifact loader so source availability and compiled context remain accurate.