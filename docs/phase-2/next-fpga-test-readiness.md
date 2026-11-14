# Next FPGA candidate — initial readiness review

Read-only source/evidence inspection after acceptance-criteria approval.
No new simulation, synthesis, hardware operation or runtime change.

## Retained evidence verified

All 128 files named by the retained Amoeba RTL manifest match their recorded
hashes. Manifest SHA-256:
`d6a098753d28e9756e1f92e389ccbc59ee68c775eba58caee1b1288a2deeb4b0`.
The integrated SYSTEM image matches both its preparation and replay receipts:
`fac85e6429e870cbbea1157a1357798d5e2004140b4c30885e2ca965335f22df`.
The existing replay records four exact/header-last publications and bounded
observation without a runtime fault. This verification did not rerun RTL.

## Reusable starting points and gaps

| Area | Finding | Remaining work |
| --- | --- | --- |
| Native loader | Exact single-USER replay and saved CLOOMC review are retained. | Multiple-waiter scheduler, Namespace-aware request ownership and shared-service bootstrap. |
| Memory | Starter RAM is 16,384 words and several paths slice addresses to `[2:16]`. Lifecycle caps images at 16,384 words. | Full checked address decoding for 144 KiB target, loaders/hash/observers and boundary/alias tests. Increasing depth alone is unsafe. |
| Receiver | CLA1 records require unique slots 3–63; destination/staging validation is bounded by 65,536 bytes. CAR1 identifies slot/epoch/transaction, not a Namespace. | Explicit Namespace-qualified selection and ownership, extended range validation, reset/stale-reply rules and backpressure tests. Do not infer authority from request fields. |
| Fault entry | Current maintained core has optional `fault_boot_binding` and FaultEntry integration absent from the retained replay core. Starter construction does not supply that binding. | Review newer source changes and explicitly provision/wire the required fault entry; preserve source-specific regression evidence. |
| Repeated attacks | Current evidence does not establish 100 fresh attempts with Alice progress after each. | Fresh-Thread template/grant/generation policy, invalidation of old requests, preserved Alice state and bounded count evidence. |
| Physical qualification | Earlier physical demonstrations cover a different frozen candidate. | New exact build reports and separately authorized physical evidence for the composed candidate. |

The current core, CHANGE implementation, memory-access modules and fault-stash
code differ from the retained replay snapshot. These differences are not
automatically defects or regressions. Neither the old replay PASS nor older
physical evidence qualifies the current source wholesale.

## Preliminary size check

The old single-Namespace preparation reserves 22,272 bytes for eleven target
bodies, plus an 8,192-byte Amoeba, 4,096 bytes of Namespace/Thread structures,
256 bytes of private target table and 4,096 bytes staging: 38,912 bytes total.
Its largest selected delivered body is 4,096 bytes; those particular bodies
fit the proposed 16 KiB staging bound.

This is not the new two-Namespace ledger. It includes targets outside the first
inventory and excludes the new service-entry code, scheduler, fresh-Thread
storage and potentially enlarged Namespace tables. No final capacity or resource
fit is claimed.

## Approved source strategy

Use current maintained RTL as the source base, reviewing its differences
from the retained successful replay. Compose the isolated starter explicitly
with the required receiver, memory and trusted Boot bindings. Keep the old
snapshot/image immutable as a regression reference, not as a reason to discard
newer maintained fixes. Freeze a new complete manifest only after reconciliation.

First produce an exact change/provisioning map. Software protocol and test-image
work remain distinct from hardware conformance/build gates; unfinished software
must not be mislabeled as a hardware defect. This review authorizes no code
implementation, vendor build, saved-artifact changes or physical operations.

Detailed change/provisioning map: [candidate change map](next-fpga-test-change-map.md).

The subsequent entry-contract review confirmed preserving Boot's saved
continuation, not introducing a fresh handler root. This resolves the candidate's
documentation choice; exact larger-image bindings and integration remain open.

The first authorized memory/admission stage is now implemented as an isolated
foundation with checked core-facing ports. Its 70 passing local/compatibility
tests do not wire those ports into StarterTop or qualify the two-Namespace
application. The original 64 KiB top, Namespace-aware receiver, trusted Boot
integration and fresh-attempt software gaps above remain integration work.
See [stage results](cooperative-retry/candidate-memory-admission.md).
