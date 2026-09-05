# LUMP Rules Summary

**Status:** Proposed for approval  
**Scope:** Namespace membership, LUMP identity, compilation integrity, lazy loading, and documentation classification

## 1. Authority and source of truth

The authority hierarchy is:

1. The **Namespace Table**.
2. The **assigned slots and LUMPs represented by that Namespace Table**.

The Namespace Table is the only source of LUMPs in a bitstream.

The manifest is not authoritative for any metadata or behavior. It must not
define or override:

- LUMP membership in a bitstream
- abstraction identity
- namespace slot assignment
- version
- size or allocation
- GT or capability metadata
- runtime or resident status
- any other LUMP property

Loose `.lump` files, sidecars, examples, historical versions, and catalog
entries do not become bitstream content merely because they exist. A LUMP is
present only when it is represented by the Namespace Table and its assigned
slot/LUMP data.

Repository tooling follows the same boundary: `update-lump.js` writes only the
binary, and manifest entries do not carry `sidecar_file` pointers. Existing
sidecars are retained solely as legacy audit material until reviewed. They may
be imported only through the one-time audit tool with an explicit filename
acceptance and write flag; they are never accepted automatically. Approved
non-intrinsic user decisions are stored in `server/lumps/approvals.json`, keyed
by the exact binary SHA-256. Legacy files are never runtime, API, source, or
validation fallback.

The complete hierarchy is: `.lump` bytes for intrinsic facts; the Namespace
Table and boot configuration for deployment; exact SHA-256-bound
`approvals.json` records for explicit non-intrinsic decisions; and disposable
manifest/catalogue/UI caches for presentation only.

## 2. Canonical LUMP identity

Every LUMP must have a canonical identity in this form:

```text
dot.name.1.token
```

The `dot.name` is required identity data. It is not optional descriptive
metadata and must not be inferred from a manifest record.

The canonical identity must remain associated with the compiled LUMP through
storage, validation, Namespace Table assignment, and runtime loading.

## 3. Compilation data and integrity

The compiled representation must include the C-list in `dot.name` form.

The LUMP CRC/integrity value must cover:

- the compiled LUMP data;
- the C-list data in `dot.name` form; and
- the read-only `SELF` identity in C-list row 0.

Changing the compilation, the named C-list, or the `SELF` identity must change
the LUMP integrity value and therefore produce a different token.

Numeric GTs, namespace slots, sidecars, manifest entries, and lookup aliases
cannot substitute for the canonical dot-name identity or its integrity check.

## 4. SELF row

C-list row 0 must contain the LUMP's `SELF` name.

The `SELF` row is:

- compiled identity data;
- read-only;
- part of the CRC/integrity input; and
- not a runtime slot for mutable capability replacement.

Runtime processing must preserve the compiled `SELF` row. The lazy-loader must
not rewrite it or use a numeric token as a replacement for the canonical
name.

## 5. Lazy-loader conversion

The lazy-loader converts 32-bit Outform values (tokens) into runtime Inform
GTs.

This conversion occurs during lazy-load/runtime resolution. It does not change
the canonical LUMP identity, the read-only `SELF` row, or the integrity input.

The Outform token is a resolution value; it is not authoritative identity
metadata.

## 6. LUMP documentation cases

Each LUMP must be classified as one of these three documentation cases:

### 6.1 Fully documented

The LUMP includes the complete permitted source and API documentation.

### 6.2 Source

The LUMP includes source representation with comments excluded.

### 6.3 API only

The LUMP includes its API description but no source representation.

The classification must be preserved when compiling, storing, validating, and
displaying the LUMP. Source-only and API-only LUMPs must not be presented as
fully documented.

This documentation classification does not alter Namespace Table authority or
bitstream membership.

## 7. Approval checklist

A LUMP implementation conforms to these rules only when:

- its presence in the bitstream is established by the Namespace Table;
- its assigned slot and LUMP data come from that Namespace Table;
- it has a canonical `dot.name.1.token` identity;
- its compiled C-list is represented in `dot.name` form;
- C-list row 0 contains the read-only `SELF` name;
- the CRC/integrity value covers the compilation and named C-list, including
  `SELF`;
- lazy loading resolves Outform tokens to Inform GTs without rewriting
  canonical identity data; and
- it has exactly one of the three documentation classifications.

**Approval decision:** ____________________________________  
**Approved by:** _________________________________________  
**Date:** ________________________________________________