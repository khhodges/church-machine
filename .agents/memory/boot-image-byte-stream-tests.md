---
name: Boot-image byte-stream tests
description: Constraint for tests that capture generated boot-image bytes from Python
---

Raw boot-image consumers must isolate the binary stream from generator diagnostics by redirecting or separately capturing text output.

**Why:** The boot-image generator reports approval and portable-binding diagnostics with ordinary stdout prints. Capturing stdout directly can prepend text to an otherwise valid image and make byte-length or image-format checks fail.

**How to apply:** When a test invokes `generate_boot_image` in a subprocess, send diagnostics to stderr or capture them separately, and reserve stdout for the returned bytes.