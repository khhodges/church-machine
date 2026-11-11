FIRST COMPLETE-LUMP LAZY LOAD -- SECOND BOARD, COM4

Keep the current FPGA configuration and All Waiting application running.
Do NOT reprogram, power-cycle, press reset, or rerun the initial image uploader.
Keep all buttons RELEASED, including KEY1 / SW3.
Stop the old bridge and any other programs using COM4.

Extract the ZIP. Open PowerShell in the folder containing lazy_load_old.py:

  py -3.13 .\lazy_load_old.py --check
  py -3.13 .\lazy_load_old.py --port COM4

Type LAZY when asked. No button hold is needed or permitted for this protocol.

The tool first verifies two observer packets: image/input identities, CRC,
epoch 1, phase 0, transaction 0, empty receiver, no publications/results/fault,
and advancing watchdog renewals. A mismatch stops the test before any write.

It sends exactly the approved 64-word old LUMP (256 bytes), selector 0,
transaction 1, using CLP1. It does not send the new revision, an application
image, reset, START, or flash programming commands.

Success requires two observer packets showing phase 1, publication bit 0 set,
transaction 1, receiver CONSUMED, advancing renewals and no fault.
The old method's RETURN deliberately remains pending until the new revision
arrives. Zero completed results are EXPECTED at this step. Results 17,29,17
belong to the later adoption test, not this first publication check.

The all-waiting image has no USER B progress counter activity; progress stays 0.
This test does not claim the concurrent USER B progress demonstration.

Send the generated lazy-capture-*/log.txt back for review. Raw UART bytes are
also saved there. On any error, stop and keep power on; do not rerun. Publication
may have happened even if subsequent observation failed.

Host tests use an offline serial fixture. Physical behavior is not claimed
until the operator returns hardware evidence.

Old LUMP SHA256:
9b12981b124ed17e671bdaf56263b81a5e60eacdc95dd3e58df15589d6fb0d7b
