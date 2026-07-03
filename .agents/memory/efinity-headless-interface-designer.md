---
name: Efinity headless Interface Designer patches
description: Why PT Unified's Interface Designer needs 5 patches to the Efinity install itself to run headless, and why hardcoded doc snippets silently no-op on a new build machine
---

# Interface Designer needs the Efinity installation patched, not just the project

PT Unified's `check_design()` validates HSIO GPIO clock rules using PLL/OSC
registries that are only populated in a GUI session. Headless (`efx_run
--flow interface`), those registries are `None` and `check_design()` crashes
before `outflow/<circuit>.interface.csv` is ever written — Place & Route then
hard-fails with a generic "did not produce .interface.csv" error that gives
no hint the real problem is upstream, inside Efinity's own Python sources.

**Why this is easy to silently "fix" and have it not work:** the patch
snippets live in `hardware/soc_combined/BUILD_SOC_CM.md` as manual
copy-paste Python with a hardcoded path
(`/home/sipantichijk/efinity/2026.1/...`). If the build machine's user/home
differs (e.g. `root@...droplet` → `/root/efinity/2026.1`), running the
snippet verbatim touches a path that doesn't exist and does nothing — no
error, no signal, just a build that still fails the same way next time.

**How to apply:** patches now live in
`scripts/apply_efinity_headless_patches.py` (`--apply`/`--check`, `--root`
override for tests), resolving the install root the same way as every other
OBBS script: `$EFINITY_HOME` else `~/efinity/2026.1`. `run_efx_pnr.sh` calls
`--apply` automatically every run (idempotent, sentinel-gated
`church-headless-patch-v1`, `py_compile`-verified with rollback). Regression
fixtures: `scripts/test_build_guard.sh` Section G.

**Known-bad variant:** an `if True:` bypass of `check_design()` in
`design.py`'s `generate()` (do not reintroduce) skips the call entirely,
leaving IO config state unpopulated → structurally incomplete LPF → IO pins
place randomly downstream. The correct patch still *calls* `check_design()`
and only swallows the exception. See `.agents/memory/ti60-headless-lpf.md`.

**Unverified gap:** a 6th, undocumented patch (neutralizing
`efx_run_pt_unified.py`'s `return PTFlowRunnerStatusCode.ERROR` after a
design-check failure table) is applied only best-effort when there is
exactly one unambiguous match — the exact surrounding source was never
captured verbatim from a real Efinity install, so don't assume it always
fires; check the patcher's own output.
