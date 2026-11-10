# Offline reproduction of the historical physical result

The tooling and evaluator guide are in [offline/README.md](offline/README.md).
They package the exact retained raw capture and result, a port-label-sanitized
event log, and the retained parser without its serial driver. The original
[physical result](physical-result.md) and all historical evidence remain unchanged.

Build from the repository root:

```sh
python3 docs/phase-2/request-retry/offline/build_bundle.py
```

Distribute the generated ZIP together with its SHA256SUMS, subject to the
rights/redistribution limitation in the guide. Generated captures and archives
stay outside Git and deployment snapshots. No upload, public publication or
hardware operation is performed by this command.

This is a Stage A evidence-replay deliverable under the
[publication audit](../cooperative-retry/release-publication-audit.md), not
Stage C/D starter qualification or Stage E independent physical reproduction.
