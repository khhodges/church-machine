---
name: Dynamic system LUMP runtime binding
description: How manifest-backed dynamic system LUMPs select secure runtime implementations without claiming a fixed Namespace slot.
---

For a dynamic system LUMP, package a canonical manifest/binary/sidecar identity
and generate the runtime identity projection from that artifact. The runtime
must bind its implementation only when the projection is canonical and the
registry descriptor is explicitly dynamic; it must fail closed otherwise.

**Why:** A manifest field that merely repeats a hard-coded registry index does
not prove that the packaged LUMP selected the security-sensitive implementation,
and can silently drift into a false fixed-slot model.

**How to apply:** Keep physical Namespace allocation inside the runtime
implementation. Verify the canonical identity and dynamic/non-resident policy
before binding calls, and test both the valid identity path and rejection of
tampered slot or identity metadata.