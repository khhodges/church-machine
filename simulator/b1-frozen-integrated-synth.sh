#!/usr/bin/env bash
# Offline diagnostic synthesis of the exact frozen-ROM candidate.
# Does not regenerate the Namespace, implement, create a bitstream, or program hardware.
set -eo pipefail
EXPERIMENT=/root/B1-frozen-ROM-test-6bJduK/experiment
test "$(cat "$EXPERIMENT/exit-status")" = 0
grep -q '^INITIALIZER_MICROTEST_PASS count=2693' "$EXPERIMENT/candidate/run.log"
grep -q 'PAIR_MISMATCH index=0 actual=000000000000' "$EXPERIMENT/baseline/run.log"
grep -q 'MAPPING_EVIDENCE variant=candidate brams=0' "$EXPERIMENT/synth.log"
echo "d7fb9b95ca8304a05148cd30ab5c1053f2c246e2b5509b461cc008ed594b677a  $EXPERIMENT/frozen_full_candidate.v" | sha256sum -c -
echo "b7cebaeb97a509b014991f4a71f85a3650f839c91b673413d11e78350364d33c  $EXPERIMENT/candidate/expected.hex" | sha256sum -c -

OUT=$(mktemp -d /root/B1-frozen-integrated-synth-XXXXXX)
cp "$EXPERIMENT/frozen_full_candidate.v" "$OUT/church_wukong_xc7a100t.v"
cp "$EXPERIMENT/candidate/expected.hex" "$OUT/expected.hex"
cp "$EXPERIMENT/frozen-repair.json" "$OUT/frozen-repair.json"
cp "$EXPERIMENT/baseline/run.log" "$OUT/micro-baseline.log"
cp "$EXPERIMENT/candidate/run.log" "$OUT/micro-candidate.log"
cp "$0" "$OUT/launcher.sh"

cat > "$OUT/synth.tcl" <<'TCL'
set_param general.maxThreads 2
create_project -in_memory -part xc7a100tfgg676-2
read_verilog church_wukong_xc7a100t.v
# Full top-level functional synthesis, not a timing/implementation release.
# No new source elaboration, catalog lookup, XDC changes, or physical board access.
synth_design -top church_wukong_xc7a100t -part xc7a100tfgg676-2
report_utilization -file utilization.txt
set f [open bram-cells.txt w]
foreach cell [get_cells -hier -filter {REF_NAME =~ RAMB*}] {
    puts $f "[get_property NAME $cell] [get_property REF_NAME $cell]"
}
close $f
write_checkpoint -force integrated_synth.dcp
write_verilog -force -mode funcsim synth_funcsim.v
puts "INTEGRATED_SYNTHESIS_COMPLETE_REPLAY_REQUIRED"
exit
TCL

cat > "$OUT/run.sh" <<'SH'
#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
trap 'rc=$?; echo "$rc" > "$ROOT/exit-status"; echo "INTEGRATED_SYNTH_EXIT=$rc"' EXIT
exec 9>/tmp/church-vivado-build.lock
flock -n 9 || { echo "Another Vivado job owns the build lock"; exit 1; }
echo "d7fb9b95ca8304a05148cd30ab5c1053f2c246e2b5509b461cc008ed594b677a  church_wukong_xc7a100t.v" | sha256sum -c -
echo "b7cebaeb97a509b014991f4a71f85a3650f839c91b673413d11e78350364d33c  expected.hex" | sha256sum -c -
sha256sum church_wukong_xc7a100t.v expected.hex synth.tcl > input-hashes.sha256
source /opt/Xilinx/2026.1/Vivado/settings64.sh
timeout --kill-after=30s 7200s vivado -mode batch -source synth.tcl -log synth.log
sha256sum -c input-hashes.sha256
test -s integrated_synth.dcp
test -s synth_funcsim.v
grep -q '^INTEGRATED_SYNTHESIS_COMPLETE_REPLAY_REQUIRED' synth.log
gzip -c synth_funcsim.v > synth_funcsim.v.gz
sha256sum integrated_synth.dcp synth_funcsim.v synth_funcsim.v.gz > output-hashes.sha256
cat output-hashes.sha256
echo "DIAGNOSTIC_ONLY_NOT_BOOT_VERIFICATION_OR_RELEASE_APPROVAL"
echo "NO_BITSTREAM_NO_FLASH_NO_BOARD_COMMANDS"
SH

bash -n "$OUT/run.sh"
nohup bash "$OUT/run.sh" > "$OUT/run.log" 2>&1 < /dev/null &
printf '\nStarted full-system diagnostic synthesis. PID: %s\nDirectory: %s\n' "$!" "$OUT"
printf '\nWatch with:\ntail -f %s/run.log\n' "$OUT"
