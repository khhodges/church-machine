# New Layout — corrected AmoebaStartup trial

Prepared with user approval on 2026-10-24. This is an isolated compiler output,
not a published LUMP, linked runtime image, installed program or hardware pass.

The repository startup prototype was compiled with its import pinned to the exact
retained API name `ide.BootThread`. This is not recovered original editing text.
Source, three compiler output profiles, hashes and compiler records are retained.

The API-only hardware-build profile remains 512 bytes / 128 words. Compared with
the retained original, its **only changed word** is word 5:
`0x27110000` → `0x27010000`. This removes the forbidden duplicated destination
field from CHANGE CR2. Allocation, public API, symbolic dependencies and all other
words remain identical. No manual instruction patch was used to create the LUMP.

Reproduction (choose a new output directory; existing evidence is not overwritten):

```
python3 scripts/prepare_amoeba_startup_change_trial.py /tmp/amoeba-trial-new
python3 -m pytest tests/hardware/test_amoeba_startup_change_trial.py -q
```

Next: bind the API-only revision into a separate frozen runtime trial, preserving
the guarded image's exact destination authority, then replay the complete program.
The earlier runtime image has not been overwritten and still contains the old
AmoebaStartup instruction. Physical reload, installed-byte verification and
observed board execution remain pending. No commands were queued, no FPGA was
flashed, and no saved Namespace or original LUMP was changed.
