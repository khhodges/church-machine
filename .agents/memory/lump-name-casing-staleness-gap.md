---
name: LUMP staleness guards keyed by exact abstraction-name string
description: How orphaned/stale duplicate lumps can hide from consistency checks, and why hardcoded tokens in UI code rot silently
---

`scripts/check_selftest_lump_stale.js` / `build_selftest_lump.js` (and similar
per-lump build scripts) find "the" lump by matching
`manifest.entry.abstraction === '<ExactName>'`. If an old lump's abstraction
name differs by even one character's casing from the current name, the
staleness guard never sees it — it just sits in `server/lumps/` and
`manifest.json` forever, fully "consistent" by `test_lump_consistency.py`'s
rules (has lump + sidecar + manifest entry), but semantically dead and
loadable by anyone who browses lumps.

**Why:** token = CRC32(bytes), so every source recompile mints a brand-new
token; nothing ever deletes the previous one, and per-lump build scripts only
know how to replace an entry that matches their hardcoded name string exactly.

**How to apply:** when a lump's disassembly/behavior looks wrong or dated
(e.g. shows `???` for opcodes that should be assigned, or annotations
disagree with the shown mnemonic — a strong sign the ISA opcode table was
renumbered after this binary was assembled), suspect a stale duplicate before
assuming the current disassembler is broken. Cross-check with the lump's own
`check_*_stale.js` script to find the *actual* canonical token, then also grep
the whole simulator/ and server/ tree for the token you were viewing — if it's
only referenced by its own sidecar + manifest.json (nowhere in app code),
it's very likely dead. Separately, grep for hardcoded lump tokens in UI code
(e.g. `runSelftestLump()`-style shortcuts) — these can independently rot to a
*third*, no-longer-existent token when the lump is rebuilt, since nothing
enforces they stay in sync with manifest.json.

See also: docs/CM_LUMP_SPECIFICATION.md — Developer Traps and Implementation Rules section.
