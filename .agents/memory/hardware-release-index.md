---
name: Hardware release evidence
description: Build-host, staging, artifact tracking, and release authority constraints.
---

- [Hardware abstraction](hardware-abstraction-boundary.md) — Artix7/Wukong catalogs include unused options without implying implementation or access.
- [CHANGE fetch evidence](hardware-change-fetch-address.md) — actual fetch addresses and absolute saved NIAs prove activation, not completion alone.
- [Internal probes](wukong-internal-probe-preservation.md) — preserve optional ILA observations and attributes without creating external ports.
- [Build-host policy](wukong-build-host-policy.md) — serialize resource-constrained vendor builds; require timing-clean provenance.
- [Readiness fingerprints](hardware-readiness-fingerprint.md) — generated hardware must identify its active source inputs.
- [Release candidate baseline](bitstream-release-candidate-baseline.md) — distinguish pending hardware work from trusted released artifacts.
- [Release-host staging](wukong-release-host-staging.md) — use fresh commit-pinned vendor checkouts.
- [Binary merge survival](verified-binary-merge-survival.md) — track and verify the complete release bundle.
- [Historical authority](historical-hardware-authority-chain.md) — bind test context to the exact source, build, and artifact digest.
- [RTL replay and ISA gates](generated-rtl-replay.md) — reset-faithful synthesis, model distinctions, ISA-derived acceptance, and trace/snapshot evidence limits.
- [Elaboration performance](amaranth-shape-memoization.md) — reuse release-generator AST memoization; bare traversal can stall or crash.
- [Validation supervision](rtl-validation-budget.md) — long matrices may outlive completion validation; unfinished checks are not passes or RTL failures.
- [ISA/simulator reference goals](isa-simulator-reference-goals.md) — fully defined ISA, explicit simulator exceptions, and FPGA-comparable binary memory detail.
- [Flash capacity units](configuration-memory-capacity.md) — write_cfgmem uses MiB; the Wukong 64 Mbit flash requires size 8, not 64.
- [Phase 1 clock](phase1-reduced-clock.md) — approved 25 MHz functional-test candidate first; memory integrity separately, with timing and programming gates preserved.