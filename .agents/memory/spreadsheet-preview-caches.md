---
name: Spreadsheet formula results in previews
description: Keep calculated results alongside formulas when delivering the Phase 1 tracker.
---

Spreadsheet previews need saved formula results; formulas alone are not enough.
Preserve formulas for Excel recalculation, but refresh their cached values after
every programmatic workbook save.

**Why:** The Phase 1 Progress sheet displayed blank counts despite correct
formulas because openpyxl clears their cached results. This also made separate
Complete and Blocked item counts look like contradictory status labels.

**How to apply:** Verify delivered workbooks with both formula and data-only
reads. Use the tracker cache refresh utility after edits; do not rebuild original
threat sheets or change item statuses to fix a presentation defect. Label
aggregate status columns as item counts, not the status of an entire area.

Report achieved engineering milestones separately from full requirement closure.

**Why:** The user challenged an audit that led with an unchanged low completion
percentage despite three new hardware demonstrations. Broad security rows can
remain open while their achieved sub-milestones are substantial.

**How to apply:** Lead the workbook with dated, evidence-classified milestones;
append supporting evidence to existing requirements without manufacturing PASS
verdicts. Preserve historical candidate identities and show remaining boundaries.
