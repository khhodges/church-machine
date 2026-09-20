---
name: Embedded source frame sizing
description: Allocation and validation rules for source-bearing LUMP binaries
---

The LUMP allocation must be selected from the complete embedded content frame
(API metadata, source length, and source payload), not only from code and
C-list words. If the frame grows the allocation, the C-list must be relocated
to the new tail before the binary is finalized.

**Why:** An older Wukong artifact was structurally valid in its header and code
regions but declared source bytes beyond its 1,024-word allocation. That made
source/identity restoration fail later and surfaced as a generic reload error.

**How to apply:** Every source-bearing save path, including direct compile and
fallback Save, must use the same final frame words before placing the C-list;
server preflight should reject any recognized 0xAB frame whose declared
API/source extent exceeds the declared freespace, with a specific allocation
error.

When browser-preliminary output is replaced by a signed server artifact, all
layout metadata must switch to that artifact together; never repair its signed
words to fit the preliminary browser layout.

**Why:** Full-source framing can enlarge the server allocation independently
of the browser estimate. Mixing the old C-list offset with the new binary
incorrectly rejects valid compiler output and tempts unsafe byte rewriting.

**How to apply:** At the authenticated artifact handoff, derive allocation,
code extent, and C-list tail from the final header and byte length before
candidate validation. Test the whole handoff, not only either compiler.