# Guarded New Layout reload support

This is a narrow loader for the retained 64 KiB trial, not a general ascending
image publisher. It never changes saved Namespace state, LUMPs or boot-image.bin.
It does not synthesize, flash, discover a board, or queue work on reconnect.
The legacy Header V2 path remains unchanged; the low-level command endpoint
now rejects ascending images rather than bypassing guarded admission.

## Explicit control endpoint

Authenticated `POST /hardware/wukong/guarded-reload` uses the existing hardware
bearer authorization and selected-target/session checks. Required fields:

- `profile`: `new-layout-guarded-relative-nia-v1`
- `target_device_uid`, `target_session_id`: the explicitly selected live target
- `action`: `inspect` (default, never queues) or `send`

Sending additionally requires `confirm_runtime_memory_replacement: true` and
`image_sha256: 2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451`.
It requires a matching, target-confirmed STOP within ten seconds, no pending
command and no transfer in flight. Admission rechecks the target/session and
operator approval under the command lock.

The endpoint belongs to hardware control, not the boot-image authoring API:
it does not bypass authoring consent or publish an image. Runtime-memory
replacement has its own explicit hash-bound confirmation above.

## Session-local installation evidence

The loader requires a server-held `build/guarded-runtime-installation.json`.
**No such approval is created by this implementation.** HTTP payloads cannot
create it or substitute their own installation claims.

Its schema is `church.guarded-runtime-installation/v1`; it must contain:
`operator_verified_installation: true`, `profile`, `device_uid`,
`bridge_session`, `guard18: 23971`, `image_sha256`, `bitstream_sha256`,
`hardware_tree_sha256`, and `expires_at` (UTC epoch seconds).
The hardware tree digest is calculated by `server.guarded_runtime_reload.source_digest`;
admission must occur within the next five minutes of expiry. It is deliberately
invalid after a session change, source change or image change.

This is trusted **operator-attested installation evidence**, not cryptographic
board attestation or installed-byte readback. Provision it only after an
authorized process establishes the exact compatible build and its installation
on that physical target. Do not infer it from a v20 label, COM port, a successful
model run, or a self-reported browser hash. Do not create a placeholder to unlock
the loader. Build receipts and installation diagnostics must remain separately
retained; the short-lived admission record does not replace them.

## Delivery and evidence boundaries

The image hash pins every image byte, including layout, initial state and bound
capabilities. The server sends those unchanged little-endian bytes through the
existing correlated upload queue. The bridge performs the existing LE-to-BE
word conversion and `u` + four-byte length framing. It requests reboot only
after transport acknowledgement. The loader resets execution authorization
before making the command visible and clears stale trace-label context.

The shared upload lease prevents concurrent control traffic. Existing bridge
failure handling and command-id/session/artifact acknowledgement correlation
are retained. Acknowledgement is not installed-byte verification or proof of
program execution; responses explicitly report installed bytes as unverified.
No automatic retry or recovery is added.

On 2026-10-26 the operator explicitly confirmed that the verified corrected
`wukong-initializer-fixed-25mhz-c1d71a72.bit` remained installed without power
cycling or further FPGA programming. Its retained bytes hash to
`c1d71a721a1380532c59be4da188def94ae8a000d6ea9b702f095d83b67c83b7`.
Synthesized boot, routed timing and physical execution evidence are retained
in `new-layout-25mhz-candidate.md` and the reload evidence directory.
A subsequent runtime reboot produced protocol 2/build 20, a board-confirmed
halt and a CRC-valid snapshot in bridge session
`9bc8f0b355574cdc89e82f51ea428a71`.

That explicit operator confirmation authorizes provisioning a short-lived
session-local installation record for this exact trial, not a placeholder
approval inferred from build 20. The source-tree pin binds the serving
workspace state at admission; frozen build/checkpoint evidence identifies
the separately compiled candidate. The record is excluded from Git and
deployment and must expire within five minutes. It never queues an upload.
The physical full-image reload subsequently received transport acknowledgement
and reached the expected Mallory denial; see
[the bounded result](installed-image-reload-result.md). Installed-byte
verification is unavailable, not passed. The trial's installation approval
was revoked after evidence collection; no repeat command is queued.
