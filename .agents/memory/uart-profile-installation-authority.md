---
name: UART profile installation authority
description: Pin UART software compatibility to the installed BIT, not today's mutable hardware checkout.
---

The user accepts the existing BIT as a fixed bootstrap toward the CLOOMC++
ABI LUMP compiler and future software, rather than requiring a new BIT for
each compiler/ABI iteration.

**Why:** The user described the BIT as a "stranded but adequate bootstrap to
the future" after agreeing to distinguish software ABI changes from hardware
changes.

**How to apply:** Check new compiler output against the frozen BIT's actual
instruction and image contracts. Use separately approved complete UART software
images; do not claim the revised ABI is physically qualified yet. Hardware
changes and updating the power-on image remain separately approved work.

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

Start the next Mint bootstrap review with the user's proposed manually created
RW data capability matching the Namespace Table's base and limit, before the
broader programmable-image demonstration.

**Why:** The user identified this authority as the missing starting point for
Mint to create RW data objects and move setup online.

**How to apply:** Review exact table geometry and private provisioning first.
Distinguish the user's slot-zero terminology from the frozen image's metadata
and self-descriptor layout. Investigation is not permission to install the
grant, alter the live Namespace, or run board commands.

For this boot-bitstream Mint bootstrap demonstration, include the passkey
parameter in the interface but ignore it, as with Mint.CREATE. Do not require
Abstract-passkey loading or verification on this path.

**Why:** The user explicitly directed “include but ignore the passkey” after
the separate approval-token path was confused with the Inform RW table grant.

**How to apply:** Preserve the interface without treating the ignored parameter
as verified authorization. Keep Inform capability, permission, bounds, sequence,
and integrity checks intact. This demonstration-specific decision does not
remove passkey enforcement from other profiles or authorize image installation.

A bounded CREATE word-address adaptation does not qualify DESTROY for the same
objects. Review the release path's address units separately before enabling it.

**Why:** The frozen BIT consumes resident descriptor bases in words, whereas
the retained Mint/Cleaner software contract uses physical bytes. Correcting
publication alone does not correct the address later returned to Cleaner.

**How to apply:** Keep the initial demonstration explicitly CREATE-only unless
the inverse conversion and release checks receive separate review. Preserve
the original saved artifact; do not silently broaden a descriptor adjustment
into lifecycle qualification.

The user approved the proposed fresh disposable CREATE layout for offline
preparation, including separate private services/state and a Namespace RW alias.

**Why:** They selected “Approve offline preparation” after the fresh-state
boundary and remaining validation/startup checks were presented.

**How to apply:** Treat new slot history as explicitly fresh only in that
disposable candidate, never as live-board history. Approval covers offline
preparation, not validator bypasses, startup-design changes, RTL replay,
upload, reboot, or flash programming.

Treat the demonstration's Namespace RW grant as a RAM view, not an MMIO
workaround. Report overlapping capability ranges as warnings rather than
assuming each descriptor owns a separate allocation.

**Why:** The user proposed overlap warnings and accepted describing access to
existing RAM directly after discussing the MMIO alternative.

**How to apply:** Distinguish data views from executable/Thread bodies without
requiring every data view to contain a LUMP header. Preserve integrity, bounds,
required boot-object checks and runtime enforcement. This agreement does not
authorize board operations or a new hardware mapping.

Do not place GT scratch storage in the client allocation heap.

**Why:** The user withdrew that direction because it would create a
“system wide threat of Heap attacks.” Merely describing a heap word as private
does not establish isolation from other writers or later allocation/reuse.

**How to apply:** Review all write authority over any proposed GT-load source
before adopting it. Bounds and descriptor integrity do not establish that the
writer was entitled to choose the loaded capability.

Start with the simplest synchronous Mint CALL/RETURN design: protected scratch
in Mint's private state, written through its RW view and loaded through a
one-word L view. Defer a dedicated Mint service Thread to Phase X.

**Why:** After reviewing the alternatives, the user selected the simplest
synchronous option and explicitly deferred the dedicated Thread.

**How to apply:** Reuse the saved Mint write/LOAD/clear pattern rather than
redesign CR6 or introduce WL permissions. Keep scratch outside client allocation
storage; verify capability custody and exclusive use. Synchronous CALL alone
does not prevent concurrent calls from other Threads. Scope the initial
demonstration to one caller, not a claim of multi-Thread service safety.
This choice does not authorize hardware installation or flash changes.
