---
name: Wukong write_bitstream DRC NSTD-1/UCIO-1 session-boundary trap
description: launch_runs -to_step write_bitstream spawns a fresh Vivado sub-process; DRC severity overrides set in the parent session are lost, causing NSTD-1/UCIO-1 errors on ILA debug ports.
---

## Rule

Never use `launch_runs impl_1 -to_step write_bitstream` in `wukong_xc7a100t.tcl`.
Use `open_run impl_1` + explicit severity downgrades + `write_bitstream` directly instead.

## Why

`launch_runs -to_step write_bitstream` spawns a child Vivado process that re-opens
the routed checkpoint from scratch. Any `set_property SEVERITY {Warning}` calls made
in the parent session are **not** serialised into the checkpoint and therefore
disappear. The XDC file sets those overrides for `opt_design`/`place_design`/`route_design`
(which run in the parent session) but not for the bitstream child process — so
`write_bitstream`'s precondition DRC re-fires NSTD-1 and UCIO-1 as hard errors on
the unassigned ILA observation ports (`dbg_*`), blocking bitstream generation even
though timing is clean.

## How to apply

Replace:
```tcl
launch_runs impl_1 -to_step write_bitstream -jobs ${JOBS}
wait_on_run impl_1
```
With:
```tcl
open_run impl_1 -name impl_1
set_property SEVERITY {Warning} [get_drc_checks NSTD-1]
set_property SEVERITY {Warning} [get_drc_checks UCIO-1]
write_bitstream -force ${TOP}.bit
```

This runs in the same Vivado session as implementation, so severity settings
are already live when `write_bitstream`'s precondition DRC fires.
