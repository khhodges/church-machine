---
name: Bootstrap repair archive discovery
description: How bootstrap-history repair identifies immutable archives when history files are not individually represented in the manifest
---

Bootstrap-history repair must authorize both kinds of immutable history that the History view can display: archives with an `archived` manifest row and standard archive files discovered from the active LUMP's exact filename pattern.

**Why:** Standard historical files can be readable, previewable, and approved while having no separate archived manifest row. Restricting repair to manifest rows makes the UI offer correction options that the server rejects.

**How to apply:** Validate the requested filename against the active abstraction's generated archive names when no matching archived manifest row exists. Keep exact filename, version, abstraction, and active-destination checks; never accept arbitrary files.