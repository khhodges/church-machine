---
name: Bitstream release candidate baseline
description: How the Versions release queue establishes whether hardware source is pending synthesis.
---

Show the next Wukong bitstream release from the local main-workstream history, using the verified bitstream sidecar's source commit as the only release baseline.

**Why:** A bitstream may exist with missing or untrusted metadata. Treating its version, timestamp, or current source tree as proof of provenance would hide pending FPGA fixes or falsely mark them released.

**How to apply:** When the sidecar source commit is absent, invalid, or not an ancestor of local HEAD, mark the release pending and label the baseline unknown. Show recent hardware-affecting commits as candidates, with the Build Approval flow as the only release action. Once a verified upload carries the exact source commit, list only later relevant commits.

When a local bitstream has no trustworthy version sidecar, a received boot sentinel may identify the **running board** version, but must not relabel the local downloadable `.bit`.

**Why:** The physical board can provide useful live evidence even while the stored artifact's provenance is incomplete. Conflating them would falsely certify that the downloadable bytes match the board.

**How to apply:** Label sentinel-derived values as running-board status and retain an unverified-metadata notice for the local `.bit` until a verified upload regenerates its sidecar.

Do not infer the latest completed build from the mutable legacy bundle alone. Check named build/revision history and distinguish approved inputs, completed synthesis, and board validation.

**Why:** The user reports newer builds outside the legacy version sequence; inspecting only the old bundle led to an unsupported “not ready” answer.

**How to apply:** If the requested build cannot be located locally, report that evidence gap and ask where its build record lives rather than claiming it was never built.