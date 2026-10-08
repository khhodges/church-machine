#!/usr/bin/env bash
# Offline routed-checkpoint preparation only. No synthesis, bitstream or board access.
set -eo pipefail
BUILD=/root/B1-frozen-integrated-synth-XACtTk
OLD=/root/B1-build-a8UYvjXS/hardware
OUT=$(mktemp -d /root/B1-frozen-route-XXXXXX)
cp "$BUILD/integrated_synth.dcp" "$OUT/"
cp "$OLD/wukong_xc7a100t.xdc" "$OUT/"
cp "$OLD/wukong_xc7a100t.tcl" "$OUT/retained-build.tcl"
cp "$0" "$OUT/launcher.sh"
cat > "$OUT/inputs.sha256" <<'HASH'
715a29fa4a402650c3ee7e06e5e33f877119027ebfd20d5a2a3f54d6265797e4  integrated_synth.dcp
fe416e3b65c8b728473891c1f966b6665ab59c13471fed33d7f6dcbebd1af4b8  wukong_xc7a100t.xdc
2acb5cbeaa6205e828f1cedfb5f9be1719cfe0fff874bccb9707e34fa2ac2ca6  retained-build.tcl
HASH
(cd "$OUT" && sha256sum -c inputs.sha256)
cat > "$OUT/route.tcl" <<'TCL'
set_param general.maxThreads 2
open_checkpoint integrated_synth.dcp
read_xdc wukong_xc7a100t.xdc
# Retain the original XDC verbatim, including its existing debug-port warnings.
# Reports must be reviewed before permitting bitstream generation.
foreach {port pin} {clk M21 led0 G21 led1 G20 rst_n M6 uart_tx_pin E3 uart_rx_pin F3} {
    set p [get_ports $port]
    if {[llength $p] != 1 ||
        [get_property PACKAGE_PIN $p] ne $pin ||
        [get_property IOSTANDARD $p] ne "LVCMOS33"} {
        error "Board pin validation failed: $port"
    }
}
set clocks [get_clocks sys_clk_pin]
if {[llength $clocks] != 1 || [get_property PERIOD $clocks] != 20.0} {
    error "Expected retained 50 MHz clock"
}
opt_design
place_design
phys_opt_design
route_design
write_checkpoint -force routed.dcp
report_timing_summary -delay_type min_max -report_unconstrained -check_timing_verbose -file timing-summary.txt
report_route_status -file route-status.txt
report_drc -file drc.txt
report_io -file io.txt
report_utilization -file utilization.txt
report_methodology -file methodology.txt
puts "ROUTED_REPORTS_READY_NOT_RELEASE_APPROVAL"
exit
TCL
cat > "$OUT/run.sh" <<'RUN'
#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
finish() {
    local rc=$?
    trap - EXIT
    echo "$rc" > "$ROOT/exit-status"
    echo "ROUTE_EXIT=$rc"
    exit "$rc"
}
trap finish EXIT
exec 9>/tmp/church-vivado-build.lock
flock -n 9 || { echo "Another Vivado job owns the build lock"; exit 1; }
sha256sum -c inputs.sha256
source /opt/Xilinx/2026.1/Vivado/settings64.sh
timeout --kill-after=30s 10800s vivado -mode batch -source route.tcl -log route.log
sha256sum -c inputs.sha256
grep -q '^ROUTED_REPORTS_READY_NOT_RELEASE_APPROVAL' route.log
for file in routed.dcp timing-summary.txt route-status.txt drc.txt io.txt utilization.txt methodology.txt; do
    test -s "$file"
done
sha256sum routed.dcp route.tcl > routed-hashes.sha256
tar -czf route-evidence.tar.gz inputs.sha256 routed-hashes.sha256 route.tcl \
    launcher.sh route.log timing-summary.txt route-status.txt drc.txt io.txt \
    utilization.txt methodology.txt
echo "=== Timing summary excerpt ==="
grep -A 14 'Design Timing Summary' timing-summary.txt || true
echo "=== Route status ==="
cat route-status.txt
echo "=== DRC report ==="
cat drc.txt
echo "ROUTED_REPORTS_READY_NOT_RELEASE_APPROVAL"
echo "NO_BITSTREAM_NO_FLASH_NO_BOARD_COMMANDS"
RUN
bash -n "$OUT/run.sh"
nohup bash "$OUT/run.sh" > "$OUT/run.log" 2>&1 < /dev/null &
printf '\nStarted routing. PID: %s\nDirectory: %s\n' "$!" "$OUT"
printf '\nWatch with:\ntail -n 70 -f %s/run.log\n' "$OUT"
