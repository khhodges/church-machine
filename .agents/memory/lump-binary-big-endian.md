---
name: LUMP binary word encoding is big-endian
description: .lump binary files store 32-bit words big-endian; reading/writing with little-endian helpers corrupts the header/c-list silently
---

`.lump` binary files (compiled Church Machine abstractions in `server/lumps/`) store each
32-bit word **big-endian** (`readUInt32BE`/`writeUInt32BE` in Node). This is not obvious from
the `.js` runtime code, which mostly works with in-memory `Uint32Array`/decoded words rather
than raw file bytes.

**Why:** A one-off Node script that reads or patches raw lump bytes with
`readUInt32LE`/`writeUInt32LE` will silently produce garbage — the header magic, `cw`/`cc`
fields, and c-list GT words all decode as nonsense, but the file size and general shape look
plausible enough that the mistake isn't obvious until you run it through `lump-audit.js` or
`tests/lump/test_lump_consistency.py` (R1/R2/RMC rules) and see wildly wrong values (e.g.
`cw=1536` for a lump that should have `cw=38`).

**How to apply:** Any time you write ad-hoc Node/Python code to inspect or patch a `.lump`
file's raw bytes directly (rather than going through `scripts/update-lump.js` or the
in-browser compiler), use big-endian word reads/writes and verify with `lump-audit.js`'s
`lumpAudit()` (or the R1 magic-byte check: `(word0 >>> 27) & 0x1F === 0x1F`) before trusting
the result.
