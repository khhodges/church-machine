# Boot-suite failure triage — 44 failed + 29 errors (73 outcomes)

Full-suite run on 2026-08-18 after the boot_rom.py import assert fix:
`44 failed, 165 passed, 2 skipped, 29 errors`. Reproduced identically twice.
`server/lumps/` was backed up before running and restored after (the suite is
destructive — it rewrites `boot-image.bin`, `SelfTest.1.*.lump`,
`SelfTest_v76.json` and creates new `SelfTest.1.<hash>` files on every run).

## Cluster arithmetic (sums exactly to 44 F + 29 E)

| Cluster | F | E |
|---|---|---|
| 1. Empty-tmp-dir image generation | 2 | 20 |
| 2. NS-table-reserve sizing | 11 | 0 |
| 3. Hardcoded old BOOT_IMAGE_FORMAT_TAG | 6 | 0 |
| 4. SelfTest save filename scheme | 3 | 0 |
| 5. B:05 CR0 auto-install guard | 3 | 0 |
| 6. Method dispatch "not found" | 6 | 9 |
| 7. Keystone NS[32] placement | 9 | 0 |
| 8. Misc singles | 4 | 0 |
| **Total** | **44** | **29** |

## Root-cause clusters

### 1. STALE — tests generate a boot image in an empty tmp dir (2 F + 20 E)
`generate_boot_image()` now *requires* a real SelfTest lump (direct-dispatch
model); it raises `ValueError: Boot.Abstr (SelfTest) lump not found`.
- ERROR ×20: `test_ns_lump_header_and_clist.py` — every test in the file
  (module fixture `boot_words` builds the image in
  `tmp_path_factory.mktemp(...)` with no lump): test_ns_lump_header_magic,
  _n_minus_6, _cw, _typ, _cc, _full_word; test_mem_mgr_gt_at_clist_0,
  test_boot_thread_gt_at_clist_1, test_uart_dev_gt_at_clist_2,
  test_led_dev_gt_at_clist_3, test_btn_dev_gt_at_clist_4,
  test_timer_dev_gt_at_clist_5, test_selftest_gt_at_clist_6,
  test_slot7_gt_at_clist_7_is_null, test_slide_rule_gt_at_clist_8,
  test_tunnel_gt_at_clist_22, test_keystone_gt_at_clist_23,
  test_gc_thread_clist_entries[35-GC-perms0], [36-Thread-perms1],
  test_clist_span_length.
- FAILED ×2: `test_boot_abstr_exec.py::test_boot_abstr_direct_dispatch_cr0`
  [default] and [custom_step1] — same empty-tmp-dir cause.
Fix: seed a synthetic 00000600.lump into the tmp dir (reuse
`tests/boot/conftest.py::_make_synthetic_lump`) plus a minimal manifest entry.

### 2. STALE — old power-of-two NS-table-reserve expectations (11 F)
`ns_table_reserve_words()` is now exact `ns_slots_max * 4` with min 16, no
power-of-2 rounding (server/boot_image.py:58). All 11 failures are
`test_dynamic_ns_table_reserve.py`: test_ns_table_reserve_words
[1-64, 52-256, 53-256, 65-512, 102-512, 129-1024, 257-2048, 513-4096] (8),
test_ns_table_reserve_is_power_of_two, test_ns_slots_max_102_reserve_is_512,
test_smaller_reserve_leaves_larger_pool. Rewrite expectations.

### 3. STALE — hardcoded old BOOT_IMAGE_FORMAT_TAG (6 F)
Tag is now `0xB0072128` (A7 v1.2 layout inversion); these assert `0xB0070563`:
- `test_boot_image_matches_simulator.py::test_boot_image_next_gt_is_serialized`
  [None-6], [7-7], [8-8], [300-300] (4)
- `test_thread_manager_clist.py::test_thread_manager_lump_cc_is_1` and
  `::test_thread_manager_lump_clist_abstract_sperm_word` (2) — same hardcoded
  tag in their shared image-parsing helper.
Fix: import the constant from server/boot_image.py instead of hardcoding.

### 4. STALE — SelfTest save no longer writes 00000600.lump (3 F)
`test_boot_abstr_cw_cc.py`: test_save_ns_slot3_updates_list_immediately,
test_saved_cw_cc_survive_server_restart (save endpoint now writes pet-name
identity files `SelfTest.1.<hash>.lump`; tests assert the legacy filename is
(re)written and that a saved cw=17 round-trips — it reads the real lump's
cw=416 instead), and test_no_saved_lump_raises_value_error (regex expects
"00000600.lump" in an error message that was reworded).

### 5. STALE vs deliberate B:05 change (3 F)
`test_boot_cr0_autoinstall.py`: test_cr0_auto_installed_by_b05_when_slot_is_zero,
test_cr0_not_overwritten_by_b05_when_slot_is_populated,
test_cr0_not_written_by_b05_when_thread_ns_entry_is_missing.
Tests expect a zero-check guard + an "auto-installed" log line in B:05.
Current behavior: B:05 writes Thread.caps[0] *unconditionally* and emits no
`[BOOT] INIT_ABSTR` delta (documented direct-dispatch behavior). Tests
predate the change.

