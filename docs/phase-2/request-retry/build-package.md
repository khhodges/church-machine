# Request-and-load build-only package

Prepared 2026-11-10 UTC. Local RTL export only: no vendor build, remote
connection, UART send, board programming, or persistent-flash operation.

## Exact handoff

- Archive: `generated-artifacts/request-retry-build-only.zip`
- Size: 3,645,192 bytes
- Archive SHA-256:
  `052ae91d5963902bc1c9a2815411e3a4241619049082e6d60c2209d947a296aa`
- Manifest SHA-256:
  `8c7c889ce8e3694f488f34729019f5227fa2631d2c292a1cb3a7db60cd75d027`
- Tested source-map SHA-256:
  `54a626a8fa35c73803e1d9b92aaf56940b40030a1b81209886b8a6e5992736ca`
- Image SHA-256 (unchanged SYSTEM fixture):
  `930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7`

The archive contains generated RTLIL/Verilog, exact tested sources, parent
provenance, reconciled 35-case local evidence, request/response frames, the
automatic host tool, and the guarded manual-build runner. It does not contain
a vendor-generated BIT. The parent UART package and installed BIT are unchanged.

## Verification

`python3 scripts/test_request_retry_build_export.py -v`: four offline test
groups passed in 10.801 seconds:

- Fresh extracted archive verifies independently of workspace imports; ZIP CRC
  checks pass. Generator enables request, receive, and terminal-stop profiles.
- Altered request, response, image, RTL, host, receiver source, evidence,
  profile, and route script are rejected.
- Receipt creation uses the exact manifest/frame/output hashes, retains false
  physical/programming flags, and refuses overwrite. Outputs used for this
  check were explicitly synthetic temporary test files, never packaged BITs.
- Negative timing and an unreviewed Vivado version cannot create a receipt.

Board constraints, clock guard, synthesis Tcl, route Tcl, and timing parser
are byte-identical to the verified parent package. The runner changes only its
completion marker, retaining the shared flock, 120/240-minute limits and
fail-closed checks. No timing/DRC check has been weakened.

The local behavioral evidence is reused without rerunning it. Its original
test-expectation failure, exact passing rerun, and monitor deprecation warnings
remain documented in [README.md](README.md); the package verifier checks that
reconciliation explicitly.

## Manual build

After download/hash verification, the operator uses the established SSH key
and host to transfer the archive. On the Linux builder, with Vivado 2026.1
sourced, extract to a new directory with `python3 -m zipfile -e`, verify, then:

```sh
setsid nohup bash run.sh > run.out 2>&1 < /dev/null &
```

Do not reuse prior failed directories, remove the shared lock file, change
board constraints, or regenerate RTL on the builder.

Expected final marker:

```text
REQUEST_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS
```

Retain the receipt, logs, checkpoints, BIT, timing/DRC/route and utilization
reports. Build success is not physical acceptance or programming approval.
The new host tool is for this request-profile BIT only, after a separately
approved JTAG test. Never send its response/challenge to the old UART BIT.
