---
name: Resident publication bootstrap approval
description: Authority rule for publishing replacements into fixed resident Namespace bindings.
---

A replacement published into an existing fixed resident Inform binding must receive bootstrap identity metadata only after its exact hash-bound bytes, destination binding, and c-list row-zero SELF authority agree. The server-owned binding selects this path; a browser enforcement hint is not authority.

**Why:** A resident replacement without bootstrap metadata can become the active Namespace owner successfully but make the next boot-image generation and Namespace Save fail closed. Conversely, portable or dynamic artifacts must never gain bootstrap authority merely by requesting the same slot.

**How to apply:** On publication, derive the complete runtime SELF GT from the committed static resident descriptor, validate it against row zero and the approval digest, and store both bootstrap forms in the exact approval. Exclude portable bindings and non-static/non-resident policies.

Freshness guards must not require a deferred name-hash identity seal for this
bootstrap path, or mistake prospective builder output for the selected artifact.

**Why:** The current bootstrap publisher deliberately removes those seal fields.
An older guard incorrectly reported a missing approval despite an exact
hash-bound record. Source freshness remained a separate, genuine failure.

**How to apply:** Verify the selected bytes, row-zero SELF, bootstrap metadata,
revision, grants, and Namespace binding independently of source comparison.
Obsolete Namespace name-hash metadata alone is not bootstrap identity authority.