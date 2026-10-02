---
name: Boot capacity advisory boundary
description: Capacity reporting is read-only; the proposed boot budget is not installation authority.
---

Treat the proposed 48 KiB boot budget and 16 KiB runtime reserve for the 64 KiB Wukong target as advisory, not an enforced policy or authorization to change residency.

**Why:** The user approved a capacity report after discussing sizing factors, not automatic installation, removal, rebuilding, or a hard budget gate.

**How to apply:** Keep saved-artifact cost, committed-image allocation, and physical-board placement distinct. An invalid layout must not produce a trustworthy free-space total; independently verified saved costs can still be useful. A fixed-size dense image file is not evidence that all its memory is occupied.

Present capacity primarily as whole-LUMP sizes and address-ordered base/end ranges; internal source, padding, heap, and stack breakdowns are secondary.

**Why:** The user explicitly approved the whole-LUMP simplification and requested base/limit addresses in sequence. Internal breakdowns had obscured the known sizes.

**How to apply:** Label inclusive allocation ends and address units clearly; do not confuse them with capability limits. Keep layout validation separate from size accounting and leave uninstalled locations unspecified.

Use full installed allocation intervals for overlap checks, including empty catalog reservations; saved catalog artifact sizes do not describe those unloaded reservations.

**Why:** An overlap investigation initially misidentified unloaded catalog entries as their much larger saved binaries. Geometry and hash agreement also failed to establish that the installed body remained intact after another descriptor occupied its range.

**How to apply:** Distinguish raw installed headers, explicitly reserved empty spans, symbolic entries with no body, and saved library artifacts. Preserve forensic inspection when execution/publication validation rejects an image. Repair from independently verified saved bytes, not from a potentially overwritten image.

Present current Namespace problems separately from expandable stored-image
evidence. Unselected library bodies and device registers are not failed RAM
installations, and repeated reports of the same overlap are not separate faults.

**Why:** The user requested a corrected report after valid devices and dormant
artifacts appeared alongside genuine placement conflicts as execution blockers.

**How to apply:** Keep saved costs visible without promoting them to installation
evidence; stale image observations must not prescribe changes to current artifacts.