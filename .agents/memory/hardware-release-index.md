---
name: Hardware release evidence
description: Build-host, staging, artifact tracking, and release authority constraints.
---

- [Build-host policy](wukong-build-host-policy.md) — serialize resource-constrained vendor builds; require timing-clean provenance.
- [Readiness fingerprints](hardware-readiness-fingerprint.md) — generated hardware must identify its active source inputs.
- [Release candidate baseline](bitstream-release-candidate-baseline.md) — distinguish pending hardware work from trusted released artifacts.
- [Release-host staging](wukong-release-host-staging.md) — use fresh commit-pinned vendor checkouts.
- [Binary merge survival](verified-binary-merge-survival.md) — track and verify the complete release bundle.
- [Historical authority](historical-hardware-authority-chain.md) — bind test context to the exact source, build, and artifact digest.