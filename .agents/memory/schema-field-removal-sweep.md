---
name: Schema field removal must sweep all readers
description: When a sidecar/schema field is removed, purge CI steps and doc-figure HTML viewers too, not just server code
---
Rule: removing a field from the sidecar schema is not done until every reader is purged: server write/read paths, the PATCH allowed-fields list, CI workflow steps (including their results-JSON and final-assert references), and any static doc-figure HTML viewers that carry their own embedded copies of the data and render the keys.

**Why:** completion review rejected the V1.3 cleanup twice — first for a CI step still invoking the deleted script, then for viewer HTML still reading the keys. Presentation-only copies in viewers were renamed (group→section, doc_refs→docs) rather than restructured.

**How to apply:** after any schema-field removal, grep the whole repo (including .github/ and docs/figures/) for the field name; add/extend a CI invariant check asserting the key stays gone from sidecars AND viewer artifacts.
