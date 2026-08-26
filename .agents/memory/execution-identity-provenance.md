---
name: Execution identity provenance
description: Rules for presenting browser-side source and binary freshness without overstating proof.
---

Browser-side execution identity may call a run **current** only when the relevant
provenance checks are actually comparable. Treat an available empty source string
as source bytes and compare it to the editor; treat a hash from another algorithm
as opaque provenance rather than evidence of editor agreement.

**Why:** A familiar abstraction name, or a server SHA-256 that cannot be compared
to the browser session fingerprint, can otherwise make unrelated editor text look
fresh.

**How to apply:** On every new load path, explicitly distinguish source bytes
(including `""`) from hash-only source metadata. Keep binary verification tied to
the recorded compile-time binary baseline, and reserve one polite announcement
region for identity transitions rather than announcing on each editor render.