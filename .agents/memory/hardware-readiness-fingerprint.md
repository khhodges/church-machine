---
name: Hardware readiness fingerprints
description: Generated hardware artifacts must carry a content fingerprint of their active Python inputs.
---
Generated Verilog/RTLIL cannot be trusted based on timestamps alone. The hardware readiness gate must reject an artifact without the current source fingerprint and run the live namespace/thread contract checks before synthesis.

**Why:** The repository can retain generated outputs from an older namespace/thread image while the Python sources and boot tables have moved on; silently synthesizing those outputs risks a stale FPGA image.

**How to apply:** Keep the fingerprint inputs aligned with the active generation path, and regenerate artifacts before running the vendor synthesis flow when the readiness check reports a mismatch.