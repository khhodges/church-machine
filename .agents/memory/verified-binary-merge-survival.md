---
name: Verified binary merge survival
description: How verified hardware releases remain complete across task and branch merges.
---

A verified hardware provenance record is incomplete unless the exact binary it names is explicitly tracked or stored through another merge-safe release mechanism. A local ignored file can make verification pass while still disappearing from the merged result.

**Why:** A verified Wukong build retained its provenance, sidecar, and MCS while the canonical `.bit` was silently omitted by a broad ignore rule. Local presence alone did not make the artifact part of the release.

**How to apply:** Narrowly unignore and stage the canonical release binary (or use an equivalent durable release store), then run a required checkout-based CI guard that verifies the binary, sidecar, provenance, and companion programming image as one bundle.

Keep newer source-generation provenance separate from the saved verified
programming-image release record.

**Why:** An unverified RTL-generation record replaced a verified release record
while the programming binaries and sidecar stayed unchanged, producing mixed
source identities and invalidating the bundle check.

**How to apply:** Recover historical release evidence only after matching the
exact binary hashes, sizes, source identity and sidecar; preserve the displaced
unverified record separately. Historical release recovery does not certify
current source or newer generated RTL and never authorizes flashing.