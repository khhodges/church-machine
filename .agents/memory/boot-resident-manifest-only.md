---
name: boot_resident is owned by the manifest, not sidecars
description: Which record controls whether a lump body is embedded in the boot image
---

For boot-image residency, `manifest.json` is the single source of truth for
`boot_resident`; per-lump sidecar JSON files do not participate.

**Why:** a lump once carried `boot_resident: true` only in its sidecar. The
generated image had a valid NS descriptor for it but a zero-filled body, which
downstream fallback code then masked with a synthetic header — the failure
surfaced far from the cause.

**How to apply:** when a lump must be embedded at boot, set/verify the flag in
the manifest entry. Treat any sidecar↔manifest divergence on
generator-consumed fields as a latent boot bug.
