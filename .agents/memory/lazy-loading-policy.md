---
name: Lazy loading selection and lifecycle
description: Approved-by-default fetching, explicit plus-marked test slots, and lifecycle scope.
---
Ordinary Lazy-load requests fetch the approved LUMP, not merely the latest
compilation. A `+` in the dot-name explicitly selects testing of a later LUMP
version, using a new slot rather than replacing the ordinary approved slot.

**Why:** The user explicitly distinguished approved runtime dependencies from
experimental later versions. Latest-compilation Development Image preparation
must not silently override this Lazy-fetch selection policy.

**How to apply:** Keep ordinary approved selection and plus-marked experimental
selection distinct. The exact plus-name grammar is not established by this rule.
Do not interpret the plus marker as a bypass of integrity or authority checks.

The Lazy-loading scope includes Lazy Resolve and Lazy Retirement, not only
fetching a missing body.

**Why:** The user explicitly included both lifecycle operations in the next design.

**How to apply:** Cover both in the design and acceptance criteria.

Namespace-type LUMPs are excluded from Lazy loading for now.

**Why:** The user explicitly confirmed this scope exclusion.

**How to apply:** Do not implement Namespace-type Lazy loading as part of the
initial lifecycle.

Lazy Retirement keeps the Namespace slot and collects the memory through GC.

**Why:** The user explicitly specified: "Keep the slot and collect the memory
through GC."

**How to apply:** Separate residency and memory reclamation from slot lifetime.
Retirement is not slot deletion or permission to reuse that slot. Define GC
safety and subsequent resolution/loading against the retained slot; do not
infer a modified-state persistence policy from the reclamation rule.

Lazy lifecycle implementation is hardware-first; a separate simulator
implementation or passing simulator suite is not a prerequisite milestone.

**Why:** The user rejected the proposed simulator-first milestone and stated
that testing should be on the hardware.

**How to apply:** Establish acceptance on the physical board with identified
bitstream and LUMP bytes. Keep cheap build/static checks distinct from functional
acceptance. This direction alone does not authorize uploading or flashing.

An unready or unavailable LUMP separates REQUEST from DELIVER and suspends the
USER THREAD for an indefinite period.

**Why:** The user explicitly required this asynchronous split rather than an
immediate fetch response.

**How to apply:** Preserve the pending operation while the SYSTEM THREAD serves
other work. Resume only after matching, validated delivery and installation;
elapsed time alone must not resume or fault the waiting USER. Reset persistence,
cancellation and resource exhaustion are separate contracts, not implied by
indefinite waiting.

Use one lifecycle mechanism across Load, Resolve, unavailable-body waiting and
Retirement. REQUEST goes logically from the SYSTEM THREAD service directly to
the IDE; DELIVER returns directly to that service.

**Why:** The user rejected the redundant FPGA forwarding messages and stated
that the IDE already knows whether the request can be satisfied.

**How to apply:** Treat the FPGA connection as transport, not another service
recipient. Availability changes delivery timing rather than selecting a separate
fetch protocol. Keep local resolution and body installation within the shared
service proposal; do not mistake this design direction for RTL authorization.

Lifecycle diagrams must explicitly distinguish FPGA CALL/RETURN actions from
CHANGE Thread transitions, including the handoff to SYSTEM and resumption of USER.

**Why:** The user identified CALL and CHANGE as the key mechanisms missing from
the unified charts.

**How to apply:** CALL changes abstraction within a Thread; CHANGE saves/restores
Thread context. Mark pending-instruction handoff as an unresolved mechanism rather
than implying ordinary CALL automatically executes CHANGE.

Document event suspension with Dijkstra Wait/Signal and explicit invoking Thread
ownership: USER calls Wait; SYSTEM signals completion after validation; scheduler
code executes CHANGE in the outgoing Thread.

**Why:** The user identified flag semantics and the invoking Thread as critical
development/testing details, and requested their inclusion in the specification.

**How to apply:** Distinguish event readiness from context switching; preserve
early signals and test the registration/CHANGE race. A one-bit flag neither
identifies requests nor counts deliveries. Keep original pending-CALL preservation
separate from Wait's own CALL/RETURN continuation.

For Phase 1, after SYSTEM finishes servicing an UNAVAILABLE event, any other
unblocked resident Thread is an acceptable next execution choice.

**Why:** The user explicitly simplified the scheduling requirement to “any other
unblocked resident thread will do, for Phase 1.”

**How to apply:** Do not require priority or fairness policy for this handoff.
Keep the requesting USER blocked until its completion condition is satisfied.
This selection rule does not authorize CR13 changes or define the event-entry ABI.

Phase 1 SYSTEM event handling is serialized and runs to completion: no
asynchronous interruption or parallel event-handler execution.

**Why:** The user explicitly clarified that a second event cannot execute until
the first finishes; earlier discussion introduced unnecessary concurrent-handler
assumptions.

**How to apply:** Finish registering the pending USER/request before handing off
to any unblocked resident Thread. Handler completion is not completion of the
potentially indefinite LUMP request. A later DELIVER is processed in a later
serialized activation; external data arrival is not nested handler execution.
Treat this as the proposed architecture, not verified installed-RTL behavior.
