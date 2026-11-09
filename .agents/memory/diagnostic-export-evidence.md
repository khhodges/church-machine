---
name: Diagnostic export evidence
description: Keep build-only exports aligned with isolated diagnostic receiver changes.
---

When isolated diagnostic sources change, check for a separately prepared
build-only export before declaring the work complete. Test acceptance of the
candidate does not qualify an earlier exported design.

**Why:** Parallel preparation can publish a manual-build package before a
receiver safety change lands. Its internal hashes may still verify perfectly
while proving only the older design, not the newly tested behavior.

**How to apply:** Rebind updated source and behavioral evidence, regenerate
only the isolated export, verify the extracted package, and identify the
superseded archive explicitly. Keep vendor builds and board operations behind
their separate approval boundaries.

For these isolated FPGA diagnostics, proceed to the next authorized handoff
once actual technical blockers are resolved; optional qualification and
regression work must not become additional release gates.

**Why:** The user explicitly required forward progress rather than repeated
optional checks delaying the manual build.

**How to apply:** Distinguish a bounded diagnostic from general qualification.
Keep essential package-integrity, timing/DRC, and separate board-operation
approval boundaries, but do not expand scope before handing over build commands.

Do not treat a merged Library metadata record as proof a downloadable asset
exists. Confirm local bytes and successful asset publication before handing off.

**Why:** A source-only merge retained an archive's metadata but omitted its
ignored ZIP and test evidence; both the attachment and Library download failed.

**How to apply:** Recover and verify the real file first. If rebuilding is
necessary, retain truthful new evidence and publish the new checksum rather
than repeating the inaccessible archive's old identity.

Use `python3 -m zipfile -e` for manual build-package extraction on the
operator's droplet; do not require `unzip`.

**Why:** The operator confirmed the ZIP utility is not installed and explicitly
required reusing the prior Python extraction approach.

**How to apply:** Give Linux extraction/build commands separately from Windows
PowerShell transfer commands, preserving a fresh extraction directory.
