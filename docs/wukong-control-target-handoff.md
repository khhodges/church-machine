# Wukong control correction — operator handoff

This preparation does not publish the web page, restart a bridge, or send board commands.
No FPGA bitstream or persistent flash change is required.

## Before activating

1. Obtain the board's verified, operator-provisioned device UID from its commissioning
   record. The UART protocol does not supply a silicon UID. Do not fabricate one
   from COM3, a session ID, a display name, or whichever bridge is connected.
2. Plan the web publish and Windows bridge update/restart separately with the operator.
   Preserve the current console output and startup evidence first.
3. At that approved restart, retain the existing bridge options and credential setup,
   adding `--device-uid "<verified-board-uid>"`. Alternatively configure
   `WUKONG_DEVICE_UID` in that bridge's process environment. Do not change REPORT_TOKEN.
4. In the IDE's target details, explicitly select a Wukong target and the same UID.
   Reopening Testing will show whether that selection matches the fresh bridge report.
5. Only after separate authorization, issue the desired hardware command once.
   Check the visible control result and delivery log. Queued or UART-written is not
   proof of board reboot or confirmed Halt.

## What the correction does

- Reboot, Step, Run/Pause, Stop and breakpoint requests carry the selected device UID
  and freshly observed bridge session.
- Missing, stale, disconnected and mismatched target evidence blocks those requests
  locally; existing server authentication and target checks remain authoritative.
- The control result is visible above the health panels as well as in the event log.
- The bridge warns clearly when it has no configured identity. Monitoring remains
  available; it does not grant control access or automatically select a board.

## Local validation

```
node simulator/test_fpga_control_auth.js
node simulator/test_fpga_control_target.js
python3 -m pytest tests/hardware/test_bridge_device_identity_config.py -q
```

These checks use synthetic identities and mocks, not the connected FPGA.
