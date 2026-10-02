---
name: Thread LUMP placement
description: Thread type does not confer special addresses or catalog reservations.
---
Threads are LUMPs with no special addresses: “LUMPS are LUMPS.”

**Why:** The user explicitly rejected treating Thread bodies as a separate class of reserved addresses during saved Namespace reconstruction.

**How to apply:** Rebuild at each saved descriptor's address and use the complete allocation from its exact body or explicitly saved architectural geometry. Never synthesize Thread membership, slots, or placement from catalog or pet-name conventions. Saved Threads may be suspended continuations rather than initial boot frames; preserve their continuation and independent CR0 authority. Keep physical hardware ABI constraints separate from generic image reconstruction.