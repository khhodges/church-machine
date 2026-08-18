---
name: Lump V1.3 self-defining freespace
description: Design constraints for the 0xAB content frame (API JSON + tiered source)
---

V1.3 lumps carry an 0xAB frame at word cw+1: header (0xAB|flags|api_len),
API JSON, and for tier≥1 a source-length word + UTF-8 source; remainder
all-zero. Tier 2 (full source) is the compile default; all-zero freespace
means legacy and must never be rewritten in place.

**Why:** the binary is the single source of truth for its API and source.
The embedded API must never contain `token`/`issue` (circular-hash rule),
and dispatch offsets in the API are raw table entries (bodyOffset+1;
0 = private), never opcode-decoded.

**How to apply:**
- Dual emitters (JS and Python) exist and must stay in lockstep, frame
  byte-for-byte. When a binary already carries a frame, downstream tooling
  must treat the embedded API as authoritative and never rebuild it from
  looser metadata (metadata lacks offsets/visibility → wrong frame).
- Embedded Tier 1/2 source outranks every external lookup: a same-name
  source file or sidecar text is a fallback, never a shadow.
- Resize/repack must count the frame in the minimum size and copy it, not
  zero it.
- Any compile-payload field that changes output (e.g. tier) must be part
  of the compile cache key.
