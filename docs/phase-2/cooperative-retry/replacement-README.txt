WHOLE-IMAGE RAM REPLACEMENT -- SECOND BOARD, COM4

This intentionally STOPS the current All Waiting application and replaces its
RAM image with the already-approved USER B image. The FPGA BIT and boot flash
remain unchanged. Keep the prior successful captures as evidence.

Prerequisite: successful adoption at epoch 1, phase 2, transaction 2,
publications 3 and results 17,29,17. Do not reset, power-cycle, reload the BIT,
or rerun any previous uploader. Stop the old bridge/other serial programs.

Extract this ZIP to a new folder. Open PowerShell where replace_with_user_b.py is:

  py -3.13 .\replace_with_user_b.py --check
  py -3.13 .\replace_with_user_b.py --port COM4

Type REPLACE. At the next prompt, PRESS AND HOLD KEY1 / SW3, then press Enter
while holding it. DO NOT press the PROG_B / SW1 configuration-reset button.
Keep holding until "RUNNING confirmed at epoch 2. RELEASE KEY1 / SW3 now."
Allow approximately 15-20 seconds for transfer and validation.

The tool discards only pre-test PC-side queued telemetry, then captures two
fresh CRC/identity-checked adoption snapshots before sending anything. It
checks the exact USER B file hash, requests BEGIN at epoch 1, checks LOADING
at epoch 2/image 1, transfers 65536 bytes, checks READY and sends START.
Any unexpected status framing stops the test rather than retrying.

After START, it checks three new observer packets for the USER B image hash,
epoch 2, correct input identity/CRC, no fault, cleared LUMP admission/results,
advancing USER B progress and watchdog renewals.

Success:
WHOLE-IMAGE REPLACEMENT VERIFIED: USER B, epoch 2, fresh admission state.

Send replacement-capture-*/log.txt back. Raw uart-rx.bin is also saved.
On failure release KEY1 and stop; keep power on and do NOT retry. RAM may be
partially replaced or the new application may already be running.

This proves only what the returned physical evidence shows. It does not test
stale-epoch rejection, concurrent LUMP loading under USER B, or boot-flash
updates. Host tests are offline fixtures, not physical acceptance.

Run ONLY replace_with_user_b.py; other Python files are imported helpers.

USER B image SHA256:
1d2417387397d64640ab976322232158db60de8b61483fd52a27b010eac302eb