### 6. GENUINE? — method dispatch "not found" despite method listed (6 F + 9 E)
One root cause: sim harnesses die with e.g.
`Method Connect not found on Keystone (available: Init, Connect, Hello)`.
The message comes from `simulator/abstractions.js:264` — the method *name*
exists but `_resolveMethod()` finds no bound handler (or the method table
entry is 0 — `tableEntry=0, preInjectionTableEntry=0` in the navana dump).
- FAILED ×6: `test_hello_mum_e2e.py::test_auto_hello_mum_trigger_fires_on_register`,
  `::test_auto_hello_mum_visible_in_device_list`;
  `test_navana_call_method1.py::test_call_navana_method1_no_fault`,
  `::test_call_navana_method1_table_entry_nonzero`,
  `::test_call_navana_method1_boot_image_does_not_embed_lump`,
  `::test_call_navana_method1_pc_lands_on_return_offset`.
- ERROR ×9: `test_hello_mum_e2e.py` module fixture (sim_hello_mum_flow.js
  exits 1): test_harness_boot_image_loaded, test_harness_boot_completes,
  test_harness_navana_init_succeeds, test_harness_keystone_connect_succeeds,
  test_harness_tunnel_slot0_is_wired, test_bridge_was_called,
  test_bridge_returned_http_200, test_bridge_returned_greet_response,
  test_hello_mum_greet_response_propagated_through_bridge.
Looks like a real regression in handler binding / method-table injection —
needs its own investigation.

### 7. Keystone placement (9 F)
`test_keystone_ns32.py`: test_ns_clist_slot32_is_keystone_gt,
test_keystone_gt_has_e_perm_only, test_keystone_gt_points_to_slot_32,
test_keystone_phys_addr_is_nonzero (NS[32] physAddr==0 — Keystone not placed
by generate_boot_image), test_keystone_lump_header_magic_in_boot_image,
test_keystone_lump_header_cw_in_boot_image,
test_keystone_lump_header_cc_in_boot_image, test_keystone_manifest_cw_matches_lump
(`00002000.lump` no longer exists — the lump is now `Keystone.1.<hash>.lump`
under the pet-name scheme), test_keystone_slot0_wiring_survives_boot_image_round_trip.
Mixed: filename assertions are stale; the physAddr==0 placement question
overlaps cluster 6's method-table gap and should be checked alongside it.

### 8. Misc singles (4 F)
- `test_ns_count_after_registry_init.py::test_ns_count_is_8_after_initabstractions_then_reset`:
  nsCount==11, test caps at 8. Catalog/registry has grown (slot 7 Wukong +
  Tunnel/Keystone etc.); decide whether 11 is the new correct count or a
  genuine registry leak. — needs investigation.
- `test_call_home_offline_safe.py::test_call_home_offline_safe`:
  `[BOOT] CALL_HOME` no longer appears in the boot-step output delta —
  output text changed or step silenced. — needs investigation.
- `test_boot_image_manifest_lump_lookup.py::TestBootImageSlot7::test_slot7_has_valid_lump_magic`:
  boot_entry slot stored at ns_table_base-2 is 0 not 7; likely lazy
  (non-resident) slot-7 handling changed. — needs investigation.
- `test_validate_step2_saved_abstr.py::test_validate_step2_rejects_lump_in_128w_abstr_region`:
  STALE test setup. The fixture writes a legacy `00000300.lump` (pre-migration
  slot-3 filename) into its tmp dir with no `manifest.json`. Current
  `_validate_step2` (server/app.py:1235) resolves the saved Boot.Abstr as
  SelfTest at slot 6 via `manifest.json` and *does* derive the saved size when
  the current representation is present. Fix: seed the tmp dir with a slot-6
  SelfTest lump + manifest entry, and update the expected foundation formula,
  which also includes obsolete regions.

## Summary
- Clearly stale (mechanical test updates): clusters 1–5 (25 F + 20 E) plus
  the validate_step2 single = 46 of 73 outcomes; much of cluster 7's 9 F is
  also stale filenames.
- Needs real investigation (possible regressions): cluster 6 (6 F + 9 E),
  cluster 7's physAddr==0, and three misc singles (ns_count, call_home,
  slot7 lookup).
- Suite hygiene: the destructive module (`test_boot_abstr_cw_cc.py`) holds an
  exclusive cross-process `lumps_write_lock` (tests/boot/conftest.py) around
  its snapshot → tests → restore span, so cooperating writers cannot
  interleave. The lock does NOT cover non-cooperating writers (e.g. a live
  dev server saving lumps); do not run destructive suites while the server is
  actively writing lumps, and still snapshot/restore `server/lumps/` manually
  around ad-hoc full runs.
