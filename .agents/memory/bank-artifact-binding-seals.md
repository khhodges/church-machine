---
name: Bank artifact binding seals
description: Keep the generated Bank artifact and hardcoded runtime identity gate synchronized.
---

Any Bank source change, including documentation comments, changes the tier-2
self-defining artifact bytes and therefore rotates its token and binary hash.
The artifact builder updates the binary, manifest, sidecar, and identity
projection, but the runtime binding also has its own canonical token/hash gate
that must agree.

**Why:** The runtime rejects a regenerated Bank projection whose token or
binary hash is still compared against an earlier artifact, disabling Bank
dispatch before any custody operation can begin.

**How to apply:** After regenerating Bank, run the Bank artifact and
capability-only suites. If the binding rejects the new projection, synchronize
its canonical token and binary hash with the manifest/binary before releasing
the artifact.