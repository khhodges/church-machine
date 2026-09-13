---
name: Malformed LUMP inspection UI
description: Malformed LUMP bytes stay inspectable in the IDE while validation remains authoritative.
---

The IDE must keep available exact LUMP bytes and recoverable source viewable
read-only when integrity or approval cannot be established. Show an explicit
unverified warning, not a blank sealed inspection view or a verified identity.
Audit, load, and runtime integrity validation remain enabled and authoritative.

**Why:** Developers need to inspect damaged bytes manually, but removing structural validation would allow unsafe binaries to load.

**How to apply:** Separate read-only inspection from editable source and
execution authority. Missing bytes stay explicitly unavailable; never decode
authentication-error JSON as binary or bypass access controls to retrieve
private source. The user's confirmed preference is visible available data with
a warning, not suppression of diagnostic inspection.