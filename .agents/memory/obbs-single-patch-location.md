---
name: OBBS single-patch-location bug class
description: Recurring failure pattern when a build pipeline has two places that could patch the same generated file — applies beyond just the firmware banner incident.
---

## The pattern

A generated/patched artifact (Verilog, firmware banner, BRAM init, etc.) has
TWO code paths that can write it: an earlier, newer/correct step in the main
build script, and a later, older step in a sub-script that used to own that
job before the newer step was added. If the later step is not removed or
converted to a read-only check, it eventually runs a second time against
output it doesn't recognize and fails with a confusing, low-level error
(regex/parse failure, wrong array names, etc.) instead of a clear
"already patched" message.

**Why this recurs:** every time a patch technique is upgraded (e.g. because
the old one stopped working on a newer toolchain version), it's tempting to
add the new call at the point that's easiest to edit rather than deleting the
old call. Both call sites keep working in isolation for a while — the bug
only appears when both run in the same pipeline invocation.

**How to apply — whenever you introduce a new/replacement patch step:**
1. Find every existing call site of the old patcher (grep the repo, not just
   the obvious build script) and remove or neuter it — don't just add the
   new call alongside it.
2. If a downstream script genuinely needs to confirm the earlier step ran
   (rather than just trusting pipeline order), make that confirmation a
   read-only self-test (grep for the new artifact's signature, check a
   companion file exists) — never a "patch again if it looks unpatched"
   fallback, because "looks unpatched" checks (e.g. bare substring sentinels
   like `'readmemb' in src`) false-positive on comments/strings left behind
   by the NEW patcher and then crash trying to find structures the new
   patcher already removed.
3. Add a standalone `scripts/check_<thing>_fresh.sh` guard with synthetic
   fixtures covering: fresh input, half-patched (new-technique markers but
   companion artifact missing), old-technique-only, and correctly-patched —
   register it in the build-guard test harness.

**Concrete instances of this exact bug class:**
- Firmware boot banner: hardcoded literal `"CHURCH Ti60 SoC+CM v2.4"` vs
  `FW_MAJOR`/`FW_MINOR` defines — fixed by deriving the banner from the
  defines at runtime; guarded by `check_fw_banner_matches_defines.sh`.
- CM DMEM BRAM init: old `patch_cm_bram.py` ($readmemb byte-lane technique,
  confirmed broken on Efinity 2026.1) vs new `gen_cm_dmem_direct.py`
  (explicit `cm_dmem_bram` EFX_RAM10 instantiation). `run_efx_map.sh` kept
  unconditionally calling the old patcher after `build_ti60_bitstream.sh`
  Step 2.5 had already run the new one; the old patcher's bare
  `'readmemb' in src` "already patched" sentinel false-positived on a
  comment the new patcher leaves behind, then crashed trying to parse
  `dmem_b0` declarations that no longer existed. Fixed by making
  `run_efx_map.sh` Step 0b a read-only self-test
  (`scripts/check_cm_dmem_bram_fresh.sh`) instead of a second patch call.
