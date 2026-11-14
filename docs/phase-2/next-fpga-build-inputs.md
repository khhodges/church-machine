# Next FPGA candidate — build input map

This is preparation, not a frozen or synthesis-approved release package.
Do not use the historical 64 KiB combined-starter exporter for this candidate.

| Input | Selected implementation |
| --- | --- |
| Board | QMTECH Wukong V3, xc7a100tfgg676-2 |
| New top | `cooperative-retry/candidate_board.py`, `CandidateBoard` |
| Maintained core | `hardware/core.py`, explicit 128 KiB profile |
| Allocation/staging | `cooperative-retry/candidate_memory.py`: 128 KiB + separate 16 KiB |
| Installation | CSI3, actual received-RAM SHA, trusted foundational checks, separate START |
| Clock | Maintained `WukongClock25`: M21 50 MHz input to 25 MHz |
| Maintenance | M6 active-low, synchronized, no transport-reset connection |
| Serial | F3 RX, E3 TX, 57,600 baud, maintained UART blocks |
| Existing pin evidence | `cooperative-retry/combined-board.xdc`; not modified |

The new board wrapper connects the physical UART installer, its replies and
the clock to the new core composition. Its local RTLIL circuit check passes
with the real MMCM/BUFGCE primitives present. This is not vendor timing,
utilization, DRC, electrical or board evidence.

The installed-image test sends the complete 128 KiB disposable image through
CSI3, hashes actual RAM, checks cleared staging and separate authorized START,
then runs high-bank write/readback, fault recovery and healthy-worker progress.
It passed in 109.44 seconds. Reset-time assertions prohibit valid fetch,
retirement and granted core writes during installation. This decoded-byte test
does not qualify physical UART timing.

## Inputs not yet ready to freeze

**Blocked on Genesis/SecurityRegulator integration:** the two-root native fixture reached a
PERM_S rejection when Amoeba attempts to arm the M bits needed for SWITCH.
Genesis alone issues M to SecurityRegulator; that authority decision is settled.
The existing Namespace-execution-only hardware gate is not the ownership
contract. Native issuance/mediation and the only-Amoeba residency rule must
both be satisfied before this is build-ready. The direct-Amoeba fixture is
disabled, not a release image. No source/image freeze or vendor-build authorization is
implied by passing loader component tests.

The candidate's staging-only receiver connection now passes seven focused
checks and fourteen legacy receiver checks. The remaining cross-Namespace
request ownership adapter now passes four integrated checks using real staging
RAM; its qualified wire format and remaining native-service integration are recorded in
[delivery ownership review](next-fpga-delivery-ownership-review.md).
The adapter is now optionally composed into the core/board wrapper, with
installer/runtime/probe inspection arbitration and runtime UART routing.
Real-image installation followed by runtime LUMP verification passes locally.
Native MMIO request/consumption and original fault identity are now connected
and exercised with exact newly compiled instructions. The offline host codec
also exists. These are not the final native two-Namespace program/image.

- The final only-Amoeba-resident image and its Namespace-aware delivery/service
  path are not supplied by the diagnostic image used for core qualification.
- The new service decoder rejects unknown accesses. The final program must
  provision its private device grant and use the qualified handoff ABI; the
  old one-USER, slot-addressed Amoeba source is not compatible unchanged.
- The final RTL export, complete constraints and exact image/source hashes
  must be frozen together after that integration, before synthesis approval.

These are candidate implementation requirements, not unrelated legacy-test
cleanup. No build authorization or programming authorization is present.
