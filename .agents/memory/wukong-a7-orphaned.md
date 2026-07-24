---
name: Wukong A7 orphaned file — resolved
description: wukong_xc7a100t.py (v1.1 Ethernet) was never in the build; deleted; future Ethernet work needs a new file
---

`hardware/wukong_xc7a100t.py` was the v1.1 Ethernet top-level (200 MHz W19 clock,
RTL8211E RGMII). It was never imported by `gen_rtlil.py` (which uses `wukong_top.py`
for the V3 LED-blink/UART build). The file has been deleted.

**Why:** Leaving dead Amaranth modules in the hardware directory creates a build
mix-up risk — a developer could accidentally synthesise the wrong board variant.

**How to apply:** Do not restore `wukong_xc7a100t.py`. When Phase 3 Ethernet work
begins, create `hardware/wukong_ethernet_v3.py` as documented in
`docs/wukong-port-plan.md` § P3.3.
