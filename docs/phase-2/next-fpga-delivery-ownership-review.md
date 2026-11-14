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
nor a capability is created. Native service/MMIO remains unconnected, so this
is not end-to-end native delivery evidence.

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

This is not native publication or a complete only-Amoeba image.

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

Next connect the qualified interface to native service MMIO and fault
termination identity, prepare matching host delivery inputs, and construct
the exact only-Amoeba image.
Do not reuse CLA1's slot-only meaning for two Namespaces or preload dependencies
to make the candidate appear ready. No synthesis or physical operations.
