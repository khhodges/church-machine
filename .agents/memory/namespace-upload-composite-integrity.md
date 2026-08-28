---
name: Namespace upload composite integrity
description: A post-flash software image is a composite Namespace artifact made from individually validated LUMPs.
---

The full Namespace upload should bind individually validated LUMP identities to their slots, locations, limits, permissions, authorities, boot entry, and layout in one aggregate image identity.

**Why:** Treating the image as an unbound collection of binaries could allow a valid LUMP to be substituted, moved, or associated with the wrong Namespace capability after IDE validation.

**How to apply:** Validate each canonical LUMP first, then validate the composed image in the IDE and again at the server/upload boundary. The board upload must carry the exact validated bytes; true board-side cryptographic acceptance requires an explicit digest/provenance check because the current upload FSM primarily checks framing, length, and memory bounds.