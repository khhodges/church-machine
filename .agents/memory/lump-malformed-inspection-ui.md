---
name: Malformed LUMP inspection UI
description: Malformed LUMP bytes stay inspectable in the IDE while validation remains authoritative.
---

The IDE should not hide raw malformed LUMP bytes behind an automatic amber chip or editor banner. The Hex Dump is an inspection and repair surface: it may render raw words and concise diagnostics even when header/layout parsing fails. Audit, load, and runtime integrity validation remain enabled and authoritative.

**Why:** Developers need to inspect damaged bytes manually, but removing structural validation would allow unsafe binaries to load.

**How to apply:** Keep automatic warning presentation suppressed; preserve explicit Audit results, raw Hex Dump diagnostics, and all server/simulator enforcement.