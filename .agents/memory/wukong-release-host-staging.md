---
name: Wukong release-host staging
description: Safe staging pattern for producing a verified Wukong bitstream on the remote Vivado host
---

Use a fresh, commit-pinned checkout on the vendor host for each release candidate. Historical build directories may be dirty, missing, or contain unrelated artifacts; never synthesize from them.

**Why:** The configured legacy build path disappeared and the surviving checkout was stale and dirty, while a clean isolated checkout reproduced the exact GitHub source and passed readiness before Vivado.

**How to apply:** Stage the committed generated Verilog and constraints in the clean checkout, require the namespace/readiness gate and positive timing slack, then quarantine the resulting bitstream until its source commit and SHA-256 are reviewed. If the working tree is intentionally dirty, verify provenance from the isolated snapshot rather than weakening the root-tree check.

Release snapshots must contain hydrated LFS-backed boot/LUMP binaries, not pointer text. Preserve the packaging layout expected by the Tcl preflights (including colocated generator/top-level sources), and set `CM_PYTHON` to a host interpreter with Amaranth installed rather than bypassing readiness checks.

**Why:** A Git archive can silently package LFS pointers, and a clean host may not expose Vivado or Amaranth on its default PATH. Both conditions should stop before synthesis, but neither means the source itself is invalid.

**How to apply:** Verify the staged readiness gate before launching Vivado, explicitly select the vendor executable and Python environment, and treat all pre-synthesis failures as non-candidates with no release artifact.

The droplet's default Python may lack Amaranth even though a vendor-build
environment is installed. The user verified that
`/root/wukong-vivado-python/bin/python` imports Amaranth 0.5.8 and passes the
staged readiness check.

**Why:** Using the default Python incorrectly made a prepared build host appear
to need dependency installation.

**How to apply:** Check that interpreter still exists and imports Amaranth, then
set `CM_PYTHON` explicitly in the background build script. Do not depend on an
interactive shell's activated environment being inherited by tmux.