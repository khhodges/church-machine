attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/core.py:74"
attribute \top 1
module \top

  attribute \src "/home/runner/workspace/church_machine/core.py:118"
  attribute \init 3'000
  wire width 3 \boot_state_reg

  attribute \src "/home/runner/workspace/church_machine/core.py:119"
  wire width 1 \clear_all

  attribute \src "/home/runner/workspace/church_machine/decoder.py:22"
  wire width 32 \instruction

  attribute \src "/home/runner/workspace/church_machine/decoder.py:23"
  wire width 1 \instr_valid

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 4 \flags

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 4 \flags$27

  attribute \src "/home/runner/workspace/church_machine/core.py:158"
  wire width 1 \cond_exec_enable

  attribute \src "/home/runner/workspace/church_machine/decoder.py:26"
  wire width 1 \exec_enable

  attribute \src "/home/runner/workspace/church_machine/core.py:161"
  wire width 1 \any_unit_busy

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:12"
  wire width 1 \lambda_busy

  attribute \src "/home/runner/workspace/church_machine/tperm.py:14"
  wire width 1 \tperm_busy

  attribute \src "/home/runner/workspace/church_machine/call.py:14"
  wire width 1 \call_busy

  attribute \src "/home/runner/workspace/church_machine/ret.py:12"
  wire width 1 \busy

  attribute \src "/home/runner/workspace/church_machine/save.py:15"
  wire width 1 \save_busy

  attribute \src "/home/runner/workspace/church_machine/load.py:12"
  wire width 1 \load_busy

  attribute \src "/home/runner/workspace/church_machine/core.py:174"
  wire width 1 \lambda_start_sig

  attribute \src "/home/runner/workspace/church_machine/decoder.py:27"
  wire width 1 \is_church_op

  attribute \src "/home/runner/workspace/church_machine/decoder.py:29"
  wire width 5 \church_op

  attribute \src "/home/runner/workspace/church_machine/registers.py:20"
  wire width 4 \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:19"
  wire width 1 \sub_busy

  attribute \src "/home/runner/workspace/church_machine/decoder.py:31"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/save.py:20"
  wire width 4 \cr_rd_addr$43

  attribute \src "/home/runner/workspace/church_machine/ret.py:18"
  wire width 4 \cr_rd_addr$44

  attribute \src "/home/runner/workspace/church_machine/call.py:19"
  wire width 4 \cr_rd_addr$45

  attribute \src "/home/runner/workspace/church_machine/tperm.py:19"
  wire width 4 \cr_rd_addr$46

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:17"
  wire width 4 \cr_rd_addr$47

  attribute \src "/home/runner/workspace/church_machine/mload.py:24"
  wire width 4 \cr_rd_addr$48

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 32 \perm_gt_sig

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 128 \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/core.py:205"
  wire width 6 \required_perms

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 32 \gt_in

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:11"
  wire width 6 \required_perms$53

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:12"
  wire width 1 \check_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:34"
  wire width 1 \check_domain_purity

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 32 \cr_rd_data_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:53"
  wire width 32 \clist_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:54"
  wire width 1 \clist_rd_en

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 32 \clist_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:57"
  wire width 1 \clist_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 4 \flags_in

  attribute \src "/home/runner/workspace/church_machine/registers.py:54"
  wire width 1 \flags_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:56"
  wire width 1 \clear_all$63

  attribute \src "/home/runner/workspace/church_machine/registers.py:48"
  wire width 4 \dr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:49"
  wire width 32 \dr_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:50"
  wire width 1 \dr_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:23"
  wire width 4 \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:29"
  wire width 1 \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/tperm.py:24"
  wire width 1 \cr_wr_en$69

  attribute \src "/home/runner/workspace/church_machine/call.py:23"
  wire width 1 \cr_wr_en$70

  attribute \src "/home/runner/workspace/church_machine/ret.py:22"
  wire width 1 \cr_wr_en$71

  attribute \src "/home/runner/workspace/church_machine/ret.py:20"
  wire width 4 \cr_wr_addr$72

  attribute \src "/home/runner/workspace/church_machine/call.py:21"
  wire width 4 \cr_wr_addr$73

  attribute \src "/home/runner/workspace/church_machine/tperm.py:22"
  wire width 4 \cr_wr_addr$74

  attribute \src "/home/runner/workspace/church_machine/mload.py:27"
  wire width 4 \cr_wr_addr$75

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 128 \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 128 \cr_wr_data$77

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 128 \cr_wr_data$78

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 128 \cr_wr_data$79

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 128 \cr_wr_data$80

  attribute \src "/home/runner/workspace/church_machine/registers.py:25"
  wire width 1 \cr_wr_en$81

  attribute \src "/home/runner/workspace/church_machine/core.py:113"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \nia_reg

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 4 \flags$83

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 32 \ns_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr15_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr15_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 32 \thrd_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr8_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr8_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 32 \cr6_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr6_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr6_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 32 \slot3_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 32 \cr7_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr7_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr7_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr0_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr0_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr0_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr0_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr0_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr0_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr1_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr1_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr1_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr1_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr1_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr1_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr2_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr2_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr2_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr2_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr2_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr2_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr3_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr3_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr3_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr3_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr3_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr3_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr4_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr4_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr4_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr4_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr4_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr4_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr5_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr5_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr5_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr5_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr5_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr5_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr6_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr6_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr6_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr6_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr7_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr7_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr7_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr7_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr8_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr8_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr8_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr8_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr9_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr9_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr9_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr9_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr9_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr9_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr10_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr10_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr10_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr10_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr10_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr10_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr11_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr11_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr11_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr11_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr11_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr11_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr12_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr12_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr12_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr12_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr12_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr12_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr13_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr13_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr13_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr13_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr13_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr13_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr14_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr14_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr14_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr14_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr14_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr14_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr15_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr15_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr15_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr15_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:180"
  wire width 1 \call_start_sig

  attribute \src "/home/runner/workspace/church_machine/call.py:10"
  wire width 1 \call_start

  attribute \src "/home/runner/workspace/church_machine/call.py:11"
  wire width 4 \cr_src$187

  attribute \src "/home/runner/workspace/church_machine/call.py:12"
  wire width 17 \index

  attribute \src "/home/runner/workspace/church_machine/decoder.py:35"
  wire width 15 \cap_index

  attribute \src "/home/runner/workspace/church_machine/call.py:13"
  wire width 16 \mask

  attribute \src "/home/runner/workspace/church_machine/decoder.py:36"
  wire width 15 \call_mask

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 128 \cr_rd_data$192

  attribute \src "/home/runner/workspace/church_machine/core.py:181"
  wire width 1 \ret_start_sig

  attribute \src "/home/runner/workspace/church_machine/ret.py:10"
  wire width 1 \return_start

  attribute \src "/home/runner/workspace/church_machine/ret.py:11"
  wire width 3 \cr_src$195

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 128 \cr_rd_data$196

  attribute \src "/home/runner/workspace/church_machine/ret.py:39"
  attribute \init 1'0
  wire width 1 \lambda_active

  attribute \src "/home/runner/workspace/church_machine/core.py:115"
  attribute \init 1'0
  wire width 1 \lambda_active_reg

  attribute \src "/home/runner/workspace/church_machine/ret.py:40"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \lambda_pc

  attribute \src "/home/runner/workspace/church_machine/core.py:116"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \lambda_pc_reg

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:10"
  wire width 1 \lambda_start

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:11"
  wire width 4 \cr_target

  attribute \src "/home/runner/workspace/church_machine/decoder.py:30"
  wire width 4 \cr_dst

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 128 \cr_rd_data$204

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:22"
  wire width 32 \saved_nia

  attribute \src "/home/runner/workspace/church_machine/core.py:179"
  wire width 1 \tperm_start_sig

  attribute \src "/home/runner/workspace/church_machine/tperm.py:10"
  wire width 1 \tperm_start

  attribute \src "/home/runner/workspace/church_machine/tperm.py:11"
  wire width 4 \cr_target$208

  attribute \src "/home/runner/workspace/church_machine/tperm.py:12"
  wire width 4 \preset

  attribute \src "/home/runner/workspace/church_machine/decoder.py:34"
  wire width 4 \tperm_preset

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 128 \cr_rd_data$211

  attribute \src "/home/runner/workspace/church_machine/core.py:467"
  wire width 1 \save_start_sig

  attribute \src "/home/runner/workspace/church_machine/save.py:11"
  wire width 1 \save_start

  attribute \src "/home/runner/workspace/church_machine/save.py:12"
  wire width 4 \cr_src$214

  attribute \src "/home/runner/workspace/church_machine/save.py:13"
  wire width 4 \cr_dst$215

  attribute \src "/home/runner/workspace/church_machine/save.py:14"
  wire width 17 \index$216

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 128 \cr_rd_data$217

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 128 \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 128 \cr15_namespace$219

  attribute \src "/home/runner/workspace/church_machine/save.py:26"
  wire width 1 \mem_wr_done

  attribute \src "/home/runner/workspace/church_machine/save.py:30"
  wire width 32 \mem_rd_data

  attribute \src "/home/runner/workspace/church_machine/save.py:31"
  wire width 1 \mem_rd_valid

  attribute \src "/home/runner/workspace/church_machine/core.py:483"
  wire width 1 \load_start_sig

  attribute \src "/home/runner/workspace/church_machine/load.py:8"
  wire width 1 \load_start

  attribute \src "/home/runner/workspace/church_machine/load.py:9"
  wire width 4 \cr_src$225

  attribute \src "/home/runner/workspace/church_machine/load.py:10"
  wire width 4 \cr_dst$226

  attribute \src "/home/runner/workspace/church_machine/load.py:11"
  wire width 17 \index$227

  attribute \src "/home/runner/workspace/church_machine/decoder.py:40"
  wire width 1 \fault_valid$228

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:32"
  wire width 1 \fault_valid$229

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:14"
  wire width 1 \lambda_fault

  attribute \src "/home/runner/workspace/church_machine/tperm.py:16"
  wire width 1 \tperm_fault

  attribute \src "/home/runner/workspace/church_machine/call.py:16"
  wire width 1 \call_fault

  attribute \src "/home/runner/workspace/church_machine/ret.py:14"
  wire width 1 \fault_valid$233

  attribute \src "/home/runner/workspace/church_machine/save.py:17"
  wire width 1 \save_fault

  attribute \src "/home/runner/workspace/church_machine/load.py:14"
  wire width 1 \load_fault

  attribute \src "/home/runner/workspace/church_machine/decoder.py:39"
  wire width 4 \fault$236

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:31"
  wire width 4 \fault_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:15"
  wire width 4 \fault_type$238

  attribute \src "/home/runner/workspace/church_machine/tperm.py:17"
  wire width 4 \fault_type$239

  attribute \src "/home/runner/workspace/church_machine/call.py:17"
  wire width 4 \fault_type$240

  attribute \src "/home/runner/workspace/church_machine/ret.py:15"
  wire width 4 \fault_type$241

  attribute \src "/home/runner/workspace/church_machine/save.py:18"
  wire width 4 \fault_type$242

  attribute \src "/home/runner/workspace/church_machine/load.py:15"
  wire width 4 \fault_type$243

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 128 \cr_rd_data$244

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 128 \cr15_namespace$245

  attribute \src "/home/runner/workspace/church_machine/mload.py:35"
  wire width 32 \mem_rd_data$246

  attribute \src "/home/runner/workspace/church_machine/mload.py:36"
  wire width 1 \mem_rd_valid$247

  attribute \src "/home/runner/workspace/church_machine/mload.py:12"
  wire width 1 \sub_start

  attribute \src "/home/runner/workspace/church_machine/call.py:25"
  wire width 1 \mload_start

  attribute \src "/home/runner/workspace/church_machine/mload.py:13"
  wire width 4 \sub_cr_src

  attribute \src "/home/runner/workspace/church_machine/call.py:26"
  wire width 4 \mload_cr_src

  attribute \src "/home/runner/workspace/church_machine/mload.py:14"
  wire width 4 \sub_cr_dst

  attribute \src "/home/runner/workspace/church_machine/call.py:27"
  wire width 4 \mload_cr_dst

  attribute \src "/home/runner/workspace/church_machine/mload.py:15"
  wire width 17 \sub_index

  attribute \src "/home/runner/workspace/church_machine/call.py:28"
  wire width 17 \mload_index

  attribute \src "/home/runner/workspace/church_machine/mload.py:16"
  wire width 1 \sub_direct

  attribute \src "/home/runner/workspace/church_machine/call.py:29"
  wire width 1 \mload_direct

  attribute \src "/home/runner/workspace/church_machine/mload.py:17"
  wire width 32 \sub_direct_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:30"
  wire width 32 \mload_direct_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:18"
  wire width 1 \sub_m_elevated

  attribute \src "/home/runner/workspace/church_machine/call.py:31"
  wire width 1 \mload_m_elevated

  attribute \src "/home/runner/workspace/church_machine/ret.py:27"
  wire width 1 \mload_start$262

  attribute \src "/home/runner/workspace/church_machine/ret.py:28"
  wire width 4 \mload_cr_src$263

  attribute \src "/home/runner/workspace/church_machine/ret.py:29"
  wire width 4 \mload_cr_dst$264

  attribute \src "/home/runner/workspace/church_machine/ret.py:30"
  wire width 17 \mload_index$265

  attribute \src "/home/runner/workspace/church_machine/ret.py:31"
  wire width 1 \mload_direct$266

  attribute \src "/home/runner/workspace/church_machine/ret.py:32"
  wire width 32 \mload_direct_gt$267

  attribute \src "/home/runner/workspace/church_machine/ret.py:33"
  wire width 1 \mload_m_elevated$268

  attribute \src "/home/runner/workspace/church_machine/load.py:17"
  wire width 1 \mload_start$269

  attribute \src "/home/runner/workspace/church_machine/load.py:18"
  wire width 4 \mload_cr_src$270

  attribute \src "/home/runner/workspace/church_machine/load.py:19"
  wire width 4 \mload_cr_dst$271

  attribute \src "/home/runner/workspace/church_machine/load.py:20"
  wire width 17 \mload_index$272

  attribute \src "/home/runner/workspace/church_machine/load.py:21"
  wire width 1 \mload_direct$273

  attribute \src "/home/runner/workspace/church_machine/load.py:22"
  wire width 32 \mload_direct_gt$274

  attribute \src "/home/runner/workspace/church_machine/load.py:23"
  wire width 1 \mload_m_elevated$275

  attribute \src "/home/runner/workspace/church_machine/call.py:33"
  wire width 1 \mload_done

  attribute \src "/home/runner/workspace/church_machine/mload.py:20"
  wire width 1 \sub_done

  attribute \src "/home/runner/workspace/church_machine/call.py:34"
  wire width 1 \mload_fault

  attribute \src "/home/runner/workspace/church_machine/mload.py:21"
  wire width 1 \sub_fault

  attribute \src "/home/runner/workspace/church_machine/call.py:35"
  wire width 4 \mload_fault_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:22"
  wire width 4 \sub_fault_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:35"
  wire width 1 \mload_done$282

  attribute \src "/home/runner/workspace/church_machine/ret.py:36"
  wire width 1 \mload_fault$283

  attribute \src "/home/runner/workspace/church_machine/ret.py:37"
  wire width 4 \mload_fault_type$284

  attribute \src "/home/runner/workspace/church_machine/load.py:25"
  wire width 1 \mload_busy

  attribute \src "/home/runner/workspace/church_machine/load.py:26"
  wire width 1 \mload_done$286

  attribute \src "/home/runner/workspace/church_machine/load.py:27"
  wire width 1 \mload_fault$287

  attribute \src "/home/runner/workspace/church_machine/load.py:28"
  wire width 4 \mload_fault_type$288

  attribute \src "/home/runner/workspace/church_machine/mload.py:34"
  wire width 1 \mem_rd_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:37"
  wire width 1 \mem_wr_en

  attribute \src "/home/runner/workspace/church_machine/save.py:25"
  wire width 1 \mem_wr_en$291

  attribute \src "/home/runner/workspace/church_machine/save.py:29"
  wire width 1 \mem_rd_en$292

  attribute \src "/home/runner/workspace/church_machine/mload.py:33"
  wire width 32 \mem_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:38"
  wire width 32 \mem_wr_data

  attribute \src "/home/runner/workspace/church_machine/save.py:23"
  wire width 32 \mem_wr_addr

  attribute \src "/home/runner/workspace/church_machine/save.py:24"
  wire width 32 \mem_wr_data$296

  attribute \src "/home/runner/workspace/church_machine/save.py:28"
  wire width 32 \mem_rd_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:50"
  wire width 96 \ns_wr_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:16"
  wire width 1 \reboot_request

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:20"
  wire width 1 \nia_set

  attribute \src "/home/runner/workspace/church_machine/ret.py:24"
  wire width 1 \nia_set$301

  attribute \src "/home/runner/workspace/church_machine/call.py:37"
  wire width 1 \nia_set$302

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:21"
  wire width 32 \nia_value

  attribute \src "/home/runner/workspace/church_machine/ret.py:25"
  wire width 32 \nia_value$304

  attribute \src "/home/runner/workspace/church_machine/call.py:38"
  wire width 32 \nia_value$305

  attribute \src "/home/runner/workspace/church_machine/ret.py:41"
  wire width 1 \lambda_clear

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:13"
  wire width 1 \lambda_complete

  attribute \src "/home/runner/workspace/church_machine/decoder.py:22"
  wire width 32 input 0  \imem_data

  attribute \src "/home/runner/workspace/church_machine/core.py:39"
  wire width 1 input 1  \imem_valid

  attribute \src "/home/runner/workspace/church_machine/mload.py:35"
  wire width 32 input 2  \dmem_rd_data

  attribute \src "/home/runner/workspace/church_machine/core.py:59"
  wire width 1 input 3  \boot_start

  attribute \src "/home/runner/workspace/church_machine/core.py:63"
  wire width 1 input 4  \gc_start

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 5  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 6  \rst

  attribute \src "/home/runner/workspace/church_machine/core.py:113"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 output 7  \imem_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:41"
  wire width 32 output 8  \dmem_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:42"
  wire width 1 output 9  \dmem_rd_en

  attribute \src "/home/runner/workspace/church_machine/core.py:44"
  wire width 32 output 10  \dmem_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:45"
  wire width 1 output 11  \dmem_wr_en

  attribute \src "/home/runner/workspace/church_machine/call.py:38"
  wire width 32 output 12  \ns_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:37"
  wire width 1 output 13  \ns_rd_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:37"
  wire width 1 output 14  \ns_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:118"
  attribute \init 3'000
  wire width 3 output 15  \boot_state

  attribute \src "/home/runner/workspace/church_machine/core.py:61"
  wire width 1 output 16  \boot_complete

  attribute \src "/home/runner/workspace/church_machine/mload.py:37"
  wire width 1 output 17  \gc_busy

  attribute \src "/home/runner/workspace/church_machine/call.py:38"
  wire width 32 output 18  \gc_garbage_count

  attribute \src "/home/runner/workspace/church_machine/core.py:67"
  wire width 4 output 19  \fault

  attribute \src "/home/runner/workspace/church_machine/core.py:68"
  wire width 1 output 20  \fault_valid

  attribute \src "/home/runner/workspace/church_machine/core.py:113"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 output 21  \nia

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 4 $10

  wire width 4 $11

  wire width 4 $12

  wire width 4 $13

  wire width 4 $14

  wire width 1 $15

  wire width 4 $16

  wire width 1 $17

  wire width 1 $18

  wire width 4 $19

  wire width 4 $20

  wire width 4 $21

  wire width 128 $22

  wire width 128 $23

  wire width 128 $24

  wire width 1 $25

  wire width 1 $26

  wire width 1 $27

  wire width 1 $28

  wire width 1 $29

  wire width 1 $30

  wire width 1 $31

  wire width 1 $32

  wire width 1 $33

  wire width 1 $34

  wire width 1 $35

  wire width 33 $36

  wire width 1 $37

  wire width 1 $38

  wire width 1 $39

  wire width 1 $40

  wire width 1 $41

  wire width 1 $42

  wire width 1 $43

  wire width 1 $44

  wire width 1 $45

  wire width 1 $46

  wire width 1 $47

  wire width 1 $48

  wire width 1 $49

  wire width 1 $50

  wire width 1 $51

  wire width 33 $52

  wire width 1 $53

  wire width 1 $54

  wire width 3 $55

  wire width 32 $56

  wire width 1 $57

  wire width 32 $58

  wire width 3 $59

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.N

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.Z

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.C

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags$27.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags$27.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags$27.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags$27.V

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 2 \perm_gt_sig.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 6 \perm_gt_sig.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 17 \perm_gt_sig.index

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 7 \perm_gt_sig.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 2 \gt_in.gt_type

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 6 \gt_in.perms

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 17 \gt_in.index

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 7 \gt_in.version

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 2 \cr_rd_data_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 6 \cr_rd_data_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 17 \cr_rd_data_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 7 \cr_rd_data_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 2 \clist_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 6 \clist_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 17 \clist_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 7 \clist_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data$77.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 2 \cr_wr_data$77.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 6 \cr_wr_data$77.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 17 \cr_wr_data$77.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 7 \cr_wr_data$77.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data$77.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data$77.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data$77.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data$78.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 2 \cr_wr_data$78.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 6 \cr_wr_data$78.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 17 \cr_wr_data$78.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 7 \cr_wr_data$78.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data$78.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data$78.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data$78.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data$79.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 2 \cr_wr_data$79.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 6 \cr_wr_data$79.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 17 \cr_wr_data$79.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 7 \cr_wr_data$79.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data$79.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data$79.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data$79.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data$80.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 2 \cr_wr_data$80.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 6 \cr_wr_data$80.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 17 \cr_wr_data$80.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 7 \cr_wr_data$80.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data$80.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data$80.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data$80.word3_seals

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 1 \flags$83.N

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 1 \flags$83.Z

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 1 \flags$83.C

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 1 \flags$83.V

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 2 \ns_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 6 \ns_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 17 \ns_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 7 \ns_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr15_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr15_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr15_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr15_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 2 \thrd_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 6 \thrd_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 17 \thrd_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 7 \thrd_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr8_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr8_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr8_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr8_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 2 \cr6_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 6 \cr6_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 17 \cr6_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 7 \cr6_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr6_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr6_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr6_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr6_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 2 \slot3_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 6 \slot3_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 17 \slot3_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 7 \slot3_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 2 \cr7_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 6 \cr7_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 17 \cr7_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 7 \cr7_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr7_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr7_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr7_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr7_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr0_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr0_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr0_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr0_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr0_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr0_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr0_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr0_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr0_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr0_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr0_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr0_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr1_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr1_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr1_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr1_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr1_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr1_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr1_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr1_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr1_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr1_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr1_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr1_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr2_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr2_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr2_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr2_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr2_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr2_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr2_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr2_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr2_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr2_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr2_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr2_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr3_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr3_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr3_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr3_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr3_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr3_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr3_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr3_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr3_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr3_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr3_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr3_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr4_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr4_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr4_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr4_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr4_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr4_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr4_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr4_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr4_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr4_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr4_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr4_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr5_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr5_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr5_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr5_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr5_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr5_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr5_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr5_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr5_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr5_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr5_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr5_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr6_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr6_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr6_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr6_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr6_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr6_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr6_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr6_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr7_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr7_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr7_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr7_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr7_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr7_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr7_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr7_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr8_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr8_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr8_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr8_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr8_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr8_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr8_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr8_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr9_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr9_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr9_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr9_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr9_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr9_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr9_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr9_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr9_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr9_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr9_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr9_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr10_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr10_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr10_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr10_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr10_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr10_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr10_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr10_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr10_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr10_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr10_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr10_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr11_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr11_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr11_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr11_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr11_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr11_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr11_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr11_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr11_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr11_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr11_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr11_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr12_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr12_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr12_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr12_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr12_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr12_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr12_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr12_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr12_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr12_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr12_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr12_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr13_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr13_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr13_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr13_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr13_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr13_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr13_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr13_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr13_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr13_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr13_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr13_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr14_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr14_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr14_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr14_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr14_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr14_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr14_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr14_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr14_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr14_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr14_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr14_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr15_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr15_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr15_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr15_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr15_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr15_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr15_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr15_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data$192.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 2 \cr_rd_data$192.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 6 \cr_rd_data$192.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 17 \cr_rd_data$192.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 7 \cr_rd_data$192.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data$192.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data$192.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data$192.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data$196.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 2 \cr_rd_data$196.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 6 \cr_rd_data$196.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 17 \cr_rd_data$196.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 7 \cr_rd_data$196.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data$196.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data$196.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data$196.word3_seals

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data$204.word0_gt

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 2 \cr_rd_data$204.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 6 \cr_rd_data$204.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 17 \cr_rd_data$204.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 7 \cr_rd_data$204.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data$204.word1_location

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data$204.word2_limit

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data$204.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data$211.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 2 \cr_rd_data$211.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 6 \cr_rd_data$211.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 17 \cr_rd_data$211.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 7 \cr_rd_data$211.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data$211.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data$211.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data$211.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data$217.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 2 \cr_rd_data$217.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 6 \cr_rd_data$217.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 17 \cr_rd_data$217.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 7 \cr_rd_data$217.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data$217.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data$217.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data$217.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace$219.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 2 \cr15_namespace$219.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 6 \cr15_namespace$219.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 17 \cr15_namespace$219.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 7 \cr15_namespace$219.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace$219.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace$219.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace$219.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data$244.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 2 \cr_rd_data$244.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 6 \cr_rd_data$244.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 17 \cr_rd_data$244.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 7 \cr_rd_data$244.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data$244.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data$244.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data$244.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace$245.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 2 \cr15_namespace$245.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 6 \cr15_namespace$245.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 17 \cr15_namespace$245.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 7 \cr15_namespace$245.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace$245.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace$245.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace$245.word3_seals

  attribute \src "/home/runner/workspace/church_machine/core.py:93"
  cell \top.u_registers \u_registers
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \clear_all \clear_all [0]
    connect \cr_rd_addr \cr_rd_addr [3:0]
    connect \cr_wr_addr \cr_wr_addr [3:0]
    connect \cr_wr_data \cr_wr_data [127:0]
    connect \cr_wr_en \cr_wr_en$81 [0]
    connect \cr0_gt_wr_en \cr0_gt_wr_en [0]
    connect \cr0_gt_wr_data \cr0_gt_wr_data [31:0]
    connect \cr1_gt_wr_en \cr1_gt_wr_en [0]
    connect \cr1_gt_wr_data \cr1_gt_wr_data [31:0]
    connect \cr2_gt_wr_en \cr2_gt_wr_en [0]
    connect \cr2_gt_wr_data \cr2_gt_wr_data [31:0]
    connect \cr3_gt_wr_en \cr3_gt_wr_en [0]
    connect \cr3_gt_wr_data \cr3_gt_wr_data [31:0]
    connect \cr4_gt_wr_en \cr4_gt_wr_en [0]
    connect \cr4_gt_wr_data \cr4_gt_wr_data [31:0]
    connect \cr5_gt_wr_en \cr5_gt_wr_en [0]
    connect \cr5_gt_wr_data \cr5_gt_wr_data [31:0]
    connect \cr6_gt_wr_en \cr6_gt_wr_en [0]
    connect \cr6_gt_wr_data \cr6_gt_wr_data [31:0]
    connect \cr7_gt_wr_en \cr7_gt_wr_en [0]
    connect \cr7_gt_wr_data \cr7_gt_wr_data [31:0]
    connect \cr8_gt_wr_en \cr8_gt_wr_en [0]
    connect \cr8_gt_wr_data \cr8_gt_wr_data [31:0]
    connect \cr9_gt_wr_en \cr9_gt_wr_en [0]
    connect \cr9_gt_wr_data \cr9_gt_wr_data [31:0]
    connect \cr10_gt_wr_en \cr10_gt_wr_en [0]
    connect \cr10_gt_wr_data \cr10_gt_wr_data [31:0]
    connect \cr11_gt_wr_en \cr11_gt_wr_en [0]
    connect \cr11_gt_wr_data \cr11_gt_wr_data [31:0]
    connect \cr12_gt_wr_en \cr12_gt_wr_en [0]
    connect \cr12_gt_wr_data \cr12_gt_wr_data [31:0]
    connect \cr13_gt_wr_en \cr13_gt_wr_en [0]
    connect \cr13_gt_wr_data \cr13_gt_wr_data [31:0]
    connect \cr14_gt_wr_en \cr14_gt_wr_en [0]
    connect \cr14_gt_wr_data \cr14_gt_wr_data [31:0]
    connect \cr15_gt_wr_en \cr15_gt_wr_en [0]
    connect \cr15_gt_wr_data \cr15_gt_wr_data [31:0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \cr15 \cr15_namespace [127:0]
    connect \flags \flags [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:94"
  cell \top.u_decoder \u_decoder
    connect \instruction \imem_data [31:0]
    connect \instr_valid \instr_valid [0]
    connect \exec_enable \exec_enable [0]
    connect \is_church_op \is_church_op [0]
    connect \flags \flags [3:0]
    connect \fault_valid \fault_valid$228 [0]
    connect \fault \fault$236 [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:95"
  cell \top.u_perm_check \u_perm_check
    connect \check_valid \check_valid [0]
    connect \check_domain_purity \check_domain_purity [0]
    connect \gt_in \cr_rd_data [31:0]
    connect \required_perms \required_perms [5:0]
    connect \fault_valid \fault_valid$229 [0]
    connect \fault_type \fault_type [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:98"
  cell \top.u_lambda \u_lambda
    connect \cr_target \imem_data [22:19]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \lambda_start \lambda_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \lambda_busy \lambda_busy [0]
    connect \lambda_complete \lambda_complete [0]
    connect \cr_rd_addr \cr_rd_addr$47 [3:0]
    connect \nia_set \nia_set [0]
    connect \nia_value \nia_value [31:0]
    connect \lambda_fault \lambda_fault [0]
    connect \fault_type \fault_type$238 [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:99"
  cell \top.u_call \u_call
    connect \port$0$2 \imem_data [18:0]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \call_start \call_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \mload_src \mload_cr_src [3:0]
    connect \port$505$0 $59 [2:0]
    connect \mload_index \mload_index [16:0]
    connect \call_busy \call_busy [0]
    connect \call_complete \nia_set$302 [0]
    connect \mload_fault \mload_fault [0]
    connect \mload_done \mload_done [0]
    connect \cr_rd_addr \cr_rd_addr$45 [3:0]
    connect \cr_wr_data \cr_wr_data$78 [127:0]
    connect \cr_wr_en \cr_wr_en$70 [0]
    connect \cr_wr_addr \cr_wr_addr$73 [3:0]
    connect \call_fault \call_fault [0]
    connect \fault_type \fault_type$240 [3:0]
    connect \mload_start \mload_start [0]
    connect \mload_fault_type \fault_type$243 [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:100"
  cell \top.u_return \u_return
    connect \cr_src \imem_data [17:15]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \return_start \ret_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \cr_rd_addr \cr_rd_addr$44 [3:0]
    connect \busy \busy [0]
    connect \reboot_request \reboot_request [0]
    connect \mload_fault \mload_fault [0]
    connect \mload_done \mload_done [0]
    connect \lambda_active \lambda_active [0]
    connect \lambda_pc \lambda_pc [31:0]
    connect \mload_dst \mload_cr_dst$264 [3:0]
    connect \mload_direct_gt \mload_direct_gt$267 [31:0]
    connect \nia_set \nia_set$301 [0]
    connect \nia_value \nia_value$304 [31:0]
    connect \lambda_clear \lambda_clear [0]
    connect \fault_valid \fault_valid$233 [0]
    connect \fault_type \fault_type$241 [3:0]
    connect \mload_start \mload_start$262 [0]
    connect \mload_fault_type \fault_type$243 [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:101"
  cell \top.u_tperm \u_tperm
    connect \preset \imem_data [3:0]
    connect \cr_target \imem_data [22:19]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \tperm_start \tperm_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \tperm_busy \tperm_busy [0]
    connect \cr_rd_addr \cr_rd_addr$46 [3:0]
    connect \cr_wr_addr \cr_wr_addr$74 [3:0]
    connect \cr_wr_data \cr_wr_data$79 [127:0]
    connect \cr_wr_en \cr_wr_en$69 [0]
    connect \tperm_fault \tperm_fault [0]
    connect \fault_type \fault_type$239 [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:102"
  cell \top.u_save \u_save
    connect \port$0$2 \imem_data [22:0]
    connect \mem_rd_data \dmem_rd_data [31:0]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \save_start \save_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \save_busy \save_busy [0]
    connect \cr15_namespace \cr15_namespace [127:0]
    connect \cr_rd_addr \cr_rd_addr$43 [3:0]
    connect \save_fault \save_fault [0]
    connect \fault_type \fault_type$242 [3:0]
    connect \mem_rd_addr \mem_rd_addr [31:0]
    connect \mem_rd_en \mem_rd_en$292 [0]
    connect \mem_wr_en \mem_wr_en$291 [0]
    connect \mem_wr_addr \mem_wr_addr [31:0]
    connect \mem_wr_data \mem_wr_data$296 [31:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:103"
  cell \top.u_load \u_load
    connect \port$0$2 \imem_data [22:0]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \load_start \load_start_sig [0]
    connect \mload_m_elevated \mload_m_elevated$275 [0]
    connect \load_busy \load_busy [0]
    connect \load_fault \load_fault [0]
    connect \mload_busy \sub_busy [0]
    connect \mload_fault \mload_fault [0]
    connect \mload_done \mload_done [0]
    connect \mload_start \mload_start$269 [0]
    connect \fault_type \fault_type$243 [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:105"
  cell \top.u_shared_mload \u_shared_mload
    connect \mem_rd_data \dmem_rd_data [31:0]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \sub_busy \sub_busy [0]
    connect \sub_fault \mload_fault [0]
    connect \sub_done \mload_done [0]
    connect \sub_start \sub_start [0]
    connect \sub_cr_src \sub_cr_src [3:0]
    connect \sub_cr_dst \sub_cr_dst [3:0]
    connect \sub_index \sub_index [16:0]
    connect \sub_direct \sub_direct [0]
    connect \sub_direct_gt \sub_direct_gt [31:0]
    connect \sub_m_elevated \sub_m_elevated [0]
    connect \cr15_namespace \cr15_namespace [127:0]
    connect \cr_rd_addr \cr_rd_addr$48 [3:0]
    connect \mem_addr \mem_addr [31:0]
    connect \mem_rd_en \mem_rd_en [0]
    connect \cr_wr_addr \cr_wr_addr$75 [3:0]
    connect \cr_wr_data \cr_wr_data$80 [127:0]
    connect \cr_wr_en \cr_wr_en [0]
    connect \sub_fault_type \fault_type$243 [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:123"
  cell $eq $60
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \boot_state [2:0]
    connect \B 3'110
    connect \Y \boot_complete
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:124"
  cell $eq $61
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_state [2:0]
    connect \B 1'1
    connect \Y \clear_all
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:146"
  cell $and $62
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \imem_valid [0]
    connect \B \boot_complete [0]
    connect \Y \instr_valid
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:159"
  cell $and $63
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_complete [0]
    connect \B \exec_enable [0]
    connect \Y \cond_exec_enable
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $64
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_busy [0]
    connect \B \tperm_busy [0]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $65
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $1 [0]
    connect \B \call_busy [0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $66
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $2 [0]
    connect \B \busy [0]
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $67
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $3 [0]
    connect \B \save_busy [0]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $68
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $4 [0]
    connect \B \load_busy [0]
    connect \Y \any_unit_busy
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $and $69
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $eq $70
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \imem_data [31:27]
    connect \B 3'111
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $and $71
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $5 [0]
    connect \B $6 [0]
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $not $72
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $and $73
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $7 [0]
    connect \B $8 [0]
    connect \Y \lambda_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:194"
  cell $or $74
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_start_sig [0]
    connect \B \lambda_busy [0]
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:198"
  cell $mux $75
    parameter \WIDTH 4
    connect \S \save_busy [0]
    connect \A \imem_data [18:15]
    connect \B \cr_rd_addr$43 [3:0]
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:197"
  cell $mux $76
    parameter \WIDTH 4
    connect \S \busy [0]
    connect \A $10 [3:0]
    connect \B \cr_rd_addr$44 [3:0]
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:196"
  cell $mux $77
    parameter \WIDTH 4
    connect \S \call_busy [0]
    connect \A $11 [3:0]
    connect \B \cr_rd_addr$45 [3:0]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:195"
  cell $mux $78
    parameter \WIDTH 4
    connect \S \tperm_busy [0]
    connect \A $12 [3:0]
    connect \B \cr_rd_addr$46 [3:0]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:194"
  cell $mux $79
    parameter \WIDTH 4
    connect \S $9 [0]
    connect \A $13 [3:0]
    connect \B \cr_rd_addr$47 [3:0]
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:193"
  cell $mux $80
    parameter \WIDTH 4
    connect \S \sub_busy [0]
    connect \A $14 [3:0]
    connect \B \cr_rd_addr$48 [3:0]
    connect \Y \cr_rd_addr
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:208"
  cell $eq $81
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \imem_data [18:15]
    connect \B 3'110
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:208"
  cell $mux $82
    parameter \WIDTH 4
    connect \S $15 [0]
    connect \A 4'1000
    connect \B 4'0000
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:229"
  cell $and $83
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y \check_valid
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:231"
  cell $and $84
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:231"
  cell $eq $85
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \imem_data [31:27]
    connect \B 3'110
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:231"
  cell $and $86
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $17 [0]
    connect \B $18 [0]
    connect \Y \check_domain_purity
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:299"
  cell $mux $87
    parameter \WIDTH 4
    connect \S 1'0
    connect \A 4'0000
    connect \B 4'0000
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:298"
  cell $mux $88
    parameter \WIDTH 4
    connect \S \cr_wr_en$70 [0]
    connect \A $19 [3:0]
    connect \B \cr_wr_addr$73 [3:0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:297"
  cell $mux $89
    parameter \WIDTH 4
    connect \S \cr_wr_en$69 [0]
    connect \A $20 [3:0]
    connect \B \cr_wr_addr$74 [3:0]
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:296"
  cell $mux $90
    parameter \WIDTH 4
    connect \S \cr_wr_en [0]
    connect \A $21 [3:0]
    connect \B \cr_wr_addr$75 [3:0]
    connect \Y \cr_wr_addr
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:306"
  cell $mux $91
    parameter \WIDTH 128
    connect \S 1'0
    connect \A 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    connect \B 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:305"
  cell $mux $92
    parameter \WIDTH 128
    connect \S \cr_wr_en$70 [0]
    connect \A $22 [127:0]
    connect \B \cr_wr_data$78 [127:0]
    connect \Y $23
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:304"
  cell $mux $93
    parameter \WIDTH 128
    connect \S \cr_wr_en$69 [0]
    connect \A $23 [127:0]
    connect \B \cr_wr_data$79 [127:0]
    connect \Y $24
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:303"
  cell $mux $94
    parameter \WIDTH 128
    connect \S \cr_wr_en [0]
    connect \A $24 [127:0]
    connect \B \cr_wr_data$80 [127:0]
    connect \Y \cr_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:310"
  cell $or $95
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cr_wr_en [0]
    connect \B \cr_wr_en$69 [0]
    connect \Y $25
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:310"
  cell $or $96
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $25 [0]
    connect \B \cr_wr_en$70 [0]
    connect \Y $26
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:310"
  cell $or $97
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $26 [0]
    connect \B 1'0
    connect \Y $27
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:310"
  cell $or $98
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $27 [0]
    connect \B 1'0
    connect \Y \cr_wr_en$81
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $99
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr0_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $100
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr0_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $101
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr1_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $102
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr1_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $103
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr2_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $104
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr2_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $105
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr3_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $106
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr3_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $107
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr4_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $108
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr4_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $109
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr5_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $110
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr5_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $111
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_cr6_wr_en [0]
    connect \B 1'0
    connect \Y \cr6_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $112
    parameter \WIDTH 32
    connect \S \boot_cr6_wr_en [0]
    connect \A 32'00000000000000000000000000000000
    connect \B \boot_cr6_wr_gt [31:0]
    connect \Y \cr6_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $113
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_cr7_wr_en [0]
    connect \B 1'0
    connect \Y \cr7_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $114
    parameter \WIDTH 32
    connect \S \boot_cr7_wr_en [0]
    connect \A 32'00000000000000000000000000000000
    connect \B \boot_cr7_wr_gt [31:0]
    connect \Y \cr7_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $115
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_cr8_wr_en [0]
    connect \B 1'0
    connect \Y \cr8_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $116
    parameter \WIDTH 32
    connect \S \boot_cr8_wr_en [0]
    connect \A 32'00000000000000000000000000000000
    connect \B \boot_cr8_wr_gt [31:0]
    connect \Y \cr8_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $117
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr9_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $118
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr9_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $119
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr10_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $120
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr10_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $121
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr11_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $122
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr11_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $123
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr12_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $124
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr12_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $125
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr13_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $126
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr13_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $127
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr14_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $128
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr14_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $129
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_cr15_wr_en [0]
    connect \B 1'0
    connect \Y \cr15_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $130
    parameter \WIDTH 32
    connect \S \boot_cr15_wr_en [0]
    connect \A 32'00000000000000000000000000000000
    connect \B \boot_cr15_wr_gt [31:0]
    connect \Y \cr15_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $and $131
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $28
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $eq $132
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \imem_data [31:27]
    connect \B 2'10
    connect \Y $29
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $and $133
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $28 [0]
    connect \B $29 [0]
    connect \Y $30
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $not $134
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $31
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $and $135
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $30 [0]
    connect \B $31 [0]
    connect \Y \call_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $and $136
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $32
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $eq $137
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \imem_data [31:27]
    connect \B 2'11
    connect \Y $33
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $and $138
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $32 [0]
    connect \B $33 [0]
    connect \Y $34
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $not $139
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $35
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $and $140
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $34 [0]
    connect \B $35 [0]
    connect \Y \ret_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:454"
  cell $add $141
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A \imem_addr [31:0]
    connect \B 3'100
    connect \Y $36
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $and $142
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $37
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $eq $143
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \imem_data [31:27]
    connect \B 3'110
    connect \Y $38
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $and $144
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $37 [0]
    connect \B $38 [0]
    connect \Y $39
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $not $145
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $40
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $and $146
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $39 [0]
    connect \B $40 [0]
    connect \Y \tperm_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $and $147
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $41
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $eq $148
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \imem_data [31:27]
    connect \B 1'1
    connect \Y $42
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $and $149
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $41 [0]
    connect \B $42 [0]
    connect \Y $43
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $not $150
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $44
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $and $151
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $43 [0]
    connect \B $44 [0]
    connect \Y \save_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $and $152
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $45
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $eq $153
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \imem_data [31:27]
    connect \B {  }
    connect \Y $46
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $and $154
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $45 [0]
    connect \B $46 [0]
    connect \Y $47
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $not $155
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $48
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $and $156
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $47 [0]
    connect \B $48 [0]
    connect \Y \load_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:652"
  cell $or $157
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \mem_rd_en [0]
    connect \B 1'0
    connect \Y $49
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:331"
  cell $not $158
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $50
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:331"
  cell $and $159
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B $50 [0]
    connect \Y $51
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:332"
  cell $add $160
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A \imem_addr [31:0]
    connect \B 3'100
    connect \Y $52
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:447"
  cell $not $161
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_fault [0]
    connect \Y $53
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:447"
  cell $and $162
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_complete [0]
    connect \B $53 [0]
    connect \Y $54
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:205"
  process $163
    assign \required_perms [5:0] 6'000000
    switch \imem_data [31:27]
      case 5'00000
        assign \required_perms [5:0] { 2'00 $16 [3:0] }
      case 5'00001
        assign \required_perms [5:0] 6'010000
      case 5'00010
        assign \required_perms [5:0] 6'100000
      case 5'00101
        assign \required_perms [5:0] 6'001000
      case 5'00100
        assign \required_perms [5:0] 6'001000
      case 5'00111
        assign \required_perms [5:0] 6'000100
      case 5'01000
        assign \required_perms [5:0] 6'000000
      case 5'01001
        assign \required_perms [5:0] 6'000000
      case
        assign \required_perms [5:0] 6'000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  process $164
    assign \ns_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
        assign \ns_gt [24:8] 17'00000000000000000
        assign \ns_gt [31:25] 7'0000000
        assign \ns_gt [1:0] 2'00
        assign \ns_gt [7:2] 6'000000
      case 3'011
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  process $165
    assign \boot_cr15_wr_en [0] 1'0
    switch \boot_state [2:0]
      case 3'010
        assign \boot_cr15_wr_en [0] 1'1
      case 3'011
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  process $166
    assign \boot_cr15_wr_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
        assign \boot_cr15_wr_gt [31:0] \ns_gt [31:0]
      case 3'011
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  process $167
    assign \thrd_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
        assign \thrd_gt [24:8] 17'00000000000000001
        assign \thrd_gt [31:25] 7'0000000
        assign \thrd_gt [1:0] 2'00
        assign \thrd_gt [7:2] 6'000000
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  process $168
    assign \boot_cr8_wr_en [0] 1'0
    switch \boot_state [2:0]
      case 3'010
      case 3'011
        assign \boot_cr8_wr_en [0] 1'1
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  process $169
    assign \boot_cr8_wr_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
        assign \boot_cr8_wr_gt [31:0] \thrd_gt [31:0]
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  process $170
    assign \cr6_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
        assign \cr6_gt [24:8] 17'00000000000000010
        assign \cr6_gt [31:25] 7'0000000
        assign \cr6_gt [1:0] 2'00
        assign \cr6_gt [7:2] 6'100000
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  process $171
    assign \boot_cr6_wr_en [0] 1'0
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
        assign \boot_cr6_wr_en [0] 1'1
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  process $172
    assign \boot_cr6_wr_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
        assign \boot_cr6_wr_gt [31:0] \cr6_gt [31:0]
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  process $173
    assign \slot3_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
      case 3'101
        assign \slot3_gt [24:8] 17'00000000000000010
        assign \slot3_gt [31:25] 7'0000000
        assign \slot3_gt [1:0] 2'00
        assign \slot3_gt [7:2] 6'100000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  process $174
    assign \cr7_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
      case 3'101
        assign \cr7_gt [24:8] 17'00000000000000011
        assign \cr7_gt [31:25] 7'0000000
        assign \cr7_gt [1:0] 2'00
        assign \cr7_gt [7:2] 6'000100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  process $175
    assign \boot_cr7_wr_en [0] 1'0
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
      case 3'101
        assign \boot_cr7_wr_en [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  process $176
    assign \boot_cr7_wr_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
      case 3'101
        assign \boot_cr7_wr_gt [31:0] \cr7_gt [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:67"
  process $177
    assign \fault [3:0] 4'0000
    switch { \load_fault [0] \save_fault [0] \fault_valid$233 [0] \call_fault [0] \tperm_fault [0] \lambda_fault [0] \fault_valid$229 [0] \fault_valid$228 [0] }
      case 8'-------1
        assign \fault [3:0] \fault$236 [3:0]
      case 8'------1-
        assign \fault [3:0] \fault_type [3:0]
      case 8'-----1--
        assign \fault [3:0] \fault_type$238 [3:0]
      case 8'----1---
        assign \fault [3:0] \fault_type$239 [3:0]
      case 8'---1----
        assign \fault [3:0] \fault_type$240 [3:0]
      case 8'--1-----
        assign \fault [3:0] \fault_type$241 [3:0]
      case 8'-1------
        assign \fault [3:0] \fault_type$242 [3:0]
      case 8'1-------
        assign \fault [3:0] \fault_type$243 [3:0]
      case
        assign \fault [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:68"
  process $178
    assign \fault_valid [0] 1'0
    switch { \load_fault [0] \save_fault [0] \fault_valid$233 [0] \call_fault [0] \tperm_fault [0] \lambda_fault [0] \fault_valid$229 [0] \fault_valid$228 [0] }
      case 8'-------1
        assign \fault_valid [0] 1'1
      case 8'------1-
        assign \fault_valid [0] 1'1
      case 8'-----1--
        assign \fault_valid [0] 1'1
      case 8'----1---
        assign \fault_valid [0] 1'1
      case 8'---1----
        assign \fault_valid [0] 1'1
      case 8'--1-----
        assign \fault_valid [0] 1'1
      case 8'-1------
        assign \fault_valid [0] 1'1
      case 8'1-------
        assign \fault_valid [0] 1'1
      case
        assign \fault_valid [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:12"
  process $179
    assign \sub_start [0] 1'0
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_start [0] \mload_start [0]
      case 3'-1-
        assign \sub_start [0] \mload_start$262 [0]
      case 3'1--
        assign \sub_start [0] \mload_start$269 [0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:13"
  process $180
    assign \sub_cr_src [3:0] 4'0000
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_cr_src [3:0] \mload_cr_src [3:0]
      case 3'-1-
        assign \sub_cr_src [3:0] 4'0000
      case 3'1--
        assign \sub_cr_src [3:0] \imem_data [18:15]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:14"
  process $181
    assign \sub_cr_dst [3:0] 4'0000
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_cr_dst [3:0] { 1'0 $59 [2:0] }
      case 3'-1-
        assign \sub_cr_dst [3:0] \mload_cr_dst$264 [3:0]
      case 3'1--
        assign \sub_cr_dst [3:0] \imem_data [22:19]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:15"
  process $182
    assign \sub_index [16:0] 17'00000000000000000
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_index [16:0] \mload_index [16:0]
      case 3'-1-
        assign \sub_index [16:0] 17'00000000000000000
      case 3'1--
        assign \sub_index [16:0] { 2'00 \imem_data [14:0] }
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:16"
  process $183
    assign \sub_direct [0] 1'0
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_direct [0] 1'0
      case 3'-1-
        assign \sub_direct [0] 1'1
      case 3'1--
        assign \sub_direct [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:17"
  process $184
    assign \sub_direct_gt [31:0] 32'00000000000000000000000000000000
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_direct_gt [31:0] 32'00000000000000000000000000000000
      case 3'-1-
        assign \sub_direct_gt [31:0] \mload_direct_gt$267 [31:0]
      case 3'1--
        assign \sub_direct_gt [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:18"
  process $185
    assign \sub_m_elevated [0] 1'0
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_m_elevated [0] 1'1
      case 3'-1-
        assign \sub_m_elevated [0] 1'1
      case 3'1--
        assign \sub_m_elevated [0] \mload_m_elevated$275 [0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:41"
  process $186
    assign \dmem_addr [31:0] 32'00000000000000000000000000000000
    switch { \mem_rd_en$292 [0] \mem_wr_en$291 [0] $49 [0] }
      case 3'--1
        assign \dmem_addr [31:0] \mem_addr [31:0]
      case 3'-1-
        assign \dmem_addr [31:0] \mem_wr_addr [31:0]
      case 3'1--
        assign \dmem_addr [31:0] \mem_rd_addr [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:42"
  process $187
    assign \dmem_rd_en [0] 1'0
    switch { \mem_rd_en$292 [0] \mem_wr_en$291 [0] $49 [0] }
      case 3'--1
        assign \dmem_rd_en [0] \mem_rd_en [0]
      case 3'-1-
      case 3'1--
        assign \dmem_rd_en [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:44"
  process $188
    assign \dmem_wr_data [31:0] 32'00000000000000000000000000000000
    switch { \mem_rd_en$292 [0] \mem_wr_en$291 [0] $49 [0] }
      case 3'--1
        assign \dmem_wr_data [31:0] 32'00000000000000000000000000000000
      case 3'-1-
        assign \dmem_wr_data [31:0] \mem_wr_data$296 [31:0]
      case 3'1--
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:45"
  process $189
    assign \dmem_wr_en [0] 1'0
    switch { \mem_rd_en$292 [0] \mem_wr_en$291 [0] $49 [0] }
      case 3'--1
        assign \dmem_wr_en [0] 1'0
      case 3'-1-
        assign \dmem_wr_en [0] 1'1
      case 3'1--
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:118"
  process $190
    assign $55 [2:0] \boot_state [2:0]
    switch \boot_state [2:0]
      case 3'000
        switch \boot_start [0]
          case 1'1
            assign $55 [2:0] 3'001
        end
      case 3'001
        assign $55 [2:0] 3'010
      case 3'010
        assign $55 [2:0] 3'011
      case 3'011
        assign $55 [2:0] 3'100
      case 3'100
        assign $55 [2:0] 3'101
      case 3'101
        assign $55 [2:0] 3'110
      case 3'110
        assign $55 [2:0] 3'110
    end
    switch { $51 [0] \nia_set$302 [0] \nia_set$301 [0] \nia_set [0] \clear_all [0] \reboot_request [0] }
      case 6'-----1
        assign $55 [2:0] 3'001
      case 6'----1-
      case 6'---1--
      case 6'--1---
      case 6'-1----
      case 6'1-----
    end
    switch \rst [0]
      case 1'1
        assign $55 [2:0] 3'000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:118"
  cell $dff $191
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $55 [2:0]
    connect \CLK \clk [0]
    connect \Q \boot_state
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:113"
  process $192
    assign $56 [31:0] \imem_addr [31:0]
    switch { $51 [0] \nia_set$302 [0] \nia_set$301 [0] \nia_set [0] \clear_all [0] \reboot_request [0] }
      case 6'-----1
        assign $56 [31:0] 32'00000000000000000000000000000000
      case 6'----1-
        assign $56 [31:0] 32'00000000000000000000000000000000
      case 6'---1--
        assign $56 [31:0] \nia_value [31:0]
      case 6'--1---
        assign $56 [31:0] \nia_value$304 [31:0]
      case 6'-1----
        assign $56 [31:0] 32'00000000000000000000000000000000
      case 6'1-----
        assign $56 [31:0] $52 [31:0]
    end
    switch \rst [0]
      case 1'1
        assign $56 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:113"
  cell $dff $193
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $56 [31:0]
    connect \CLK \clk [0]
    connect \Q \imem_addr
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:115"
  process $194
    assign $57 [0] \lambda_active [0]
    switch { $54 [0] \lambda_clear [0] \clear_all [0] }
      case 3'--1
        assign $57 [0] 1'0
      case 3'-1-
        assign $57 [0] 1'0
      case 3'1--
        assign $57 [0] 1'1
    end
    switch \rst [0]
      case 1'1
        assign $57 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:115"
  cell $dff $195
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $57 [0]
    connect \CLK \clk [0]
    connect \Q \lambda_active
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:116"
  process $196
    assign $58 [31:0] \lambda_pc [31:0]
    switch { $54 [0] \lambda_clear [0] \clear_all [0] }
      case 3'--1
        assign $58 [31:0] 32'00000000000000000000000000000000
      case 3'-1-
      case 3'1--
        assign $58 [31:0] $36 [31:0]
    end
    switch \rst [0]
      case 1'1
        assign $58 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:116"
  cell $dff $197
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $58 [31:0]
    connect \CLK \clk [0]
    connect \Q \lambda_pc
  end

connect \boot_state_reg \boot_state [2:0]
connect \instruction \imem_data [31:0]
connect \flags$27 \flags [3:0]
connect \church_op \imem_data [31:27]
connect \cr_src \imem_data [18:15]
connect \perm_gt_sig \cr_rd_data [31:0]
connect \gt_in \cr_rd_data [31:0]
connect \required_perms$53 \required_perms [5:0]
connect \cr_rd_data_gt \cr_rd_data [31:0]
connect \clist_addr 32'00000000000000000000000000000000
connect \clist_rd_en 1'0
connect \clist_wr_data \cr_rd_data [31:0]
connect \clist_wr_en 1'0
connect \flags_in 4'0000
connect \flags_wr_en 1'0
connect \clear_all$63 \clear_all [0]
connect \dr_wr_addr 4'0000
connect \dr_wr_data 32'00000000000000000000000000000000
connect \dr_wr_en 1'0
connect \cr_wr_en$71 1'0
connect \cr_wr_addr$72 4'0000
connect \cr_wr_data$77 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \nia_reg \imem_addr [31:0]
connect \flags$83 \flags [3:0]
connect \boot_cr0_wr_en 1'0
connect \rt_cr0_wr_en 1'0
connect \rt_cr0_wr_gt 32'00000000000000000000000000000000
connect \boot_cr0_wr_gt 32'00000000000000000000000000000000
connect \boot_cr1_wr_en 1'0
connect \rt_cr1_wr_en 1'0
connect \rt_cr1_wr_gt 32'00000000000000000000000000000000
connect \boot_cr1_wr_gt 32'00000000000000000000000000000000
connect \boot_cr2_wr_en 1'0
connect \rt_cr2_wr_en 1'0
connect \rt_cr2_wr_gt 32'00000000000000000000000000000000
connect \boot_cr2_wr_gt 32'00000000000000000000000000000000
connect \boot_cr3_wr_en 1'0
connect \rt_cr3_wr_en 1'0
connect \rt_cr3_wr_gt 32'00000000000000000000000000000000
connect \boot_cr3_wr_gt 32'00000000000000000000000000000000
connect \boot_cr4_wr_en 1'0
connect \rt_cr4_wr_en 1'0
connect \rt_cr4_wr_gt 32'00000000000000000000000000000000
connect \boot_cr4_wr_gt 32'00000000000000000000000000000000
connect \boot_cr5_wr_en 1'0
connect \rt_cr5_wr_en 1'0
connect \rt_cr5_wr_gt 32'00000000000000000000000000000000
connect \boot_cr5_wr_gt 32'00000000000000000000000000000000
connect \rt_cr6_wr_en 1'0
connect \rt_cr6_wr_gt 32'00000000000000000000000000000000
connect \rt_cr7_wr_en 1'0
connect \rt_cr7_wr_gt 32'00000000000000000000000000000000
connect \rt_cr8_wr_en 1'0
connect \rt_cr8_wr_gt 32'00000000000000000000000000000000
connect \boot_cr9_wr_en 1'0
connect \rt_cr9_wr_en 1'0
connect \rt_cr9_wr_gt 32'00000000000000000000000000000000
connect \boot_cr9_wr_gt 32'00000000000000000000000000000000
connect \boot_cr10_wr_en 1'0
connect \rt_cr10_wr_en 1'0
connect \rt_cr10_wr_gt 32'00000000000000000000000000000000
connect \boot_cr10_wr_gt 32'00000000000000000000000000000000
connect \boot_cr11_wr_en 1'0
connect \rt_cr11_wr_en 1'0
connect \rt_cr11_wr_gt 32'00000000000000000000000000000000
connect \boot_cr11_wr_gt 32'00000000000000000000000000000000
connect \boot_cr12_wr_en 1'0
connect \rt_cr12_wr_en 1'0
connect \rt_cr12_wr_gt 32'00000000000000000000000000000000
connect \boot_cr12_wr_gt 32'00000000000000000000000000000000
connect \boot_cr13_wr_en 1'0
connect \rt_cr13_wr_en 1'0
connect \rt_cr13_wr_gt 32'00000000000000000000000000000000
connect \boot_cr13_wr_gt 32'00000000000000000000000000000000
connect \boot_cr14_wr_en 1'0
connect \rt_cr14_wr_en 1'0
connect \rt_cr14_wr_gt 32'00000000000000000000000000000000
connect \boot_cr14_wr_gt 32'00000000000000000000000000000000
connect \rt_cr15_wr_en 1'0
connect \rt_cr15_wr_gt 32'00000000000000000000000000000000
connect \call_start \call_start_sig [0]
connect \cr_src$187 \imem_data [18:15]
connect \index { 2'00 \imem_data [14:0] }
connect \cap_index \imem_data [14:0]
connect \mask { 1'0 \imem_data [14:0] }
connect \call_mask \imem_data [14:0]
connect \cr_rd_data$192 \cr_rd_data [127:0]
connect \return_start \ret_start_sig [0]
connect \cr_src$195 \imem_data [17:15]
connect \cr_rd_data$196 \cr_rd_data [127:0]
connect \lambda_active_reg \lambda_active [0]
connect \lambda_pc_reg \lambda_pc [31:0]
connect \lambda_start \lambda_start_sig [0]
connect \cr_target \imem_data [22:19]
connect \cr_dst \imem_data [22:19]
connect \cr_rd_data$204 \cr_rd_data [127:0]
connect \saved_nia $36 [31:0]
connect \tperm_start \tperm_start_sig [0]
connect \cr_target$208 \imem_data [22:19]
connect \preset \imem_data [3:0]
connect \tperm_preset \imem_data [3:0]
connect \cr_rd_data$211 \cr_rd_data [127:0]
connect \save_start \save_start_sig [0]
connect \cr_src$214 \imem_data [18:15]
connect \cr_dst$215 \imem_data [22:19]
connect \index$216 { 2'00 \imem_data [14:0] }
connect \cr_rd_data$217 \cr_rd_data [127:0]
connect \cr15_namespace$219 \cr15_namespace [127:0]
connect \mem_wr_done 1'1
connect \mem_rd_data \dmem_rd_data [31:0]
connect \mem_rd_valid 1'1
connect \load_start \load_start_sig [0]
connect \cr_src$225 \imem_data [18:15]
connect \cr_dst$226 \imem_data [22:19]
connect \index$227 { 2'00 \imem_data [14:0] }
connect \cr_rd_data$244 \cr_rd_data [127:0]
connect \cr15_namespace$245 \cr15_namespace [127:0]
connect \mem_rd_data$246 \dmem_rd_data [31:0]
connect \mem_rd_valid$247 1'1
connect \mload_cr_dst { 1'0 $59 [2:0] }
connect \mload_direct 1'0
connect \mload_direct_gt 32'00000000000000000000000000000000
connect \mload_m_elevated 1'1
connect \mload_cr_src$263 4'0000
connect \mload_index$265 17'00000000000000000
connect \mload_direct$266 1'1
connect \mload_m_elevated$268 1'1
connect \mload_cr_src$270 \imem_data [18:15]
connect \mload_cr_dst$271 \imem_data [22:19]
connect \mload_index$272 { 2'00 \imem_data [14:0] }
connect \mload_direct$273 1'0
connect \mload_direct_gt$274 32'00000000000000000000000000000000
connect \sub_done \mload_done [0]
connect \sub_fault \mload_fault [0]
connect \mload_fault_type \fault_type$243 [3:0]
connect \sub_fault_type \fault_type$243 [3:0]
connect \mload_done$282 \mload_done [0]
connect \mload_fault$283 \mload_fault [0]
connect \mload_fault_type$284 \fault_type$243 [3:0]
connect \mload_busy \sub_busy [0]
connect \mload_done$286 \mload_done [0]
connect \mload_fault$287 \mload_fault [0]
connect \mload_fault_type$288 \fault_type$243 [3:0]
connect \mem_wr_en 1'0
connect \mem_wr_data 32'00000000000000000000000000000000
connect \ns_wr_data 96'000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \nia_value$305 32'00000000000000000000000000000000
connect \ns_addr 32'00000000000000000000000000000000
connect \ns_rd_en 1'0
connect \ns_wr_en 1'0
connect \gc_busy 1'0
connect \gc_garbage_count 32'00000000000000000000000000000000
connect \nia \imem_addr [31:0]
connect \flags.N \flags [0]
connect \flags.Z \flags [1]
connect \flags.C \flags [2]
connect \flags.V \flags [3]
connect \flags$27.N \flags [0]
connect \flags$27.Z \flags [1]
connect \flags$27.C \flags [2]
connect \flags$27.V \flags [3]
connect \perm_gt_sig.gt_type \cr_rd_data [1:0]
connect \perm_gt_sig.perms \cr_rd_data [7:2]
connect \perm_gt_sig.index \cr_rd_data [24:8]
connect \perm_gt_sig.version \cr_rd_data [31:25]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]
connect \gt_in.gt_type \cr_rd_data [1:0]
connect \gt_in.perms \cr_rd_data [7:2]
connect \gt_in.index \cr_rd_data [24:8]
connect \gt_in.version \cr_rd_data [31:25]
connect \cr_rd_data_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data_gt.index \cr_rd_data [24:8]
connect \cr_rd_data_gt.version \cr_rd_data [31:25]
connect \clist_wr_data.gt_type \cr_rd_data [1:0]
connect \clist_wr_data.perms \cr_rd_data [7:2]
connect \clist_wr_data.index \cr_rd_data [24:8]
connect \clist_wr_data.version \cr_rd_data [31:25]
connect \flags_in.N 1'0
connect \flags_in.Z 1'0
connect \flags_in.C 1'0
connect \flags_in.V 1'0
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \cr_wr_data$77.word0_gt 32'00000000000000000000000000000000
connect \cr_wr_data$77.word0_gt.gt_type 2'00
connect \cr_wr_data$77.word0_gt.perms 6'000000
connect \cr_wr_data$77.word0_gt.index 17'00000000000000000
connect \cr_wr_data$77.word0_gt.version 7'0000000
connect \cr_wr_data$77.word1_location 32'00000000000000000000000000000000
connect \cr_wr_data$77.word2_limit 32'00000000000000000000000000000000
connect \cr_wr_data$77.word3_seals 32'00000000000000000000000000000000
connect \cr_wr_data$78.word0_gt \cr_wr_data$78 [31:0]
connect \cr_wr_data$78.word0_gt.gt_type \cr_wr_data$78 [1:0]
connect \cr_wr_data$78.word0_gt.perms \cr_wr_data$78 [7:2]
connect \cr_wr_data$78.word0_gt.index \cr_wr_data$78 [24:8]
connect \cr_wr_data$78.word0_gt.version \cr_wr_data$78 [31:25]
connect \cr_wr_data$78.word1_location \cr_wr_data$78 [63:32]
connect \cr_wr_data$78.word2_limit \cr_wr_data$78 [95:64]
connect \cr_wr_data$78.word3_seals \cr_wr_data$78 [127:96]
connect \cr_wr_data$79.word0_gt \cr_wr_data$79 [31:0]
connect \cr_wr_data$79.word0_gt.gt_type \cr_wr_data$79 [1:0]
connect \cr_wr_data$79.word0_gt.perms \cr_wr_data$79 [7:2]
connect \cr_wr_data$79.word0_gt.index \cr_wr_data$79 [24:8]
connect \cr_wr_data$79.word0_gt.version \cr_wr_data$79 [31:25]
connect \cr_wr_data$79.word1_location \cr_wr_data$79 [63:32]
connect \cr_wr_data$79.word2_limit \cr_wr_data$79 [95:64]
connect \cr_wr_data$79.word3_seals \cr_wr_data$79 [127:96]
connect \cr_wr_data$80.word0_gt \cr_wr_data$80 [31:0]
connect \cr_wr_data$80.word0_gt.gt_type \cr_wr_data$80 [1:0]
connect \cr_wr_data$80.word0_gt.perms \cr_wr_data$80 [7:2]
connect \cr_wr_data$80.word0_gt.index \cr_wr_data$80 [24:8]
connect \cr_wr_data$80.word0_gt.version \cr_wr_data$80 [31:25]
connect \cr_wr_data$80.word1_location \cr_wr_data$80 [63:32]
connect \cr_wr_data$80.word2_limit \cr_wr_data$80 [95:64]
connect \cr_wr_data$80.word3_seals \cr_wr_data$80 [127:96]
connect \flags$83.N \flags [0]
connect \flags$83.Z \flags [1]
connect \flags$83.C \flags [2]
connect \flags$83.V \flags [3]
connect \ns_gt.gt_type \ns_gt [1:0]
connect \ns_gt.perms \ns_gt [7:2]
connect \ns_gt.index \ns_gt [24:8]
connect \ns_gt.version \ns_gt [31:25]
connect \boot_cr15_wr_gt.gt_type \boot_cr15_wr_gt [1:0]
connect \boot_cr15_wr_gt.perms \boot_cr15_wr_gt [7:2]
connect \boot_cr15_wr_gt.index \boot_cr15_wr_gt [24:8]
connect \boot_cr15_wr_gt.version \boot_cr15_wr_gt [31:25]
connect \thrd_gt.gt_type \thrd_gt [1:0]
connect \thrd_gt.perms \thrd_gt [7:2]
connect \thrd_gt.index \thrd_gt [24:8]
connect \thrd_gt.version \thrd_gt [31:25]
connect \boot_cr8_wr_gt.gt_type \boot_cr8_wr_gt [1:0]
connect \boot_cr8_wr_gt.perms \boot_cr8_wr_gt [7:2]
connect \boot_cr8_wr_gt.index \boot_cr8_wr_gt [24:8]
connect \boot_cr8_wr_gt.version \boot_cr8_wr_gt [31:25]
connect \cr6_gt.gt_type \cr6_gt [1:0]
connect \cr6_gt.perms \cr6_gt [7:2]
connect \cr6_gt.index \cr6_gt [24:8]
connect \cr6_gt.version \cr6_gt [31:25]
connect \boot_cr6_wr_gt.gt_type \boot_cr6_wr_gt [1:0]
connect \boot_cr6_wr_gt.perms \boot_cr6_wr_gt [7:2]
connect \boot_cr6_wr_gt.index \boot_cr6_wr_gt [24:8]
connect \boot_cr6_wr_gt.version \boot_cr6_wr_gt [31:25]
connect \slot3_gt.gt_type \slot3_gt [1:0]
connect \slot3_gt.perms \slot3_gt [7:2]
connect \slot3_gt.index \slot3_gt [24:8]
connect \slot3_gt.version \slot3_gt [31:25]
connect \cr7_gt.gt_type \cr7_gt [1:0]
connect \cr7_gt.perms \cr7_gt [7:2]
connect \cr7_gt.index \cr7_gt [24:8]
connect \cr7_gt.version \cr7_gt [31:25]
connect \boot_cr7_wr_gt.gt_type \boot_cr7_wr_gt [1:0]
connect \boot_cr7_wr_gt.perms \boot_cr7_wr_gt [7:2]
connect \boot_cr7_wr_gt.index \boot_cr7_wr_gt [24:8]
connect \boot_cr7_wr_gt.version \boot_cr7_wr_gt [31:25]
connect \cr0_gt_wr_data.gt_type \cr0_gt_wr_data [1:0]
connect \cr0_gt_wr_data.perms \cr0_gt_wr_data [7:2]
connect \cr0_gt_wr_data.index \cr0_gt_wr_data [24:8]
connect \cr0_gt_wr_data.version \cr0_gt_wr_data [31:25]
connect \rt_cr0_wr_gt.gt_type 2'00
connect \rt_cr0_wr_gt.perms 6'000000
connect \rt_cr0_wr_gt.index 17'00000000000000000
connect \rt_cr0_wr_gt.version 7'0000000
connect \boot_cr0_wr_gt.gt_type 2'00
connect \boot_cr0_wr_gt.perms 6'000000
connect \boot_cr0_wr_gt.index 17'00000000000000000
connect \boot_cr0_wr_gt.version 7'0000000
connect \cr1_gt_wr_data.gt_type \cr1_gt_wr_data [1:0]
connect \cr1_gt_wr_data.perms \cr1_gt_wr_data [7:2]
connect \cr1_gt_wr_data.index \cr1_gt_wr_data [24:8]
connect \cr1_gt_wr_data.version \cr1_gt_wr_data [31:25]
connect \rt_cr1_wr_gt.gt_type 2'00
connect \rt_cr1_wr_gt.perms 6'000000
connect \rt_cr1_wr_gt.index 17'00000000000000000
connect \rt_cr1_wr_gt.version 7'0000000
connect \boot_cr1_wr_gt.gt_type 2'00
connect \boot_cr1_wr_gt.perms 6'000000
connect \boot_cr1_wr_gt.index 17'00000000000000000
connect \boot_cr1_wr_gt.version 7'0000000
connect \cr2_gt_wr_data.gt_type \cr2_gt_wr_data [1:0]
connect \cr2_gt_wr_data.perms \cr2_gt_wr_data [7:2]
connect \cr2_gt_wr_data.index \cr2_gt_wr_data [24:8]
connect \cr2_gt_wr_data.version \cr2_gt_wr_data [31:25]
connect \rt_cr2_wr_gt.gt_type 2'00
connect \rt_cr2_wr_gt.perms 6'000000
connect \rt_cr2_wr_gt.index 17'00000000000000000
connect \rt_cr2_wr_gt.version 7'0000000
connect \boot_cr2_wr_gt.gt_type 2'00
connect \boot_cr2_wr_gt.perms 6'000000
connect \boot_cr2_wr_gt.index 17'00000000000000000
connect \boot_cr2_wr_gt.version 7'0000000
connect \cr3_gt_wr_data.gt_type \cr3_gt_wr_data [1:0]
connect \cr3_gt_wr_data.perms \cr3_gt_wr_data [7:2]
connect \cr3_gt_wr_data.index \cr3_gt_wr_data [24:8]
connect \cr3_gt_wr_data.version \cr3_gt_wr_data [31:25]
connect \rt_cr3_wr_gt.gt_type 2'00
connect \rt_cr3_wr_gt.perms 6'000000
connect \rt_cr3_wr_gt.index 17'00000000000000000
connect \rt_cr3_wr_gt.version 7'0000000
connect \boot_cr3_wr_gt.gt_type 2'00
connect \boot_cr3_wr_gt.perms 6'000000
connect \boot_cr3_wr_gt.index 17'00000000000000000
connect \boot_cr3_wr_gt.version 7'0000000
connect \cr4_gt_wr_data.gt_type \cr4_gt_wr_data [1:0]
connect \cr4_gt_wr_data.perms \cr4_gt_wr_data [7:2]
connect \cr4_gt_wr_data.index \cr4_gt_wr_data [24:8]
connect \cr4_gt_wr_data.version \cr4_gt_wr_data [31:25]
connect \rt_cr4_wr_gt.gt_type 2'00
connect \rt_cr4_wr_gt.perms 6'000000
connect \rt_cr4_wr_gt.index 17'00000000000000000
connect \rt_cr4_wr_gt.version 7'0000000
connect \boot_cr4_wr_gt.gt_type 2'00
connect \boot_cr4_wr_gt.perms 6'000000
connect \boot_cr4_wr_gt.index 17'00000000000000000
connect \boot_cr4_wr_gt.version 7'0000000
connect \cr5_gt_wr_data.gt_type \cr5_gt_wr_data [1:0]
connect \cr5_gt_wr_data.perms \cr5_gt_wr_data [7:2]
connect \cr5_gt_wr_data.index \cr5_gt_wr_data [24:8]
connect \cr5_gt_wr_data.version \cr5_gt_wr_data [31:25]
connect \rt_cr5_wr_gt.gt_type 2'00
connect \rt_cr5_wr_gt.perms 6'000000
connect \rt_cr5_wr_gt.index 17'00000000000000000
connect \rt_cr5_wr_gt.version 7'0000000
connect \boot_cr5_wr_gt.gt_type 2'00
connect \boot_cr5_wr_gt.perms 6'000000
connect \boot_cr5_wr_gt.index 17'00000000000000000
connect \boot_cr5_wr_gt.version 7'0000000
connect \cr6_gt_wr_data.gt_type \cr6_gt_wr_data [1:0]
connect \cr6_gt_wr_data.perms \cr6_gt_wr_data [7:2]
connect \cr6_gt_wr_data.index \cr6_gt_wr_data [24:8]
connect \cr6_gt_wr_data.version \cr6_gt_wr_data [31:25]
connect \rt_cr6_wr_gt.gt_type 2'00
connect \rt_cr6_wr_gt.perms 6'000000
connect \rt_cr6_wr_gt.index 17'00000000000000000
connect \rt_cr6_wr_gt.version 7'0000000
connect \cr7_gt_wr_data.gt_type \cr7_gt_wr_data [1:0]
connect \cr7_gt_wr_data.perms \cr7_gt_wr_data [7:2]
connect \cr7_gt_wr_data.index \cr7_gt_wr_data [24:8]
connect \cr7_gt_wr_data.version \cr7_gt_wr_data [31:25]
connect \rt_cr7_wr_gt.gt_type 2'00
connect \rt_cr7_wr_gt.perms 6'000000
connect \rt_cr7_wr_gt.index 17'00000000000000000
connect \rt_cr7_wr_gt.version 7'0000000
connect \cr8_gt_wr_data.gt_type \cr8_gt_wr_data [1:0]
connect \cr8_gt_wr_data.perms \cr8_gt_wr_data [7:2]
connect \cr8_gt_wr_data.index \cr8_gt_wr_data [24:8]
connect \cr8_gt_wr_data.version \cr8_gt_wr_data [31:25]
connect \rt_cr8_wr_gt.gt_type 2'00
connect \rt_cr8_wr_gt.perms 6'000000
connect \rt_cr8_wr_gt.index 17'00000000000000000
connect \rt_cr8_wr_gt.version 7'0000000
connect \cr9_gt_wr_data.gt_type \cr9_gt_wr_data [1:0]
connect \cr9_gt_wr_data.perms \cr9_gt_wr_data [7:2]
connect \cr9_gt_wr_data.index \cr9_gt_wr_data [24:8]
connect \cr9_gt_wr_data.version \cr9_gt_wr_data [31:25]
connect \rt_cr9_wr_gt.gt_type 2'00
connect \rt_cr9_wr_gt.perms 6'000000
connect \rt_cr9_wr_gt.index 17'00000000000000000
connect \rt_cr9_wr_gt.version 7'0000000
connect \boot_cr9_wr_gt.gt_type 2'00
connect \boot_cr9_wr_gt.perms 6'000000
connect \boot_cr9_wr_gt.index 17'00000000000000000
connect \boot_cr9_wr_gt.version 7'0000000
connect \cr10_gt_wr_data.gt_type \cr10_gt_wr_data [1:0]
connect \cr10_gt_wr_data.perms \cr10_gt_wr_data [7:2]
connect \cr10_gt_wr_data.index \cr10_gt_wr_data [24:8]
connect \cr10_gt_wr_data.version \cr10_gt_wr_data [31:25]
connect \rt_cr10_wr_gt.gt_type 2'00
connect \rt_cr10_wr_gt.perms 6'000000
connect \rt_cr10_wr_gt.index 17'00000000000000000
connect \rt_cr10_wr_gt.version 7'0000000
connect \boot_cr10_wr_gt.gt_type 2'00
connect \boot_cr10_wr_gt.perms 6'000000
connect \boot_cr10_wr_gt.index 17'00000000000000000
connect \boot_cr10_wr_gt.version 7'0000000
connect \cr11_gt_wr_data.gt_type \cr11_gt_wr_data [1:0]
connect \cr11_gt_wr_data.perms \cr11_gt_wr_data [7:2]
connect \cr11_gt_wr_data.index \cr11_gt_wr_data [24:8]
connect \cr11_gt_wr_data.version \cr11_gt_wr_data [31:25]
connect \rt_cr11_wr_gt.gt_type 2'00
connect \rt_cr11_wr_gt.perms 6'000000
connect \rt_cr11_wr_gt.index 17'00000000000000000
connect \rt_cr11_wr_gt.version 7'0000000
connect \boot_cr11_wr_gt.gt_type 2'00
connect \boot_cr11_wr_gt.perms 6'000000
connect \boot_cr11_wr_gt.index 17'00000000000000000
connect \boot_cr11_wr_gt.version 7'0000000
connect \cr12_gt_wr_data.gt_type \cr12_gt_wr_data [1:0]
connect \cr12_gt_wr_data.perms \cr12_gt_wr_data [7:2]
connect \cr12_gt_wr_data.index \cr12_gt_wr_data [24:8]
connect \cr12_gt_wr_data.version \cr12_gt_wr_data [31:25]
connect \rt_cr12_wr_gt.gt_type 2'00
connect \rt_cr12_wr_gt.perms 6'000000
connect \rt_cr12_wr_gt.index 17'00000000000000000
connect \rt_cr12_wr_gt.version 7'0000000
connect \boot_cr12_wr_gt.gt_type 2'00
connect \boot_cr12_wr_gt.perms 6'000000
connect \boot_cr12_wr_gt.index 17'00000000000000000
connect \boot_cr12_wr_gt.version 7'0000000
connect \cr13_gt_wr_data.gt_type \cr13_gt_wr_data [1:0]
connect \cr13_gt_wr_data.perms \cr13_gt_wr_data [7:2]
connect \cr13_gt_wr_data.index \cr13_gt_wr_data [24:8]
connect \cr13_gt_wr_data.version \cr13_gt_wr_data [31:25]
connect \rt_cr13_wr_gt.gt_type 2'00
connect \rt_cr13_wr_gt.perms 6'000000
connect \rt_cr13_wr_gt.index 17'00000000000000000
connect \rt_cr13_wr_gt.version 7'0000000
connect \boot_cr13_wr_gt.gt_type 2'00
connect \boot_cr13_wr_gt.perms 6'000000
connect \boot_cr13_wr_gt.index 17'00000000000000000
connect \boot_cr13_wr_gt.version 7'0000000
connect \cr14_gt_wr_data.gt_type \cr14_gt_wr_data [1:0]
connect \cr14_gt_wr_data.perms \cr14_gt_wr_data [7:2]
connect \cr14_gt_wr_data.index \cr14_gt_wr_data [24:8]
connect \cr14_gt_wr_data.version \cr14_gt_wr_data [31:25]
connect \rt_cr14_wr_gt.gt_type 2'00
connect \rt_cr14_wr_gt.perms 6'000000
connect \rt_cr14_wr_gt.index 17'00000000000000000
connect \rt_cr14_wr_gt.version 7'0000000
connect \boot_cr14_wr_gt.gt_type 2'00
connect \boot_cr14_wr_gt.perms 6'000000
connect \boot_cr14_wr_gt.index 17'00000000000000000
connect \boot_cr14_wr_gt.version 7'0000000
connect \cr15_gt_wr_data.gt_type \cr15_gt_wr_data [1:0]
connect \cr15_gt_wr_data.perms \cr15_gt_wr_data [7:2]
connect \cr15_gt_wr_data.index \cr15_gt_wr_data [24:8]
connect \cr15_gt_wr_data.version \cr15_gt_wr_data [31:25]
connect \rt_cr15_wr_gt.gt_type 2'00
connect \rt_cr15_wr_gt.perms 6'000000
connect \rt_cr15_wr_gt.index 17'00000000000000000
connect \rt_cr15_wr_gt.version 7'0000000
connect \cr_rd_data$192.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$192.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$192.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$192.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$192.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$192.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$192.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$192.word3_seals \cr_rd_data [127:96]
connect \cr_rd_data$196.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$196.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$196.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$196.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$196.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$196.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$196.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$196.word3_seals \cr_rd_data [127:96]
connect \cr_rd_data$204.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$204.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$204.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$204.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$204.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$204.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$204.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$204.word3_seals \cr_rd_data [127:96]
connect \cr_rd_data$211.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$211.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$211.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$211.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$211.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$211.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$211.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$211.word3_seals \cr_rd_data [127:96]
connect \cr_rd_data$217.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$217.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$217.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$217.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$217.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$217.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$217.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$217.word3_seals \cr_rd_data [127:96]
connect \cr15_namespace.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace.word1_location \cr15_namespace [63:32]
connect \cr15_namespace.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace.word3_seals \cr15_namespace [127:96]
connect \cr15_namespace$219.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace$219.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace$219.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace$219.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace$219.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace$219.word1_location \cr15_namespace [63:32]
connect \cr15_namespace$219.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace$219.word3_seals \cr15_namespace [127:96]
connect \cr_rd_data$244.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$244.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$244.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$244.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$244.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$244.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$244.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$244.word3_seals \cr_rd_data [127:96]
connect \cr15_namespace$245.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace$245.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace$245.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace$245.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace$245.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace$245.word1_location \cr15_namespace [63:32]
connect \cr15_namespace$245.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace$245.word3_seals \cr15_namespace [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/registers.py:59"
module \top.u_registers

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr0

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr1

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr2

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr3

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr4

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr5

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr6

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr7

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr8

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr9

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr10

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr11

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr12

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr13

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr14

  attribute \src "/home/runner/workspace/church_machine/registers.py:33"
  wire width 2 \cr_word_rd_sel

  attribute \src "/home/runner/workspace/church_machine/registers.py:34"
  wire width 32 \cr_word_rd_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:32"
  wire width 4 \cr_word_rd_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr6_clist

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr14_cloomc

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr8_thread

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/registers.py:45"
  wire width 32 \dr_rd_data1

  attribute \src "/home/runner/workspace/church_machine/registers.py:44"
  wire width 4 \dr_rd_addr1

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \dr0

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \dr1

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \dr2

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \dr3

  attribute \src "/home/runner/workspace/church_machine/registers.py:47"
  wire width 32 \dr_rd_data2

  attribute \src "/home/runner/workspace/church_machine/registers.py:46"
  wire width 4 \dr_rd_addr2

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  attribute \init 4'0000
  wire width 4 \flags_reg

  attribute \src "/home/runner/workspace/church_machine/registers.py:30"
  wire width 1 \cr_word_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:28"
  wire width 2 \cr_word_sel

  attribute \src "/home/runner/workspace/church_machine/registers.py:27"
  wire width 4 \cr_word_wr_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:29"
  wire width 32 \cr_word_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:50"
  wire width 1 \dr_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:48"
  wire width 4 \dr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:49"
  wire width 32 \dr_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:54"
  wire width 1 \flags_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 4 \flags_in

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/registers.py:56"
  wire width 1 input 2  \clear_all

  attribute \src "/home/runner/workspace/church_machine/registers.py:20"
  wire width 4 input 3  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:23"
  wire width 4 input 4  \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 128 input 5  \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:25"
  wire width 1 input 6  \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 7  \cr0_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 8  \cr0_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 9  \cr1_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 10  \cr1_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 11  \cr2_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 12  \cr2_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 13  \cr3_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 14  \cr3_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 15  \cr4_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 16  \cr4_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 17  \cr5_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 18  \cr5_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 19  \cr6_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 20  \cr6_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 21  \cr7_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 22  \cr7_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 23  \cr8_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 24  \cr8_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 25  \cr9_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 26  \cr9_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 27  \cr10_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 28  \cr10_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 29  \cr11_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 30  \cr11_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 31  \cr12_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 32  \cr12_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 33  \cr13_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 34  \cr13_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 35  \cr14_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 36  \cr14_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 37  \cr15_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 38  \cr15_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 128 output 39  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 output 40  \cr15

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  attribute \init 4'0000
  wire width 4 output 41  \flags

  wire width 128 $1

  wire width 128 $2

  wire width 128 $3

  wire width 128 $4

  wire width 1 $5

  wire width 32 $6

  wire width 1 $7

  wire width 32 $8

  wire width 1 $9

  wire width 1 $10

  wire width 128 $11

  wire width 128 $12

  wire width 128 $13

  wire width 128 $14

  wire width 128 $15

  wire width 128 $16

  wire width 128 $17

  wire width 128 $18

  wire width 128 $19

  wire width 128 $20

  wire width 128 $21

  wire width 128 $22

  wire width 128 $23

  wire width 128 $24

  wire width 128 $25

  wire width 128 $26

  wire width 32 $27

  wire width 32 $28

  wire width 32 $29

  wire width 32 $30

  wire width 4 $31

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr0.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr0.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr0.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr0.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr0.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr0.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr0.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr0.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr1.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr1.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr1.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr1.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr1.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr1.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr1.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr1.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr2.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr2.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr2.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr2.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr2.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr2.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr2.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr2.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr3.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr3.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr3.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr3.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr3.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr3.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr3.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr3.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr4.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr4.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr4.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr4.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr4.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr4.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr4.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr4.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr5.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr5.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr5.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr5.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr5.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr5.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr5.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr5.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr6.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr6.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr6.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr6.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr6.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr6.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr6.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr6.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr7.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr7.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr7.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr7.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr7.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr7.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr7.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr7.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr8.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr8.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr8.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr8.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr8.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr8.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr8.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr8.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr9.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr9.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr9.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr9.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr9.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr9.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr9.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr9.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr10.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr10.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr10.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr10.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr10.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr10.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr10.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr10.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr11.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr11.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr11.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr11.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr11.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr11.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr11.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr11.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr12.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr12.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr12.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr12.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr12.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr12.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr12.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr12.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr13.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr13.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr13.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr13.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr13.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr13.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr13.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr13.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr14.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr14.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr14.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr14.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr14.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr14.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr14.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr14.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr15.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr15.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr15.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr15.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr15.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr15.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr15.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr15.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 32 \cr6_clist.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 2 \cr6_clist.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 6 \cr6_clist.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 17 \cr6_clist.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 7 \cr6_clist.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 32 \cr6_clist.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 32 \cr6_clist.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 32 \cr6_clist.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 32 \cr14_cloomc.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 2 \cr14_cloomc.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 6 \cr14_cloomc.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 17 \cr14_cloomc.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 7 \cr14_cloomc.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 32 \cr14_cloomc.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 32 \cr14_cloomc.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 32 \cr14_cloomc.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 32 \cr8_thread.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 2 \cr8_thread.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 6 \cr8_thread.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 17 \cr8_thread.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 7 \cr8_thread.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 32 \cr8_thread.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 32 \cr8_thread.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 32 \cr8_thread.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  wire width 1 \flags_reg.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  wire width 1 \flags_reg.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  wire width 1 \flags_reg.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  wire width 1 \flags_reg.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr0_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr0_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr0_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr0_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr1_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr1_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr1_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr1_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr2_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr2_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr2_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr2_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr3_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr3_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr3_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr3_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr4_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr4_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr4_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr4_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr5_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr5_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr5_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr5_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr6_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr6_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr6_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr6_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr7_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr7_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr7_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr7_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr8_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr8_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr8_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr8_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr9_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr9_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr9_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr9_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr10_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr10_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr10_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr10_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr11_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr11_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr11_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr11_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr12_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr12_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr12_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr12_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr13_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr13_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr13_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr13_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr14_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr14_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr14_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr14_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr15_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr15_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr15_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr15_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:65"
  process $32
    assign \cr_rd_data [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \cr_rd_addr [3:0]
      case 4'0000
        assign \cr_rd_data [127:0] \cr0 [127:0]
      case 4'0001
        assign \cr_rd_data [127:0] \cr1 [127:0]
      case 4'0010
        assign \cr_rd_data [127:0] \cr2 [127:0]
      case 4'0011
        assign \cr_rd_data [127:0] \cr3 [127:0]
      case 4'0100
        assign \cr_rd_data [127:0] \cr4 [127:0]
      case 4'0101
        assign \cr_rd_data [127:0] \cr5 [127:0]
      case 4'0110
        assign \cr_rd_data [127:0] \cr6 [127:0]
      case 4'0111
        assign \cr_rd_data [127:0] \cr7 [127:0]
      case 4'1000
        assign \cr_rd_data [127:0] \cr8 [127:0]
      case 4'1001
        assign \cr_rd_data [127:0] \cr9 [127:0]
      case 4'1010
        assign \cr_rd_data [127:0] \cr10 [127:0]
      case 4'1011
        assign \cr_rd_data [127:0] \cr11 [127:0]
      case 4'1100
        assign \cr_rd_data [127:0] \cr12 [127:0]
      case 4'1101
        assign \cr_rd_data [127:0] \cr13 [127:0]
      case 4'1110
        assign \cr_rd_data [127:0] \cr14 [127:0]
      case 4'1111
        assign \cr_rd_data [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:69"
  process $33
    assign $1 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $1 [127:0] \cr0 [127:0]
      case 4'0001
        assign $1 [127:0] \cr1 [127:0]
      case 4'0010
        assign $1 [127:0] \cr2 [127:0]
      case 4'0011
        assign $1 [127:0] \cr3 [127:0]
      case 4'0100
        assign $1 [127:0] \cr4 [127:0]
      case 4'0101
        assign $1 [127:0] \cr5 [127:0]
      case 4'0110
        assign $1 [127:0] \cr6 [127:0]
      case 4'0111
        assign $1 [127:0] \cr7 [127:0]
      case 4'1000
        assign $1 [127:0] \cr8 [127:0]
      case 4'1001
        assign $1 [127:0] \cr9 [127:0]
      case 4'1010
        assign $1 [127:0] \cr10 [127:0]
      case 4'1011
        assign $1 [127:0] \cr11 [127:0]
      case 4'1100
        assign $1 [127:0] \cr12 [127:0]
      case 4'1101
        assign $1 [127:0] \cr13 [127:0]
      case 4'1110
        assign $1 [127:0] \cr14 [127:0]
      case 4'1111
        assign $1 [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:71"
  process $34
    assign $2 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $2 [127:0] \cr0 [127:0]
      case 4'0001
        assign $2 [127:0] \cr1 [127:0]
      case 4'0010
        assign $2 [127:0] \cr2 [127:0]
      case 4'0011
        assign $2 [127:0] \cr3 [127:0]
      case 4'0100
        assign $2 [127:0] \cr4 [127:0]
      case 4'0101
        assign $2 [127:0] \cr5 [127:0]
      case 4'0110
        assign $2 [127:0] \cr6 [127:0]
      case 4'0111
        assign $2 [127:0] \cr7 [127:0]
      case 4'1000
        assign $2 [127:0] \cr8 [127:0]
      case 4'1001
        assign $2 [127:0] \cr9 [127:0]
      case 4'1010
        assign $2 [127:0] \cr10 [127:0]
      case 4'1011
        assign $2 [127:0] \cr11 [127:0]
      case 4'1100
        assign $2 [127:0] \cr12 [127:0]
      case 4'1101
        assign $2 [127:0] \cr13 [127:0]
      case 4'1110
        assign $2 [127:0] \cr14 [127:0]
      case 4'1111
        assign $2 [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:73"
  process $35
    assign $3 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $3 [127:0] \cr0 [127:0]
      case 4'0001
        assign $3 [127:0] \cr1 [127:0]
      case 4'0010
        assign $3 [127:0] \cr2 [127:0]
      case 4'0011
        assign $3 [127:0] \cr3 [127:0]
      case 4'0100
        assign $3 [127:0] \cr4 [127:0]
      case 4'0101
        assign $3 [127:0] \cr5 [127:0]
      case 4'0110
        assign $3 [127:0] \cr6 [127:0]
      case 4'0111
        assign $3 [127:0] \cr7 [127:0]
      case 4'1000
        assign $3 [127:0] \cr8 [127:0]
      case 4'1001
        assign $3 [127:0] \cr9 [127:0]
      case 4'1010
        assign $3 [127:0] \cr10 [127:0]
      case 4'1011
        assign $3 [127:0] \cr11 [127:0]
      case 4'1100
        assign $3 [127:0] \cr12 [127:0]
      case 4'1101
        assign $3 [127:0] \cr13 [127:0]
      case 4'1110
        assign $3 [127:0] \cr14 [127:0]
      case 4'1111
        assign $3 [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:75"
  process $36
    assign $4 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $4 [127:0] \cr0 [127:0]
      case 4'0001
        assign $4 [127:0] \cr1 [127:0]
      case 4'0010
        assign $4 [127:0] \cr2 [127:0]
      case 4'0011
        assign $4 [127:0] \cr3 [127:0]
      case 4'0100
        assign $4 [127:0] \cr4 [127:0]
      case 4'0101
        assign $4 [127:0] \cr5 [127:0]
      case 4'0110
        assign $4 [127:0] \cr6 [127:0]
      case 4'0111
        assign $4 [127:0] \cr7 [127:0]
      case 4'1000
        assign $4 [127:0] \cr8 [127:0]
      case 4'1001
        assign $4 [127:0] \cr9 [127:0]
      case 4'1010
        assign $4 [127:0] \cr10 [127:0]
      case 4'1011
        assign $4 [127:0] \cr11 [127:0]
      case 4'1100
        assign $4 [127:0] \cr12 [127:0]
      case 4'1101
        assign $4 [127:0] \cr13 [127:0]
      case 4'1110
        assign $4 [127:0] \cr14 [127:0]
      case 4'1111
        assign $4 [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:118"
  cell $eq $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:118"
  process $38
    assign $6 [31:0] 32'00000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $6 [31:0] \dr0 [31:0]
      case 4'0001
        assign $6 [31:0] \dr1 [31:0]
      case 4'0010
        assign $6 [31:0] \dr2 [31:0]
      case 4'0011
        assign $6 [31:0] \dr3 [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:118"
  cell $mux $39
    parameter \WIDTH 32
    connect \S $5 [0]
    connect \A $6 [31:0]
    connect \B 32'00000000000000000000000000000000
    connect \Y \dr_rd_data1
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:119"
  cell $eq $40
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:119"
  process $41
    assign $8 [31:0] 32'00000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $8 [31:0] \dr0 [31:0]
      case 4'0001
        assign $8 [31:0] \dr1 [31:0]
      case 4'0010
        assign $8 [31:0] \dr2 [31:0]
      case 4'0011
        assign $8 [31:0] \dr3 [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:119"
  cell $mux $42
    parameter \WIDTH 32
    connect \S $7 [0]
    connect \A $8 [31:0]
    connect \B 32'00000000000000000000000000000000
    connect \Y \dr_rd_data2
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:111"
  cell $ne $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:111"
  cell $and $44
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B $9 [0]
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:34"
  process $45
    assign \cr_word_rd_data [31:0] 32'00000000000000000000000000000000
    switch 2'00
      case 2'00
        assign \cr_word_rd_data [31:0] $1 [31:0]
      case 2'01
        assign \cr_word_rd_data [31:0] $2 [63:32]
      case 2'10
        assign \cr_word_rd_data [31:0] $3 [95:64]
      case 2'11
        assign \cr_word_rd_data [31:0] $4 [127:96]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $46
    assign $11 [127:0] \cr0 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $11 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
                assign $11 [127:0] \cr_wr_data [127:0]
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                    assign $11 [31:0] 32'00000000000000000000000000000000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                    assign $11 [63:32] 32'00000000000000000000000000000000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                    assign $11 [95:64] 32'00000000000000000000000000000000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                    assign $11 [127:96] 32'00000000000000000000000000000000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr0_gt_wr_en [0]
          case 1'1
            assign $11 [31:0] \cr0_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $11 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $47
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $11 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr0
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $48
    assign $12 [127:0] \cr1 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $12 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
                assign $12 [127:0] \cr_wr_data [127:0]
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                    assign $12 [31:0] 32'00000000000000000000000000000000
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                    assign $12 [63:32] 32'00000000000000000000000000000000
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                    assign $12 [95:64] 32'00000000000000000000000000000000
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                    assign $12 [127:96] 32'00000000000000000000000000000000
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr1_gt_wr_en [0]
          case 1'1
            assign $12 [31:0] \cr1_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $12 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $49
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $12 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr1
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $50
    assign $13 [127:0] \cr2 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $13 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
                assign $13 [127:0] \cr_wr_data [127:0]
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                    assign $13 [31:0] 32'00000000000000000000000000000000
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                    assign $13 [63:32] 32'00000000000000000000000000000000
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                    assign $13 [95:64] 32'00000000000000000000000000000000
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                    assign $13 [127:96] 32'00000000000000000000000000000000
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr2_gt_wr_en [0]
          case 1'1
            assign $13 [31:0] \cr2_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $13 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $51
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $13 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr2
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $52
    assign $14 [127:0] \cr3 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $14 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
                assign $14 [127:0] \cr_wr_data [127:0]
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                    assign $14 [31:0] 32'00000000000000000000000000000000
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                    assign $14 [63:32] 32'00000000000000000000000000000000
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                    assign $14 [95:64] 32'00000000000000000000000000000000
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                    assign $14 [127:96] 32'00000000000000000000000000000000
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr3_gt_wr_en [0]
          case 1'1
            assign $14 [31:0] \cr3_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $14 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $53
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $14 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr3
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $54
    assign $15 [127:0] \cr4 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $15 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
                assign $15 [127:0] \cr_wr_data [127:0]
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                    assign $15 [31:0] 32'00000000000000000000000000000000
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                    assign $15 [63:32] 32'00000000000000000000000000000000
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                    assign $15 [95:64] 32'00000000000000000000000000000000
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                    assign $15 [127:96] 32'00000000000000000000000000000000
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr4_gt_wr_en [0]
          case 1'1
            assign $15 [31:0] \cr4_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $15 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $55
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $15 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr4
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $56
    assign $16 [127:0] \cr5 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $16 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
                assign $16 [127:0] \cr_wr_data [127:0]
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                    assign $16 [31:0] 32'00000000000000000000000000000000
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                    assign $16 [63:32] 32'00000000000000000000000000000000
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                    assign $16 [95:64] 32'00000000000000000000000000000000
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                    assign $16 [127:96] 32'00000000000000000000000000000000
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr5_gt_wr_en [0]
          case 1'1
            assign $16 [31:0] \cr5_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $16 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $57
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $16 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr5
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $58
    assign $17 [127:0] \cr6 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $17 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
                assign $17 [127:0] \cr_wr_data [127:0]
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                    assign $17 [31:0] 32'00000000000000000000000000000000
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                    assign $17 [63:32] 32'00000000000000000000000000000000
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                    assign $17 [95:64] 32'00000000000000000000000000000000
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                    assign $17 [127:96] 32'00000000000000000000000000000000
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr6_gt_wr_en [0]
          case 1'1
            assign $17 [31:0] \cr6_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $17 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $59
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $17 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr6
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $60
    assign $18 [127:0] \cr7 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $18 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
                assign $18 [127:0] \cr_wr_data [127:0]
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                    assign $18 [31:0] 32'00000000000000000000000000000000
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                    assign $18 [63:32] 32'00000000000000000000000000000000
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                    assign $18 [95:64] 32'00000000000000000000000000000000
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                    assign $18 [127:96] 32'00000000000000000000000000000000
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr7_gt_wr_en [0]
          case 1'1
            assign $18 [31:0] \cr7_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $18 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $61
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $18 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr7
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $62
    assign $19 [127:0] \cr8 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $19 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
                assign $19 [127:0] \cr_wr_data [127:0]
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                    assign $19 [31:0] 32'00000000000000000000000000000000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                    assign $19 [63:32] 32'00000000000000000000000000000000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                    assign $19 [95:64] 32'00000000000000000000000000000000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                    assign $19 [127:96] 32'00000000000000000000000000000000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr8_gt_wr_en [0]
          case 1'1
            assign $19 [31:0] \cr8_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $19 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $63
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $19 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr8
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $64
    assign $20 [127:0] \cr9 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $20 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
                assign $20 [127:0] \cr_wr_data [127:0]
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                    assign $20 [31:0] 32'00000000000000000000000000000000
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                    assign $20 [63:32] 32'00000000000000000000000000000000
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                    assign $20 [95:64] 32'00000000000000000000000000000000
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                    assign $20 [127:96] 32'00000000000000000000000000000000
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr9_gt_wr_en [0]
          case 1'1
            assign $20 [31:0] \cr9_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $20 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $65
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $20 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr9
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $66
    assign $21 [127:0] \cr10 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $21 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
                assign $21 [127:0] \cr_wr_data [127:0]
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                    assign $21 [31:0] 32'00000000000000000000000000000000
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                    assign $21 [63:32] 32'00000000000000000000000000000000
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                    assign $21 [95:64] 32'00000000000000000000000000000000
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                    assign $21 [127:96] 32'00000000000000000000000000000000
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr10_gt_wr_en [0]
          case 1'1
            assign $21 [31:0] \cr10_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $21 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $67
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $21 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr10
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $68
    assign $22 [127:0] \cr11 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $22 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
                assign $22 [127:0] \cr_wr_data [127:0]
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                    assign $22 [31:0] 32'00000000000000000000000000000000
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                    assign $22 [63:32] 32'00000000000000000000000000000000
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                    assign $22 [95:64] 32'00000000000000000000000000000000
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                    assign $22 [127:96] 32'00000000000000000000000000000000
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr11_gt_wr_en [0]
          case 1'1
            assign $22 [31:0] \cr11_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $22 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $69
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $22 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr11
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $70
    assign $23 [127:0] \cr12 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $23 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
                assign $23 [127:0] \cr_wr_data [127:0]
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                    assign $23 [31:0] 32'00000000000000000000000000000000
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                    assign $23 [63:32] 32'00000000000000000000000000000000
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                    assign $23 [95:64] 32'00000000000000000000000000000000
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                    assign $23 [127:96] 32'00000000000000000000000000000000
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr12_gt_wr_en [0]
          case 1'1
            assign $23 [31:0] \cr12_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $23 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $71
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $23 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr12
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $72
    assign $24 [127:0] \cr13 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $24 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
                assign $24 [127:0] \cr_wr_data [127:0]
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                    assign $24 [31:0] 32'00000000000000000000000000000000
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                    assign $24 [63:32] 32'00000000000000000000000000000000
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                    assign $24 [95:64] 32'00000000000000000000000000000000
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                    assign $24 [127:96] 32'00000000000000000000000000000000
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr13_gt_wr_en [0]
          case 1'1
            assign $24 [31:0] \cr13_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $24 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $73
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $24 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr13
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $74
    assign $25 [127:0] \cr14 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $25 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
                assign $25 [127:0] \cr_wr_data [127:0]
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                    assign $25 [31:0] 32'00000000000000000000000000000000
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                    assign $25 [63:32] 32'00000000000000000000000000000000
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                    assign $25 [95:64] 32'00000000000000000000000000000000
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                    assign $25 [127:96] 32'00000000000000000000000000000000
                  case 4'1111
                end
            end
        end
        switch \cr14_gt_wr_en [0]
          case 1'1
            assign $25 [31:0] \cr14_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $25 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $75
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $25 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr14
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $76
    assign $26 [127:0] \cr15 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $26 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
                assign $26 [127:0] \cr_wr_data [127:0]
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                    assign $26 [31:0] 32'00000000000000000000000000000000
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                    assign $26 [63:32] 32'00000000000000000000000000000000
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                    assign $26 [95:64] 32'00000000000000000000000000000000
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                    assign $26 [127:96] 32'00000000000000000000000000000000
                end
            end
        end
        switch \cr15_gt_wr_en [0]
          case 1'1
            assign $26 [31:0] \cr15_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $26 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $77
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $26 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr15
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  process $78
    assign $27 [31:0] \dr0 [31:0]
    switch \clear_all [0]
      case 1'1
        assign $27 [31:0] 32'00000000000000000000000000000000
      case
        switch $10 [0]
          case 1'1
            switch 4'0000
              case 4'0000
                assign $27 [31:0] 32'00000000000000000000000000000000
              case 4'0001
              case 4'0010
              case 4'0011
            end
        end
    end
    switch \rst [0]
      case 1'1
        assign $27 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  cell $dff $79
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $27 [31:0]
    connect \CLK \clk [0]
    connect \Q \dr0
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  process $80
    assign $28 [31:0] \dr1 [31:0]
    switch \clear_all [0]
      case 1'1
        assign $28 [31:0] 32'00000000000000000000000000000000
      case
        switch $10 [0]
          case 1'1
            switch 4'0000
              case 4'0000
              case 4'0001
                assign $28 [31:0] 32'00000000000000000000000000000000
              case 4'0010
              case 4'0011
            end
        end
    end
    switch \rst [0]
      case 1'1
        assign $28 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  cell $dff $81
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $28 [31:0]
    connect \CLK \clk [0]
    connect \Q \dr1
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  process $82
    assign $29 [31:0] \dr2 [31:0]
    switch \clear_all [0]
      case 1'1
        assign $29 [31:0] 32'00000000000000000000000000000000
      case
        switch $10 [0]
          case 1'1
            switch 4'0000
              case 4'0000
              case 4'0001
              case 4'0010
                assign $29 [31:0] 32'00000000000000000000000000000000
              case 4'0011
            end
        end
    end
    switch \rst [0]
      case 1'1
        assign $29 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  cell $dff $83
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $29 [31:0]
    connect \CLK \clk [0]
    connect \Q \dr2
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  process $84
    assign $30 [31:0] \dr3 [31:0]
    switch \clear_all [0]
      case 1'1
        assign $30 [31:0] 32'00000000000000000000000000000000
      case
        switch $10 [0]
          case 1'1
            switch 4'0000
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
                assign $30 [31:0] 32'00000000000000000000000000000000
            end
        end
    end
    switch \rst [0]
      case 1'1
        assign $30 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  cell $dff $85
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $30 [31:0]
    connect \CLK \clk [0]
    connect \Q \dr3
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  process $86
    assign $31 [3:0] \flags [3:0]
    switch \clear_all [0]
      case 1'1
        assign $31 [3:0] 4'0000
      case
        switch 1'0
          case 1'1
            assign $31 [3:0] 4'0000
        end
    end
    switch \rst [0]
      case 1'1
        assign $31 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  cell $dff $87
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $31 [3:0]
    connect \CLK \clk [0]
    connect \Q \flags
  end

connect \cr_word_rd_sel 2'00
connect \cr_word_rd_addr 4'0000
connect \cr6_clist \cr6 [127:0]
connect \cr14_cloomc \cr14 [127:0]
connect \cr8_thread \cr8 [127:0]
connect \cr15_namespace \cr15 [127:0]
connect \dr_rd_addr1 4'0000
connect \dr_rd_addr2 4'0000
connect \flags_reg \flags [3:0]
connect \cr_word_wr_en 1'0
connect \cr_word_sel 2'00
connect \cr_word_wr_addr 4'0000
connect \cr_word_wr_data 32'00000000000000000000000000000000
connect \dr_wr_en 1'0
connect \dr_wr_addr 4'0000
connect \dr_wr_data 32'00000000000000000000000000000000
connect \flags_wr_en 1'0
connect \flags_in 4'0000
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]
connect \cr0.word0_gt \cr0 [31:0]
connect \cr0.word0_gt.gt_type \cr0 [1:0]
connect \cr0.word0_gt.perms \cr0 [7:2]
connect \cr0.word0_gt.index \cr0 [24:8]
connect \cr0.word0_gt.version \cr0 [31:25]
connect \cr0.word1_location \cr0 [63:32]
connect \cr0.word2_limit \cr0 [95:64]
connect \cr0.word3_seals \cr0 [127:96]
connect \cr1.word0_gt \cr1 [31:0]
connect \cr1.word0_gt.gt_type \cr1 [1:0]
connect \cr1.word0_gt.perms \cr1 [7:2]
connect \cr1.word0_gt.index \cr1 [24:8]
connect \cr1.word0_gt.version \cr1 [31:25]
connect \cr1.word1_location \cr1 [63:32]
connect \cr1.word2_limit \cr1 [95:64]
connect \cr1.word3_seals \cr1 [127:96]
connect \cr2.word0_gt \cr2 [31:0]
connect \cr2.word0_gt.gt_type \cr2 [1:0]
connect \cr2.word0_gt.perms \cr2 [7:2]
connect \cr2.word0_gt.index \cr2 [24:8]
connect \cr2.word0_gt.version \cr2 [31:25]
connect \cr2.word1_location \cr2 [63:32]
connect \cr2.word2_limit \cr2 [95:64]
connect \cr2.word3_seals \cr2 [127:96]
connect \cr3.word0_gt \cr3 [31:0]
connect \cr3.word0_gt.gt_type \cr3 [1:0]
connect \cr3.word0_gt.perms \cr3 [7:2]
connect \cr3.word0_gt.index \cr3 [24:8]
connect \cr3.word0_gt.version \cr3 [31:25]
connect \cr3.word1_location \cr3 [63:32]
connect \cr3.word2_limit \cr3 [95:64]
connect \cr3.word3_seals \cr3 [127:96]
connect \cr4.word0_gt \cr4 [31:0]
connect \cr4.word0_gt.gt_type \cr4 [1:0]
connect \cr4.word0_gt.perms \cr4 [7:2]
connect \cr4.word0_gt.index \cr4 [24:8]
connect \cr4.word0_gt.version \cr4 [31:25]
connect \cr4.word1_location \cr4 [63:32]
connect \cr4.word2_limit \cr4 [95:64]
connect \cr4.word3_seals \cr4 [127:96]
connect \cr5.word0_gt \cr5 [31:0]
connect \cr5.word0_gt.gt_type \cr5 [1:0]
connect \cr5.word0_gt.perms \cr5 [7:2]
connect \cr5.word0_gt.index \cr5 [24:8]
connect \cr5.word0_gt.version \cr5 [31:25]
connect \cr5.word1_location \cr5 [63:32]
connect \cr5.word2_limit \cr5 [95:64]
connect \cr5.word3_seals \cr5 [127:96]
connect \cr6.word0_gt \cr6 [31:0]
connect \cr6.word0_gt.gt_type \cr6 [1:0]
connect \cr6.word0_gt.perms \cr6 [7:2]
connect \cr6.word0_gt.index \cr6 [24:8]
connect \cr6.word0_gt.version \cr6 [31:25]
connect \cr6.word1_location \cr6 [63:32]
connect \cr6.word2_limit \cr6 [95:64]
connect \cr6.word3_seals \cr6 [127:96]
connect \cr7.word0_gt \cr7 [31:0]
connect \cr7.word0_gt.gt_type \cr7 [1:0]
connect \cr7.word0_gt.perms \cr7 [7:2]
connect \cr7.word0_gt.index \cr7 [24:8]
connect \cr7.word0_gt.version \cr7 [31:25]
connect \cr7.word1_location \cr7 [63:32]
connect \cr7.word2_limit \cr7 [95:64]
connect \cr7.word3_seals \cr7 [127:96]
connect \cr8.word0_gt \cr8 [31:0]
connect \cr8.word0_gt.gt_type \cr8 [1:0]
connect \cr8.word0_gt.perms \cr8 [7:2]
connect \cr8.word0_gt.index \cr8 [24:8]
connect \cr8.word0_gt.version \cr8 [31:25]
connect \cr8.word1_location \cr8 [63:32]
connect \cr8.word2_limit \cr8 [95:64]
connect \cr8.word3_seals \cr8 [127:96]
connect \cr9.word0_gt \cr9 [31:0]
connect \cr9.word0_gt.gt_type \cr9 [1:0]
connect \cr9.word0_gt.perms \cr9 [7:2]
connect \cr9.word0_gt.index \cr9 [24:8]
connect \cr9.word0_gt.version \cr9 [31:25]
connect \cr9.word1_location \cr9 [63:32]
connect \cr9.word2_limit \cr9 [95:64]
connect \cr9.word3_seals \cr9 [127:96]
connect \cr10.word0_gt \cr10 [31:0]
connect \cr10.word0_gt.gt_type \cr10 [1:0]
connect \cr10.word0_gt.perms \cr10 [7:2]
connect \cr10.word0_gt.index \cr10 [24:8]
connect \cr10.word0_gt.version \cr10 [31:25]
connect \cr10.word1_location \cr10 [63:32]
connect \cr10.word2_limit \cr10 [95:64]
connect \cr10.word3_seals \cr10 [127:96]
connect \cr11.word0_gt \cr11 [31:0]
connect \cr11.word0_gt.gt_type \cr11 [1:0]
connect \cr11.word0_gt.perms \cr11 [7:2]
connect \cr11.word0_gt.index \cr11 [24:8]
connect \cr11.word0_gt.version \cr11 [31:25]
connect \cr11.word1_location \cr11 [63:32]
connect \cr11.word2_limit \cr11 [95:64]
connect \cr11.word3_seals \cr11 [127:96]
connect \cr12.word0_gt \cr12 [31:0]
connect \cr12.word0_gt.gt_type \cr12 [1:0]
connect \cr12.word0_gt.perms \cr12 [7:2]
connect \cr12.word0_gt.index \cr12 [24:8]
connect \cr12.word0_gt.version \cr12 [31:25]
connect \cr12.word1_location \cr12 [63:32]
connect \cr12.word2_limit \cr12 [95:64]
connect \cr12.word3_seals \cr12 [127:96]
connect \cr13.word0_gt \cr13 [31:0]
connect \cr13.word0_gt.gt_type \cr13 [1:0]
connect \cr13.word0_gt.perms \cr13 [7:2]
connect \cr13.word0_gt.index \cr13 [24:8]
connect \cr13.word0_gt.version \cr13 [31:25]
connect \cr13.word1_location \cr13 [63:32]
connect \cr13.word2_limit \cr13 [95:64]
connect \cr13.word3_seals \cr13 [127:96]
connect \cr14.word0_gt \cr14 [31:0]
connect \cr14.word0_gt.gt_type \cr14 [1:0]
connect \cr14.word0_gt.perms \cr14 [7:2]
connect \cr14.word0_gt.index \cr14 [24:8]
connect \cr14.word0_gt.version \cr14 [31:25]
connect \cr14.word1_location \cr14 [63:32]
connect \cr14.word2_limit \cr14 [95:64]
connect \cr14.word3_seals \cr14 [127:96]
connect \cr15.word0_gt \cr15 [31:0]
connect \cr15.word0_gt.gt_type \cr15 [1:0]
connect \cr15.word0_gt.perms \cr15 [7:2]
connect \cr15.word0_gt.index \cr15 [24:8]
connect \cr15.word0_gt.version \cr15 [31:25]
connect \cr15.word1_location \cr15 [63:32]
connect \cr15.word2_limit \cr15 [95:64]
connect \cr15.word3_seals \cr15 [127:96]
connect \cr6_clist.word0_gt \cr6 [31:0]
connect \cr6_clist.word0_gt.gt_type \cr6 [1:0]
connect \cr6_clist.word0_gt.perms \cr6 [7:2]
connect \cr6_clist.word0_gt.index \cr6 [24:8]
connect \cr6_clist.word0_gt.version \cr6 [31:25]
connect \cr6_clist.word1_location \cr6 [63:32]
connect \cr6_clist.word2_limit \cr6 [95:64]
connect \cr6_clist.word3_seals \cr6 [127:96]
connect \cr14_cloomc.word0_gt \cr14 [31:0]
connect \cr14_cloomc.word0_gt.gt_type \cr14 [1:0]
connect \cr14_cloomc.word0_gt.perms \cr14 [7:2]
connect \cr14_cloomc.word0_gt.index \cr14 [24:8]
connect \cr14_cloomc.word0_gt.version \cr14 [31:25]
connect \cr14_cloomc.word1_location \cr14 [63:32]
connect \cr14_cloomc.word2_limit \cr14 [95:64]
connect \cr14_cloomc.word3_seals \cr14 [127:96]
connect \cr8_thread.word0_gt \cr8 [31:0]
connect \cr8_thread.word0_gt.gt_type \cr8 [1:0]
connect \cr8_thread.word0_gt.perms \cr8 [7:2]
connect \cr8_thread.word0_gt.index \cr8 [24:8]
connect \cr8_thread.word0_gt.version \cr8 [31:25]
connect \cr8_thread.word1_location \cr8 [63:32]
connect \cr8_thread.word2_limit \cr8 [95:64]
connect \cr8_thread.word3_seals \cr8 [127:96]
connect \cr15_namespace.word0_gt \cr15 [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15 [1:0]
connect \cr15_namespace.word0_gt.perms \cr15 [7:2]
connect \cr15_namespace.word0_gt.index \cr15 [24:8]
connect \cr15_namespace.word0_gt.version \cr15 [31:25]
connect \cr15_namespace.word1_location \cr15 [63:32]
connect \cr15_namespace.word2_limit \cr15 [95:64]
connect \cr15_namespace.word3_seals \cr15 [127:96]
connect \flags.N \flags [0]
connect \flags.Z \flags [1]
connect \flags.C \flags [2]
connect \flags.V \flags [3]
connect \flags_reg.N \flags [0]
connect \flags_reg.Z \flags [1]
connect \flags_reg.C \flags [2]
connect \flags_reg.V \flags [3]
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \cr0_gt_wr_data.gt_type \cr0_gt_wr_data [1:0]
connect \cr0_gt_wr_data.perms \cr0_gt_wr_data [7:2]
connect \cr0_gt_wr_data.index \cr0_gt_wr_data [24:8]
connect \cr0_gt_wr_data.version \cr0_gt_wr_data [31:25]
connect \cr1_gt_wr_data.gt_type \cr1_gt_wr_data [1:0]
connect \cr1_gt_wr_data.perms \cr1_gt_wr_data [7:2]
connect \cr1_gt_wr_data.index \cr1_gt_wr_data [24:8]
connect \cr1_gt_wr_data.version \cr1_gt_wr_data [31:25]
connect \cr2_gt_wr_data.gt_type \cr2_gt_wr_data [1:0]
connect \cr2_gt_wr_data.perms \cr2_gt_wr_data [7:2]
connect \cr2_gt_wr_data.index \cr2_gt_wr_data [24:8]
connect \cr2_gt_wr_data.version \cr2_gt_wr_data [31:25]
connect \cr3_gt_wr_data.gt_type \cr3_gt_wr_data [1:0]
connect \cr3_gt_wr_data.perms \cr3_gt_wr_data [7:2]
connect \cr3_gt_wr_data.index \cr3_gt_wr_data [24:8]
connect \cr3_gt_wr_data.version \cr3_gt_wr_data [31:25]
connect \cr4_gt_wr_data.gt_type \cr4_gt_wr_data [1:0]
connect \cr4_gt_wr_data.perms \cr4_gt_wr_data [7:2]
connect \cr4_gt_wr_data.index \cr4_gt_wr_data [24:8]
connect \cr4_gt_wr_data.version \cr4_gt_wr_data [31:25]
connect \cr5_gt_wr_data.gt_type \cr5_gt_wr_data [1:0]
connect \cr5_gt_wr_data.perms \cr5_gt_wr_data [7:2]
connect \cr5_gt_wr_data.index \cr5_gt_wr_data [24:8]
connect \cr5_gt_wr_data.version \cr5_gt_wr_data [31:25]
connect \cr6_gt_wr_data.gt_type \cr6_gt_wr_data [1:0]
connect \cr6_gt_wr_data.perms \cr6_gt_wr_data [7:2]
connect \cr6_gt_wr_data.index \cr6_gt_wr_data [24:8]
connect \cr6_gt_wr_data.version \cr6_gt_wr_data [31:25]
connect \cr7_gt_wr_data.gt_type \cr7_gt_wr_data [1:0]
connect \cr7_gt_wr_data.perms \cr7_gt_wr_data [7:2]
connect \cr7_gt_wr_data.index \cr7_gt_wr_data [24:8]
connect \cr7_gt_wr_data.version \cr7_gt_wr_data [31:25]
connect \cr8_gt_wr_data.gt_type \cr8_gt_wr_data [1:0]
connect \cr8_gt_wr_data.perms \cr8_gt_wr_data [7:2]
connect \cr8_gt_wr_data.index \cr8_gt_wr_data [24:8]
connect \cr8_gt_wr_data.version \cr8_gt_wr_data [31:25]
connect \cr9_gt_wr_data.gt_type \cr9_gt_wr_data [1:0]
connect \cr9_gt_wr_data.perms \cr9_gt_wr_data [7:2]
connect \cr9_gt_wr_data.index \cr9_gt_wr_data [24:8]
connect \cr9_gt_wr_data.version \cr9_gt_wr_data [31:25]
connect \cr10_gt_wr_data.gt_type \cr10_gt_wr_data [1:0]
connect \cr10_gt_wr_data.perms \cr10_gt_wr_data [7:2]
connect \cr10_gt_wr_data.index \cr10_gt_wr_data [24:8]
connect \cr10_gt_wr_data.version \cr10_gt_wr_data [31:25]
connect \cr11_gt_wr_data.gt_type \cr11_gt_wr_data [1:0]
connect \cr11_gt_wr_data.perms \cr11_gt_wr_data [7:2]
connect \cr11_gt_wr_data.index \cr11_gt_wr_data [24:8]
connect \cr11_gt_wr_data.version \cr11_gt_wr_data [31:25]
connect \cr12_gt_wr_data.gt_type \cr12_gt_wr_data [1:0]
connect \cr12_gt_wr_data.perms \cr12_gt_wr_data [7:2]
connect \cr12_gt_wr_data.index \cr12_gt_wr_data [24:8]
connect \cr12_gt_wr_data.version \cr12_gt_wr_data [31:25]
connect \cr13_gt_wr_data.gt_type \cr13_gt_wr_data [1:0]
connect \cr13_gt_wr_data.perms \cr13_gt_wr_data [7:2]
connect \cr13_gt_wr_data.index \cr13_gt_wr_data [24:8]
connect \cr13_gt_wr_data.version \cr13_gt_wr_data [31:25]
connect \cr14_gt_wr_data.gt_type \cr14_gt_wr_data [1:0]
connect \cr14_gt_wr_data.perms \cr14_gt_wr_data [7:2]
connect \cr14_gt_wr_data.index \cr14_gt_wr_data [24:8]
connect \cr14_gt_wr_data.version \cr14_gt_wr_data [31:25]
connect \cr15_gt_wr_data.gt_type \cr15_gt_wr_data [1:0]
connect \cr15_gt_wr_data.perms \cr15_gt_wr_data [7:2]
connect \cr15_gt_wr_data.index \cr15_gt_wr_data [24:8]
connect \cr15_gt_wr_data.version \cr15_gt_wr_data [31:25]
connect \flags_in.N 1'0
connect \flags_in.Z 1'0
connect \flags_in.C 1'0
connect \flags_in.V 1'0

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/decoder.py:43"
module \top.u_decoder

  attribute \src "/home/runner/workspace/church_machine/decoder.py:29"
  wire width 5 \church_op

  attribute \src "/home/runner/workspace/church_machine/decoder.py:30"
  wire width 4 \cr_dst

  attribute \src "/home/runner/workspace/church_machine/decoder.py:31"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/decoder.py:32"
  wire width 15 \immediate

  attribute \src "/home/runner/workspace/church_machine/decoder.py:35"
  wire width 15 \cap_index

  attribute \src "/home/runner/workspace/church_machine/decoder.py:34"
  wire width 4 \tperm_preset

  attribute \src "/home/runner/workspace/church_machine/decoder.py:36"
  wire width 15 \call_mask

  attribute \src "/home/runner/workspace/church_machine/decoder.py:37"
  wire width 4 \switch_target

  attribute \src "/home/runner/workspace/church_machine/decoder.py:66"
  wire width 1 \cond_pass

  attribute \src "/home/runner/workspace/church_machine/decoder.py:104"
  wire width 1 \valid_opcode

  attribute \src "/home/runner/workspace/church_machine/decoder.py:22"
  wire width 32 input 0  \instruction

  attribute \src "/home/runner/workspace/church_machine/decoder.py:23"
  wire width 1 input 1  \instr_valid

  attribute \src "/home/runner/workspace/church_machine/decoder.py:26"
  wire width 1 output 2  \exec_enable

  attribute \src "/home/runner/workspace/church_machine/decoder.py:27"
  wire width 1 output 3  \is_church_op

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 4 input 4  \flags

  attribute \src "/home/runner/workspace/church_machine/decoder.py:40"
  wire width 1 output 5  \fault_valid

  attribute \src "/home/runner/workspace/church_machine/decoder.py:39"
  wire width 4 output 6  \fault

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.N

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.Z

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.C

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.V

  attribute \src "/home/runner/workspace/church_machine/decoder.py:72"
  cell $not $22
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [1]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:76"
  cell $not $23
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [2]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:80"
  cell $not $24
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:84"
  cell $not $25
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [3]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:86"
  cell $not $26
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [1]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:86"
  cell $and $27
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [2]
    connect \B $5 [0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:88"
  cell $not $28
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [2]
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:88"
  cell $or $29
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $7 [0]
    connect \B \flags [1]
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:90"
  cell $eq $30
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \B \flags [3]
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:92"
  cell $ne $31
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \B \flags [3]
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:94"
  cell $not $32
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [1]
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:94"
  cell $eq $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \B \flags [3]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:94"
  cell $and $34
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $11 [0]
    connect \B $12 [0]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:96"
  cell $ne $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \B \flags [3]
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:96"
  cell $or $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [1]
    connect \B $14 [0]
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:102"
  cell $and $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \instr_valid [0]
    connect \B \cond_pass [0]
    connect \Y \exec_enable
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:105"
  cell $le $38
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 4'1001
    connect \Y \valid_opcode
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:106"
  cell $and $39
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \valid_opcode [0]
    connect \B \instr_valid [0]
    connect \Y \is_church_op
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:114"
  cell $not $40
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \valid_opcode [0]
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:119"
  cell $eq $41
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 3'110
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:120"
  cell $eq $42
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \instruction [3:0]
    connect \B 4'1110
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:121"
  cell $eq $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \instruction [3:0]
    connect \B 4'1111
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:120"
  cell $or $44
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $18 [0]
    connect \B $19 [0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:119"
  cell $and $45
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $17 [0]
    connect \B $20 [0]
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:66"
  process $46
    assign \cond_pass [0] 1'0
    switch \instruction [26:23]
      case 4'0000
        assign \cond_pass [0] \flags [1]
      case 4'0001
        assign \cond_pass [0] $1 [0]
      case 4'0010
        assign \cond_pass [0] \flags [2]
      case 4'0011
        assign \cond_pass [0] $2 [0]
      case 4'0100
        assign \cond_pass [0] \flags [0]
      case 4'0101
        assign \cond_pass [0] $3 [0]
      case 4'0110
        assign \cond_pass [0] \flags [3]
      case 4'0111
        assign \cond_pass [0] $4 [0]
      case 4'1000
        assign \cond_pass [0] $6 [0]
      case 4'1001
        assign \cond_pass [0] $8 [0]
      case 4'1010
        assign \cond_pass [0] $9 [0]
      case 4'1011
        assign \cond_pass [0] $10 [0]
      case 4'1100
        assign \cond_pass [0] $13 [0]
      case 4'1101
        assign \cond_pass [0] $15 [0]
      case 4'1110
        assign \cond_pass [0] 1'1
      case 4'1111
        assign \cond_pass [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:40"
  process $47
    assign \fault_valid [0] 1'0
    switch \instr_valid [0]
      case 1'1
        switch { $21 [0] $16 [0] }
          case 2'-1
            assign \fault_valid [0] 1'1
          case 2'1-
            assign \fault_valid [0] 1'1
        end
    end
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:39"
  process $48
    assign \fault [3:0] 4'0000
    switch \instr_valid [0]
      case 1'1
        switch { $21 [0] $16 [0] }
          case 2'-1
            assign \fault [3:0] 4'1011
          case 2'1-
            assign \fault [3:0] 4'1100
        end
    end
  end

connect \church_op \instruction [31:27]
connect \cr_dst \instruction [22:19]
connect \cr_src \instruction [18:15]
connect \immediate \instruction [14:0]
connect \cap_index \instruction [14:0]
connect \tperm_preset \instruction [3:0]
connect \call_mask \instruction [14:0]
connect \switch_target \instruction [3:0]
connect \flags.N \flags [0]
connect \flags.Z \flags [1]
connect \flags.C \flags [2]
connect \flags.V \flags [3]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/perm_check.py:38"
module \top.u_perm_check

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:43"
  wire width 1 \is_null_gt

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:44"
  wire width 1 \perms_match

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:26"
  wire width 1 \perm_granted

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:52"
  wire width 1 \has_turing

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:53"
  wire width 1 \has_church

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:35"
  wire width 1 \domain_purity_ok

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:27"
  wire width 1 \bounds_ok

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:16"
  wire width 1 \check_bounds

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:14"
  wire width 17 \access_index

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:15"
  wire width 32 \limit

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:28"
  wire width 1 \version_ok

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:20"
  wire width 1 \check_version

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:19"
  wire width 7 \gt_version

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:18"
  wire width 7 \stored_version

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:29"
  wire width 1 \seal_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:24"
  wire width 1 \check_seal

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:22"
  wire width 25 \calculated_seal

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:23"
  wire width 25 \stored_seal

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:30"
  wire width 1 \all_checks_pass

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:12"
  wire width 1 input 0  \check_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:34"
  wire width 1 input 1  \check_domain_purity

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 32 input 2  \gt_in

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:11"
  wire width 6 input 3  \required_perms

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:32"
  wire width 1 output 4  \fault_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:31"
  wire width 4 output 5  \fault_type

  wire width 6 $1

  wire width 1 $2

  wire width 6 $3

  wire width 6 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  wire width 1 $22

  wire width 6 $23

  wire width 6 $24

  wire width 6 $25

  wire width 6 $26

  wire width 1 $27

  wire width 6 $28

  wire width 6 $29

  wire width 6 $30

  wire width 6 $31

  wire width 1 $32

  wire width 6 $33

  wire width 6 $34

  wire width 6 $35

  wire width 6 $36

  wire width 1 $37

  wire width 6 $38

  wire width 6 $39

  wire width 6 $40

  wire width 6 $41

  wire width 1 $42

  wire width 6 $43

  wire width 6 $44

  wire width 6 $45

  wire width 6 $46

  wire width 1 $47

  wire width 6 $48

  wire width 6 $49

  wire width 6 $50

  wire width 6 $51

  wire width 1 $52

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 2 \gt_in.gt_type

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 6 \gt_in.perms

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 17 \gt_in.index

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 7 \gt_in.version

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:47"
  cell $eq $53
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \gt_in [1:0]
    connect \B 2'10
    connect \Y \is_null_gt
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:48"
  cell $and $54
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B \required_perms [5:0]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:48"
  cell $eq $55
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $1 [5:0]
    connect \B \required_perms [5:0]
    connect \Y \perms_match
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:49"
  cell $not $56
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \is_null_gt [0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:49"
  cell $and $57
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $2 [0]
    connect \B \perms_match [0]
    connect \Y \perm_granted
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:55"
  cell $and $58
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'000111
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:55"
  cell $ne $59
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A $3 [5:0]
    connect \B {  }
    connect \Y \has_turing
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:56"
  cell $and $60
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'111000
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:56"
  cell $ne $61
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A $4 [5:0]
    connect \B {  }
    connect \Y \has_church
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:57"
  cell $and $62
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \has_turing [0]
    connect \B \has_church [0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:57"
  cell $not $63
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $5 [0]
    connect \Y \domain_purity_ok
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:60"
  cell $not $64
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:60"
  cell $lt $65
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:60"
  cell $or $66
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $6 [0]
    connect \B $7 [0]
    connect \Y \bounds_ok
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:61"
  cell $not $67
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:61"
  cell $eq $68
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:61"
  cell $or $69
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $8 [0]
    connect \B $9 [0]
    connect \Y \version_ok
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:62"
  cell $not $70
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:62"
  cell $eq $71
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:62"
  cell $or $72
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $10 [0]
    connect \B $11 [0]
    connect \Y \seal_valid
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:65"
  cell $and $73
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \perm_granted [0]
    connect \B \bounds_ok [0]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:65"
  cell $and $74
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $12 [0]
    connect \B \version_ok [0]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:65"
  cell $and $75
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $13 [0]
    connect \B \seal_valid [0]
    connect \Y \all_checks_pass
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:79"
  cell $not $76
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \perms_match [0]
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:95"
  cell $not $77
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \bounds_ok [0]
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:95"
  cell $and $78
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B $15 [0]
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:100"
  cell $not $79
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \version_ok [0]
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:100"
  cell $and $80
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B $17 [0]
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:105"
  cell $not $81
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \seal_valid [0]
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:105"
  cell $and $82
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B $19 [0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:110"
  cell $not $83
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \domain_purity_ok [0]
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:110"
  cell $and $84
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \check_domain_purity [0]
    connect \B $21 [0]
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:81"
  cell $and $85
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'000001
    connect \Y $23
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:81"
  cell $and $86
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'000001
    connect \Y $24
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:81"
  cell $not $87
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $24 [5:0]
    connect \Y $25
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:81"
  cell $and $88
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $23 [5:0]
    connect \B $25 [5:0]
    connect \Y $26
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $89
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $26 [5:0]
    connect \Y $27
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:83"
  cell $and $90
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'000010
    connect \Y $28
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:83"
  cell $and $91
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'000010
    connect \Y $29
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:83"
  cell $not $92
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $29 [5:0]
    connect \Y $30
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:83"
  cell $and $93
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $28 [5:0]
    connect \B $30 [5:0]
    connect \Y $31
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $94
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $31 [5:0]
    connect \Y $32
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:85"
  cell $and $95
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'000100
    connect \Y $33
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:85"
  cell $and $96
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'000100
    connect \Y $34
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:85"
  cell $not $97
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $34 [5:0]
    connect \Y $35
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:85"
  cell $and $98
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $33 [5:0]
    connect \B $35 [5:0]
    connect \Y $36
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $99
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $36 [5:0]
    connect \Y $37
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:87"
  cell $and $100
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'001000
    connect \Y $38
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:87"
  cell $and $101
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'001000
    connect \Y $39
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:87"
  cell $not $102
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $39 [5:0]
    connect \Y $40
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:87"
  cell $and $103
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $38 [5:0]
    connect \B $40 [5:0]
    connect \Y $41
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $104
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $41 [5:0]
    connect \Y $42
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:89"
  cell $and $105
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'010000
    connect \Y $43
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:89"
  cell $and $106
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'010000
    connect \Y $44
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:89"
  cell $not $107
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $44 [5:0]
    connect \Y $45
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:89"
  cell $and $108
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $43 [5:0]
    connect \B $45 [5:0]
    connect \Y $46
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $109
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $46 [5:0]
    connect \Y $47
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:91"
  cell $and $110
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'100000
    connect \Y $48
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:91"
  cell $and $111
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'100000
    connect \Y $49
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:91"
  cell $not $112
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $49 [5:0]
    connect \Y $50
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:91"
  cell $and $113
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $48 [5:0]
    connect \B $50 [5:0]
    connect \Y $51
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $114
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $51 [5:0]
    connect \Y $52
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:32"
  process $115
    assign \fault_valid [0] 1'0
    switch \check_valid [0]
      case 1'1
        switch { $22 [0] $20 [0] $18 [0] $16 [0] $14 [0] \is_null_gt [0] }
          case 6'-----1
            assign \fault_valid [0] 1'1
          case 6'----1-
            assign \fault_valid [0] 1'1
          case 6'---1--
            assign \fault_valid [0] 1'1
          case 6'--1---
            assign \fault_valid [0] 1'1
          case 6'-1----
            assign \fault_valid [0] 1'1
          case 6'1-----
            assign \fault_valid [0] 1'1
        end
    end
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:31"
  process $116
    assign \fault_type [3:0] 4'0000
    switch \check_valid [0]
      case 1'1
        switch { $22 [0] $20 [0] $18 [0] $16 [0] $14 [0] \is_null_gt [0] }
          case 6'-----1
            assign \fault_type [3:0] 4'0111
          case 6'----1-
            switch { $52 [0] $47 [0] $42 [0] $37 [0] $32 [0] $27 [0] }
              case 6'-----1
                assign \fault_type [3:0] 4'0001
              case 6'----1-
                assign \fault_type [3:0] 4'0010
              case 6'---1--
                assign \fault_type [3:0] 4'0011
              case 6'--1---
                assign \fault_type [3:0] 4'0100
              case 6'-1----
                assign \fault_type [3:0] 4'0101
              case 6'1-----
                assign \fault_type [3:0] 4'0110
              case
                assign \fault_type [3:0] 4'0001
            end
          case 6'---1--
            assign \fault_type [3:0] 4'1000
          case 6'--1---
            assign \fault_type [3:0] 4'1001
          case 6'-1----
            assign \fault_type [3:0] 4'1010
          case 6'1-----
            assign \fault_type [3:0] 4'1101
        end
    end
  end

connect \check_bounds 1'0
connect \access_index 17'00000000000000000
connect \limit 32'00000000000000000000000000000000
connect \check_version 1'0
connect \gt_version 7'0000000
connect \stored_version 7'0000000
connect \check_seal 1'0
connect \calculated_seal 25'0000000000000000000000000
connect \stored_seal 25'0000000000000000000000000
connect \gt_in.gt_type \gt_in [1:0]
connect \gt_in.perms \gt_in [7:2]
connect \gt_in.index \gt_in [24:8]
connect \gt_in.version \gt_in [31:25]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:25"
module \top.u_lambda

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:32"
  wire width 1 \is_null

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \target_cap

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \lambda_state

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:35"
  attribute \init 1'0
  wire width 1 \fault_flag

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:36"
  attribute \init 4'0000
  wire width 4 \fault_latched

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:11"
  wire width 4 input 0  \cr_target

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \rst

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:10"
  wire width 1 input 3  \lambda_start

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 128 input 4  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:12"
  wire width 1 output 5  \lambda_busy

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:13"
  wire width 1 output 6  \lambda_complete

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:17"
  wire width 4 output 7  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:20"
  wire width 1 output 8  \nia_set

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:21"
  wire width 32 output 9  \nia_value

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:35"
  attribute \init 1'0
  wire width 1 output 10  \lambda_fault

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:36"
  attribute \init 4'0000
  wire width 4 output 11  \fault_type

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 4 $8

  wire width 3 $9

  wire width 128 $10

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 32 \target_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 2 \target_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 6 \target_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 17 \target_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 7 \target_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 32 \target_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 32 \target_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 32 \target_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:33"
  cell $eq $11
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \target_cap [1:0]
    connect \B 2'10
    connect \Y \is_null
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:74"
  cell $not $12
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $1 [0]
    connect \Y \lambda_busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $13
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B {  }
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $14
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 1'1
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 2'10
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $16
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 2'11
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $17
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 3'100
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $18
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 3'101
    connect \Y \lambda_complete
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:54"
  cell $not $19
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \target_cap [4]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:17"
  process $20
    assign \cr_rd_addr [3:0] 4'0000
    switch \lambda_state [2:0]
      case 3'000
        switch \lambda_start [0]
          case 1'1
            assign \cr_rd_addr [3:0] \cr_target [3:0]
        end
      case 3'001
        assign \cr_rd_addr [3:0] \cr_target [3:0]
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:20"
  process $21
    assign \nia_set [0] 1'0
    switch \lambda_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \nia_set [0] 1'1
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:21"
  process $22
    assign \nia_value [31:0] 32'00000000000000000000000000000000
    switch \lambda_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \nia_value [31:0] \target_cap [63:32]
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:35"
  process $23
    assign $7 [0] \lambda_fault [0]
    switch \lambda_state [2:0]
      case 3'000
        assign $7 [0] 1'0
      case 3'001
      case 3'010
        switch { $6 [0] \is_null [0] }
          case 2'-1
            assign $7 [0] 1'1
          case 2'1-
            assign $7 [0] 1'1
          case
        end
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $7 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:35"
  cell $dff $24
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $7 [0]
    connect \CLK \clk [0]
    connect \Q \lambda_fault
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:36"
  process $25
    assign $8 [3:0] \fault_type [3:0]
    switch \lambda_state [2:0]
      case 3'000
        assign $8 [3:0] 4'0000
      case 3'001
      case 3'010
        switch { $6 [0] \is_null [0] }
          case 2'-1
            assign $8 [3:0] 4'0111
          case 2'1-
            assign $8 [3:0] 4'0011
          case
        end
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $8 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:36"
  cell $dff $26
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $8 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $27
    assign $9 [2:0] \lambda_state [2:0]
    switch \lambda_state [2:0]
      case 3'000
        switch \lambda_start [0]
          case 1'1
            assign $9 [2:0] 3'001
        end
      case 3'001
        assign $9 [2:0] 3'010
      case 3'010
        switch { $6 [0] \is_null [0] }
          case 2'-1
            assign $9 [2:0] 3'011
          case 2'1-
            assign $9 [2:0] 3'011
          case
            assign $9 [2:0] 3'100
        end
      case 3'100
        assign $9 [2:0] 3'101
      case 3'101
        assign $9 [2:0] 3'000
      case 3'011
        assign $9 [2:0] 3'000
    end
    switch \rst [0]
      case 1'1
        assign $9 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $28
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $9 [2:0]
    connect \CLK \clk [0]
    connect \Q \lambda_state
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  process $29
    assign $10 [127:0] \target_cap [127:0]
    switch \lambda_state [2:0]
      case 3'000
      case 3'001
        assign $10 [127:0] \cr_rd_data [127:0]
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $10 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  cell $dff $30
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $10 [127:0]
    connect \CLK \clk [0]
    connect \Q \target_cap
  end

connect \fault_flag \lambda_fault [0]
connect \fault_latched \fault_type [3:0]
connect \target_cap.word0_gt \target_cap [31:0]
connect \target_cap.word0_gt.gt_type \target_cap [1:0]
connect \target_cap.word0_gt.perms \target_cap [7:2]
connect \target_cap.word0_gt.index \target_cap [24:8]
connect \target_cap.word0_gt.version \target_cap [31:25]
connect \target_cap.word1_location \target_cap [63:32]
connect \target_cap.word2_limit \target_cap [95:64]
connect \target_cap.word3_seals \target_cap [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/call.py:43"
module \top.u_call

  attribute \src "/home/runner/workspace/church_machine/call.py:66"
  wire width 1 \src_in_range

  attribute \src "/home/runner/workspace/church_machine/call.py:11"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/call.py:49"
  attribute \init 1'0
  wire width 1 \phase

  attribute \src "/home/runner/workspace/church_machine/call.py:74"
  wire width 4 \mload_dst

  attribute \src "/home/runner/workspace/church_machine/call.py:12"
  wire width 17 \index

  attribute \src "/home/runner/workspace/church_machine/call.py:54"
  attribute \init 1'0
  wire width 1 \sub_start_reg

  attribute \src "/home/runner/workspace/church_machine/call.py:26"
  wire width 4 \mload_cr_src

  attribute \src "/home/runner/workspace/church_machine/call.py:27"
  wire width 4 \mload_cr_dst

  attribute \src "/home/runner/workspace/church_machine/call.py:28"
  wire width 17 \mload_index$11

  attribute \src "/home/runner/workspace/church_machine/call.py:29"
  wire width 1 \mload_direct

  attribute \src "/home/runner/workspace/church_machine/call.py:31"
  wire width 1 \mload_m_elevated

  attribute \src "/home/runner/workspace/church_machine/call.py:30"
  wire width 32 \mload_direct_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:63"
  wire width 4 \b_clear_wr_addr

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 128 \b_clear_wr_data

  attribute \src "/home/runner/workspace/church_machine/call.py:62"
  wire width 1 \b_clear_wr_en

  attribute \src "/home/runner/workspace/church_machine/call.py:58"
  wire width 4 \local_cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/call.py:103"
  wire width 16 \dr_clear_computed

  attribute \src "/home/runner/workspace/church_machine/call.py:51"
  attribute \init 16'0000000000000000
  wire width 16 \mask_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:104"
  wire width 16 \cr_clear_computed

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \call_state

  attribute \src "/home/runner/workspace/church_machine/call.py:60"
  attribute \init 3'000
  wire width 3 \b_idx

  attribute \src "/home/runner/workspace/church_machine/call.py:188"
  wire width 32 \cleared_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \b_cr_data

  attribute \src "/home/runner/workspace/church_machine/call.py:52"
  attribute \init 1'0
  wire width 1 \fault_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:53"
  attribute \init 4'0000
  wire width 4 \fault_type_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:37"
  wire width 1 \nia_set

  attribute \src "/home/runner/workspace/church_machine/call.py:38"
  wire width 32 \nia_value

  attribute \src "/home/runner/workspace/church_machine/call.py:39"
  wire width 16 \dr_clear_mask

  attribute \src "/home/runner/workspace/church_machine/call.py:40"
  wire width 16 \cr_clear_mask

  attribute \src "/home/runner/workspace/church_machine/call.py:55"
  attribute \init 1'0
  wire width 1 \sub_done_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:56"
  attribute \init 1'0
  wire width 1 \sub_fault_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:13"
  wire width 16 \mask

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \src_reg_latched

  wire width 19 input 0  \port$0$2

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \rst

  attribute \src "/home/runner/workspace/church_machine/call.py:10"
  wire width 1 input 3  \call_start

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 128 input 4  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/call.py:26"
  wire width 4 output 5  \mload_src

  wire width 3 output 6  \port$505$0

  attribute \src "/home/runner/workspace/church_machine/call.py:28"
  wire width 17 output 7  \mload_index

  attribute \src "/home/runner/workspace/church_machine/call.py:14"
  wire width 1 output 8  \call_busy

  attribute \src "/home/runner/workspace/church_machine/call.py:37"
  wire width 1 output 9  \call_complete

  attribute \src "/home/runner/workspace/church_machine/call.py:34"
  wire width 1 input 10  \mload_fault

  attribute \src "/home/runner/workspace/church_machine/call.py:33"
  wire width 1 input 11  \mload_done

  attribute \src "/home/runner/workspace/church_machine/call.py:58"
  wire width 4 output 12  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 128 output 13  \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/call.py:62"
  wire width 1 output 14  \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/call.py:63"
  wire width 4 output 15  \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/call.py:52"
  attribute \init 1'0
  wire width 1 output 16  \call_fault

  attribute \src "/home/runner/workspace/church_machine/call.py:53"
  attribute \init 4'0000
  wire width 4 output 17  \fault_type

  attribute \src "/home/runner/workspace/church_machine/call.py:54"
  attribute \init 1'0
  wire width 1 output 18  \mload_start

  attribute \src "/home/runner/workspace/church_machine/call.py:35"
  wire width 4 input 19  \mload_fault_type

  wire width 3 $1

  wire width 5 $2

  wire width 6 $3

  wire width 1 $4

  wire width 1 $5

  wire width 33 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  wire width 1 $22

  wire width 4 $23

  wire width 4 $24

  wire width 1 $25

  wire width 1 $26

  wire width 4 $27

  wire width 1 $28

  wire width 1 $29

  wire width 16 $30

  wire width 4 $31

  wire width 128 $32

  wire width 1 $33

  wire width 3 $34

  wire width 128 $35

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 32 \b_clear_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 2 \b_clear_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 6 \b_clear_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 17 \b_clear_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 7 \b_clear_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 32 \b_clear_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 32 \b_clear_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 32 \b_clear_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 32 \b_cr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 2 \b_cr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 6 \b_cr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 17 \b_cr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 7 \b_cr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 32 \b_cr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 32 \b_cr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 32 \b_cr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 32 \src_reg_latched.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 2 \src_reg_latched.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 6 \src_reg_latched.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 17 \src_reg_latched.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 7 \src_reg_latched.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 32 \src_reg_latched.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 32 \src_reg_latched.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 32 \src_reg_latched.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:67"
  cell $le $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \port$0$2 [18:15]
    connect \B 3'101
    connect \Y \src_in_range
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:77"
  cell $mux $37
    parameter \WIDTH 4
    connect \S \phase [0]
    connect \A \port$0$2 [18:15]
    connect \B 4'0110
    connect \Y \mload_src
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:78"
  cell $mux $38
    parameter \WIDTH 3
    connect \S \phase [0]
    connect \A 3'110
    connect \B 3'111
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:79"
  cell $mux $39
    parameter \WIDTH 17
    connect \S \phase [0]
    connect \A { 2'00 \port$0$2 [14:0] }
    connect \B 17'00000000000000000
    connect \Y \mload_index
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:106"
  cell $not $40
    parameter \A_SIGNED 0
    parameter \A_WIDTH 5
    parameter \Y_WIDTH 5
    connect \A \mask_latched [4:0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:107"
  cell $not $41
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \mask_latched [10:5]
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:173"
  cell $gt $42
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \b_idx [2:0]
    connect \B 3'101
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:175"
  cell $shift $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mask_latched [10:5]
    connect \B \b_idx [2:0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:189"
  cell $and $44
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 33
    parameter \B_WIDTH 33
    parameter \Y_WIDTH 33
    connect \A { 1'0 \b_cr_data [95:64] }
    connect \B 33'101111111111111111111111111111111
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:209"
  cell $not $45
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $7 [0]
    connect \Y \call_busy
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:215"
  cell $mux $46
    parameter \WIDTH 16
    connect \S \call_complete [0]
    connect \A 16'0000000000000000
    connect \B { 10'1111111111 $2 [4:0] 1'0 }
    connect \Y \dr_clear_mask
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:216"
  cell $mux $47
    parameter \WIDTH 16
    connect \S \call_complete [0]
    connect \A 16'0000000000000000
    connect \B { 10'0000000000 $3 [5:0] }
    connect \Y \cr_clear_mask
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $48
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B {  }
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $49
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 1'1
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $50
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 2'10
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $51
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 2'11
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $52
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 3'100
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $53
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 3'101
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $54
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 3'110
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $55
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 3'111
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $56
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1000
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $57
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1001
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $58
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1010
    connect \Y \call_complete
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $59
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1011
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $60
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1100
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:120"
  cell $not $61
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \src_in_range [0]
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:132"
  cell $not $62
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \src_reg_latched [5]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:173"
  cell $gt $63
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \b_idx [2:0]
    connect \B 3'101
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:175"
  cell $shift $64
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mask_latched [10:5]
    connect \B \b_idx [2:0]
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:179"
  cell $add $65
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 4
    connect \A \b_idx [2:0]
    connect \B 1'1
    connect \Y $23
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:199"
  cell $add $66
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 4
    connect \A \b_idx [2:0]
    connect \B 1'1
    connect \Y $24
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:58"
  process $67
    assign \cr_rd_addr [3:0] 4'0000
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
        assign \cr_rd_addr [3:0] \port$0$2 [18:15]
      case 4'0011
        assign \cr_rd_addr [3:0] \port$0$2 [18:15]
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
        switch { $5 [0] $4 [0] }
          case 2'-1
          case 2'1-
            assign \cr_rd_addr [3:0] { 1'0 \b_idx [2:0] }
          case
        end
      case 4'1011
        assign \cr_rd_addr [3:0] { 1'0 \b_idx [2:0] }
      case 4'1100
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:188"
  process $68
    assign \cleared_limit [31:0] 32'00000000000000000000000000000000
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
        assign \cleared_limit [31:0] $6 [31:0]
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  process $69
    assign \cr_wr_data [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
        assign \cr_wr_data [31:0] \b_cr_data [31:0]
        assign \cr_wr_data [63:32] \b_cr_data [63:32]
        assign \cr_wr_data [95:64] \cleared_limit [31:0]
        assign \cr_wr_data [127:96] \b_cr_data [127:96]
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:62"
  process $70
    assign \cr_wr_en [0] 1'0
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
        assign \cr_wr_en [0] 1'1
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:63"
  process $71
    assign \cr_wr_addr [3:0] 4'0000
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
        assign \cr_wr_addr [3:0] { 1'0 \b_idx [2:0] }
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:49"
  process $72
    assign $25 [0] \phase [0]
    switch \call_state [3:0]
      case 4'0000
        assign $25 [0] 1'0
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
        assign $25 [0] 1'1
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $25 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:49"
  cell $dff $73
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $25 [0]
    connect \CLK \clk [0]
    connect \Q \phase
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:52"
  process $74
    assign $26 [0] \call_fault [0]
    switch \call_state [3:0]
      case 4'0000
        assign $26 [0] 1'0
      case 4'0001
        switch $19 [0]
          case 1'1
            assign $26 [0] 1'1
          case
        end
      case 4'0011
      case 4'0100
        switch $20 [0]
          case 1'1
            assign $26 [0] 1'1
          case
        end
      case 4'0101
        switch \mload_fault [0]
          case 1'1
            assign $26 [0] 1'1
        end
      case 4'0110
      case 4'0111
        switch \mload_fault [0]
          case 1'1
            assign $26 [0] 1'1
        end
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $26 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:52"
  cell $dff $75
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $26 [0]
    connect \CLK \clk [0]
    connect \Q \call_fault
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:53"
  process $76
    assign $27 [3:0] \fault_type [3:0]
    switch \call_state [3:0]
      case 4'0000
        assign $27 [3:0] 4'0000
      case 4'0001
        switch $19 [0]
          case 1'1
            assign $27 [3:0] 4'0100
          case
        end
      case 4'0011
      case 4'0100
        switch $20 [0]
          case 1'1
            assign $27 [3:0] 4'0100
          case
        end
      case 4'0101
        switch \mload_fault [0]
          case 1'1
            assign $27 [3:0] \mload_fault_type [3:0]
        end
      case 4'0110
      case 4'0111
        switch \mload_fault [0]
          case 1'1
            assign $27 [3:0] \mload_fault_type [3:0]
        end
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $27 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:53"
  cell $dff $77
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $27 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:55"
  process $78
    assign $28 [0] \sub_done_latched [0]
    switch \call_state [3:0]
      case 4'0000
        assign $28 [0] 1'0
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        switch \mload_done [0]
          case 1'1
            assign $28 [0] 1'1
        end
      case 4'0110
        assign $28 [0] 1'0
      case 4'0111
        switch \mload_done [0]
          case 1'1
            assign $28 [0] 1'1
        end
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $28 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:55"
  cell $dff $79
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $28 [0]
    connect \CLK \clk [0]
    connect \Q \sub_done_latched
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:56"
  process $80
    assign $29 [0] \sub_fault_latched [0]
    switch \call_state [3:0]
      case 4'0000
        assign $29 [0] 1'0
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        switch \mload_fault [0]
          case 1'1
            assign $29 [0] 1'1
        end
      case 4'0110
        assign $29 [0] 1'0
      case 4'0111
        switch \mload_fault [0]
          case 1'1
            assign $29 [0] 1'1
        end
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $29 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:56"
  cell $dff $81
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $29 [0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_latched
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:51"
  process $82
    assign $30 [15:0] \mask_latched [15:0]
    switch \call_state [3:0]
      case 4'0000
        switch \call_start [0]
          case 1'1
            assign $30 [15:0] { 1'0 \port$0$2 [14:0] }
        end
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $30 [15:0] 16'0000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:51"
  cell $dff $83
    parameter \WIDTH 16
    parameter \CLK_POLARITY 1
    connect \D $30 [15:0]
    connect \CLK \clk [0]
    connect \Q \mask_latched
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $84
    assign $31 [3:0] \call_state [3:0]
    switch \call_state [3:0]
      case 4'0000
        switch \call_start [0]
          case 1'1
            assign $31 [3:0] 4'0001
        end
      case 4'0001
        switch $19 [0]
          case 1'1
            assign $31 [3:0] 4'0010
          case
            assign $31 [3:0] 4'0011
        end
      case 4'0011
        assign $31 [3:0] 4'0100
      case 4'0100
        switch $20 [0]
          case 1'1
            assign $31 [3:0] 4'0010
          case
            assign $31 [3:0] 4'0101
        end
      case 4'0101
        switch { \sub_done_latched [0] \sub_fault_latched [0] }
          case 2'-1
            assign $31 [3:0] 4'0010
          case 2'1-
            assign $31 [3:0] 4'0110
        end
      case 4'0110
        assign $31 [3:0] 4'0111
      case 4'0111
        switch { \sub_done_latched [0] \sub_fault_latched [0] }
          case 2'-1
            assign $31 [3:0] 4'0010
          case 2'1-
            assign $31 [3:0] 4'1000
        end
      case 4'1000
        assign $31 [3:0] 4'1001
      case 4'1001
        switch { $22 [0] $21 [0] }
          case 2'-1
            assign $31 [3:0] 4'1010
          case 2'1-
            assign $31 [3:0] 4'1011
          case
        end
      case 4'1011
        assign $31 [3:0] 4'1100
      case 4'1100
        assign $31 [3:0] 4'1001
      case 4'1010
        assign $31 [3:0] 4'0000
      case 4'0010
        assign $31 [3:0] 4'0000
    end
    switch \rst [0]
      case 1'1
        assign $31 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $85
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $31 [3:0]
    connect \CLK \clk [0]
    connect \Q \call_state
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  process $86
    assign $32 [127:0] \src_reg_latched [127:0]
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
        assign $32 [127:0] \cr_rd_data [127:0]
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $32 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  cell $dff $87
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $32 [127:0]
    connect \CLK \clk [0]
    connect \Q \src_reg_latched
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:54"
  process $88
    assign $33 [0] \mload_start [0]
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
        switch $20 [0]
          case 1'1
          case
            assign $33 [0] 1'1
        end
      case 4'0101
        assign $33 [0] 1'0
      case 4'0110
        assign $33 [0] 1'1
      case 4'0111
        assign $33 [0] 1'0
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $33 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:54"
  cell $dff $89
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $33 [0]
    connect \CLK \clk [0]
    connect \Q \mload_start
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:60"
  process $90
    assign $34 [2:0] \b_idx [2:0]
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        assign $34 [2:0] 3'000
      case 4'1001
        switch { $22 [0] $21 [0] }
          case 2'-1
          case 2'1-
          case
            assign $34 [2:0] $23 [2:0]
        end
      case 4'1011
      case 4'1100
        assign $34 [2:0] $24 [2:0]
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $34 [2:0] 3'000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:60"
  cell $dff $91
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $34 [2:0]
    connect \CLK \clk [0]
    connect \Q \b_idx
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  process $92
    assign $35 [127:0] \b_cr_data [127:0]
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
        assign $35 [127:0] \cr_rd_data [127:0]
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $35 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  cell $dff $93
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $35 [127:0]
    connect \CLK \clk [0]
    connect \Q \b_cr_data
  end

connect \cr_src \port$0$2 [18:15]
connect \mload_dst { 1'0 $1 [2:0] }
connect \index { 2'00 \port$0$2 [14:0] }
connect \sub_start_reg \mload_start [0]
connect \mload_cr_src \mload_src [3:0]
connect \mload_cr_dst { 1'0 $1 [2:0] }
connect \mload_index$11 \mload_index [16:0]
connect \mload_direct 1'0
connect \mload_m_elevated 1'1
connect \mload_direct_gt 32'00000000000000000000000000000000
connect \b_clear_wr_addr \cr_wr_addr [3:0]
connect \b_clear_wr_data \cr_wr_data [127:0]
connect \b_clear_wr_en \cr_wr_en [0]
connect \local_cr_rd_addr \cr_rd_addr [3:0]
connect \dr_clear_computed { 10'1111111111 $2 [4:0] 1'0 }
connect \cr_clear_computed { 10'0000000000 $3 [5:0] }
connect \fault_latched \call_fault [0]
connect \fault_type_latched \fault_type [3:0]
connect \nia_set \call_complete [0]
connect \nia_value 32'00000000000000000000000000000000
connect \mask { 1'0 \port$0$2 [14:0] }
connect \port$505$0 $1 [2:0]
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \b_clear_wr_data.word0_gt \cr_wr_data [31:0]
connect \b_clear_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \b_clear_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \b_clear_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \b_clear_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \b_clear_wr_data.word1_location \cr_wr_data [63:32]
connect \b_clear_wr_data.word2_limit \cr_wr_data [95:64]
connect \b_clear_wr_data.word3_seals \cr_wr_data [127:96]
connect \b_cr_data.word0_gt \b_cr_data [31:0]
connect \b_cr_data.word0_gt.gt_type \b_cr_data [1:0]
connect \b_cr_data.word0_gt.perms \b_cr_data [7:2]
connect \b_cr_data.word0_gt.index \b_cr_data [24:8]
connect \b_cr_data.word0_gt.version \b_cr_data [31:25]
connect \b_cr_data.word1_location \b_cr_data [63:32]
connect \b_cr_data.word2_limit \b_cr_data [95:64]
connect \b_cr_data.word3_seals \b_cr_data [127:96]
connect \src_reg_latched.word0_gt \src_reg_latched [31:0]
connect \src_reg_latched.word0_gt.gt_type \src_reg_latched [1:0]
connect \src_reg_latched.word0_gt.perms \src_reg_latched [7:2]
connect \src_reg_latched.word0_gt.index \src_reg_latched [24:8]
connect \src_reg_latched.word0_gt.version \src_reg_latched [31:25]
connect \src_reg_latched.word1_location \src_reg_latched [63:32]
connect \src_reg_latched.word2_limit \src_reg_latched [95:64]
connect \src_reg_latched.word3_seals \src_reg_latched [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/ret.py:44"
module \top.u_return

  attribute \src "/home/runner/workspace/church_machine/ret.py:51"
  wire width 1 \is_null_cap

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \return_cap

  attribute \src "/home/runner/workspace/church_machine/ret.py:62"
  attribute \init 2'00
  wire width 2 \phase

  attribute \src "/home/runner/workspace/church_machine/ret.py:65"
  attribute \init 1'0
  wire width 1 \sub_start_reg

  attribute \src "/home/runner/workspace/church_machine/ret.py:28"
  wire width 4 \mload_cr_src

  attribute \src "/home/runner/workspace/church_machine/ret.py:29"
  wire width 4 \mload_cr_dst

  attribute \src "/home/runner/workspace/church_machine/ret.py:30"
  wire width 17 \mload_index

  attribute \src "/home/runner/workspace/church_machine/ret.py:31"
  wire width 1 \mload_direct

  attribute \src "/home/runner/workspace/church_machine/ret.py:33"
  wire width 1 \mload_m_elevated

  attribute \src "/home/runner/workspace/church_machine/ret.py:32"
  wire width 32 \mload_direct_gt$12

  attribute \src "/home/runner/workspace/church_machine/ret.py:20"
  wire width 4 \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/ret.py:71"
  wire width 4 \local_cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 128 \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 128 \local_cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:22"
  wire width 1 \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/ret.py:70"
  wire width 1 \local_cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/ret.py:69"
  wire width 1 \local_cr_rd_en

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \ret_state

  attribute \src "/home/runner/workspace/church_machine/ret.py:13"
  wire width 1 \complete

  attribute \src "/home/runner/workspace/church_machine/ret.py:63"
  attribute \init 1'0
  wire width 1 \fault_flag

  attribute \src "/home/runner/workspace/church_machine/ret.py:64"
  attribute \init 4'0000
  wire width 4 \fault_latched

  attribute \src "/home/runner/workspace/church_machine/ret.py:66"
  attribute \init 1'0
  wire width 1 \sub_done_latched

  attribute \src "/home/runner/workspace/church_machine/ret.py:67"
  attribute \init 1'0
  wire width 1 \sub_fault_latched

  attribute \src "/home/runner/workspace/church_machine/ret.py:11"
  wire width 3 input 0  \cr_src

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \rst

  attribute \src "/home/runner/workspace/church_machine/ret.py:10"
  wire width 1 input 3  \return_start

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 128 input 4  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:18"
  wire width 4 output 5  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/ret.py:12"
  wire width 1 output 6  \busy

  attribute \src "/home/runner/workspace/church_machine/ret.py:16"
  wire width 1 output 7  \reboot_request

  attribute \src "/home/runner/workspace/church_machine/ret.py:36"
  wire width 1 input 8  \mload_fault

  attribute \src "/home/runner/workspace/church_machine/ret.py:35"
  wire width 1 input 9  \mload_done

  attribute \src "/home/runner/workspace/church_machine/ret.py:39"
  wire width 1 input 10  \lambda_active

  attribute \src "/home/runner/workspace/church_machine/ret.py:40"
  wire width 32 input 11  \lambda_pc

  attribute \src "/home/runner/workspace/church_machine/ret.py:29"
  wire width 4 output 12  \mload_dst

  attribute \src "/home/runner/workspace/church_machine/ret.py:32"
  wire width 32 output 13  \mload_direct_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:24"
  wire width 1 output 14  \nia_set

  attribute \src "/home/runner/workspace/church_machine/ret.py:25"
  wire width 32 output 15  \nia_value

  attribute \src "/home/runner/workspace/church_machine/ret.py:41"
  wire width 1 output 16  \lambda_clear

  attribute \src "/home/runner/workspace/church_machine/ret.py:63"
  attribute \init 1'0
  wire width 1 output 17  \fault_valid

  attribute \src "/home/runner/workspace/church_machine/ret.py:64"
  attribute \init 4'0000
  wire width 4 output 18  \fault_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:65"
  attribute \init 1'0
  wire width 1 output 19  \mload_start

  attribute \src "/home/runner/workspace/church_machine/ret.py:37"
  wire width 4 input 20  \mload_fault_type

  wire width 33 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 4 $15

  wire width 2 $16

  wire width 1 $17

  wire width 1 $18

  wire width 4 $19

  wire width 128 $20

  wire width 1 $21

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 32 \return_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 2 \return_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 6 \return_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 17 \return_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 7 \return_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 32 \return_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 32 \return_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 32 \return_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 32 \local_cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 2 \local_cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 6 \local_cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 17 \local_cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 7 \local_cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 32 \local_cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 32 \local_cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 32 \local_cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:52"
  cell $eq $22
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \return_cap [1:0]
    connect \B 2'10
    connect \Y \is_null_cap
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:105"
  cell $mux $23
    parameter \WIDTH 4
    connect \S \local_cr_rd_en [0]
    connect \A 4'0000
    connect \B { 1'0 \cr_src [2:0] }
    connect \Y \cr_rd_addr
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:181"
  cell $add $24
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A \return_cap [63:32]
    connect \B 3'100
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:195"
  cell $not $25
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $2 [0]
    connect \Y \busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $26
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B {  }
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $27
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 1'1
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $28
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 2'10
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $29
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 2'11
    connect \Y \complete
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $30
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 3'100
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $31
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 3'101
    connect \Y \reboot_request
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $32
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 3'110
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 3'111
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $34
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 4'1000
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 4'1001
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 4'1010
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 4'1011
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:134"
  cell $not $38
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \return_cap [7]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:141"
  cell $not $39
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \return_cap [71]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:74"
  process $40
    assign \mload_dst [3:0] 4'0000
    switch \phase [1:0]
      case 2'01
        assign \mload_dst [3:0] 4'0110
      case
        assign \mload_dst [3:0] 4'0111
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:75"
  process $41
    assign \mload_direct_gt [31:0] 32'00000000000000000000000000000000
    switch \phase [1:0]
      case 2'01
        assign \mload_direct_gt [31:0] \return_cap [95:64]
      case
        assign \mload_direct_gt [31:0] \return_cap [127:96]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:24"
  process $42
    assign \nia_set [0] 1'0
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
        assign \nia_set [0] 1'1
      case 4'0010
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
        assign \nia_set [0] 1'1
      case 4'0011
      case 4'0101
      case 4'0110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:25"
  process $43
    assign \nia_value [31:0] 32'00000000000000000000000000000000
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
        assign \nia_value [31:0] \lambda_pc [31:0]
      case 4'0010
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
        assign \nia_value [31:0] $1 [31:0]
      case 4'0011
      case 4'0101
      case 4'0110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:41"
  process $44
    assign \lambda_clear [0] 1'0
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
        assign \lambda_clear [0] 1'1
      case 4'0010
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:69"
  process $45
    assign \local_cr_rd_en [0] 1'0
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
        assign \local_cr_rd_en [0] 1'1
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:63"
  process $46
    assign $14 [0] \fault_valid [0]
    switch \ret_state [3:0]
      case 4'0000
        assign $14 [0] 1'0
      case 4'0001
      case 4'0010
      case 4'0100
        switch { $12 [0] \is_null_cap [0] }
          case 2'-1
          case 2'1-
            assign $14 [0] 1'1
          case
        end
      case 4'0111
        switch $13 [0]
          case 1'1
            assign $14 [0] 1'1
          case
        end
      case 4'1000
        switch \mload_fault [0]
          case 1'1
            assign $14 [0] 1'1
        end
      case 4'1001
      case 4'1010
        switch \mload_fault [0]
          case 1'1
            assign $14 [0] 1'1
        end
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $14 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:63"
  cell $dff $47
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $14 [0]
    connect \CLK \clk [0]
    connect \Q \fault_valid
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:64"
  process $48
    assign $15 [3:0] \fault_type [3:0]
    switch \ret_state [3:0]
      case 4'0000
        assign $15 [3:0] 4'0000
      case 4'0001
      case 4'0010
      case 4'0100
        switch { $12 [0] \is_null_cap [0] }
          case 2'-1
          case 2'1-
            assign $15 [3:0] 4'0110
          case
        end
      case 4'0111
        switch $13 [0]
          case 1'1
            assign $15 [3:0] 4'0110
          case
        end
      case 4'1000
        switch \mload_fault [0]
          case 1'1
            assign $15 [3:0] \mload_fault_type [3:0]
        end
      case 4'1001
      case 4'1010
        switch \mload_fault [0]
          case 1'1
            assign $15 [3:0] \mload_fault_type [3:0]
        end
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $15 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:64"
  cell $dff $49
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $15 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:62"
  process $50
    assign $16 [1:0] \phase [1:0]
    switch \ret_state [3:0]
      case 4'0000
        assign $16 [1:0] 2'01
      case 4'0001
      case 4'0010
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
        assign $16 [1:0] 2'10
      case 4'1010
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $16 [1:0] 2'00
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:62"
  cell $dff $51
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $16 [1:0]
    connect \CLK \clk [0]
    connect \Q \phase
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:66"
  process $52
    assign $17 [0] \sub_done_latched [0]
    switch \ret_state [3:0]
      case 4'0000
        assign $17 [0] 1'0
      case 4'0001
      case 4'0010
      case 4'0100
      case 4'0111
        switch $13 [0]
          case 1'1
          case
            assign $17 [0] 1'0
        end
      case 4'1000
        switch \mload_done [0]
          case 1'1
            assign $17 [0] 1'1
        end
      case 4'1001
        assign $17 [0] 1'0
      case 4'1010
        switch \mload_done [0]
          case 1'1
            assign $17 [0] 1'1
        end
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $17 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:66"
  cell $dff $53
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $17 [0]
    connect \CLK \clk [0]
    connect \Q \sub_done_latched
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:67"
  process $54
    assign $18 [0] \sub_fault_latched [0]
    switch \ret_state [3:0]
      case 4'0000
        assign $18 [0] 1'0
      case 4'0001
      case 4'0010
      case 4'0100
      case 4'0111
        switch $13 [0]
          case 1'1
          case
            assign $18 [0] 1'0
        end
      case 4'1000
        switch \mload_fault [0]
          case 1'1
            assign $18 [0] 1'1
        end
      case 4'1001
        assign $18 [0] 1'0
      case 4'1010
        switch \mload_fault [0]
          case 1'1
            assign $18 [0] 1'1
        end
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $18 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:67"
  cell $dff $55
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $18 [0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_latched
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $56
    assign $19 [3:0] \ret_state [3:0]
    switch \ret_state [3:0]
      case 4'0000
        switch \return_start [0]
          case 1'1
            switch \lambda_active [0]
              case 1'1
                assign $19 [3:0] 4'0001
              case
                assign $19 [3:0] 4'0010
            end
        end
      case 4'0001
        assign $19 [3:0] 4'0011
      case 4'0010
        assign $19 [3:0] 4'0100
      case 4'0100
        switch { $12 [0] \is_null_cap [0] }
          case 2'-1
            assign $19 [3:0] 4'0101
          case 2'1-
            assign $19 [3:0] 4'0110
          case
            assign $19 [3:0] 4'0111
        end
      case 4'0111
        switch $13 [0]
          case 1'1
            assign $19 [3:0] 4'0110
          case
            assign $19 [3:0] 4'1000
        end
      case 4'1000
        switch { \sub_done_latched [0] \sub_fault_latched [0] }
          case 2'-1
            assign $19 [3:0] 4'0110
          case 2'1-
            assign $19 [3:0] 4'1001
        end
      case 4'1001
        assign $19 [3:0] 4'1010
      case 4'1010
        switch { \sub_done_latched [0] \sub_fault_latched [0] }
          case 2'-1
            assign $19 [3:0] 4'0110
          case 2'1-
            assign $19 [3:0] 4'1011
        end
      case 4'1011
        assign $19 [3:0] 4'0011
      case 4'0011
        assign $19 [3:0] 4'0000
      case 4'0101
        assign $19 [3:0] 4'0000
      case 4'0110
        assign $19 [3:0] 4'0000
    end
    switch \rst [0]
      case 1'1
        assign $19 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $57
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $19 [3:0]
    connect \CLK \clk [0]
    connect \Q \ret_state
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  process $58
    assign $20 [127:0] \return_cap [127:0]
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
        assign $20 [127:0] \cr_rd_data [127:0]
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $20 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  cell $dff $59
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $20 [127:0]
    connect \CLK \clk [0]
    connect \Q \return_cap
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:65"
  process $60
    assign $21 [0] \mload_start [0]
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0100
      case 4'0111
        switch $13 [0]
          case 1'1
          case
            assign $21 [0] 1'1
        end
      case 4'1000
        assign $21 [0] 1'0
      case 4'1001
        assign $21 [0] 1'1
      case 4'1010
        assign $21 [0] 1'0
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $21 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:65"
  cell $dff $61
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $21 [0]
    connect \CLK \clk [0]
    connect \Q \mload_start
  end

connect \sub_start_reg \mload_start [0]
connect \mload_cr_src 4'0000
connect \mload_cr_dst \mload_dst [3:0]
connect \mload_index 17'00000000000000000
connect \mload_direct 1'1
connect \mload_m_elevated 1'1
connect \mload_direct_gt$12 \mload_direct_gt [31:0]
connect \cr_wr_addr 4'0000
connect \local_cr_wr_addr 4'0000
connect \cr_wr_data 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \local_cr_wr_data 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \cr_wr_en 1'0
connect \local_cr_wr_en 1'0
connect \fault_flag \fault_valid [0]
connect \fault_latched \fault_type [3:0]
connect \return_cap.word0_gt \return_cap [31:0]
connect \return_cap.word0_gt.gt_type \return_cap [1:0]
connect \return_cap.word0_gt.perms \return_cap [7:2]
connect \return_cap.word0_gt.index \return_cap [24:8]
connect \return_cap.word0_gt.version \return_cap [31:25]
connect \return_cap.word1_location \return_cap [63:32]
connect \return_cap.word2_limit \return_cap [95:64]
connect \return_cap.word3_seals \return_cap [127:96]
connect \cr_wr_data.word0_gt 32'00000000000000000000000000000000
connect \cr_wr_data.word0_gt.gt_type 2'00
connect \cr_wr_data.word0_gt.perms 6'000000
connect \cr_wr_data.word0_gt.index 17'00000000000000000
connect \cr_wr_data.word0_gt.version 7'0000000
connect \cr_wr_data.word1_location 32'00000000000000000000000000000000
connect \cr_wr_data.word2_limit 32'00000000000000000000000000000000
connect \cr_wr_data.word3_seals 32'00000000000000000000000000000000
connect \local_cr_wr_data.word0_gt 32'00000000000000000000000000000000
connect \local_cr_wr_data.word0_gt.gt_type 2'00
connect \local_cr_wr_data.word0_gt.perms 6'000000
connect \local_cr_wr_data.word0_gt.index 17'00000000000000000
connect \local_cr_wr_data.word0_gt.version 7'0000000
connect \local_cr_wr_data.word1_location 32'00000000000000000000000000000000
connect \local_cr_wr_data.word2_limit 32'00000000000000000000000000000000
connect \local_cr_wr_data.word3_seals 32'00000000000000000000000000000000
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/tperm.py:27"
module \top.u_tperm

  attribute \src "/home/runner/workspace/church_machine/tperm.py:32"
  attribute \init 4'0000
  wire width 4 \preset_reg

  attribute \src "/home/runner/workspace/church_machine/tperm.py:36"
  wire width 6 \new_perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:37"
  wire width 1 \is_reserved

  attribute \src "/home/runner/workspace/church_machine/tperm.py:63"
  wire width 1 \can_only_reduce

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \target_cap

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \tperm_state

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 128 \result_cap

  attribute \src "/home/runner/workspace/church_machine/tperm.py:15"
  wire width 1 \tperm_complete

  attribute \src "/home/runner/workspace/church_machine/tperm.py:33"
  attribute \init 1'0
  wire width 1 \fault_flag

  attribute \src "/home/runner/workspace/church_machine/tperm.py:34"
  attribute \init 4'0000
  wire width 4 \fault_latched

  attribute \src "/home/runner/workspace/church_machine/tperm.py:12"
  wire width 4 input 0  \preset

  attribute \src "/home/runner/workspace/church_machine/tperm.py:11"
  wire width 4 input 1  \cr_target

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 3  \rst

  attribute \src "/home/runner/workspace/church_machine/tperm.py:10"
  wire width 1 input 4  \tperm_start

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 128 input 5  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/tperm.py:14"
  wire width 1 output 6  \tperm_busy

  attribute \src "/home/runner/workspace/church_machine/tperm.py:19"
  wire width 4 output 7  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/tperm.py:22"
  wire width 4 output 8  \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 128 output 9  \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/tperm.py:24"
  wire width 1 output 10  \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/tperm.py:33"
  attribute \init 1'0
  wire width 1 output 11  \tperm_fault

  attribute \src "/home/runner/workspace/church_machine/tperm.py:34"
  attribute \init 4'0000
  wire width 4 output 12  \fault_type

  wire width 6 $1

  wire width 6 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 4 $10

  wire width 4 $11

  wire width 3 $12

  wire width 128 $13

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 32 \target_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 2 \target_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 6 \target_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 17 \target_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 7 \target_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 32 \target_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 32 \target_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 32 \target_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 32 \result_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 2 \result_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 6 \result_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 17 \result_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 7 \result_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 32 \result_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 32 \result_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 32 \result_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:64"
  cell $and $14
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \new_perms [5:0]
    connect \B \target_cap [7:2]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:64"
  cell $eq $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $1 [5:0]
    connect \B \new_perms [5:0]
    connect \Y \can_only_reduce
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:94"
  cell $and $16
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \new_perms [5:0]
    connect \B \target_cap [7:2]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:108"
  cell $not $17
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $3 [0]
    connect \Y \tperm_busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $18
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B {  }
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $19
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 1'1
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $20
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 2'10
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $21
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 2'11
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $22
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 3'100
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $23
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 3'101
    connect \Y \tperm_complete
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:82"
  cell $not $24
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \can_only_reduce [0]
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:36"
  process $25
    assign \new_perms [5:0] 6'000000
    switch \preset_reg [3:0]
      case 4'0000
        assign \new_perms [5:0] 6'000000
      case 4'0001
        assign \new_perms [5:0] 6'000001
      case 4'0010
        assign \new_perms [5:0] 6'000011
      case 4'0011
        assign \new_perms [5:0] 6'000100
      case 4'0100
        assign \new_perms [5:0] 6'000101
      case 4'0101
        assign \new_perms [5:0] 6'000111
      case 4'0110
        assign \new_perms [5:0] 6'001000
      case 4'0111
        assign \new_perms [5:0] 6'010000
      case 4'1000
        assign \new_perms [5:0] 6'100000
      case 4'1001
        assign \new_perms [5:0] 6'011000
      case
        assign \new_perms [5:0] 6'000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:37"
  process $26
    assign \is_reserved [0] 1'0
    switch \preset_reg [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case
        assign \is_reserved [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:19"
  process $27
    assign \cr_rd_addr [3:0] 4'0000
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
        assign \cr_rd_addr [3:0] \cr_target [3:0]
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  process $28
    assign \result_cap [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \result_cap [127:0] \target_cap [127:0]
        assign \result_cap [7:2] $2 [5:0]
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:22"
  process $29
    assign \cr_wr_addr [3:0] 4'0000
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \cr_wr_addr [3:0] \cr_target [3:0]
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  process $30
    assign \cr_wr_data [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \cr_wr_data [127:0] \result_cap [127:0]
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:24"
  process $31
    assign \cr_wr_en [0] 1'0
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \cr_wr_en [0] 1'1
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:33"
  process $32
    assign $9 [0] \tperm_fault [0]
    switch \tperm_state [2:0]
      case 3'000
        assign $9 [0] 1'0
      case 3'001
      case 3'010
        switch { $8 [0] \is_reserved [0] }
          case 2'-1
            assign $9 [0] 1'1
          case 2'1-
            assign $9 [0] 1'1
          case
        end
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $9 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:33"
  cell $dff $33
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $9 [0]
    connect \CLK \clk [0]
    connect \Q \tperm_fault
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:34"
  process $34
    assign $10 [3:0] \fault_type [3:0]
    switch \tperm_state [2:0]
      case 3'000
        assign $10 [3:0] 4'0000
      case 3'001
      case 3'010
        switch { $8 [0] \is_reserved [0] }
          case 2'-1
            assign $10 [3:0] 4'1100
          case 2'1-
            assign $10 [3:0] 4'1101
          case
        end
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $10 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:34"
  cell $dff $35
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $10 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:32"
  process $36
    assign $11 [3:0] \preset_reg [3:0]
    switch \tperm_state [2:0]
      case 3'000
        switch \tperm_start [0]
          case 1'1
            assign $11 [3:0] \preset [3:0]
        end
      case 3'001
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $11 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:32"
  cell $dff $37
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $11 [3:0]
    connect \CLK \clk [0]
    connect \Q \preset_reg
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $38
    assign $12 [2:0] \tperm_state [2:0]
    switch \tperm_state [2:0]
      case 3'000
        switch \tperm_start [0]
          case 1'1
            assign $12 [2:0] 3'001
        end
      case 3'001
        assign $12 [2:0] 3'010
      case 3'010
        switch { $8 [0] \is_reserved [0] }
          case 2'-1
            assign $12 [2:0] 3'011
          case 2'1-
            assign $12 [2:0] 3'011
          case
            assign $12 [2:0] 3'100
        end
      case 3'100
        assign $12 [2:0] 3'101
      case 3'101
        assign $12 [2:0] 3'000
      case 3'011
        assign $12 [2:0] 3'000
    end
    switch \rst [0]
      case 1'1
        assign $12 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $39
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $12 [2:0]
    connect \CLK \clk [0]
    connect \Q \tperm_state
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  process $40
    assign $13 [127:0] \target_cap [127:0]
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
        assign $13 [127:0] \cr_rd_data [127:0]
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $13 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  cell $dff $41
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $13 [127:0]
    connect \CLK \clk [0]
    connect \Q \target_cap
  end

connect \fault_flag \tperm_fault [0]
connect \fault_latched \fault_type [3:0]
connect \target_cap.word0_gt \target_cap [31:0]
connect \target_cap.word0_gt.gt_type \target_cap [1:0]
connect \target_cap.word0_gt.perms \target_cap [7:2]
connect \target_cap.word0_gt.index \target_cap [24:8]
connect \target_cap.word0_gt.version \target_cap [31:25]
connect \target_cap.word1_location \target_cap [63:32]
connect \target_cap.word2_limit \target_cap [95:64]
connect \target_cap.word3_seals \target_cap [127:96]
connect \result_cap.word0_gt \result_cap [31:0]
connect \result_cap.word0_gt.gt_type \result_cap [1:0]
connect \result_cap.word0_gt.perms \result_cap [7:2]
connect \result_cap.word0_gt.index \result_cap [24:8]
connect \result_cap.word0_gt.version \result_cap [31:25]
connect \result_cap.word1_location \result_cap [63:32]
connect \result_cap.word2_limit \result_cap [95:64]
connect \result_cap.word3_seals \result_cap [127:96]
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/save.py:36"
module \top.u_save

  attribute \src "/home/runner/workspace/church_machine/save.py:52"
  wire width 1 \dst_in_range

  attribute \src "/home/runner/workspace/church_machine/save.py:13"
  wire width 4 \cr_dst

  attribute \src "/home/runner/workspace/church_machine/msave.py:12"
  attribute \init 1'0
  wire width 1 \sub_start

  attribute \src "/home/runner/workspace/church_machine/save.py:47"
  attribute \init 1'0
  wire width 1 \sub_start$3

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \sub_dst_cap

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \dst_reg_latched

  attribute \src "/home/runner/workspace/church_machine/msave.py:14"
  wire width 32 \sub_src_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \src_reg_latched

  attribute \src "/home/runner/workspace/church_machine/msave.py:15"
  wire width 17 \sub_index

  attribute \src "/home/runner/workspace/church_machine/save.py:14"
  wire width 17 \index

  attribute \src "/home/runner/workspace/church_machine/msave.py:24"
  wire width 1 \mem_wr_done

  attribute \src "/home/runner/workspace/church_machine/save.py:26"
  wire width 1 \mem_wr_done$11

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 128 \cr15_namespace$13

  attribute \src "/home/runner/workspace/church_machine/save.py:30"
  wire width 32 \mem_rd_data$15

  attribute \src "/home/runner/workspace/church_machine/msave.py:29"
  wire width 1 \mem_rd_valid

  attribute \src "/home/runner/workspace/church_machine/save.py:31"
  wire width 1 \mem_rd_valid$17

  attribute \src "/home/runner/workspace/church_machine/msave.py:21"
  wire width 32 \mem_wr_addr$19

  attribute \src "/home/runner/workspace/church_machine/msave.py:22"
  wire width 32 \mem_wr_data$21

  attribute \src "/home/runner/workspace/church_machine/msave.py:23"
  wire width 1 \mem_wr_en$23

  attribute \src "/home/runner/workspace/church_machine/msave.py:26"
  wire width 32 \mem_rd_addr$25

  attribute \src "/home/runner/workspace/church_machine/msave.py:27"
  wire width 1 \mem_rd_en$27

  attribute \src "/home/runner/workspace/church_machine/save.py:48"
  attribute \init 1'0
  wire width 1 \sub_start_reg

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \save_wrapper_state

  attribute \src "/home/runner/workspace/church_machine/save.py:12"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/save.py:16"
  wire width 1 \save_complete

  attribute \src "/home/runner/workspace/church_machine/save.py:49"
  attribute \init 1'0
  wire width 1 \sub_done_latched

  attribute \src "/home/runner/workspace/church_machine/save.py:45"
  attribute \init 1'0
  wire width 1 \fault_latched

  attribute \src "/home/runner/workspace/church_machine/save.py:46"
  attribute \init 4'0000
  wire width 4 \fault_type_latched

  attribute \src "/home/runner/workspace/church_machine/save.py:50"
  attribute \init 1'0
  wire width 1 \sub_fault_latched

  attribute \src "/home/runner/workspace/church_machine/msave.py:17"
  wire width 1 \sub_done

  attribute \src "/home/runner/workspace/church_machine/msave.py:18"
  wire width 1 \sub_fault

  attribute \src "/home/runner/workspace/church_machine/msave.py:19"
  wire width 4 \sub_fault_type

  wire width 23 input 0  \port$0$2

  attribute \src "/home/runner/workspace/church_machine/save.py:30"
  wire width 32 input 1  \mem_rd_data

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 3  \rst

  attribute \src "/home/runner/workspace/church_machine/save.py:11"
  wire width 1 input 4  \save_start

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 128 input 5  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/save.py:15"
  wire width 1 output 6  \save_busy

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 128 input 7  \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/save.py:20"
  wire width 4 output 8  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/save.py:45"
  attribute \init 1'0
  wire width 1 output 9  \save_fault

  attribute \src "/home/runner/workspace/church_machine/save.py:46"
  attribute \init 4'0000
  wire width 4 output 10  \fault_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:26"
  wire width 32 output 11  \mem_rd_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:27"
  wire width 1 output 12  \mem_rd_en

  attribute \src "/home/runner/workspace/church_machine/msave.py:23"
  wire width 1 output 13  \mem_wr_en

  attribute \src "/home/runner/workspace/church_machine/msave.py:21"
  wire width 32 output 14  \mem_wr_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:22"
  wire width 32 output 15  \mem_wr_data

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 4 $8

  wire width 1 $9

  wire width 1 $10

  wire width 3 $11

  wire width 128 $12

  wire width 128 $13

  wire width 1 $14

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 2 \sub_dst_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 6 \sub_dst_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 17 \sub_dst_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 7 \sub_dst_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 32 \dst_reg_latched.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 2 \dst_reg_latched.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 6 \dst_reg_latched.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 17 \dst_reg_latched.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 7 \dst_reg_latched.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 32 \dst_reg_latched.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 32 \dst_reg_latched.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 32 \dst_reg_latched.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 32 \src_reg_latched.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 2 \src_reg_latched.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 6 \src_reg_latched.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 17 \src_reg_latched.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 7 \src_reg_latched.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 32 \src_reg_latched.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 32 \src_reg_latched.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 32 \src_reg_latched.word3_seals

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace$13.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 2 \cr15_namespace$13.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 6 \cr15_namespace$13.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 17 \cr15_namespace$13.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 7 \cr15_namespace$13.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace$13.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace$13.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace$13.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:41"
  cell \top.u_save.u_msave \u_msave
    connect \port$0$2 \port$0$2 [14:0]
    connect \mem_rd_data \mem_rd_data [31:0]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \sub_fault \sub_fault [0]
    connect \sub_done \sub_done [0]
    connect \cr15_namespace \cr15_namespace [127:0]
    connect \sub_dst_cap \sub_dst_cap [127:0]
    connect \sub_src_gt \src_reg_latched [31:0]
    connect \sub_start \sub_start [0]
    connect \mem_rd_addr \mem_rd_addr [31:0]
    connect \mem_rd_en \mem_rd_en [0]
    connect \mem_wr_en \mem_wr_en [0]
    connect \mem_wr_addr \mem_wr_addr [31:0]
    connect \mem_wr_data \mem_wr_data [31:0]
    connect \sub_fault_type \sub_fault_type [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:53"
  cell $le $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \port$0$2 [22:19]
    connect \B 3'110
    connect \Y \dst_in_range
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:115"
  cell $not $16
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $1 [0]
    connect \Y \save_busy
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:116"
  cell $and $17
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $5 [0]
    connect \B \sub_done_latched [0]
    connect \Y \save_complete
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $18
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B {  }
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $19
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B 1'1
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $20
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B 2'10
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $21
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B 2'11
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $22
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B 3'100
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:85"
  cell $not $23
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \dst_in_range [0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:20"
  process $24
    assign \cr_rd_addr [3:0] 4'0000
    switch \save_wrapper_state [2:0]
      case 3'000
      case 3'001
        assign \cr_rd_addr [3:0] \port$0$2 [22:19]
      case 3'010
        assign \cr_rd_addr [3:0] \port$0$2 [18:15]
      case 3'011
        assign \cr_rd_addr [3:0] \port$0$2 [18:15]
      case 3'100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:45"
  process $25
    assign $7 [0] \save_fault [0]
    switch \save_wrapper_state [2:0]
      case 3'000
        assign $7 [0] 1'0
      case 3'001
        switch $6 [0]
          case 1'1
            assign $7 [0] 1'1
          case
        end
      case 3'010
      case 3'011
      case 3'100
        switch \sub_fault [0]
          case 1'1
            assign $7 [0] 1'1
        end
    end
    switch \rst [0]
      case 1'1
        assign $7 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:45"
  cell $dff $26
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $7 [0]
    connect \CLK \clk [0]
    connect \Q \save_fault
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:46"
  process $27
    assign $8 [3:0] \fault_type [3:0]
    switch \save_wrapper_state [2:0]
      case 3'000
        assign $8 [3:0] 4'0000
      case 3'001
        switch $6 [0]
          case 1'1
            assign $8 [3:0] 4'0101
          case
        end
      case 3'010
      case 3'011
      case 3'100
        switch \sub_fault [0]
          case 1'1
            assign $8 [3:0] \sub_fault_type [3:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $8 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:46"
  cell $dff $28
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $8 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:49"
  process $29
    assign $9 [0] \sub_done_latched [0]
    switch \save_wrapper_state [2:0]
      case 3'000
        assign $9 [0] 1'0
      case 3'001
      case 3'010
      case 3'011
      case 3'100
        switch \sub_done [0]
          case 1'1
            assign $9 [0] 1'1
        end
    end
    switch \rst [0]
      case 1'1
        assign $9 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:49"
  cell $dff $30
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $9 [0]
    connect \CLK \clk [0]
    connect \Q \sub_done_latched
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:50"
  process $31
    assign $10 [0] \sub_fault_latched [0]
    switch \save_wrapper_state [2:0]
      case 3'000
        assign $10 [0] 1'0
      case 3'001
      case 3'010
      case 3'011
      case 3'100
        switch \sub_fault [0]
          case 1'1
            assign $10 [0] 1'1
        end
    end
    switch \rst [0]
      case 1'1
        assign $10 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:50"
  cell $dff $32
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $10 [0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_latched
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $33
    assign $11 [2:0] \save_wrapper_state [2:0]
    switch \save_wrapper_state [2:0]
      case 3'000
        switch \save_start [0]
          case 1'1
            assign $11 [2:0] 3'001
        end
      case 3'001
        switch $6 [0]
          case 1'1
            assign $11 [2:0] 3'000
          case
            assign $11 [2:0] 3'010
        end
      case 3'010
        assign $11 [2:0] 3'011
      case 3'011
        assign $11 [2:0] 3'100
      case 3'100
        switch { \sub_fault_latched [0] \sub_done_latched [0] }
          case 2'-1
            assign $11 [2:0] 3'000
          case 2'1-
            assign $11 [2:0] 3'000
        end
    end
    switch \rst [0]
      case 1'1
        assign $11 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $34
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $11 [2:0]
    connect \CLK \clk [0]
    connect \Q \save_wrapper_state
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  process $35
    assign $12 [127:0] \sub_dst_cap [127:0]
    switch \save_wrapper_state [2:0]
      case 3'000
      case 3'001
      case 3'010
        assign $12 [127:0] \cr_rd_data [127:0]
      case 3'011
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $12 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  cell $dff $36
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $12 [127:0]
    connect \CLK \clk [0]
    connect \Q \sub_dst_cap
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  process $37
    assign $13 [127:0] \src_reg_latched [127:0]
    switch \save_wrapper_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'011
        assign $13 [127:0] \cr_rd_data [127:0]
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $13 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  cell $dff $38
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $13 [127:0]
    connect \CLK \clk [0]
    connect \Q \src_reg_latched
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:48"
  process $39
    assign $14 [0] \sub_start [0]
    switch \save_wrapper_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'011
        assign $14 [0] 1'1
      case 3'100
        assign $14 [0] 1'0
    end
    switch \rst [0]
      case 1'1
        assign $14 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:48"
  cell $dff $40
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $14 [0]
    connect \CLK \clk [0]
    connect \Q \sub_start
  end

connect \cr_dst \port$0$2 [22:19]
connect \sub_start$3 \sub_start [0]
connect \dst_reg_latched \sub_dst_cap [127:0]
connect \sub_src_gt \src_reg_latched [31:0]
connect \sub_index { 2'00 \port$0$2 [14:0] }
connect \index { 2'00 \port$0$2 [14:0] }
connect \mem_wr_done 1'1
connect \mem_wr_done$11 1'1
connect \cr15_namespace$13 \cr15_namespace [127:0]
connect \mem_rd_data$15 \mem_rd_data [31:0]
connect \mem_rd_valid 1'1
connect \mem_rd_valid$17 1'1
connect \mem_wr_addr$19 \mem_wr_addr [31:0]
connect \mem_wr_data$21 \mem_wr_data [31:0]
connect \mem_wr_en$23 \mem_wr_en [0]
connect \mem_rd_addr$25 \mem_rd_addr [31:0]
connect \mem_rd_en$27 \mem_rd_en [0]
connect \sub_start_reg \sub_start [0]
connect \cr_src \port$0$2 [18:15]
connect \fault_latched \save_fault [0]
connect \fault_type_latched \fault_type [3:0]
connect \sub_dst_cap.word0_gt \sub_dst_cap [31:0]
connect \sub_dst_cap.word0_gt.gt_type \sub_dst_cap [1:0]
connect \sub_dst_cap.word0_gt.perms \sub_dst_cap [7:2]
connect \sub_dst_cap.word0_gt.index \sub_dst_cap [24:8]
connect \sub_dst_cap.word0_gt.version \sub_dst_cap [31:25]
connect \sub_dst_cap.word1_location \sub_dst_cap [63:32]
connect \sub_dst_cap.word2_limit \sub_dst_cap [95:64]
connect \sub_dst_cap.word3_seals \sub_dst_cap [127:96]
connect \dst_reg_latched.word0_gt \sub_dst_cap [31:0]
connect \dst_reg_latched.word0_gt.gt_type \sub_dst_cap [1:0]
connect \dst_reg_latched.word0_gt.perms \sub_dst_cap [7:2]
connect \dst_reg_latched.word0_gt.index \sub_dst_cap [24:8]
connect \dst_reg_latched.word0_gt.version \sub_dst_cap [31:25]
connect \dst_reg_latched.word1_location \sub_dst_cap [63:32]
connect \dst_reg_latched.word2_limit \sub_dst_cap [95:64]
connect \dst_reg_latched.word3_seals \sub_dst_cap [127:96]
connect \src_reg_latched.word0_gt \src_reg_latched [31:0]
connect \src_reg_latched.word0_gt.gt_type \src_reg_latched [1:0]
connect \src_reg_latched.word0_gt.perms \src_reg_latched [7:2]
connect \src_reg_latched.word0_gt.index \src_reg_latched [24:8]
connect \src_reg_latched.word0_gt.version \src_reg_latched [31:25]
connect \src_reg_latched.word1_location \src_reg_latched [63:32]
connect \src_reg_latched.word2_limit \src_reg_latched [95:64]
connect \src_reg_latched.word3_seals \src_reg_latched [127:96]
connect \cr15_namespace.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace.word1_location \cr15_namespace [63:32]
connect \cr15_namespace.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace.word3_seals \cr15_namespace [127:96]
connect \cr15_namespace$13.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace$13.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace$13.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace$13.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace$13.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace$13.word1_location \cr15_namespace [63:32]
connect \cr15_namespace$13.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace$13.word3_seals \cr15_namespace [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/msave.py:34"
module \top.u_save.u_msave

  attribute \src "/home/runner/workspace/church_machine/msave.py:50"
  wire width 1 \index_in_bounds

  attribute \src "/home/runner/workspace/church_machine/msave.py:38"
  attribute \init 17'00000000000000000
  wire width 17 \index_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \dst_cap_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:53"
  wire width 32 \write_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:56"
  wire width 32 \ns_entry_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:37"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \src_gt_reg

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \msave_state

  attribute \src "/home/runner/workspace/church_machine/msave.py:16"
  wire width 1 \sub_busy

  attribute \src "/home/runner/workspace/church_machine/msave.py:39"
  attribute \init 4'0000
  wire width 4 \fault_type_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:15"
  wire width 17 \sub_index

  attribute \src "/home/runner/workspace/church_machine/msave.py:29"
  wire width 1 \mem_rd_valid

  attribute \src "/home/runner/workspace/church_machine/msave.py:59"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \ns_location_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:60"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \ns_limit_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:24"
  wire width 1 \mem_wr_done

  wire width 15 input 0  \port$0$2

  attribute \src "/home/runner/workspace/church_machine/msave.py:28"
  wire width 32 input 1  \mem_rd_data

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 3  \rst

  attribute \src "/home/runner/workspace/church_machine/msave.py:18"
  wire width 1 output 4  \sub_fault

  attribute \src "/home/runner/workspace/church_machine/msave.py:17"
  wire width 1 output 5  \sub_done

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 128 input 6  \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 128 input 7  \sub_dst_cap

  attribute \src "/home/runner/workspace/church_machine/msave.py:14"
  wire width 32 input 8  \sub_src_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:12"
  wire width 1 input 9  \sub_start

  attribute \src "/home/runner/workspace/church_machine/msave.py:26"
  wire width 32 output 10  \mem_rd_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:27"
  wire width 1 output 11  \mem_rd_en

  attribute \src "/home/runner/workspace/church_machine/msave.py:23"
  wire width 1 output 12  \mem_wr_en

  attribute \src "/home/runner/workspace/church_machine/msave.py:21"
  wire width 32 output 13  \mem_wr_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:22"
  wire width 32 output 14  \mem_wr_data

  attribute \src "/home/runner/workspace/church_machine/msave.py:39"
  attribute \init 4'0000
  wire width 4 output 15  \sub_fault_type

  wire width 20 $1

  wire width 33 $2

  wire width 20 $3

  wire width 33 $4

  wire width 20 $5

  wire width 34 $6

  wire width 33 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 128 $19

  wire width 32 $20

  wire width 17 $21

  wire width 4 $22

  wire width 4 $23

  wire width 32 $24

  wire width 32 $25

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 32 \dst_cap_reg.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 2 \dst_cap_reg.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 6 \dst_cap_reg.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 17 \dst_cap_reg.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 7 \dst_cap_reg.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 32 \dst_cap_reg.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 32 \dst_cap_reg.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 32 \dst_cap_reg.word3_seals

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 2 \sub_dst_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 6 \sub_dst_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 17 \sub_dst_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 7 \sub_dst_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/msave.py:51"
  cell $lt $26
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 17
    parameter \Y_WIDTH 1
    connect \A \index_reg [16:0]
    connect \B \dst_cap_reg [80:64]
    connect \Y \index_in_bounds
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:54"
  cell $shl $27
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \index_reg [16:0]
    connect \B 2'10
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:54"
  cell $add $28
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 33
    connect \A \dst_cap_reg [63:32]
    connect \B $1 [19:0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:57"
  cell $shl $29
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \src_gt_reg [24:8]
    connect \B 2'11
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:57"
  cell $add $30
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 33
    connect \A \cr15_namespace [63:32]
    connect \B $3 [19:0]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:57"
  cell $shl $31
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \src_gt_reg [24:8]
    connect \B 2'10
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:57"
  cell $add $32
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 33
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 34
    connect \A $4 [32:0]
    connect \B $5 [19:0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:134"
  cell $add $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A $6 [31:0]
    connect \B 3'100
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:187"
  cell $not $34
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $8 [0]
    connect \Y \sub_busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B {  }
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 1'1
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 2'10
    connect \Y \sub_fault
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $38
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 2'11
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $39
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 3'100
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $40
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 3'101
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $41
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 3'110
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $42
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 3'111
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 4'1000
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $44
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 4'1001
    connect \Y \sub_done
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:103"
  cell $not $45
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \dst_cap_reg [95]
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:110"
  cell $not $46
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \dst_cap_reg [6]
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:117"
  cell $not $47
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \index_in_bounds [0]
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:26"
  process $48
    assign \mem_rd_addr [31:0] 32'00000000000000000000000000000000
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        assign \mem_rd_addr [31:0] $6 [31:0]
      case 4'0110
        assign \mem_rd_addr [31:0] $7 [31:0]
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:27"
  process $49
    assign \mem_rd_en [0] 1'0
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        assign \mem_rd_en [0] 1'1
      case 4'0110
        assign \mem_rd_en [0] 1'1
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:23"
  process $50
    assign \mem_wr_en [0] 1'0
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        assign \mem_wr_en [0] 1'1
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:21"
  process $51
    assign \mem_wr_addr [31:0] 32'00000000000000000000000000000000
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        assign \mem_wr_addr [31:0] $2 [31:0]
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:22"
  process $52
    assign \mem_wr_data [31:0] 32'00000000000000000000000000000000
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        assign \mem_wr_data [31:0] \src_gt_reg [31:0]
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  process $53
    assign $19 [127:0] \dst_cap_reg [127:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $19 [127:0] \sub_dst_cap [127:0]
        end
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $19 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  cell $dff $54
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $19 [127:0]
    connect \CLK \clk [0]
    connect \Q \dst_cap_reg
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:37"
  process $55
    assign $20 [31:0] \src_gt_reg [31:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $20 [31:0] \sub_src_gt [31:0]
        end
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $20 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:37"
  cell $dff $56
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $20 [31:0]
    connect \CLK \clk [0]
    connect \Q \src_gt_reg
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:38"
  process $57
    assign $21 [16:0] \index_reg [16:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $21 [16:0] { 2'00 \port$0$2 [14:0] }
        end
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $21 [16:0] 17'00000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:38"
  cell $dff $58
    parameter \WIDTH 17
    parameter \CLK_POLARITY 1
    connect \D $21 [16:0]
    connect \CLK \clk [0]
    connect \Q \index_reg
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:39"
  process $59
    assign $22 [3:0] \sub_fault_type [3:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $22 [3:0] 4'0000
        end
      case 4'0001
        switch $16 [0]
          case 1'1
            assign $22 [3:0] 4'1110
          case
        end
      case 4'0011
        switch $17 [0]
          case 1'1
            assign $22 [3:0] 4'0101
          case
        end
      case 4'0100
        switch $18 [0]
          case 1'1
            assign $22 [3:0] 4'1000
          case
        end
      case 4'0101
      case 4'0110
      case 4'0111
        switch \ns_limit_reg [30]
          case 1'1
            assign $22 [3:0] 4'1111
          case
        end
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $22 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:39"
  cell $dff $60
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $22 [3:0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_type
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $61
    assign $23 [3:0] \msave_state [3:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $23 [3:0] 4'0001
        end
      case 4'0001
        switch $16 [0]
          case 1'1
            assign $23 [3:0] 4'0010
          case
            assign $23 [3:0] 4'0011
        end
      case 4'0011
        switch $17 [0]
          case 1'1
            assign $23 [3:0] 4'0010
          case
            assign $23 [3:0] 4'0100
        end
      case 4'0100
        switch $18 [0]
          case 1'1
            assign $23 [3:0] 4'0010
          case
            assign $23 [3:0] 4'0101
        end
      case 4'0101
        switch 1'1
          case 1'1
            assign $23 [3:0] 4'0110
        end
      case 4'0110
        switch 1'1
          case 1'1
            assign $23 [3:0] 4'0111
        end
      case 4'0111
        switch \ns_limit_reg [30]
          case 1'1
            assign $23 [3:0] 4'0010
          case
            assign $23 [3:0] 4'1000
        end
      case 4'1000
        switch 1'1
          case 1'1
            assign $23 [3:0] 4'1001
        end
      case 4'1001
        assign $23 [3:0] 4'0000
      case 4'0010
        assign $23 [3:0] 4'0000
    end
    switch \rst [0]
      case 1'1
        assign $23 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $62
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $23 [3:0]
    connect \CLK \clk [0]
    connect \Q \msave_state
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:59"
  process $63
    assign $24 [31:0] \ns_location_reg [31:0]
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        switch 1'1
          case 1'1
            assign $24 [31:0] \mem_rd_data [31:0]
        end
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $24 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:59"
  cell $dff $64
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $24 [31:0]
    connect \CLK \clk [0]
    connect \Q \ns_location_reg
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:60"
  process $65
    assign $25 [31:0] \ns_limit_reg [31:0]
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
        switch 1'1
          case 1'1
            assign $25 [31:0] \mem_rd_data [31:0]
        end
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $25 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:60"
  cell $dff $66
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $25 [31:0]
    connect \CLK \clk [0]
    connect \Q \ns_limit_reg
  end

connect \write_addr $2 [31:0]
connect \ns_entry_addr $6 [31:0]
connect \fault_type_reg \sub_fault_type [3:0]
connect \sub_index { 2'00 \port$0$2 [14:0] }
connect \mem_rd_valid 1'1
connect \mem_wr_done 1'1
connect \dst_cap_reg.word0_gt \dst_cap_reg [31:0]
connect \dst_cap_reg.word0_gt.gt_type \dst_cap_reg [1:0]
connect \dst_cap_reg.word0_gt.perms \dst_cap_reg [7:2]
connect \dst_cap_reg.word0_gt.index \dst_cap_reg [24:8]
connect \dst_cap_reg.word0_gt.version \dst_cap_reg [31:25]
connect \dst_cap_reg.word1_location \dst_cap_reg [63:32]
connect \dst_cap_reg.word2_limit \dst_cap_reg [95:64]
connect \dst_cap_reg.word3_seals \dst_cap_reg [127:96]
connect \cr15_namespace.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace.word1_location \cr15_namespace [63:32]
connect \cr15_namespace.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace.word3_seals \cr15_namespace [127:96]
connect \sub_dst_cap.word0_gt \sub_dst_cap [31:0]
connect \sub_dst_cap.word0_gt.gt_type \sub_dst_cap [1:0]
connect \sub_dst_cap.word0_gt.perms \sub_dst_cap [7:2]
connect \sub_dst_cap.word0_gt.index \sub_dst_cap [24:8]
connect \sub_dst_cap.word0_gt.version \sub_dst_cap [31:25]
connect \sub_dst_cap.word1_location \sub_dst_cap [63:32]
connect \sub_dst_cap.word2_limit \sub_dst_cap [95:64]
connect \sub_dst_cap.word3_seals \sub_dst_cap [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/load.py:31"
module \top.u_load

  attribute \src "/home/runner/workspace/church_machine/load.py:18"
  wire width 4 \mload_cr_src

  attribute \src "/home/runner/workspace/church_machine/load.py:9"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/load.py:19"
  wire width 4 \mload_cr_dst

  attribute \src "/home/runner/workspace/church_machine/load.py:10"
  wire width 4 \cr_dst

  attribute \src "/home/runner/workspace/church_machine/load.py:20"
  wire width 17 \mload_index

  attribute \src "/home/runner/workspace/church_machine/load.py:11"
  wire width 17 \index

  attribute \src "/home/runner/workspace/church_machine/load.py:21"
  wire width 1 \mload_direct

  attribute \src "/home/runner/workspace/church_machine/load.py:22"
  wire width 32 \mload_direct_gt

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 2'00
  wire width 2 \load_wrapper_state

  attribute \src "/home/runner/workspace/church_machine/load.py:13"
  wire width 1 \load_complete

  attribute \src "/home/runner/workspace/church_machine/load.py:28"
  wire width 4 \mload_fault_type

  wire width 23 input 0  \port$0$2

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \rst

  attribute \src "/home/runner/workspace/church_machine/load.py:8"
  wire width 1 input 3  \load_start

  attribute \src "/home/runner/workspace/church_machine/load.py:23"
  wire width 1 output 4  \mload_m_elevated

  attribute \src "/home/runner/workspace/church_machine/load.py:12"
  wire width 1 output 5  \load_busy

  attribute \src "/home/runner/workspace/church_machine/load.py:14"
  wire width 1 output 6  \load_fault

  attribute \src "/home/runner/workspace/church_machine/load.py:25"
  wire width 1 input 7  \mload_busy

  attribute \src "/home/runner/workspace/church_machine/load.py:27"
  wire width 1 input 8  \mload_fault

  attribute \src "/home/runner/workspace/church_machine/load.py:26"
  wire width 1 input 9  \mload_done

  attribute \src "/home/runner/workspace/church_machine/load.py:17"
  wire width 1 output 10  \mload_start

  attribute \src "/home/runner/workspace/church_machine/load.py:28"
  wire width 4 input 11  \fault_type

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 2 $6

  attribute \src "/home/runner/workspace/church_machine/load.py:39"
  cell $eq $7
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \port$0$2 [18:15]
    connect \B 3'110
    connect \Y \mload_m_elevated
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:58"
  cell $not $8
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $1 [0]
    connect \Y \load_busy
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:59"
  cell $and $9
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $4 [0]
    connect \B \mload_done [0]
    connect \Y \load_complete
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:60"
  cell $and $10
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $4 [0]
    connect \B \mload_fault [0]
    connect \Y \load_fault
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $11
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \load_wrapper_state [1:0]
    connect \B {  }
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $12
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \load_wrapper_state [1:0]
    connect \B 1'1
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $13
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \load_wrapper_state [1:0]
    connect \B 2'10
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $14
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \load_wrapper_state [1:0]
    connect \B 2'11
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:54"
  cell $or $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \mload_done [0]
    connect \B \mload_fault [0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:17"
  process $16
    assign \mload_start [0] 1'0
    switch \load_wrapper_state [1:0]
      case 2'00
      case 2'01
        assign \mload_start [0] 1'1
      case 2'10
        assign \mload_start [0] 1'1
      case 2'11
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $17
    assign $6 [1:0] \load_wrapper_state [1:0]
    switch \load_wrapper_state [1:0]
      case 2'00
        switch \load_start [0]
          case 1'1
            assign $6 [1:0] 2'01
        end
      case 2'01
        assign $6 [1:0] 2'10
      case 2'10
        switch \mload_busy [0]
          case 1'1
            assign $6 [1:0] 2'11
        end
      case 2'11
        switch $5 [0]
          case 1'1
            assign $6 [1:0] 2'00
        end
    end
    switch \rst [0]
      case 1'1
        assign $6 [1:0] 2'00
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $18
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $6 [1:0]
    connect \CLK \clk [0]
    connect \Q \load_wrapper_state
  end

connect \mload_cr_src \port$0$2 [18:15]
connect \cr_src \port$0$2 [18:15]
connect \mload_cr_dst \port$0$2 [22:19]
connect \cr_dst \port$0$2 [22:19]
connect \mload_index { 2'00 \port$0$2 [14:0] }
connect \index { 2'00 \port$0$2 [14:0] }
connect \mload_direct 1'0
connect \mload_direct_gt 32'00000000000000000000000000000000
connect \mload_fault_type \fault_type [3:0]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/mload.py:51"
module \top.u_shared_mload

  attribute \src "/home/runner/workspace/church_machine/mload.py:70"
  wire width 1 \src_is_null

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \src_cap

  attribute \src "/home/runner/workspace/church_machine/mload.py:73"
  wire width 1 \bounds_ok

  attribute \src "/home/runner/workspace/church_machine/mload.py:55"
  attribute \init 17'00000000000000000
  wire width 17 \index_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:76"
  wire width 32 \clist_gt_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:79"
  wire width 32 \ns_entry_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \result_cap

  attribute \src "/home/runner/workspace/church_machine/mload.py:82"
  wire width 1 \ns_index_in_bounds

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \mload_state

  attribute \src "/home/runner/workspace/church_machine/mload.py:56"
  attribute \init 1'0
  wire width 1 \direct_mode

  attribute \src "/home/runner/workspace/church_machine/mload.py:53"
  attribute \init 4'0000
  wire width 4 \cr_src_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:54"
  attribute \init 4'0000
  wire width 4 \cr_dst_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:43"
  wire width 1 \thread_wr_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:44"
  wire width 4 \thread_wr_idx

  attribute \src "/home/runner/workspace/church_machine/mload.py:45"
  wire width 32 \thread_wr_data

  attribute \src "/home/runner/workspace/church_machine/mload.py:60"
  attribute \init 4'0000
  wire width 4 \fault_type_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:57"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \direct_gt_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:36"
  wire width 1 \mem_rd_valid

  attribute \src "/home/runner/workspace/church_machine/mload.py:85"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \ns_w1_saved

  attribute \src "/home/runner/workspace/church_machine/mload.py:35"
  wire width 32 input 0  \mem_rd_data

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \rst

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 128 input 3  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/mload.py:19"
  wire width 1 output 4  \sub_busy

  attribute \src "/home/runner/workspace/church_machine/mload.py:21"
  wire width 1 output 5  \sub_fault

  attribute \src "/home/runner/workspace/church_machine/mload.py:20"
  wire width 1 output 6  \sub_done

  attribute \src "/home/runner/workspace/church_machine/mload.py:12"
  wire width 1 input 7  \sub_start

  attribute \src "/home/runner/workspace/church_machine/mload.py:13"
  wire width 4 input 8  \sub_cr_src

  attribute \src "/home/runner/workspace/church_machine/mload.py:14"
  wire width 4 input 9  \sub_cr_dst

  attribute \src "/home/runner/workspace/church_machine/mload.py:15"
  wire width 17 input 10  \sub_index

  attribute \src "/home/runner/workspace/church_machine/mload.py:16"
  wire width 1 input 11  \sub_direct

  attribute \src "/home/runner/workspace/church_machine/mload.py:17"
  wire width 32 input 12  \sub_direct_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:18"
  wire width 1 input 13  \sub_m_elevated

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 128 input 14  \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/mload.py:24"
  wire width 4 output 15  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:33"
  wire width 32 output 16  \mem_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:34"
  wire width 1 output 17  \mem_rd_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:27"
  wire width 4 output 18  \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 128 output 19  \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/mload.py:29"
  wire width 1 output 20  \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:60"
  attribute \init 4'0000
  wire width 4 output 21  \sub_fault_type

  wire width 20 $1

  wire width 33 $2

  wire width 20 $3

  wire width 33 $4

  wire width 20 $5

  wire width 34 $6

  wire width 33 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  wire width 1 $22

  wire width 4 $23

  wire width 4 $24

  wire width 17 $25

  wire width 1 $26

  wire width 32 $27

  wire width 128 $28

  wire width 4 $29

  wire width 4 $30

  wire width 128 $31

  wire width 32 $32

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 32 \src_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 2 \src_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 6 \src_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 17 \src_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 7 \src_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 32 \src_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 32 \src_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 32 \src_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 32 \result_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 2 \result_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 6 \result_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 17 \result_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 7 \result_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 32 \result_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 32 \result_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 32 \result_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:71"
  cell $eq $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \src_cap [1:0]
    connect \B 2'10
    connect \Y \src_is_null
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:74"
  cell $lt $34
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 17
    parameter \Y_WIDTH 1
    connect \A \index_reg [16:0]
    connect \B \src_cap [80:64]
    connect \Y \bounds_ok
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:77"
  cell $shl $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \index_reg [16:0]
    connect \B 2'10
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:77"
  cell $add $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 33
    connect \A \src_cap [63:32]
    connect \B $1 [19:0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:80"
  cell $shl $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \result_cap [24:8]
    connect \B 2'11
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:80"
  cell $add $38
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 33
    connect \A \cr15_namespace [63:32]
    connect \B $3 [19:0]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:80"
  cell $shl $39
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \result_cap [24:8]
    connect \B 2'10
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:80"
  cell $add $40
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 33
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 34
    connect \A $4 [32:0]
    connect \B $5 [19:0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:83"
  cell $lt $41
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 17
    parameter \Y_WIDTH 1
    connect \A \result_cap [24:8]
    connect \B \cr15_namespace [80:64]
    connect \Y \ns_index_in_bounds
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:181"
  cell $add $42
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A $6 [31:0]
    connect \B 3'100
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:234"
  cell $le $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \cr_dst_reg [3:0]
    connect \B 3'111
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:254"
  cell $not $44
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $9 [0]
    connect \Y \sub_busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $45
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B {  }
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $46
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 1'1
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $47
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 2'10
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $48
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 2'11
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $49
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 3'100
    connect \Y \sub_fault
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $50
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 3'101
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $51
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 3'110
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $52
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 3'111
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $53
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 4'1000
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $54
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 4'1001
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $55
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 4'1010
    connect \Y \sub_done
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:141"
  cell $not $56
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \src_cap [5]
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:141"
  cell $not $57
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \sub_m_elevated [0]
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:141"
  cell $and $58
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $18 [0]
    connect \B $19 [0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:148"
  cell $not $59
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \bounds_ok [0]
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:164"
  cell $not $60
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \ns_index_in_bounds [0]
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:24"
  process $61
    assign \cr_rd_addr [3:0] 4'0000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
        switch \direct_mode [0]
          case 1'1
          case
            assign \cr_rd_addr [3:0] \cr_src_reg [3:0]
        end
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:33"
  process $62
    assign \mem_addr [31:0] 32'00000000000000000000000000000000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
        assign \mem_addr [31:0] $2 [31:0]
      case 4'0010
      case 4'0111
        assign \mem_addr [31:0] $6 [31:0]
      case 4'1000
        assign \mem_addr [31:0] $7 [31:0]
      case 4'1001
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:34"
  process $63
    assign \mem_rd_en [0] 1'0
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
        assign \mem_rd_en [0] 1'1
      case 4'0010
      case 4'0111
        assign \mem_rd_en [0] 1'1
      case 4'1000
        assign \mem_rd_en [0] 1'1
      case 4'1001
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:43"
  process $64
    assign \thread_wr_en [0] 1'0
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
        switch $8 [0]
          case 1'1
            assign \thread_wr_en [0] 1'1
        end
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:44"
  process $65
    assign \thread_wr_idx [3:0] 4'0000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
        switch $8 [0]
          case 1'1
            assign \thread_wr_idx [3:0] \cr_dst_reg [3:0]
        end
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:45"
  process $66
    assign \thread_wr_data [31:0] 32'00000000000000000000000000000000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
        switch $8 [0]
          case 1'1
            assign \thread_wr_data [31:0] \result_cap [31:0]
        end
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:27"
  process $67
    assign \cr_wr_addr [3:0] 4'0000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
        assign \cr_wr_addr [3:0] \cr_dst_reg [3:0]
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  process $68
    assign \cr_wr_data [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
        assign \cr_wr_data [127:0] \result_cap [127:0]
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:29"
  process $69
    assign \cr_wr_en [0] 1'0
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
        assign \cr_wr_en [0] 1'1
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:53"
  process $70
    assign $23 [3:0] \cr_src_reg [3:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $23 [3:0] \sub_cr_src [3:0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $23 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:53"
  cell $dff $71
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $23 [3:0]
    connect \CLK \clk [0]
    connect \Q \cr_src_reg
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:54"
  process $72
    assign $24 [3:0] \cr_dst_reg [3:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $24 [3:0] \sub_cr_dst [3:0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $24 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:54"
  cell $dff $73
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $24 [3:0]
    connect \CLK \clk [0]
    connect \Q \cr_dst_reg
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:55"
  process $74
    assign $25 [16:0] \index_reg [16:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $25 [16:0] \sub_index [16:0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $25 [16:0] 17'00000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:55"
  cell $dff $75
    parameter \WIDTH 17
    parameter \CLK_POLARITY 1
    connect \D $25 [16:0]
    connect \CLK \clk [0]
    connect \Q \index_reg
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:56"
  process $76
    assign $26 [0] \direct_mode [0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $26 [0] \sub_direct [0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $26 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:56"
  cell $dff $77
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $26 [0]
    connect \CLK \clk [0]
    connect \Q \direct_mode
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:57"
  process $78
    assign $27 [31:0] \direct_gt_reg [31:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $27 [31:0] \sub_direct_gt [31:0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $27 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:57"
  cell $dff $79
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $27 [31:0]
    connect \CLK \clk [0]
    connect \Q \direct_gt_reg
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  process $80
    assign $28 [127:0] \result_cap [127:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $28 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
        end
      case 4'0001
        switch \direct_mode [0]
          case 1'1
            assign $28 [31:0] \direct_gt_reg [31:0]
          case
        end
      case 4'0011
      case 4'0101
      case 4'0110
        switch 1'1
          case 1'1
            assign $28 [31:0] \mem_rd_data [31:0]
        end
      case 4'0010
      case 4'0111
        switch 1'1
          case 1'1
            assign $28 [63:32] \mem_rd_data [31:0]
        end
      case 4'1000
        switch 1'1
          case 1'1
            assign $28 [95:64] \mem_rd_data [31:0]
        end
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $28 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  cell $dff $81
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $28 [127:0]
    connect \CLK \clk [0]
    connect \Q \result_cap
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:60"
  process $82
    assign $29 [3:0] \sub_fault_type [3:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $29 [3:0] 4'0000
        end
      case 4'0001
      case 4'0011
        switch { $20 [0] \src_is_null [0] }
          case 2'-1
            assign $29 [3:0] 4'0111
          case 2'1-
            assign $29 [3:0] 4'0100
          case
        end
      case 4'0101
        switch $21 [0]
          case 1'1
            assign $29 [3:0] 4'1000
          case
        end
      case 4'0110
      case 4'0010
        switch $22 [0]
          case 1'1
            assign $29 [3:0] 4'1000
          case
        end
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $29 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:60"
  cell $dff $83
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $29 [3:0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_type
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $84
    assign $30 [3:0] \mload_state [3:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $30 [3:0] 4'0001
        end
      case 4'0001
        switch \direct_mode [0]
          case 1'1
            assign $30 [3:0] 4'0010
          case
            assign $30 [3:0] 4'0011
        end
      case 4'0011
        switch { $20 [0] \src_is_null [0] }
          case 2'-1
            assign $30 [3:0] 4'0100
          case 2'1-
            assign $30 [3:0] 4'0100
          case
            assign $30 [3:0] 4'0101
        end
      case 4'0101
        switch $21 [0]
          case 1'1
            assign $30 [3:0] 4'0100
          case
            assign $30 [3:0] 4'0110
        end
      case 4'0110
        switch 1'1
          case 1'1
            assign $30 [3:0] 4'0010
        end
      case 4'0010
        switch $22 [0]
          case 1'1
            assign $30 [3:0] 4'0100
          case
            assign $30 [3:0] 4'0111
        end
      case 4'0111
        switch 1'1
          case 1'1
            assign $30 [3:0] 4'1000
        end
      case 4'1000
        switch 1'1
          case 1'1
            assign $30 [3:0] 4'1001
        end
      case 4'1001
        assign $30 [3:0] 4'1010
      case 4'1010
        assign $30 [3:0] 4'0000
      case 4'0100
        assign $30 [3:0] 4'0000
    end
    switch \rst [0]
      case 1'1
        assign $30 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $85
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $30 [3:0]
    connect \CLK \clk [0]
    connect \Q \mload_state
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  process $86
    assign $31 [127:0] \src_cap [127:0]
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
        switch \direct_mode [0]
          case 1'1
          case
            assign $31 [127:0] \cr_rd_data [127:0]
        end
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $31 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  cell $dff $87
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $31 [127:0]
    connect \CLK \clk [0]
    connect \Q \src_cap
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:85"
  process $88
    assign $32 [31:0] \ns_w1_saved [31:0]
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
        switch 1'1
          case 1'1
            assign $32 [31:0] \mem_rd_data [31:0]
        end
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $32 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:85"
  cell $dff $89
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $32 [31:0]
    connect \CLK \clk [0]
    connect \Q \ns_w1_saved
  end

connect \clist_gt_addr $2 [31:0]
connect \ns_entry_addr $6 [31:0]
connect \fault_type_reg \sub_fault_type [3:0]
connect \mem_rd_valid 1'1
connect \src_cap.word0_gt \src_cap [31:0]
connect \src_cap.word0_gt.gt_type \src_cap [1:0]
connect \src_cap.word0_gt.perms \src_cap [7:2]
connect \src_cap.word0_gt.index \src_cap [24:8]
connect \src_cap.word0_gt.version \src_cap [31:25]
connect \src_cap.word1_location \src_cap [63:32]
connect \src_cap.word2_limit \src_cap [95:64]
connect \src_cap.word3_seals \src_cap [127:96]
connect \cr15_namespace.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace.word1_location \cr15_namespace [63:32]
connect \cr15_namespace.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace.word3_seals \cr15_namespace [127:96]
connect \result_cap.word0_gt \result_cap [31:0]
connect \result_cap.word0_gt.gt_type \result_cap [1:0]
connect \result_cap.word0_gt.perms \result_cap [7:2]
connect \result_cap.word0_gt.index \result_cap [24:8]
connect \result_cap.word0_gt.version \result_cap [31:25]
connect \result_cap.word1_location \result_cap [63:32]
connect \result_cap.word2_limit \result_cap [95:64]
connect \result_cap.word3_seals \result_cap [127:96]
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

