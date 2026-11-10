# Application-image loading on the existing FPGA

## Scope

The Namespace workflow is Bind → Prepare → Load. Prepare constructs application memory from the latest compilations, without synthesizing FPGA logic. Load reviews an exact prepared image and retains explicit replacement consent, target/session checks, STOP acknowledgement, and latest-input revalidation.

This check authorized no bitstream build, flash operation, board command, or physical image transfer.

## Existing software path

The UART installer targets `amoeba-retry-25mhz-uart-v1`: a 64 KiB native Namespace image, with version-zero Namespace self and entry Thread, and word 255 left zero to avoid enabling the incompatible legacy scheduler.

Its declared BIT SHA-256 is `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`. This is the software target profile, not proof of what is currently installed.

Compatible application changes can use this path without a new bitstream. Load does not silently build an unprepared Namespace. Final revalidation can reject changed inputs before any STOP or upload.

## The two cooperative retry applications

Both saved review designs depend on a protected unavailable-CALL transition back to SYSTEM, a diagnostic receiver, and the fixed execution-watchdog behavior described in their scenario notes.

The retained baseline review, `docs/phase-2/hardware-first-baseline-review.md`, identifies this same BIT and records:

- Absent CALL uses `LAZY_LOAD_ABORT` through the legacy IRQ dispatcher, not the newer protected LLR entry.
- The frozen build lacks the integrated execution watchdog. A UART upload timeout is not that watchdog.

Consequently, the two scenarios **cannot be claimed equivalent to their qualified diagnostic merely by replacing memory on that baseline**. An image upload cannot introduce missing hardware transitions or timer circuitry.

There is also an independent software issue: the SYSTEM sources' fixed five-word payload publication routine describes the historical diagnostic payload, not a general loader for compiler-produced LUMPs with method tables and API metadata. Thread entry/home and transport binding still need reconciliation.

## Physical evidence

Offline preparation succeeded for both saved review Namespaces through the real preparation endpoint. Each produced a 65,536-byte image with no transfer queued:

- USER B: SHA-256 `82ca232588688f8d2efc15f8a8bd263ab17d8365340b363052dd8b4313752aeb`.
- All Waiting: SHA-256 `3026cb12f7d529c592792f52e16afba660394545dafe6fbf406048d0fc856381`.

This establishes image construction and structural acceptance, not successful execution or compatibility with missing hardware features. Browser verification confirmed that Load before Prepare did not prepare or transfer, and switching Namespaces discarded the previous selection's displayed prepared image.

During this check the IDE status reported `physical_target.live = false`, with no active device or session. The currently installed physical bitstream was therefore not established. The retained baseline findings must not be presented as a fresh board readback.

## Conclusion

Use application-image loading for workloads compatible with existing hardware. Keep compatibility information advisory rather than introducing another manual certification gate. Before running these exact cooperative scenarios, either establish that the installed FPGA already supplies their hardware requirements or explicitly agree a different software scenario supported by the baseline. Such a change would not demonstrate the same protected lazy-CALL/watchdog behavior.
