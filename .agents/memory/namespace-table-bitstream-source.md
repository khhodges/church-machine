---
name: Namespace Table is the bitstream LUMP source
description: The serialized Namespace Table, not the catalog manifest or loose files, determines which LUMPs are present in a bitstream.
---

The Namespace Table is the sole authoritative source of LUMPs in a bitstream. A manifest entry, sidecar, loose `.lump` file, example, historical version, or runtime catalog entry must not be treated as bitstream content unless it is represented by a Namespace Table entry in the image.

**Why:** The manifest contains catalog, lazy-load, example, and historical artifacts in addition to resident hardware content; treating it as the bitstream source makes Build Approval report unrelated LUMPs.

**How to apply:** Build-image generation and Build Approval should derive bitstream membership from the final Namespace Table. Use the manifest only to resolve metadata or locate bytes for an already-selected Namespace Table entry. Lazy/runtime catalog entries are informational and are not bitstream LUMPs unless explicitly materialized in the Namespace Table.