---
name: M-bit I/O object
description: Canonical representation and custody rule for CR M state.
---

**Current review authority:** M belongs only to SecurityRegulator, trusted as
part of the TSB. See [hardwired recovery and security](hardwired-recovery-security-authority.md).
The historical interface and watchdog discussion below does not authorize
reintroducing an IRQ/WatchdogFault role in the current review.

M is represented by one 32-bit Namespace-table I/O object at fixed NS slot 13. Bits 0–15 map
directly to CR0.M–CR15.M; a full-word write sets and clears all sixteen states,
and bits 16–31 were reserved in the earlier definition.

**New review direction:** The user assigns bits 0–15 to CR M controls and
bits 16–31 to other hardware settings, including a protected watchdog-refresh
operation in this same word. Exact upper-bit allocation and command semantics
remain to be specified; this does not claim implementation or master-ISA change.

**Why:** Reuse the existing capability-protected hardware-control object rather
than add an unrelated watchdog control path.

**How to apply:** Distinguish refresh from configuring the fixed duration.
Do not give ordinary workers whole-word write authority merely to refresh
the watchdog, since that also grants M-control authority. Reconcile refresh
writes with the existing full-word replacement semantics for the low bits.

The user requires an M-bit abstraction with functional methods such as
watchdog refresh and "set CR12.M + operation."
The user names this abstraction **SecurityRegulator**, "in Babbage's tradition."
Use that name in future interface discussion; naming does not allocate a GT
or change device custody.

SecurityRegulator's proposed functional method contract must include a Passkey
to regulate users, as explicitly requested by the user. Apply the existing
GT-plus-independent-proof model from `top-security-passkeys.md`.

**Why:** Encapsulating M operations alone does not authorize their callers.

**How to apply:** Include caller, method and target authorization in the proposed
contract; this request is for interface design, not operational provisioning.

The user's current design direction is to limit SecurityRegulator to machine
register functionality, leaving abstraction architecture to programmers.

**Why:** The user questioned whether purpose-specific methods such as dependency
installation improperly assign programmer choices to the Regulator.

**How to apply:** Propose instruction/register-level operations, not constructors,
schedulers or dependency policies. Separate Passkey validation from issuance
policy. Exact method signatures remain proposals, not approved implementation.

The C-list used to specify or construct a Namespace is not necessarily the
constructing abstraction's E-list. They may coincide but are distinct roles.

**Why:** The user explicitly corrected the assumption that Namespace membership
must come from the abstraction's own execution list.

**How to apply:** Model the construction C-list as an independently supplied,
authorized input. Do not implicitly select CR6 or copy the constructor's E-list
as the Namespace definition. This distinction does not approve a binary format
or grant new construction authority.

The user endorses the three-layer Namespace design: the programmer supplies
the definition C-list; a Namespace abstraction constructs the machine table;
SecurityRegulator validates the Passkey and performs the privileged activation.

**Why:** This keeps programmer-defined organization separate from table
construction and machine-register authority. The user explicitly approved
this separation as the “3 layer cake.”

**How to apply:** Preserve these boundaries when working through Namespace
SWITCH and subsequent Regulator methods. This is design-direction approval,
not approval of an ABI, binary format, implementation or hardware change.

The user's subsequent interface proposal passes a Namespace abstraction and
Passkey to SecurityRegulator, which confirms the table before transition,
rather than requiring the programmer to pass a raw completed table.

**Why:** This keeps Namespace construction encapsulated while making the
Regulator responsible for validating the actual transition target.

**How to apply:** Distinguish preparing the abstraction's table from making it
the active Namespace. Define how the confirmed table remains the exact table
consumed by SWITCH; do not claim an existing validation-to-use interlock.
Preparation must not receive raw M authority. This remains an interface
proposal, not an approved method ABI or implementation.

**Why:** Encapsulate privileged control as operations instead of exposing raw
whole-word writes or leaving M authority with the caller.

**How to apply:** Design the M setting and its intended operation together.
Do not assume a setter followed by a caller operation works across CALL/RETURN
M-state changes. Keep method authorization distinct from raw device custody;
this interface direction does not itself transfer Namespace-only custody.

The user identifies the presently known privileged M methods as LOAD into
CR12, CR13, CR14 or CR15, and SAVE a GT from CRn without requiring its B bit.

