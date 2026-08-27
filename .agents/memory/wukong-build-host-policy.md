---
name: Wukong build-host policy
description: Durable resource and release-evidence rules for vendor FPGA builds.
---

Run only one Wukong Vivado synthesis/implementation job at a time on the
resource-constrained build host, and constrain Vivado to two worker threads.

**Why:** Concurrent or orphaned synthesis workers can exhaust physical memory,
causing later builds to fail or stall during RTL optimization.

**How to apply:** Before a retry, verify no previous Wukong Vivado process tree
remains and that memory has recovered. Never kill a build you do not own.

Accept a hardware release only after the content-fingerprint readiness gate
passes, the build records an explicit successful exit, timing is non-negative,
and the fetched artifacts have fresh hashes and timestamps.

**Why:** Reused build directories and stale generated RTL can otherwise produce
a successful-looking artifact that does not correspond to the active sources.

**How to apply:** Build in a clean output directory from regenerated RTL. Bind
the resulting bitstream and flash image hashes, source fingerprint, sentinel
version, tool version, and timing result in the release provenance record.