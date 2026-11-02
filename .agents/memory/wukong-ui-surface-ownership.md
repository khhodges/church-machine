---
name: Wukong UI surface ownership
description: Defines the durable boundary between physical Wukong controls and software simulator controls.
---

Physical Wukong controls belong exclusively on the Builder > Testing page. The simulator/dashboard must remain software-only: its Step, Run, Stop, boot selection, and modifier shortcuts must never send commands to the FPGA. A Wukong item on the simulator toolbar may show passive connection status and navigate to Testing, but must not control the board.

**Why:** The user explicitly separated the physical testing workflow from software simulation. Mirroring simulator actions to hardware or exposing hardware controls on the simulator makes it unclear which machine is executing and creates accidental board-command paths.

**How to apply:** Add or change Step HW, HW Run/Pause, immediate Stop, Load/upload, breakpoint, reboot, and call-depth controls in the Testing page. When touching simulator controls, add guards proving they do not call Wukong command or upload endpoints.

The IDE Bridge On/Off switch controls this browser's hardware connection,
not board power, execution, or the external bridge process.

**Why:** The user requested an IDE on/off switch after repeated reconnect-failure
messages were being presented as board connection transitions.

**How to apply:** Keep local disconnection separate from STOP. Off must suppress
monitoring and new hardware requests without sending a board command; previously
sent commands cannot be recalled by a browser-local switch.

The user requires Bitstream Under Test on the Testing view itself, with the
associated frozen Namespace/build-DNA link there rather than only in download
or build-approval pages.

**Why:** Test identity must be visible where tests are operated. A proposed
section must not be described as already present.

**How to apply:** Distinguish selected build identity from verified installed
identity and unavailable provenance. Honour the user's step-by-step review
before executing the proposed release-review work.

Build-DNA inspection must decode the coordinate system of the frozen image,
not borrow the current Namespace's slot numbering or labels. Keep binary-body
hashes distinct from portable artifact hashes and keep unassociated Namespace
inspection distinct from evidence for a bitstream.

**Why:** Retained descending and ascending images coexist. Ascending metadata
occupies slot zero; treating the following self descriptor as slot zero shifts
every GT target. Localization can legitimately change the inspected body hash.

Treat revision-store integrity and valid FPGA artifacts as separate checks.
Do not call catalog entries real builds solely because their stored hashes
verify. Validate the bitstream format and trace its exact bytes to retained
build receipts and input-image bytes before presenting build DNA.

**Why:** The Testing catalog exposed checksum-valid, tiny unit-test payloads as
bitstreams. Real vendor evidence was retained separately in uploaded archives.
Receipt-backed experimental inspection does not confer release approval,
installation permission, or proof of what is installed on the board.

The user authorized receipt-backed experimental pairs for DNA inspection only.
Keep that permission separate from artifact publication, admission, installation,
release approval and hardware commands.

**Why:** The explicit approval was “Yes, inspection only”; surfacing an archive
in Testing must not promote it into the live Namespace or approved-build history.