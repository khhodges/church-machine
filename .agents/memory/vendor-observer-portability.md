---
name: Vendor observer declaration portability
description: Icarus success does not establish Vivado testbench declaration compatibility.
---

Declare observer counters and arrays before any procedural use in generated Verilog.

**Why:** Icarus accepted a forward counter reference that Vivado xvlog rejected, stopping validation after costly synthesis.

**How to apply:** Check declaration order independently of behavioral simulation. If only the observer fails, preserve the frozen inputs and synthesis hashes, create a separately hashed corrected observer, and resume simulation without rebuilding the design. Never label a local stub test as vendor validation.

Validate model-package imports outside the repository, without inherited project paths or secrets, before transferring a package.

**Why:** Repository-local imports masked omitted server approval helpers until the model was launched on the droplet. Even explicit-image hardware imports require the real approval helper and its deferred validator.

**How to apply:** Use only the extracted package, separately recorded supplemental modules, and installed third-party dependencies. Preserve admission checks; never substitute stubs or weaken evidence validation to make imports succeed.
