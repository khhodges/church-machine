---
name: UART profile installation authority
description: Pin UART software compatibility to the installed BIT, not today's mutable hardware checkout.
---

The second Artix-7 is for a team member using the same published lab IDE
for code development and Phase 1 integration. Foundation improvements
continue in the Replit development workspace. Do not create a second site.
Prepare the shared-IDE usage before flashing the second board.

Agreed shared-site operating rules:
- Keep the published baseline unchanged while team development begins.
- Export and verify live LUMPs, history and Namespace configuration before
  any republish; do not assume production saves sync back to the workspace.
- Connect only one hardware bridge at a time.
- Only the project owner changes shared Namespace configuration and boot
  selections; the team member develops code and performs Phase 1 integration.

**Why:** The user approved the first three safeguards and explicitly reserved
Namespace and boot changes to themselves.

**How to apply:** Treat these as operating constraints, not proof of enforced
role-based permissions or completed backups. Do not publish or connect a
second simultaneous bridge as part of ordinary development work.

For proposed multi-bridge support, the user agrees that software-image
upgrades will never occur simultaneously, using a shared IDE switch.

**Why:** Serial image loading reduces complexity while allowing boards to
run different compatible images. This is not a request to change the
Phase 1 bitstream.

**How to apply:** Design one shared selected upload target and one
server-enforced upload operation at a time, pinned to exact image bytes,
board UID and session. Do not retarget an in-flight operation. Still isolate
board commands and telemetry. Until implemented and verified, the existing
one-connected-bridge rule remains in force.

**Why:** The user explicitly rejected the independent-site interpretation
and clarified the split between Phase 1 integration and foundation work.

**How to apply:** Check shared artifact/editing behavior and board-target
isolation on the existing site. Keep foundation changes out of the shared
baseline until deliberately released. Verify the actual published domain
before configuring endpoints. This clarification does not authorize
publishing, flashing, or sharing existing credentials.

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

Do not use trace-map disassembly text as the installed BIT's decoding authority.
Compare the raw instruction with the archived decoder and replay captured
operands before changing capability bounds.

**Why:** A legacy-form DREAD was displayed as a legal positive immediate while
the frozen FPGA interpreted those bits as an indexed subtraction. Replaying
the saved word reproduced the BOUNDS fault without an undersized capability.

**How to apply:** Match the archived source bundle to the vendor manifest and
recorded BIT, distinguish mapped bytes from UART-captured instruction evidence,
and audit related encodings before preparing a replacement software image.

Use the native Development Image preparation contract when validating a
replacement UART image, not an older simulator-admission harness's blanket
requirement that every resident C-list be resolved.

**Why:** That stronger harness prerequisite rejected an offline correction
because unrelated dormant Mint references were unresolved. Native preparation
retains those unresolved references for runtime checks; resolving them would
change the programmer's authority design rather than fix instruction encoding.

**How to apply:** Keep private candidate assembly distinct from complete-program
execution qualification. Preserve unresolved bindings, run the actual native
builder, and report separately which execution paths were replayed.

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

For the immediate board handoff, the user explicitly approved temporary
sharing of the existing bridge credential with full existing access.

**Why:** The user chose “Yes, temporary full access” to avoid delaying the
handoff for a separate restricted credential and production release.

**How to apply:** Transfer the credential privately outside chat and source
control. Keep one bridge connected at a time and the published site unchanged.
Do not claim a separate token exists, restricted permissions are enforced, or
the receiving workstation has been tested until there is fresh evidence.
This temporary exception does not authorize publishing or FPGA changes.

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

Use preconfigured free-object queues by size for foreground allocation.
Move Mint's creation work to an independent background Thread that can be
finished later to refill those queues. This supersedes the synchronous
scratch/C-list minting design.

**Why:** The user proposed a faster allocation path with preconfigured queues
and background Mint, separating clients from the conversion authority discussed
in the scratch review.

