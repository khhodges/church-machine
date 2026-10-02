---
name: Hardware readiness fingerprints
description: Generated hardware artifacts must carry a content fingerprint of their active Python inputs.
---
Generated Verilog/RTLIL cannot be trusted based on timestamps alone. The hardware readiness gate must reject an artifact without the current source fingerprint and run the live namespace/thread contract checks before synthesis.

**Why:** The repository can retain generated outputs from an older namespace/thread image while the Python sources and boot tables have moved on; silently synthesizing those outputs risks a stale FPGA image.

**How to apply:** Keep the fingerprint inputs aligned with the active generation path, and regenerate artifacts before running the vendor synthesis flow when the readiness check reports a mismatch.

A passing pre-synthesis check for one output directory is not proof that every
committed RTL copy is current; also run the committed-artifact freshness tests.

**Why:** The build-directory gate passed after regeneration while a separate
checked-in core copy still carried old RTL. Both checks are needed before
describing the source snapshot as ready for synthesis.

Source freshness does not establish ISA parity. Before a hardware release,
separately check instruction acceptance, execution profiles, and semantics
against the approved ISA changes.

**Why:** Regenerated RTL passed its freshness gate while the decoder still
accepted retired instructions and lacked a software-supported indexed profile.
Passing tests for older semantics can coexist with missing ISA changes.

Hardware instruction tests must wait for boot completion with a bounded,
fault-aware handshake, not a fixed clock count.

**Why:** Namespace initialization can add internal wait states without changing
instruction semantics. Injecting a test instruction too early produces misleading
ISA failures. Fixing that prerequisite does not justify relaxing later result
or permission assertions.