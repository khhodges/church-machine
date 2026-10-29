---
name: Vendor observer declaration portability
description: Icarus success does not establish Vivado testbench declaration compatibility.
---

Declare observer counters and arrays before any procedural use in generated Verilog.

**Why:** Icarus accepted a forward counter reference that Vivado xvlog rejected, stopping validation after costly synthesis.

**How to apply:** Check declaration order independently of behavioral simulation. If only the observer fails, preserve the frozen inputs and synthesis hashes, create a separately hashed corrected observer, and resume simulation without rebuilding the design. Never label a local stub test as vendor validation.
