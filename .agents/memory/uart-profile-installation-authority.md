---
name: UART profile installation authority
description: Pin UART software compatibility to the installed BIT, not today's mutable hardware checkout.
---

For a UART-only developer workflow, preserve the exact installed FPGA profile
while allowing separately approved native software images to change. Do not
rebuild hardware or reject its operator installation evidence solely because
the workspace's hardware source tree has advanced.

**Why:** The user wants a second developer to use the IDE without JTAG. The
tested Amoeba retry BIT and the generic IDE upload projection implement different
memory layouts; a generic build-number claim cannot establish compatibility.
Mutable checkout hashes also cannot identify a previously installed BIT.

**How to apply:** Pin the explicit native profile to its exact BIT identity,
retain approved image bytes without legacy projection, and bind installation
evidence to the selected physical board/session. Offline format checking,
physical runtime replacement, and persistent flash programming remain distinct.
Do not treat transfer ACK as board readback or startup acceptance.

The next image must drive towards a Mint demonstration, not merely repeat a
generic UART transfer or Amoeba/Mallory retry demonstration.

**Why:** The user explicitly directed: “the next image must drive towards a
Mint demonstration.”

**How to apply:** Make the next image review identify a concrete Mint operation,
its required caller/service bindings, and observable success. Reuse transport
validation as supporting evidence, not the demonstration objective. Do not
silently promote historical private Mint fixtures or expand this direction into
authorization for live provisioning, runtime fixes, or flash programming.

Proceed toward the Mint demonstration step by step with joint review and
explicit approval before each next step. Do not batch later stages under a
general agreement to pursue the demonstration.

**Why:** The user directed “Step by step with joint review and approval” after
raising the time and cost of another RTL replay.

**How to apply:** Propose the bounded action and its exclusions, await approval,
execute only that action, then review the result together. Do not launch a new
RTL simulation without separate approval; omitted tests remain omitted, not
passed. Keep image preparation, software testing, board commands and flash writes
as separately reviewed steps.
