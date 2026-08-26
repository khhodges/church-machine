# Wukong release chain

The checked-out Git commit is the source baseline for a release candidate.
The canonical remotes are `church-machine` and `origin`, both pointing at the
Church Machine repository; unrelated Replit synchronization remotes are not
release authorities. A clean source tree is required for provenance, while
tracked generated outputs may change during regeneration.

## Required evidence

An artifact is current only when all of these match:

1. `hardware/readiness.py`'s source fingerprint is present as the first line of
   the generated RTLIL and Verilog.
2. The provenance record names the exact source commit, a clean source tree,
   the boot input hashes, generated artifact hashes, part, and implementation
   timing result.
3. The `.bit` sidecar verifies the bytes on disk and includes both MD5 (legacy
   upload compatibility) and SHA-256 (release identity).
4. The sidecar commit and SHA-256 agree with the provenance record.

Run the local checks with:

```sh
python3 scripts/check_verilog_rtlil_stale.py
python3 scripts/wukong_build_provenance.py --verify
```

`vivado` is required to create a new release candidate. If it is unavailable,
the existing bitstream remains an unverified historical download; its
timestamp, sentinel, and local presence are not provenance.