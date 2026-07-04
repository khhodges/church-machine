---
name: EFXPT_HOME must be $EFINITY_HOME/pt, not the plain Efinity root
description: Interface Designer's device-name validation silently fails ("unusupported device") when EFXPT_HOME points at the Efinity root instead of its pt/ subdirectory
---

Efinity's Interface Designer (PT Unified) validates a device name via
`DeviceService.is_device_exists()` → `get_device_map_file()`, which reads
`os.environ["EFXPT_HOME"]` and builds `"$EFXPT_HOME/db/devicemap.csv"`. The
real file lives at `$EFINITY_HOME/pt/db/devicemap.csv` — i.e. `EFXPT_HOME`
must itself be `$EFINITY_HOME/pt`, not the plain Efinity install root.

**Symptom is deceptive:** if `EFXPT_HOME` is missing the `/pt` suffix, the
CSV path doesn't exist, `get_device_map_file()` silently returns `""` (no
error, no exception), and `is_device_exists()` unconditionally returns
`False` — regardless of whether the device name is valid. The resulting
error, `ERROR, unusupported device <name> in Interface Designer` (typo is
Efinity's own), looks like a device-name/typo problem even for a device
name used correctly everywhere else in the project (project XML, `peri.xml`,
every other build script, including MAP synthesis which succeeds with the
identical string).

**Why:** headless build scripts that avoid sourcing Efinity's `bin/setup.sh`
(a legitimate choice — it calls `exit` in non-interactive shells) must
manually recreate every env var it would otherwise set. `setup.sh` itself
defines `export EFXPT_HOME=$EFINITY_HOME/pt` — that is the authoritative
value. It is easy to instead default it to the plain `$EFINITY_HOME`
(matching the pattern used for `EFXPGM_HOME`, `EFINITY_USER_DIR_INI`, etc.,
which *do* take the plain root), producing a silent, wrong value that only
surfaces much later as a confusing device-lookup failure.

**How to apply:** any script that headlessly drives `efx_run`/Interface
Designer for the Ti60 OBBS pipeline must export `EFXPT_HOME` ending in
`/pt`. When a new Efinity Python module reports a device, family, or
resource lookup as "not found"/"unsupported" for a value known to be
correct elsewhere in the project, suspect a similar env-var path mismatch
before assuming a device-database or install problem.