**How to apply:** First review preprovisioned, zeroed objects with existing GTs
and a bounded dequeue/return path; do not implement background refill yet.
Retain CR1 as the result register and the 64-word minimum. Queue custody,
exclusive dequeue, exhaustion behavior, and safe reclamation remain contracts
to establish; a separate Thread alone does not prove complete threat removal.
This direction does not authorize installation, hardware changes, or reuse of
objects while old capabilities remain valid.

Version-based reuse is acceptable for Phase 1; the initial queues need not be
restricted permanently to consume-once objects.

**Why:** In response to the stale-capability concern for free queues, the user
said “Using the version # that is fine for Phase 1.”

**How to apply:** Software advances the slot generation before reissue and
publishes matching descriptors/GTs; hardware does not change versions.
Do not wrap generations into old identities. Verify stale loaded as well as
stored GT behavior on the frozen profile before claiming revocation is proven.
This acceptance does not authorize implementation of the deferred refill Thread.

Phase 1 starting inventory is four 64-word, two 128-word, and two 256-word RW
objects, with a shared return queue sized for eight objects.

**Why:** The user approved that initial sizing proposal with “ok proceed.”

**How to apply:** Treat these as initial demonstration capacities, not a general
allocator policy. Retain finite-inventory exhaustion until refill is separately
implemented; queue storage is additional to the 1024-word object pool.

Represent the foreground allocator as one resident abstraction with methods
and private variables; the size queues and return queue are internal structures.

**Why:** The user corrected the proposed representation: “we should use one
abstraction with various methods and variables.”

**How to apply:** Preserve the CREATE/CR1 contract and keep queue bookkeeping
private. Do not turn each queue into a separate abstraction or expose queue
capabilities to clients. Earlier per-queue descriptor/C-list numbering is
provisional; reconcile actual variable storage before implementation. Grouping
methods does not authorize deferred release/refill or hardware operations.

The user approved the standardized eight-object formation and requested a
four-method Free Handler design in one abstraction.

**Why:** They said “Design approved lets design a Free Handler that includes
the four methods.” The formation fixes relative sizes/offsets, not universal
GT values or permission to reuse live generations.

**How to apply:** Review three size-specific allocation methods and Release
under FreeHandler. Preserve the user's Free64, Free128 and Free256 method
names, not Allocate64/128/256; the user explicitly challenged that unsolicited
rename. These are not changes to saved Mint.CREATE. Release quarantines returns until deferred refill: it is not
immediate revocation. Design permission is not hardware-execution approval.

Deliver the FreeHandler example as actual CLOOMC++ source compiled by the
existing toolchain, not a new software simulator or IDE print/preview feature.

**Why:** The user explicitly corrected the direction: “we dont need a software
simulator for this abstraction we need a working CLOOMC++ example.”

**How to apply:** Keep behavior in CLOOMC++ method bodies and limit host scripts
to compilation/provisioning checks. Do not equate successful compilation with
runtime qualification or use this request as permission for board commands.
For this bounded example, keep typed native method bodies self-contained
rather than expanding compiler grammar to share helpers.

Deliver examples through the existing IDE source-discovery path as well as
the repository file; a filesystem path alone is not a finished handoff.

**Why:** The user asked “Finish the job,, How do I find the cloomc file??”
after receiving only a source path and build command.

**How to apply:** Register the example in the existing Source Library and give
the exact open/load steps plus a verified direct source URL. Preserve editor
replacement consent; discoverability does not authorize overwriting a draft.

The Mint CREATE demonstration must respect a minimum allocation of 64 words.
The earlier eight-word example is not an accepted allocation contract.

**Why:** The user corrected the proposed size: “64 is the minimum.”
Raw data was incorrectly assumed exempt without establishing that exception.

**How to apply:** Use at least 64 words for the demonstration and reconcile
request encoding, Cleaner accounting, descriptor limit, and boundary tests
before execution. Do not confuse a one-word capability view into existing
storage with an independently allocated one-word object.
