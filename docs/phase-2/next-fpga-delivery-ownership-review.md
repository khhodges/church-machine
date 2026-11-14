# Candidate delivery: single-transfer decision recorded

The user selected one LUMP transfer at a time. This does not serialize all
Thread execution or require unloading either resident Namespace.

The isolated ownership latch now retains Namespace, requesting Thread and
target identity through completion/cancellation. Four local tests pass:
matching completion, owner fault, disable and image-epoch change. Each also
checks that changing live request inputs cannot redirect the active request,
an unrelated Namespace's fault does not cancel it, and stale completion cannot
release its successor. Transaction numbers are not reused on same-epoch
cancellation.

The latch is now connected to the receiver in `candidate_qualified_delivery.py`.
Trusted inputs select the full Namespace96/target-GT32 pair; changing those
inputs after acceptance cannot redirect the transfer. The owner supplies the
transaction number, including after same-epoch cancellation. Neither a queue
nor a capability is created. Native service MMIO is now connected to the
maintained core, but the final two-Namespace Amoeba program/image is not
implemented, so this is not end-to-end native loading evidence.

Four integrated checks pass using actual banked staging RAM and SHA, covering
completion, owner fault, disable and epoch replacement, duplicate target slots
across Namespaces, unrelated faults, delayed replies and unchanged executable
destinations. RTLIL conversion checks the integration for combinational cycles.
Together with the existing candidate and owner checks, 15 checks pass.
The 14 legacy receiver checks also pass when loaded against the isolated local
modules (their historical imports otherwise refer to removed hardware modules).

### Qualified wire format

The opt-in profile uses `CRQ1` requests and `CLQ1` replies, not the legacy
slot-addressed CAR1/CLA1 meanings. CRQ1 contains big-endian u32 table selector,
epoch and transaction after its four-byte magic. CLQ1 retains the 20-byte
command layout: magic, operation u8, table selector u8, zero u16, epoch u32,
transaction u32, payload length u32. Payload words remain little-endian.
Selectors 3 onward identify records in the immutable provisioned table, not
Namespace slots. The same table must be frozen with the host delivery inputs.
Each table row binds Namespace96, exact target GT32, destination, length and
SHA. Changing the table requires a new non-reused installation epoch; epochs
and transactions must not be reused while old replies may exist.

Stale/malformed responses fail closed and end that transfer; they do not
authorize copying. Native retry policy is not implemented here. Legacy profiles
retain their original framing and transaction behavior.

## Implemented locally

The explicit candidate receiver profile permits destination allocations inside
128 KiB and requires the separate, exact 16 KiB staging bank at `0x20000`.
The legacy profile still bounds memory at 64 KiB.

`cooperative-retry/candidate_delivery.py` connects the selected-record receiver
to real checked banked memory. Receiver grants follow actual staging-write
acceptance; hashing and word consumption read actual staging RAM. The receiver
never writes the executable destination. The admission wrapper now arbitrates
the inspection channel: installer verification first, active runtime delivery
second, diagnostic probe otherwise. Read responses retain their sampled owner.
Runtime writes are separately gated out during installation and maintenance.

The core/board wrappers optionally accept the provisioned delivery table and
connect the qualified adapter through this interface. Entering maintenance
cancels a transfer even before a new BEGIN packet. Leaving maintenance without
reinstalling preserves the transaction counter. A real complete CSI3 install,
runtime LUMP hash under competing probe reads, and cancellation/re-entry check
passed alongside core and qualified-delivery regressions (13 checks).

`candidate_serial.py` routes decoded input exclusively to CSI3 in maintenance,
or to the enabled runtime receiver otherwise. Packet arbitration retains
ownership until completion, except when a cancelled producer withdraws its
request; then it releases arbitration without resetting the UART transmitter.
Byte-level cancellation/routing and both board configurations passed three
checks, including physical-top RTLIL elaboration with clock primitives. This
is not a pin-timing test. Host tooling must recognize a truncated request at a
maintenance/cancellation boundary and resynchronize on the protocol framing.

Local results: seven candidate checks passed, including exact boundary
rejection, real hash success/corruption rejection, complete word consumption,
transaction commit, and unchanged high/low executable destinations. Fourteen
existing receiver checks also passed against these modules' legacy defaults.

These staging checks alone are not native publication or a complete candidate image.

## Service interface to connect

The legacy CLA1 receiver selects records by slot alone and requires unique
slots across its table. Two resident Namespaces can legitimately use the same
slot. Increasing RAM bounds does not fix that ownership ambiguity.

Bounded service contract guiding integration:

1. One active serial transfer at a time. Other Lazy requests remain pending in
   the native scheduler; no concurrent reuse of the staging bank.
2. Native Amoeba retains the original Namespace identity, versioned requesting
   Thread GT and versioned target GT from the authorized local SYSTEM handoff.
   Switching to Boot must not substitute Boot's current Namespace for origin.
3. The request selects an exact pre-provisioned record and destination grant
   for that Namespace/target pair. A bare slot or sender-supplied digest never
   selects authority.
4. Delivery is bound to the installed-image epoch and transaction. Duplicate,
   stale or mismatched responses cannot publish into another request.
5. A fault that terminates the requesting Thread invalidates its pending
   request; an unrelated Thread fault must not silently retarget or replace it.
   Partial bytes remain unpublished. This is not image reinstallation.
