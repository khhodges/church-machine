---
name: Namespace Table is the bitstream LUMP source
description: The serialized Namespace Table, not the catalog manifest or loose files, determines which LUMPs are present in a bitstream.
---

The Namespace Table is the sole authoritative source of LUMPs and their metadata in a bitstream. Truth is ordered as: (1) the Namespace Table, then (2) the assigned slots and LUMPs represented by that table. The manifest is not authoritative for membership, metadata, identity, version, slot, size, or any other property.

**Why:** The manifest contains catalog, lazy-load, example, and historical artifacts in addition to resident hardware content; treating it as authoritative makes Build Approval and image tooling report unrelated or stale LUMPs and metadata.

**How to apply:** Build-image generation and Build Approval must derive membership and metadata from the final Namespace Table and its assigned slot/LUMP data. The manifest may be treated only as an untrusted catalog or lookup aid, never as truth. Lazy/runtime catalog entries are not bitstream LUMPs unless explicitly represented in the Namespace Table.