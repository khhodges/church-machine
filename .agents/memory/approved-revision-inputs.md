---
name: Approved revision input isolation
description: Immutable downstream deliverables must retain bytes, not mutable upstream catalog locators.
---
An approved Namespace retains its selected LUMP bytes and generated build inputs;
an approved bitstream retains the exact Namespace revision and source commit.
Compatibility filenames and current catalog rows are not historical authority.

**Why:** LUMP publication can reuse a filename while archiving its previous bytes.
Merely storing that filename in a downstream snapshot would silently change its
input or make an otherwise valid historical approval unusable.

**How to apply:** Preserve independent byte copies and verify their hashes when
consuming an approved revision. Selecting a newer upstream revision is explicit.
Do not silently rebuild from current files or relax existing hardware build gates
when a frozen input is missing or mismatched.

Approval and later activation are separate transitions. Before approval,
require the exact reviewed current inputs; after approval, use the retained
revision independently of mutable drafts, original library files, or server
restart. Simulation approval is not hardware certification.

**Why:** An approved-but-not-yet-activated simulation previously became unusable
when another role advanced the current Namespace, defeating parallel work.

**How to apply:** Retain approved bytes durably, reopen with a fresh one-use
activation ticket, and keep hardware evidence requirements separate. Programmer
publication must preserve old selected filenames and bytes rather than redirect
them to a newer artifact.

Historical builds must stage their retained inputs into a private build tree,
not merely compare those hashes with the build host's current checkout.

**Why:** Hash checks against shared current files reject an older approved
selection after another team updates those files; retaining bytes alone does not
make the historical selection usable.

**How to apply:** Transfer and verify frozen inputs, preserve the exact source
commit gate, run in a unique directory, and collect outputs from that same
directory. Lazy/Dynamic selections remain non-blocking unless the existing
hardware policy makes them build inputs; record unavailable optional bytes
explicitly rather than substituting checkout or latest-catalog copies.

Use verified Git objects for the source archive; do not assume the build host's
package directory is a Git checkout. Preserve Tcl-relative hardware/script paths
when overlaying frozen inputs, and distinguish retained output from uploaded output.

**Why:** The remote package directory may be an extracted ZIP, hardware Tcl
preflight resolves files relative to the Tcl location, and retaining a successful
build must not consume its later explicit upload permission.

**How to apply:** Test the real staged source layout locally, permit safe tracked
symlinks without traversing symlink overlay parents, and test build retention
followed by first upload and replay rejection as a single lifecycle.