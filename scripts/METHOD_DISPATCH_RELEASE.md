# Method-dispatch release gate

Run the standalone RTL prerequisite:

```sh
python3 scripts/check_method_dispatch_release.py
```

Run it followed by historical release-bundle integrity validation:

```sh
bash scripts/run-all-tests.sh --group release
```

The `wukong-release-bundle` validation workflow uses the same gate. The default
test run excludes the expensive RTL replay and its negative
tests. `--jobs 1` through `--jobs 4` bounds compiler concurrency.

Each run creates a new `/tmp/method-dispatch-release-*` directory, builds an
**unapproved, uninstalled** SelfTest candidate there, and requires all dispatch
cases plus candidate method-1 execution through the release converter. Partial
resume results and reports from previous invocations cannot satisfy this gate.
Source, compiler, harness, and saved-input hashes are compared before and after
execution. Candidate bytes have their own before/after hash check.

Logs and JSON evidence remain in the printed temporary directory on success or
failure. Recorder failures additionally retain RTL and testbench inputs under
`/tmp/church-rtl-failure-*`. Yosys has a 120-second conversion limit, Icarus a
180-second compilation limit, and each simulation a 60-second limit. The full
replay has a one-hour ceiling (including single-worker runs); timeout kills
its process group, including workers and compiler descendants.

This is a prerequisite, not authority to release or install anything. It does
not run Vivado, prove timing closure, test the complete physical board, approve
a candidate, or bind an old bitstream to new source. The low-level
`wukong_build_provenance.py --verify-release` remains a historical bundle
integrity checker; by itself it is **not** the current-source release gate.