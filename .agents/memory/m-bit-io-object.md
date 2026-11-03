---
name: M-bit I/O object
description: Canonical representation and custody rule for CR M state.
---

## Current mechanism-versus-policy clarification

The user approved trusted IDE/Builder provisioning of the raw M-control
capability into SecurityRegulator's private C-list during Namespace preparation
on 2026-11-03. Ordinary Mint/FreeHandler allocation must not create or distribute
it, and SR does not acquire it automatically at runtime. Boot and automatic
CR6.M retain their defined exceptions.

**Why:** Explicit preparation establishes intended custody without giving
ordinary allocation services an implicit M-control issuance role.

**How to apply:** Treat this as design approval only, not permission to change
code, saved artifacts or hardware. Verify Mint's Namespace-write reach before
asserting exclusive access.

The user separately approved explicit trusted IDE/Builder provisioning of SR
E invocation grants to Mint and FreeHandler. Their ordinary allocation results
include neither SR access nor raw M-control; additional application grants
require an explicit programmer decision.

**Why:** Trusted consumers need the regulator's general operations without
receiving its raw control capability. Invocation remains substantial authority,
not a purpose-policy filter.

**How to apply:** Keep this at design approval until implementation is requested.
Do not infer that the Passcode/audit contract or concrete binding ABI is settled.

The user approved SAVEM's three operand inputs: CR1 destination GT, CR2 value
GT, and DR1 capability-home index, not a byte address.

**Why:** Freeze the bounded first-use interface for writing the application
E-GT into the allocated Thread's saved CR1 without conflating CR and DR values.

**How to apply:** This is interface design approval only. Method selector,
audit inputs, exact clobbers and return behavior remain separate decisions;
do not infer implementation or hardware approval.

The user approved caller-managed preservation across SAVEM: callers preserve
the working values they need afterward; SR offers no preservation guarantee
for ordinary working registers.

**Why:** Keep the method interface small and FreeHandler's dependencies explicit.

**How to apply:** Preserve protected CALL/RETURN behavior and M-authority rules.
The exact clobber set and supported save/restore sequence still need definition;
this approval neither exports temporary M nor changes saved artifacts.

Retain SAVEM's void return contract: normal return after a successful write,
no result value or success flag; failed SAVE takes the defined machine-fault
path. Audit-delivery failure remains separate.

**Why:** The user confirmed the existing contract and rejected reopening it
as an unnecessary choice.

**How to apply:** Resolve genuinely open contract items rather than presenting
established SAVEM behavior as a new approval decision.

SR must support explicitly setting a GT's B to either 1 or 0, not just
toggling it or bypassing a check.

**Why:** The user explicitly requested both B settings after settling the
CALL/SAVE/RETURN movement rules.

**How to apply:** Keep B-setting separate from automatic movement behavior.
Follow common SR access, consumed-M and audit requirements; do not infer
a concrete method ABI, new opcode, or changes to other copies or GT fields.

**B movement model:** B is a GT setting defining movement, not a property
of source/destination operands and not register-local M.

LOAD ignores B as a condition and preserves the loaded GT's B unchanged;
the user explicitly approved this. M-assisted LOAD does not grant B.

An argument GT with B=0 may cross CALL; an argument with B=1 crosses with
B cleared to 0. Both decisions are explicitly approved. Passed arguments
arrive with B=0. Explicit argument clearing, the invocation E GT, other CALL
checks and M behavior remain separate. RETURN explicitly preserves B on
deliberately returned GTs in kept CRs: 0 stays 0, 1 stays 1. Repeated RETURNs
preserve B while the GT is kept; intervening CALLs apply their own rule.

**Why:** The user emphatically corrected the repeated source/destination
framing and clarified that the discussion concerns B, not M.

**How to apply:** Review GT movement semantics directly. Do not infer a
broader CALL-clears-B rule beyond passed arguments or retain the corrected
multiple-RETURN/private-sharing explanation as an approved oracle.

**Current SAVE rule, superseding earlier B-admission notes below:** Source
GT bits, including B, have no effect on SAVE authorization. Destination
authority governs the write. Source GT stays unchanged; stored GT has B=0,
with other fields preserved. Source B=0 does not require SR.

**Why:** The user explicitly corrected repeated attempts to reintroduce a
source-B requirement: “The source bits including B have zero impace on the SAVE”.

**How to apply:** Do not add source-B checks or describe B as authorizing
SAVE. Treat earlier source-B/SR-override discussions as superseded history,
and reconcile existing implementation checks against this current rule.

The command interpreter is used as a compiler to populate the E C-list of
a newly composed abstraction: it creates GTs and saves them in ESaveLists.
Use the explicit CALL/RETURN decisions above rather than the earlier
corrected multiple-RETURN/private-sharing explanation.
Successful SAVE consumes B in the stored GT only. Source CR
B remains unchanged, allowing further authorized bindings; other stored GT
fields are preserved.

