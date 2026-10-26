# Diagnostic for the retained implemented_boot_probe, starting at simulation t=0.
# Only reads simulator objects; never forces DUT state.
set selected {}
set admission_count 0
foreach object [get_objects /implemented_boot_tb/dut/*] {
    # Normalize only for matching; pass the exact original object to get_value.
    set leaf [string trimleft [string trim [file tail $object]] "\\"]
    if {[regexp {(_i_[0-9]|_n_[0-9]|_INST_)} $leaf]} {continue}
    set admission [regexp {boot_metadata|boot_namespace_guard|boot_thread_validation|boot_thread_activation} $leaf]
    if {$admission} {incr admission_count}
    if {$admission ||
        [regexp {(^|[.])[^.]*(fault|error)[^.]*$} $leaf] ||
        [regexp {(^|[.])(namespace_error|guarded_call_error|boot_state_reg|boot_fault_slot|boot_namespace_admitted|boot_thread_validated|boot_thread_activated|dmem_rd_data|dmem_rd_valid|dmem_addr|fault_valid|dbg_fault|dbg_nia|boot_complete|boot_triggered|clear_all|execution_phase|fetch_bounds_fault|compact_index_fault|bf_fault|call_index_fault|branch_index_fault)(_reg)?(\[[0-9:]+\])?$} $leaf]} {
        lappend selected $object
    }
}
if {![llength $selected]} {error "No boot diagnostic signals found"}
if {!$admission_count} {error "No admission signals survived under the expected names; stopping before replay"}
run 1365310999 ps
foreach sample {before_2_cycles before_1_cycle fault_observation} {
    if {$sample ne "before_2_cycles"} {run 40000 ps}
    puts "BOOT_ADMISSION_SAMPLE: $sample"
    foreach object $selected {
        puts "$object = [get_value -radix hex $object]"
    }
}
puts "BOOT_ADMISSION_DIAGNOSTIC_COMPLETE"
exit
