---
name: Capability picker version selection
description: Default-version rule for capability selection from saved LUMPs.
---

The capability picker groups saved LUMPs by abstraction. Its default choice is
the newest dated LUMP with a valid binary and test/stable/released indication;
if none qualifies, it falls back to the newest available version. Older
versions stay available only through the row's “Earlier versions” disclosure.

**Why:** Rendering every archived LUMP as a separate capability created
ambiguous duplicate choices and made it easy to select an outdated version.

**How to apply:** Preserve access to history, but never surface an archived
version alongside the default choice without an explicit expansion action.