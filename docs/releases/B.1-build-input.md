# B.1 — approved FPGA build input

B.1 is the human-readable reference for the immutable approved Namespace
revision below. The IDE selects it by its revision ID, not by this document's
label.

- Approval state: **approved build input**, not a built or hardware-tested bitstream.
- Frozen at: 2026-10-06T14:32:56.136794Z.
- Namespace revision: `3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166`.
- Build intent: `wukong-build-intent:v2:80c713390ccb625594c26f2d92c1b27854c347f85fc006a52595a56b222cbb0a`.
- Approval receipt: `server/build-snapshots/build-approval-20261006T143256136794Z.json`.
- Image SHA-256: `0ff1b24d76b7010c13b8b50737f4513a771b586be73b8d0fa80a748087070a5b`.
- Hardware source commit: `5a6078529288d4d25c8124e01e1c6e4685164d9b`.

The server approval endpoint returned all_checks_pass=true. All retained file
hashes were verified against the immutable revision manifest, and the retained
boot image matches the simulator-tested image byte for byte.

NS slots 8 and 9 are empty in both the saved simulator image and the generated
hardware Namespace projection. The selected SelfTest, CapabilityTest, and
WukongCallHome binaries are retained by the revision. The simulator image's
Thread.2 and Thread.3 enter CapabilityTest.

Generated Wukong RTLIL/Verilog and the core/Core-IoT Verilog passed the hardware
readiness freshness checks. Generated provenance verification and five focused
hardware/provenance tests passed. These checks are not full ISA conformance,
timing closure, or evidence of successful board execution.

No Vivado bitstream synthesis, FPGA programming, or flashing was performed.
Any future build must explicitly select this revision and use its retained
inputs, not whichever catalog or build files happen to be current.
