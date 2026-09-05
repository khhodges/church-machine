---
name: LUMP output profile stability
description: Why repeated LUMP saves must retain the selected embedded-content profile.
---

Remember the selected API-only, Compact-source, or Full-source output profile per abstraction, and infer it from an opened V1.3 content frame when no preference exists. Reopening Save must not silently choose a different profile.

**Why:** LUMP allocation is a power-of-two total artifact size. Changing only the embedded-content profile can move an otherwise unchanged LUMP between 64, 128, and 512 words, making History appear unstable even when CW and CC barely change.

**How to apply:** Keep History based on actual binary length, label entries with their encoded profile, and treat a larger allocation as legitimate only when content/profile crosses an allocation boundary. Do not substitute CW for artifact size.