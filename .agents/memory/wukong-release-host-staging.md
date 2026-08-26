---
name: Wukong release-host staging
description: Safe staging pattern for producing a verified Wukong bitstream on the remote Vivado host
---

Use a fresh, commit-pinned checkout on the vendor host for each release candidate. Historical build directories may be dirty, missing, or contain unrelated artifacts; never synthesize from them.

**Why:** The configured legacy build path disappeared and the surviving checkout was stale and dirty, while a clean isolated checkout reproduced the exact GitHub source and passed readiness before Vivado.

**How to apply:** Stage the committed generated Verilog and constraints in the clean checkout, require the namespace/readiness gate and positive timing slack, then quarantine the resulting bitstream until its source commit and SHA-256 are reviewed. If the working tree is intentionally dirty, verify provenance from the isolated snapshot rather than weakening the root-tree check.