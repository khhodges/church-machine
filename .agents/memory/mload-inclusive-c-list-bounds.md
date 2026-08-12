---
name: mLoad inclusive c-list bounds
description: Hardware mLoad and namespace slot bounds use inclusive limit_offset values.
---

`WORD2_LAYOUT.limit_offset` stores the last valid index (`count - 1`), so mLoad
must accept an index when `index <= limit_offset`, not only when `index <
limit_offset`. This matters for every one-entry c-list and one-slot namespace
range, including the canonical factory SelfTest image.

**Why:** A strict comparison made a valid `cc=1`, slot-0 LOAD fault as BOUNDS
even though the stored limit was the inclusive value zero.

**How to apply:** Keep allocation/range producers encoded as `count - 1` and
audit consumers whenever a new capability or namespace range check is added.