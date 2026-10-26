# Guarded New Layout — offline results

The following focused command completed with **34 passed in 2.70 seconds**:

```sh
python3 -m pytest \
  tests/hardware/test_guarded_new_layout.py \
  tests/hardware/test_ascending_namespace_bootstrap.py \
  tests/hardware/test_boot_pair_guard.py \
  tests/hardware/test_reset_marker_admission.py \
  tests/hardware/test_new_layout_reload_compatibility.py -q
```

`git diff --check` also passed.

Evidence established:

- The retained candidate reconstructs byte-for-byte from the pinned original
  image and its retained guard; its complete patch ledger is checked.
- Preparation refuses to overwrite an existing candidate; verification reuses
  the retained pair and rejects modified bytes/evidence.
- Original retained artifact hashes are verified without writing to those files.
- Actual guarded-image metadata passes the RTL geometry/seal reader.
- Each version passes its own guard comparison. Independently altered,
  re-sealed descriptors still fail VERSION with the correct slot identified.
- Component tests exercise one-shot marker context, replay rejection,
  fresh-reset re-arming and handoff revocation.
- Existing compatibility tests still report the current loader/core mismatch.
  Their passing result does **not** mean the image is hardware-compatible.

Not established:

- Full-core upload, boot, Thread activation, CALL CR0 or ActorManager execution.
- Transport acknowledgement, installed-byte readback or physical execution.
- Synthesis, timing closure or a matching bitstream.

The complete physical reload task remains **pending, not passed**.
