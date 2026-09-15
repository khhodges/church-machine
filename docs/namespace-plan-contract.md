# Namespace boot-plan API contract

The persisted `server/lumps/ns-state.json` Namespace rows are the only boot
plan. The Lightning Bolt is the one row whose `boot` value is `true`; browser
storage, `boot-config.json`, catalog ordering, loaded images, and manifest
metadata are not selection authority.

## Read

`GET /api/boot-image/ns-state` returns the persisted Namespace document,
including its opaque `revision`, rich rows, and a read-only `plan` projection.
The selected row must include its exact slot, generation, token, and filename.

Missing or duplicate Lightning Bolt markers, duplicate slots, stale identity,
and invalid rows are errors. Clients must not choose a legacy default.

## Update plan

`POST /api/namespace/plan`

```json
{
  "expected_revision": 12,
  "boot": {
    "slot": 6,
    "seq": 0,
    "token": "4a000006",
    "filename": "SelfTest.86.f37bafd6.lump"
  }
}
```

The identity fields must exactly echo the current Namespace row. The server
atomically removes the marker from every other row, marks that exact row,
increments `revision`, and returns the document. Stale revisions and identity
mismatches write nothing.

## Device rows

`GET /api/namespace/device-migration` is a read-only diagnostic. The
Namespace plan must contain `UART_DEV` at `NS[2]` with location `0x40000014`
and inclusive register limit `0x00002`. `CapabilityTest` is an executable
resident at `NS[10]`; it is not a device row and must never be moved to NS[2].
The endpoint cannot create or relocate either row. Hardware projection rejects
missing, duplicate, stale, or unsafe device rows rather than repairing them as
an upload side effect.

`boot-config.json` remains geometry and projection input only. Its legacy
`bootEntrySlot`, resident profile, slot rules, and Step-2 membership fields
cannot alter the Namespace plan.