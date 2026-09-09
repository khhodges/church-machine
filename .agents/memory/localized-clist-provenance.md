---
name: Localized c-list provenance
description: How to distinguish legitimate destination localization from stale c-list-only artifact changes.
---

Generated hardware images need provenance for both the exact selected artifact digest and the localized c-list digest at each resident slot. Comparing only immutable code/data cannot detect a c-list-only replacement; comparing artifact c-list bytes directly rejects legitimate localization.

**Why:** SelfTest Next.GT and portable capability rows are rewritten for the destination image, but a later selected artifact can also differ only in those rows.

**How to apply:** Authenticate the generated image and its localized rows together, then separately require the current Namespace-selected artifact digest to match the digest recorded at generation.