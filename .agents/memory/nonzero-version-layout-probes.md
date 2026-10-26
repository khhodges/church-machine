---
name: Nonzero-version layout probes
description: Zero-version success can conceal incompatible descriptor field layouts.
---
Use independently resealed nonzero-version fixtures when testing Namespace
descriptor consumers, including both matching and mismatching tokens.

**Why:** A zero version can pass two incompatible authority layouts. Version
bits may also be misread as limit bits, silently enlarging the apparent bounds.
Successful address conversion or seal checking alone does not prove field
interpretation is correct.

**How to apply:** Check slot bounds, version comparisons and cached-authority
representation separately. Keep original-word integrity checks before address
or representation conversion; never rewrite retained bytes to fit a consumer.

Keep the stored-format and private-cache-format boundaries explicit rather than
changing saved artifacts to accommodate older internal consumers.

**Why:** A converted cache is not the original sealed descriptor. Writing that
cache representation back as a Namespace word can move version bits into a
different field, even when reads and immediate execution initially look correct.

**How to apply:** Verify source versions before conversion, retain them in derived
capabilities, and test maintenance writes independently against the stored format.

Check descriptor interpretation again when an instruction independently resolves
an operand GT; a correctly populated operand cache is not proof of that path.

**Why:** LOAD can produce a correct byte-addressed cache while a subsequent
Thread activation re-reads the stored word address and consumes it as bytes.

**How to apply:** Exercise the complete handoff with nonzero locations and
versions. Preserve the saved layout and apply conversion at each actual
stored-descriptor boundary, never by weakening context validation.
