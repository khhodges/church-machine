COM4 INITIAL APPLICATION UPLOAD -- SECOND WUKONG BOARD ONLY

This package loads the approved all-waiting application into RAM, validates it
on the FPGA, and starts it. It does not program the FPGA or write boot flash.
It does not yet perform the Lazy Load, revision-adoption, or replacement demos.

Prerequisites:
- The second board is running the supplied combined_starter.bit.
- Its latest startup packet was 43 53 00 00 00 00 00 00 (HELD, image 0, epoch 0).
- No prior upload attempt has occurred since that BIT load.
- The old bridge and other serial programs are stopped.
- Python 3 with pyserial is installed on the Windows computer.

Extract the whole ZIP. In PowerShell, change to the extracted folder:

  py -3 .\upload_combined_initial.py --check

This verifies the image without opening COM4. If Python's py launcher is not
available but python is, use python instead of py -3.

If pyserial is missing:

  py -3 -m pip install pyserial

Run:

  py -3 .\upload_combined_initial.py --port COM4

Type UPLOAD when prompted. When the COM4 port is open, press and KEEP HOLDING
Key1/M6, then press Enter. Hold until "RUNNING confirmed. RELEASE..." appears.
Transfer requires at least 11.4 seconds; allow 15-20 seconds plus validation.
There are no further interactive pauses during transfer/validation/START.

The uploader checks LOADING -> READY -> RUNNING and accepts an intervening
VERIFYING status. It then receives two UCV4 observer packets and verifies their
CRC, exact image/input identities, epoch, fault flag and increasing sequence.
Successful initial upload does NOT claim that the three demonstrations passed.

Keep the printed capture-* directory. It contains log.txt and raw uart-rx.bin.
Send log.txt back for review, or both files if the script reports a problem.

On failure: release Key1, keep the evidence, and stop. Do not rerun the script,
send old bridge commands, press reset, or power-cycle without reviewing the
result. RAM may be partially loaded; execution may have started before a later
observation failure. The tool never automatically retries, resumes or recovers.

The serial status has no silicon identity or BIT hash. The operator's verified
board selection and exact JTAG loading remain required; COM4 alone proves
neither. The UCV4 identity checks verify the expected runtime data after START.

Image: all-waiting.bin, 65536 bytes
SHA256: bfd60b47f5346768a81a53276876634f8b87b52d05f4ffa9a986a232d6ffc3d7
Required BIT SHA256:
df3ca62905b65c81890ab9067b933501fbac1c7477a8de60321c4380bb8229ab

Verification scope: host tests with a simulated serial transport. The Windows
COM4 upload itself still needs physical execution by the operator.