The user clarified that source B may start at 1 or 0: authorized SAVE leaves
that value unchanged and writes stored B=0 in either case.
Destination authority, not source B, decides SAVE admission.

**Why:** The user supplied the compiler composition use case; the later
sharing explanation must not be used to infer unapproved movement rules.

**How to apply:** Preserve B on explicitly returned GT results; do not replace
the post-RETURN SAVE with an assumption that the recipient can invoke SR.
Review any intervening CALL separately from RETURN. A stored copy has B=0;
loading it does not restore B. Failed-SAVE behavior remains
a separate decision, not an inference from M consumption.

B and M do not coincide in every situation; not all callers have SR access.
Ordinary destination-authorized SAVE remains independent of SR invocation rights.

**Why:** The user corrected the inference that SAVE effects alone made SaveB
redundant; ordinary authority and privileged service access are distinct.

**How to apply:** Never infer M or SR rights from B. Preserve ordinary SAVE
checks and access. Resolve any SaveB interface by its actual authority path,
not by equating it with SAVEM.

The user requires SecurityRegulator methods for B and F as well.

**Why:** The user explicitly extended the review beyond the six-method set
when source B/F transfer semantics were raised.

**How to apply:** The earlier B-override proposal is superseded: no source
B check applies to SAVE; stored B is cleared and source B remains unchanged.
For F, explicitly set Near or Far; do not toggle state or substitute a SAVE
check override. The user corrected the wording to “Set not change near or far.”
Do not infer the target, encoding, source-M setup or method signature from
these functional decisions.

SAVEM destination-register M replaces S, retaining identity, generation,
integrity, bounds and protected-home checks; consume it on success or failure.
Its value operand is a GT held in CRn, not a DR integer or register-number
argument. No source B override is needed under the current rule; the F setting
mechanism remains open, not a SAVE-time F bypass.

**Why:** The user agreed to destination elevation and clarified that
`valueGT` is a CRn.

**How to apply:** Store the CR-held GT with stored B cleared, never its M setting; do not infer
source-transfer overrides or permission to read arbitrary isolated registers.

M is an immovable hardware register bit setting, never a transferable GT field.
LOADM returns the exact GT in CR1 with CR1.M clear; CR6.M is independently
established by the normal execution-context mechanism.

**Why:** The user confirmed the result rule and emphasized that M belongs
to hardware registers, not tokens.

**How to apply:** Never describe copying or returning a GT as transporting M.
Distinguish token preservation from hardware M-state transitions.

Review regulator methods from the top, one decision at a time.
LOADM's source-register M may replace source L permission, but does not
bypass identity, generation, integrity, bounds or protected-register checks.
Stored NULL is valid data; NULL source is not authority; result permissions
are unchanged.

CR6.M is automatic execution-context authority, persists across ordinary
C-list LOADs, and does not use SecurityRegulator. Boot is also an exception:
preserve its defined trusted bootstrap authority and lifecycle outside SR,
without extending bootstrap authority to ordinary code.
Outside Boot and CR6.M, M use is limited
to the six agreed SR methods and is consumed on use, success or failure.

**Why:** The user explicitly confirmed the existing CR6 exception and
required single-use authority for other cases, including failures, then
explicitly reminded us not to omit Boot from the exceptions.

**How to apply:** Do not route ordinary CR6 access through SR or consume
CR6.M after LOAD. Do not retain other used M grants after faults or invent
extra M services. Resolve exact clear points and skipped instructions
separately; this decision is not installed-FPGA qualification.

**Why:** The user explicitly approved this limited source-permission rule,
not blanket elevation or the remaining LOADM contract.

**How to apply:** Follow A.2 and the approved lifetime rule above without
inferring destination M behavior or result preservation across CALL/RETURN.

MintM(Ctype, Permissions, Slot) -> GT adds construction to the regulator.
The user requires fixing Phase I M-bit limitations to support it.

MakeOutformM and MakeInformM must take a source GT, unlike MintM.

**Why:** The user explicitly distinguishes conversion of existing authority
from construction from explicit fields.

**How to apply:** Preserve source identity evidence; never replace conversion
with construction from a slot alone. The current proposal has six methods;
appendix A.8 records the source-required contract.

**Why:** Golden Token construction belongs in the trusted mechanism, rather
than being omitted because of current implementation limitations.

**How to apply:** Follow appendix A.7; distinguish construction from allocation
and generation mutation. Resolve type-specific fields and exact M changes
before implementation. Earlier three-method minimal-set statements are
superseded; all actions still require Passcode-associated Home IDE audit.

Every SecurityRegulator action must be logged in detail against the Passcode
and sent to the Home IDE.

Audit attribution includes the originating Passcode identity, immediate caller,
and the transaction ID held in the tuple's CR5 store. The user approved
`TransactionID` as the reserved tuple entry name across transaction types.

**Why:** The user explicitly added the transaction, such as an order or
telephone call, to the proposed originator-and-caller audit attribution.

