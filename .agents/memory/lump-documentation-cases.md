---
name: Three LUMP documentation cases
description: The canonical documentation forms for LUMPs are fully documented, source-only without comments, and API-only.
---

Every LUMP must be classified into one of three documented cases:

1. **Fully documented** — includes the complete permitted documentation.
2. **Source** — includes source representation with comments excluded.
3. **API only** — includes the API description without source.

These are documentation/content classifications, not alternate sources of Namespace Table truth. The Namespace Table and assigned slot/LUMP data remain authoritative for the artifact's identity and runtime/build membership.

**Why:** A LUMP can expose implementation source, an interface contract, or both; the distinction must be explicit so tooling does not infer missing source or documentation.

**How to apply:** Preserve the classification when compiling, storing, validating, and displaying a LUMP. Do not silently convert API-only or source-only content into a claim of full documentation.