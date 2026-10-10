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

**How to apply:** Search uploaded terminal transcripts in `attached_assets` as well as local artifacts and build history before asking the user. Manual remote builds can be evidenced only by those transcripts, without updating the IDE's legacy bundle or revision database. If the requested build still cannot be located, report the evidence gap rather than claiming it was never built.

Uploaded completion logs establish historical build results, not current possession of the files or a successful physical-board run.

**Why:** Remote build outputs and corrected packages have appeared in user-supplied terminal logs while the workspace retained an older downloadable bitstream.

**How to apply:** Distinguish recorded completion/timing/hash evidence from fresh remote-file verification and board acceptance. Do not equate simulation replay or successful file generation with board validation.