**How to apply:** Reuse that stored transaction ID; do not invent a second
transaction identity or treat the raw CR5 GT as the ID. Physical tuple layout,
secure propagation and detailed audit-delivery mechanisms remain separate design work.

The user approved trusted IDE/Builder provisioning of SecurityRegulator's
Home IDE destination during Namespace preparation.

**Why:** Audit destination ownership must not pass to individual callers.

**How to apply:** Mint, FreeHandler and applications cannot redirect individual
records. Passcode identity and `TransactionID` identify activity, not its
destination. Changes require explicit configuration; transport and credentials
remain separate, and design approval does not authorize live changes.

The user approved local audit recording with asynchronous Home IDE delivery.
Required local evidence precedes the privileged effect; record the actual
outcome and retain unacknowledged records as pending. If required local
recording cannot be guaranteed, hard-fault instead of executing unaudited.

**Why:** Standalone operation should not depend on a network round trip for
each regulator action, while the required audit must not be silently lost.

**How to apply:** Treat this as design approval only, not evidence of
reset-safe storage. Specify retention, capacity, acknowledgement and
outcome-recording failure boundaries separately; transmission is not receipt
and a logging fault does not imply rollback of a committed effect.

The user approved allowing pending local audit records to be lost on board
power-off in Phase 1.

**Why:** The user chose the bounded retention guarantee rather than requiring
power-loss-safe local storage.

**How to apply:** Do not add nonvolatile audit storage as a Phase 1 requirement
on this account. Preserve pending records during normal powered operation;
Thread-local faults are not power-off. Do not extend this decision to FPGA
reconfiguration or discard acknowledged Home IDE records.

**Why:** The user explicitly requires per-Passcode accountability for all
regulator actions, in addition to the pure digital mechanism.

**How to apply:** Cover LOADM, SAVEM and SWITCHM, including unsuccessful actions
and non-returning transfers. Use the ISA appendix's audit review requirements;
do not invent delivery-failure behavior or expose reusable credentials as an
audit identifier. Do not silently equate Passcode with historical Passkey ABIs.

The user requested LOADM, SAVEM and SWITCHM as a review appendix to the ISA.
These are the minimal proposed software methods, not new opcodes or approved
M-override semantics. The appendix is in the Master ISA under
“Review appendix: SecurityRegulator methods.”

**Why:** The regulator API must be reviewed as one explicit machine contract,
not accumulated from purpose-specific wrappers.

**How to apply:** Use that appendix for the current proposal; preserve its
open LOAD/SAVE M rules, ABI and SWITCHM continuation questions. Watchdog RW
access and ordinary CHANGE do not require additional M methods.

The user clarified that the watchdog is an MMIO capability with RW access to
set the next time interval.

**Why:** Watchdog control is capability-mediated device access, not inherently
an M privilege or a policy service.

**How to apply:** Treat W as authority for the defined interval-setting write
and R as defined register readback. Do not infer active-deadline refresh,
remaining-time readback, new units, or a combined M/watchdog word from this
clarification; reconcile exact timing with the Master ISA.

The first operation review is recorded in
`docs/phase-1/security-regulator-operation-review.md`. It separates proposed
APIs from Master ISA authority: ordinary CHANGE has no added M requirement,
SWITCH has fixed destinations, and watchdog MMIO must not be conflated with
the earlier combined M-control-word proposal.

**Why:** Current Master rules constrain the broader hypothetical API family;
mechanism-only design does not authorize inventing new instruction semantics.

**How to apply:** Resolve SaveM destination elevation separately from source
transfer and CALL/RETURN lifetime before implementing a replacement for the
private ThreadSetup grant.

Historical naming correction: the user distinguishes Babbage's “regulator”
from this project's “SecurityRegulator”; do not attribute the latter term
or the project's M-bit API to Babbage.

**Why:** The user explicitly corrected that attribution.

**How to apply:** Cite Babbage's actual mechanical regulation examples and
label any digital-authority comparison as a modern analogy.

The user states: “SecurityRegulator as a pure digital mechanism with no policy
control, like GTs the M bit says the owner is trusted.”

**Why:** Earlier proposals incorrectly made SecurityRegulator adjudicate
caller purpose and per-target policy rather than implement the machine
mechanism represented by held authority.

**How to apply:** Describe deterministic register/instruction semantics and
their mechanical checks, not an added policy engine or Thread-specific
approval service. Trust assignment belongs to the authority-granting design,
not a new decision by the mechanism on each operation. Earlier Passkey
discussion below is historical context, not permission to invent extra
per-operation policy checks. This clarification does not by itself specify
which checks M bypasses, change the GT format, or authorize code/hardware
changes; derive those details from the approved ISA and explicit decisions.

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

Namespace memory capacity must be a variable parameter of its abstraction.
A captured instance's capacity must not become a fixed abstraction constant.

**Why:** The user explicitly corrected the concrete Namespace definition to
require variable memory size.

**How to apply:** Distinguish requested capacity, authorized allocation and
actual validated extent. This does not itself specify live resizing.

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