---
name: Boot image preparation and evidence
description: Image identity, prepared boot authority, layout and freshness rules.
---

- [Namespace upload integrity](namespace-upload-composite-integrity.md) — exact upload image binds validated LUMPs, slots, layout and boot entry.
- [Namespace header fallback](namespace-header-boot-fallback.md) — missing selected dynamic boot slot must not crash reset.
- [Resident binding validation](resident-image-binding-validation.md) — compare payload and allocation; C-list rows are destination-localized.
- [Localized C-list provenance](localized-clist-provenance.md) — bind image evidence to selected hashes and resulting capability rows.
- [Boot byte-stream tests](boot-image-byte-stream-tests.md) — redirect diagnostics before treating generator stdout as raw image bytes.
- [Prepared boot authority](prepared-boot-authority.md) — explicit preparation owns CR0; boot/import/Run never repair it.
- [Boot-entry UI authority](boot-entry-ui-authority.md) — default Code View follows the loaded image's boot slot.
- [Executed-artifact freshness](executed-artifact-freshness-warning.md) — expose committed-versus-latest mismatches before simulation.
