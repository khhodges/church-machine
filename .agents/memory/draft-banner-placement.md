---
name: Draft banner placement
description: Placement rule for restored-draft notices in the editor layout.
---

Restored-draft notices must be inserted as siblings above the editor's
`code-editor-wrap`, not as children of that flex row. The editor should also
receive a distinct draft-state style so recovered source remains readable and
visibly separate from compiled disassembly.

**Why:** A banner inserted inside the editor flex row can displace or cover the
textarea, making the recovered source appear missing or corrupted.

**How to apply:** Insert banners before the `code-editor-wrap` in its parent
editor panel, and remove the draft styling when the draft is discarded, saved,
or the saved-LUMP editor mode exits.