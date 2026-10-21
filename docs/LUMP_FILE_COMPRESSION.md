# LUMP file compression

New `.lump` downloads use one standard gzip member over the complete big-endian
binary, including header, instructions, content frame, padding, and C-list.
The filename remains `.lump`; gzip's `1f 8b` signature identifies the packaging.
There is no HTTP `Content-Encoding` header: gzip is the file format, not a
transparent HTTP transfer encoding.

The decoded binary is authoritative. Its hashes, allocation, capability
validation, compiler attestation, and approval requirements are unchanged.
Decompression does not confer trust. Uploaded files still enter quarantine
and require explicit admission.

New frames store source uncompressed; readers retain support for legacy
source-DEFLATE flags `0x05` and `0x07`, as well as plain source and API-only
frames. Raw historical `.lump` files remain accepted. Historical files and
bundles are never rewritten in place.

New exact-revision bundles store all three complete variants as gzip, with
separate decoded byte counts/hash and stored byte counts. Legacy bundles
remain readable. Download links request `?compressed=1`; internal variant
inspection may request decoded bytes without that parameter.

The canonical execution store, quarantine, simulator, hardware wire protocol,
and boot images continue to use decoded binaries. Whole-file compression
reduces storage/transfer size, not runtime allocation. Hardware delivery must
not receive gzip in place of its existing word/CRC protocol.

Decoding is bounded by the maximum header-representable allocation (8 MiB),
checks gzip integrity and exact header allocation, and rejects truncated
streams, concatenated members, and trailing bytes.

Checks:

```
python3 -m pytest tests/server/test_lump_file.py tests/server/test_lump_variants.py -q
node simulator/test_lump_file.js
node simulator/test_raw_lump_export.js
node simulator/test_lump_roundtrip.js
node simulator/test_build_action_state.js
```
