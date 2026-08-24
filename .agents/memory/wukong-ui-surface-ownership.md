---
name: Wukong UI surface ownership
description: Defines the durable boundary between physical Wukong controls and software simulator controls.
---

Physical Wukong controls belong exclusively on the Builder > Testing page. The simulator/dashboard must remain software-only: its Step, Run, Stop, boot selection, and modifier shortcuts must never send commands to the FPGA. A Wukong item on the simulator toolbar may show passive connection status and navigate to Testing, but must not control the board.

**Why:** The user explicitly separated the physical testing workflow from software simulation. Mirroring simulator actions to hardware or exposing hardware controls on the simulator makes it unclear which machine is executing and creates accidental board-command paths.

**How to apply:** Add or change Step HW, HW Run/Pause, immediate Stop, Load/upload, breakpoint, reboot, and call-depth controls in the Testing page. When touching simulator controls, add guards proving they do not call Wukong command or upload endpoints.