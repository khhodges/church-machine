---
name: T7 freespace self-definition format
description: Key decisions in the lump freespace content format (0xAB header) and identity-field circularity rule
---

The embedded API JSON in a lump's freespace MUST NOT contain `token` or `issue` fields.

**Why:** token = hash(name || full genotype including freespace) — embedding the token is a circular fixed point; issue is excluded from token identity, so embedding it would bake publication history into the hashed bytes. Both are filename/catalogue metadata; tooling may annotate them into an extracted `.api.json` only.

**How to apply:** any compiler/extractor/spec edit touching the 0xAB freespace format or `.api.json` must keep identity fields external. Mint step 7 validates framing + bounds + zero remainder only; UTF-8/JSON/schema validation is tooling-side at extraction.
