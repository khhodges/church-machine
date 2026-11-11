# Combined starter physical evidence review

## Acceptance disposition

The user accepted closure on the supplied demonstration evidence, stating
“I think this is closed completed.” This closes the bounded demonstration
review, not full physical qualification. The evidence gaps listed below remain
unverified, not passed. No additional hardware work is authorized by closure.

Reviewed the operator-supplied `github-milestone-assets-20261111` archive.
This is an offline evidence review, not a new hardware run or authorization.

## Verified locally

- All seven outer archive checksums and all demonstration-bundle checksums match.
- The BIT and every included file named in the vendor receipt match their
  receipt hashes. The DCPs and authorization record are not included; their
  hashes alone cannot verify their contents.
- BIT SHA-256:
  `df3ca62905b65c81890ab9067b933501fbac1c7477a8de60321c4380bb8229ab`.
- Board source:
  `fd2aa07cc4163a3318446c050b19156ad6c5c29b94d68ecb3115e77e1875c17b`.
- Verilog:
  `64d21092a115b428e29b169e73ca613267d490caf0f37830cce3e2ce8ddc9850`.
- Runtime:
  `a6e6223126248bf4ac07edabe891f3cfd123ce0865d5bcc5d06b8fe2c08de8d7`.
- Vivado 2026.1 routed timing reports +5.008 ns setup and +0.090 ns hold
  slack, with zero violations in the checked internal timing categories.
  Clock/pin/timing/DRC gates pass. CFGBVS-1 remains a warning.

## Physical results supplied by the operator

The bundle identifies the second Wukong V3 as the demonstration target,
using COM4 at 57600 baud, 8N1. The selected board's previously recorded UID is
`058ad4112e1085c`; this archive does not provide live DNA confirmation.

The summary reports complete 64-word old-LUMP publication, different-size
64/256-word side-by-side adoption with results 17/29/17, and 64 KiB
All Waiting -> USER B replacement on the same loaded BIT.
The included replacement console log corroborates the prior adoption results,
then LOADING -> VERIFYING -> READY -> RUNNING at epoch 2, cleared observations,
increasing USER B progress/renewals, and no fault. It records holding
KEY1/SW3 through START and releasing afterward. SW1 is configuration reset,
not maintenance.

These are operator-console observations, not independently decoded UART captures.
The bundle explicitly retains the original vendor-only receipt flags
`physicalTest=false` and `programmingAuthorized=false`; these do not negate
later operator trials, but do not supply their authorization record either.

## Remaining acceptance evidence

- Physical early-release rejection is not documented in the supplied evidence.
  Simulated interruption tests cannot stand in for this physical check.
- 50 MHz input / 25 MHz execution is vendor-constrained and communication
  works at the reported baud rate; independent physical clock/UART timing
  measurements are not supplied.
- Raw UART files for initial upload, lazy publication, adoption and replacement
  remain on the operator's computer according to the handoff. Independent
  CRC/identity/epoch decoding has not been performed here.
- Live board identity and the separate physical-operation approval are not
  included in this handoff.

The build log's INIT critical warnings have a bounded included investigation
reporting verification of 24 SHA state words / 768 bits against the exact routed
checkpoint. This review does not reproduce that inspection without the DCP.
Configuration-voltage declarations remain omitted from this experimental build;
do not silently substitute a corrected BIT into the single-hash evidence.

The vendor build and three operator-reported application demonstrations are
established at the evidence levels above. Full physical qualification remains
outside this accepted closure. No board access, programming, reset, transfer, or working-system changes
were performed during this review.
