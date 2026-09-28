# Protected-review validation: resolution report

The protected-change confirmation on `POST /api/lumps/save` remains required:
an unconfirmed save returns HTTP 428 (`change_confirmation_required`).
Approval intent alone does not replace this confirmation. The frozen-approval
identity-downgrade rejection test remains in place.

## Saved artifact and label resolutions

- Restored the exact approved historical bytes as regular immutable files at
  `server/lumps/WukongCallHome.1.ba8b8e76.lump` (SHA-256
  `5ceb0eafe823710de8c682e3399fc5aed3313ad5f00ebc5e2f3b290b1b19ef01`)
  and `server/lumps/CapabilityTest.2.35647a26.lump` (SHA-256
  `bda0d44f551a4b5b55a04e1b630fe2889ed024ab4a7dd42d7381c4334f9c92fc`).
  These hashes match their archived filename approvals. Active binaries,
  Namespace selections, manifest bindings, and approvals were not changed by
  these restorations.
- Local `server/boot-config.json` labels for slots 8 and 9 now read `Tunnel`
  and `Ethernet`, matching the Namespace state; slot 7 already matched
  `WukongCallHome`. Boot configuration is an ignored runtime setting, so these
  local label changes may not travel with a Git checkout.
- The legacy sidecar guard's metadata complaints are no longer errors: its
  test/CI registrations were removed as authorized. The saved manifest's
  extended metadata does not require a rewrite.

## Migration and rebuild resolutions

- `scripts/migrate_bootstrap_residents.py` is intentionally pinned to a
  reviewed historical NS[2] source and NS[10] target. It is not a generic
  migration for the current already-migrated catalog. Its atomic-migration
  tests now construct an explicit private historical fixture rather than
  presuming the current catalog is the old source.
- Removed the obsolete exact 75-instruction assertion in the
  WukongCallHome builder; assembled source and format bounds still determine
  the output. Both rebuilders retain content-ID collision guards and refuse
  to overwrite differing immutable bytes. Identical existing binaries are
  left untouched rather than rewritten.