6. The receiver remains staging-only. Native Amoeba copies under its private
   destination grants and publishes header last; normal CALL admission remains
   authoritative afterward.

### Native MMIO connection

`candidate_service.py` exposes a 12-word device window at `0x40000100`.
Offsets are words: 0 stream/pop, 1 receiver state, 2 full target GT,
3 transaction/commit, 4 size, 5 request (write 1), 6 expected header,
7–9 origin Namespace96 (least-significant word first), 10 origin Thread GT,
11 target GT. All five handoff fields must be written by the same executing
Namespace/Thread before request acceptance; disable and acceptance clear the
assembly mask. No write is accepted while another transfer owns the staging
bank. The core's existing device capabilities remain the access authority.
Origin fields do not grant authority; the provisioned table selects bytes.

Reads before verified availability, excess pops, premature/wrong-transaction
commit, incomplete/unknown/busy requests, unknown offsets, and wrong-direction
access fail explicitly. This is not a software request queue. The native
scheduler must retain pending work before issuing a request.

The bridge separates original DWRITE payload from the recovery bus: otherwise
payload-dependent MMIO rejection feeds fault selection back into the stash
payload and creates a combinational loop. Fault Namespace/Thread are captured
on the original fault edge, not read from the later Boot context. Service
effects are disabled throughout fault entry.

Exact newly compiled instructions now exercise real device writes/status reads
and rejected writes through the maintained core, then reach healthy progress
through Boot's retained recovery continuation. These diagnostic fixtures still
contain resident test code and are NOT the final two-LUMP resident candidate image.

`candidate_host_delivery.py` provides an offline matching CRQ1/CLQ1 codec.
It validates provisioned records, rejects stale epochs/transactions and emits
exact little-endian payload bytes. It opens no serial devices. Host state must
retain its transaction counter across pauses. No live delivery was attempted.

The focused run passed 73 checks covering native bus access, component delivery,
serial routing, board elaboration, memory, ownership and maintained fault-entry
regressions. Longer received-image regressions are tracked separately.

### Remaining build qualification

**Authority settled; native integration remains unfinished.**
Genesis alone issues M authority, exclusively to SecurityRegulator. Neither
Namespace ownership nor direct Amoeba M-control is an approved alternative.
Here Genesis is the human configurator acting through the IDE, not another
abstraction or a runtime issuer to implement. The IDE must carry out the
configurator's authority decisions. The next implementation must preserve
the configured SecurityRegulator grants and provide
native mediation, with the now-approved Amoeba-plus-SecurityRegulator initial
executable residency. All other executable dependencies remain initially absent.

The new disposable two-Namespace source reaches Amoeba's M-control write and
faults with PERM_S at NIA `0x8024`. The maintained core deliberately accepts
M-bit writes only under Namespace execution identity (Inform RX at slot 5).
A normal Amoeba E execution identity is not that authority, even when supplied
an exact device capability. The hardware gate has NOT been relaxed.

The direct-Amoeba diagnostic fixture is not approved provisioning; its generator
is now disabled before compilation or image construction. Completing the first
SWITCH requires the Genesis/SecurityRegulator path, not a new ownership choice.
The existing Namespace-only execution check must be reconciled with that
authoritative contract, not presented as a policy decision still open. Do not erase
this failure with host-set M bits, a new implicit privilege, instruction-word
translation, or secretly preloaded executable dependencies.

Before that stop, the real native qualified loader passed both valid and
corrupt-delivery tests. The valid test observes native body writes, header-last
publication, a normal CALL into the newly resident target and its result.
The corrupt test observes native failure with no executable publication.
Receiver failure status is now retained after releasing staging ownership so
native polling cannot mistake a failed transfer for an idle receiver forever.

The longer installation/capacity run passed 26 checks in 368.31 seconds.
Two further candidate-specific gaps were found during cross-root integration:
SWITCH's private resolver and Boot's saved-capability activation needed the
explicit 128 KiB/word-addressed profile. SWITCH capacity, existing handoff and
board elaboration checks passed (39 checks). These fixes preserve 64 KiB defaults.

The offline compiler now has a private opt-in
`_candidate_namespace_handoff: true`. Only that mode accepts `SWITCH CRsource,
#row` with required-zero destination bits. Four checks verify exact generated
words, rejected legacy syntax in candidate mode, range checks and unchanged
legacy output in default mode. It is not an ISA-wide IDE migration; normal
compilation remains unchanged. Candidate words are emitted directly, never
rewritten after compilation.

The existing `simulator/examples/amoeba_loader.cloomc` is explicitly a one-USER,
slot-addressed legacy program. It cannot be silently reused with the new
full-GT service status or treated as the two-Namespace round-robin service.
The next implementation must supply the explicit application Slot-2 → SWITCH
to Boot/Amoeba → SWITCH to application Slot-2 → CHANGE to USER route, private
qualified destination/handoff data, Amoeba-plus-SecurityRegulator executable residency, and fresh
Mallory initialization while retaining Alice across 100 rejected attempts.

Compile new disposable candidates without rewriting saved LUMPs; bind the
exact provisioned records and native grants into one 128 KiB image. Exercise
native copy/header-last publication and normal CALL admission in RTL, not a
host publication callback. Only then freeze the final binding, table, source
hashes, RTL export and constraints together.
Do not reuse CLA1's slot-only meaning for two Namespaces or preload dependencies
to make the candidate appear ready. No synthesis or physical operations.
