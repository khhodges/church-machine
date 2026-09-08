# WukongCallHome source recovery

Recovered directly from the embedded `0xAB` content frames in the archived
big-endian LUMP binaries.

## Full source

- `WukongCallHome_v1_this_screenshot.cloomc` — matches the screenshot's
  CW 74, CC 4, 4096-word current row.
- `WukongCallHome_v2.cloomc` — archived v2 source.
- `WukongCallHome_v3.cloomc` — archived v3 source; byte-identical to v2.
- `WukongCallHome_v6.cloomc` — archived v6 source.

## Partial recovery

- `WukongCallHome_v4.api.json` — v4 contains an API-only frame, with no
  embedded source text.

## Unavailable

- v5 has no artifact in the current tree or Git filename history.
- v7 and v8 have telemetry/version records, but no local or historical binary
  from which source can be decoded.

`RECOVERY_REPORT.json` records the source binary, geometry, character count,
and SHA-256 digest for each recovered file.