**Why:** The earlier CR12-only SAVE example understated the intended interface.

**How to apply:** The earlier proposal used destination M for privileged LOAD
and source M for B-free SAVE. Do not limit SAVE to isolated registers or waive
unrelated checks. The later construction proposal below reopens the M source
and saved-B semantics; do not treat B preservation as user-approved.
Method ABI and continuation semantics
must account for CALL/RETURN and replacement of active privileged registers;
functional method naming does not silently change LOAD/SWITCH opcodes.

The user identifies a principal use case: dynamic abstractions/objects created
by a service object but structured by a calling constructor, such as a compiler.

**Why:** Allocation and selection/installation of an object's dependencies
can belong to different participants.

**How to apply:** Evaluate B and privileged SAVE against this construction
flow, not just isolated-register examples. Distinguish direct constructor
SAVE from service-mediated installation; no decision to remove B follows
merely from the existence of SecurityRegulator.

The user's concrete construction example is `objectMaker.Creat(RW, size)`
returning `GT.new.M=true`, giving the owner an in-scope opportunity to build a
C-list for a dynamic class instance. The user explicitly confirmed that
**each dependency GT inserted into the new object's C-list is stored with B=0**,
not merely the new object's own GT when published elsewhere.

**Why:** The intended construction authority is associated with the newly
returned reference, rather than privileged service mediation of every insertion.

**How to apply:** Replace the previous blanket B-preserving SAVE model for
construction: an authorized insertion stores B=0 even when source B=1.
Do not infer source-register mutation or universal admission of dependencies.
Reconcile scoped M
with register-held M and CALL/RETURN semantics without silently changing
the GT format. No implementation change is authorized.

M authority applies to one CR at a time, only when that CR's M bit is set.
Boot phase or instruction class is not a substitute for that register's bit.

**Why:** The user explicitly rejected blanket boot/CALL mLoad elevation as an
mLoad error, not an architectural exemption.

**How to apply:** Audit mLoad privilege inputs against the specific CR's M
state; do not justify global bounds, permission, or seal bypasses merely
because execution is booting or performing CALL.

For isolated Mint Thread usability, the user directs the activation
investigation through CR12 and CR6, SWITCH and CHANGE, with M authorizing L
and S. Do not treat LS token bits alone as the complete authority model or
assume a new preparation API is needed before tracing that path.

**Why:** The user explicitly corrected the proposed preparation-API approach
with “CR12, and CR6, use Switch, Change” and “Mbit to authorize Land S.”

**How to apply:** Check the register-scoped M gates as well as token rights,
while retaining protected homes/frames, SecurityRegulator custody, and normal
continuation validation. This direction does not specify an implicit CALL or
authorize interpreting a poison root as a suspended continuation.

**Why:** Separate target-bound ports incorrectly modeled per-register M state
as four hidden capabilities and omitted the required hardware object from the
Namespace table.

**How to apply:** Keep one Inform RW descriptor in the boot Namespace catalog,
issue it only to Namespace, and require Namespace execution identity for both
DREAD and DWRITE. Reads return bits 0–15 zero-extended; writes replace all 16 M
states. In the Namespace UI, classify its Source as “Resident I/O register” and
never offer LUMP Source/Identity controls. SWITCH tests and consumes its
destination bit. Preserve generated
Thread#2 and Thread#3 at slots 11 and 12; later generated Threads skip slot 13.
For SAVE, an isolated source CR12–CR15 is readable only when its own M bit is
set at instruction acceptance. That M authority bypasses the source GT's normal
B/F export gates, while the destination C-list must still independently grant S.
Consume the source M bit only after a successful, atomic C-list write.
The M_BIT_DEV Inform GT must always have B=0 so it cannot be saved into a C-List.

The Add Capability picker exposes M_BIT_DEV only after an exact, case-sensitive
IDE-secret unlock. The server verifies the secret without persisting access;
the secret must never be embedded in browser code.

**Why:** The owner requires this privileged entry to be single-use. Any click
inside the picker after unlock consumes access immediately, regardless of the
clicked item or whether its action succeeds.

**How to apply:** Keep the locked picker form and server verification boundary.
Never issue an unlock cookie. Reveal one Inform RW row named M_BIT_DEV at NS slot
13 only until the next picker click, then remove it synchronously and require the
secret again.