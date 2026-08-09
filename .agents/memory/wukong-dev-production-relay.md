---
name: Wukong dev/production event relay
description: Local simulator previews need the production event relay when the physical bridge is connected to lab.cloomc.org.
---

The FPGA status page and simulator can be served by different Church Machine instances. A local preview only follows hardware when its `/hardware/wukong/relay` is enabled with `https://lab.cloomc.org`, or when a bridge posts directly to the local server.

**Why:** The browser polls the server-local `/hardware/wukong/events`; it does not read another instance's queue directly. A green production FPGA page therefore does not imply that a local simulator has events.

**How to apply:** If local `/hardware/wukong/status` shows `total_trace_posts: 0`, `server_seq: 0`, and `total_bridge_polls: 0` while production has live data, enable the relay and refresh the simulator. The relay is process state and must be re-enabled after a server restart unless startup configuration is added.