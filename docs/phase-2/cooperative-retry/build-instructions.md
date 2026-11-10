# Cooperative retry — two build-only variants

This package is for manual Vivado builds only. It is not a BIT and does not
authorize programming, serial transmission, reset, or persistent-flash changes.
Both variants use a fixed one-second execution watchdog with no software kick,
control capability, or exemption. Hardware: XC7A100T FGG676-2, 50 MHz input,
25 MHz MMCM core clock, 57600 baud. Use reviewed Vivado 2026.1.

- `user-b`: USER A waits; SYSTEM dispatches USER B, which makes progress.
- `all-waiting`: SYSTEM performs self-CHANGE while USER A waits.

Each has its own image, generated RTL, manifest, host responder, and evidence.
Never mix their files. The source constructor retains the parent's flag name
`diagnostic_retry_return_stop`, but this isolated profile uses that event only
as a report trigger: it does **not** halt execution. The exported profile
truthfully records `diagnosticRetryReturnStop: false`.

## Linux builder

After transferring and checking the ZIP checksum, extract once to a fresh path:

```sh
python3 -m zipfile -e cooperative-retry-build-only.zip NEW_DIRECTORY
cd NEW_DIRECTORY/cooperative-retry-build-only/user-b
python3 verify.py
# Source the existing Vivado 2026.1 settings64.sh, then:
setsid nohup bash run.sh > run.out 2>&1 < /dev/null &
```

Wait for `COOPERATIVE_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS`. Then run the same
verification/build commands in the sibling `all-waiting` directory. The shared
build lock intentionally prevents simultaneous runs. Do not delete the lock,
reuse failed output directories, bypass timing/DRC gates, or regenerate RTL
on the builder. Retain both receipts, BITs, checkpoints, logs, and reports.

## Later physical test — separate approval required

Do not run the new responder against the previous installed BIT.
After separately approved programming of the matching variant, the host command
is:

```sh
python3 host/responder.py --port PORT --out NEW_EVIDENCE_DIRECTORY \
  --case user-b --arm-cooperative-profile
```

For the companion image use `--case all-waiting`. The host waits for a request,
continues draining/capturing serial input for three seconds, sends the response
once, verifies the report, and sends one nonce challenge. It verifies renewed
execution and unchanged accepted/installed words afterward. No retry, reconnect,
reset or programming operation is provided. Requires the existing pyserial setup.

CRC and object hashes are transport diagnostics, not authentication. This is a
fixed-fixture test, not general loading or production watchdog recovery.
The inherited fault path holds on fault; no healthy-Thread recovery is claimed.
Local mid-CHANGE tests cover first, middle, and last saved-word deadlines and
100 subsequent cycles of exported write suppression, not every ISA instruction.

Local tests scale UART to 5,000 baud at a 20 kHz clock, retaining a real one-second
timer and three-second response delay. The 2,500-baud case deliberately proves
watchdog expiry under report/trace backpressure. Neither trace stalls nor
observation traffic exempt or pause the timer.
