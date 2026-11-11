256-WORD REVISION ADOPTION -- SECOND BOARD, COM4

Prerequisite: the old-LUMP test passed at epoch 1, phase 1, transaction 1,
publications 1 and receiver CONSUMED, with no completed results or faults.
Keep that application running. Do not reset, power-cycle, reload the BIT, or
rerun either earlier uploader. Keep ALL buttons RELEASED, including KEY1/SW3.
Stop any other program using COM4.

Extract this ZIP to a new folder. Open PowerShell where adopt_new_revision.py is:

  py -3.13 .\adopt_new_revision.py --check
  py -3.13 .\adopt_new_revision.py --port COM4

Type ADOPT. Do not hold a button.

The script verifies two CRC/identity-checked phase-1 observer packets and
advancing watchdog renewals before transmitting anything. It then sends exactly
the approved 256-word new LUMP using selector 1, epoch 1 and transaction 2.
The existing 64-word old revision is not retransmitted or overwritten by the host.
SYSTEM and the already-approved application own publication and adoption.

Success requires two consecutive reports with:
- Epoch 1, phase 2, transaction 2, receiver CONSUMED.
- Publication mask 3 (both old and new).
- Three ordered results: 17, 29, 17.
- Caller observation PCs: 37136, 38416, 37136.
- No fault; advancing watchdog renewals.

This demonstrates old/new/old results with the approved 64/256-word revision
layouts in the current All Waiting profile. It does not prove concurrent USER B
progress, negative rejection cases, or whole-image replacement.

Send adoption-capture-*/log.txt back for review. Raw uart-rx.bin is also retained.
On failure, stop and keep power on; do not retry. Adoption may have occurred even
if a later observation failed. There are no automatic retries or recovery writes.

No FPGA build, programming, boot-flash write or application-image replacement
is performed by this package. The imported helper scripts are not entry points
for this step: run only adopt_new_revision.py.

New LUMP SHA256:
01820b0618859d7151a56f8f6f4b9a8e0d77ee729b82545ab22806d4b241aca9

Validation scope: offline host tests and comparison with the frozen protocol.
Physical adoption remains unverified until the operator runs the test.
