---
name: Thread LUMP placement
description: Thread type does not confer special addresses or catalog reservations.
---
Threads are LUMPs with no special addresses: “LUMPS are LUMPS.”

The Thread and Namespace design pages define generated LUMPs. Their saved design settings are valid body sources; do not demand repository files for those design-defined instances.

**Why:** The user corrected the assumption that Boot.Thread and secondary Thread assignments were missing LUMPs merely because their Inform descriptors had no filenames.

**How to apply:** Distinguish descriptor type from body type. Match the saved design instances to existing Namespace assignments, retain their saved addresses, and generate from saved geometry. Do not add absent instances or infer fixed slots. An explicit selected artifact takes precedence.

**Why:** The user explicitly rejected treating Thread bodies as a separate class of reserved addresses during saved Namespace reconstruction.

**How to apply:** Rebuild at each saved descriptor's address and use the complete allocation from its exact body or explicitly saved architectural geometry. Never synthesize Thread membership, slots, or placement from catalog or pet-name conventions. Saved Threads may be suspended continuations rather than initial boot frames; preserve their continuation and independent CR0 authority. Keep physical hardware ABI constraints separate from generic image reconstruction.