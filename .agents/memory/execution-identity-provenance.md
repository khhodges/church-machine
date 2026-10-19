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

Before any program is loaded, show only “No program loaded”; verification,
source, binary, Namespace, and run diagnostics have no meaning yet. Once loaded,
show the canonical dot pet name and keep raw artifact tokens internal.

**Why:** Empty unverified fields create alarm without actionable information,
while raw tokens expose implementation identity instead of the programmer’s
stable name.

**How to apply:** Key the quiet state on absence of program metadata and known
live memory, not merely on unverified status. Resolve loaded display identity
from canonical server metadata before falling back to an abstraction label.

Private saved-design execution identity is distinct from editor freshness.
Correlate captured pre-instruction identity with the exact admitted image and
immutable artifact binding. Live Namespace G visitation bits may change during
ordinary boot; do not treat that bit alone as an artifact change, or mask other
descriptor fields such as generation.

**Why:** Comparing the complete live descriptor to the frozen image falsely
rejected valid booted programs after mLoad set G. Comparing only the observed
instruction would instead miss changes elsewhere in executable code.

**How to apply:** Keep occurrence-bound evidence on historical rows, compare
code and localized capabilities to the admitted baseline, and invalidate the
current header independently when the selection or runtime changes. Recheck
the current label on presentation, not only when another instruction retires:
an unchanged selection does not prove that executable memory is unchanged.