# Candidate delivery: verified staging and pending ownership decision

## Implemented locally

The explicit candidate receiver profile permits destination allocations inside
128 KiB and requires the separate, exact 16 KiB staging bank at `0x20000`.
The legacy profile still bounds memory at 64 KiB.

`cooperative-retry/candidate_delivery.py` connects the selected-record receiver
to real checked banked memory. Receiver grants follow actual staging-write
acceptance; hashing and word consumption read actual staging RAM. The receiver
never writes the executable destination. This adapter requires exclusive
ownership of the inspection read channel, and is not yet connected alongside
the installation verifier in the board top.

Local results: seven candidate checks passed, including exact boundary
rejection, real hash success/corruption rejection, complete word consumption,
transaction commit, and unchanged high/low executable destinations. Fourteen
existing receiver checks also passed against these modules' legacy defaults.

This is not native publication or a complete only-Amoeba image.

## Consequential interface to settle

The retained CLA1 receiver selects records by slot alone and requires unique
slots across its table. Two resident Namespaces can legitimately use the same
slot. Increasing RAM bounds does not fix that ownership ambiguity.

Proposed bounded service contract, pending review:

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

After this decision, implement the qualified request/record interface, connect
service MMIO and serial routing, and construct the exact only-Amoeba image.
Do not reuse CLA1's slot-only meaning for two Namespaces or preload dependencies
to make the candidate appear ready. No synthesis or physical operations.
