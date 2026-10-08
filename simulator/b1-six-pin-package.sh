#!/usr/bin/env bash
# Generate files only from the verified routed checkpoint. Never connect hardware.
set -eo pipefail
BUILD=/root/B1-six-pin-build-jGni6C/build
REPLAY=/root/B1-six-pin-replay-cz2gZl/replay
test "$(cat "$REPLAY/exit-status")" = 0
(cd "$BUILD" && sha256sum -c inputs.sha256 && sha256sum -c outputs.sha256)
(cd "$REPLAY" && sha256sum -c inputs.sha256)
for marker in \
  'ALL_INIT_PAIRS_PASS count=2693' \
  'BOOT_LOAD_RETIRE_PASS CR15=0000003f0000000000000000' \
  'TARGET_LOAD_RETIRE_PASS nia=00002e08 gt=4a000006 fault=00' \
  'SIX_PIN_INIT_BOOT_TARGET_REPLAY_PASS'; do
  grep -Fxq "$marker" "$REPLAY/simulation.log"
done
if grep -Eiq 'Fatal:|ERROR:' "$REPLAY/simulation.log"; then exit 1; fi
echo "03dbbc64e46f5541ca1d25ac2365c5fd88709e414b36bb537ea531558ce94b56  $REPLAY/synth_funcsim.v" | sha256sum -c -
OUT=$(mktemp -d /root/B1-corrected-files-XXXXXX)
cp "$BUILD/routed.dcp" "$OUT/"
cp "$BUILD/six-pin-evidence.tar.gz" "$OUT/"
cp "$REPLAY/simulation.log" "$OUT/replay.log"
cp "$0" "$OUT/launcher.sh"
echo "5a87f594d4704c14484df4528c7473330791a3c3e6a056c395bf80cead019a91  routed.dcp" > "$OUT/checkpoint.sha256"
(cd "$OUT" && sha256sum -c checkpoint.sha256)
cat > "$OUT/generate.tcl" <<'TCL'
set_param general.maxThreads 2
open_checkpoint routed.dcp
set wanted {clk led0 led1 rst_n uart_rx_pin uart_tx_pin}
if {[lsort [get_ports]] ne [lsort $wanted]} {error "Wrong physical ports"}
foreach {port pin} {clk M21 led0 G21 led1 G20 rst_n M6 uart_tx_pin E3 uart_rx_pin F3} {
    if {[get_property PACKAGE_PIN [get_ports $port]] ne $pin ||
        [get_property IOSTANDARD [get_ports $port]] ne "LVCMOS33"} {
        error "Wrong board pin: $port"
    }
}
if {[llength [get_clocks sys_clk_pin]] != 1 ||
    [get_property PERIOD [get_clocks sys_clk_pin]] != 20.0} {
    error "Wrong clock constraint"
}
if {[get_property BITSTREAM.CONFIG.SPI_BUSWIDTH [current_design]] != 4} {
    error "Expected retained SPIx4 setting"
}
set_property SEVERITY Error [get_drc_checks NSTD-1]
set_property SEVERITY Error [get_drc_checks UCIO-1]
report_timing_summary -delay_type min_max -report_unconstrained -file final-timing.txt
set f [open final-timing.txt r]
set timing [read $f]
close $f
if {[string first "All user specified timing constraints are met." $timing] < 0} {
    error "Timing acceptance missing"
}
report_drc -file final-drc.txt
if {[llength [get_drc_violations -quiet]] != 0} {error "DRC violations remain"}
write_bitstream -force church_wukong_B1_corrected.bit
# UG908: -size is MiB, not Mbit. N25Q064 is 64 Mbit = 8 MiB.
write_cfgmem -format mcs -size 8 -interface SPIx4 \
    -loadbit "up 0x0 church_wukong_B1_corrected.bit" \
    -file church_wukong_B1_corrected.mcs -force
puts "CORRECTED_FILES_GENERATED_NO_BOARD_ACCESS"
exit
TCL
cat > "$OUT/verify_mcs.py" <<'PY'
from pathlib import Path
p = Path("church_wukong_B1_corrected.mcs")
base = 0
count = 0
end = 0
first = None
eof = False
for number, line in enumerate(p.read_text().splitlines(), 1):
    if not line.strip():
        continue
    if eof or not line.startswith(":"):
        raise SystemExit(f"Malformed MCS record at line {number}")
    record = bytes.fromhex(line[1:])
    if len(record) < 5 or len(record) != record[0] + 5 or sum(record) & 255:
        raise SystemExit(f"MCS checksum/length error at line {number}")
    n, address, kind = record[0], int.from_bytes(record[1:3], "big"), record[3]
    data = record[4:-1]
    if kind == 0:
        start = base + address
        if not n or start < end or start + n > 8 * 1024 * 1024:
            raise SystemExit("MCS data overlaps or exceeds the 8 MiB flash")
        if first is None:
            first = start
        end = start + n
        count += n
    elif kind in (2, 4):
        if n != 2 or address != 0:
            raise SystemExit("Malformed extended-address record")
        base = int.from_bytes(data, "big") << (4 if kind == 2 else 16)
    elif kind == 1:
        if n != 0 or address != 0:
            raise SystemExit("Malformed EOF record")
        eof = True
    else:
        raise SystemExit(f"Unexpected MCS record type {kind}")
if not eof or first != 0 or count < 1024:
    raise SystemExit("Incomplete MCS image")
print(f"MCS_RECORDS_PASS data_bytes={count} end_address_exclusive=0x{end:x} flash_bytes=8388608")
PY
cat > "$OUT/run.sh" <<'RUN'
#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
trap 'rc=$?; echo "$rc" > "$ROOT/exit-status"; echo "FILE_GENERATION_EXIT=$rc"' EXIT
exec 9>/tmp/church-vivado-build.lock
flock -n 9 || { echo "Another Vivado job owns the build lock"; exit 1; }
sha256sum -c checkpoint.sha256
source /opt/Xilinx/2026.1/Vivado/settings64.sh
timeout --kill-after=30s 3600s vivado -mode batch -source generate.tcl -log generate.log
sha256sum -c checkpoint.sha256
grep -q '^CORRECTED_FILES_GENERATED_NO_BOARD_ACCESS' generate.log
test -s church_wukong_B1_corrected.bit
test -s church_wukong_B1_corrected.mcs
python3 verify_mcs.py | tee mcs-validation.txt
cat > SCOPE.txt <<'SCOPE'
Frozen B.1 repair: distributed initializer ROM and removal of physical debug ports.
UART retained. Six constrained board pins. Clock remains 50 MHz.
Verified: 2693 initialization writes, boot LOAD, fault-free LOAD at 0x2E08.
Routed timing and strict I/O DRC checked before file generation.
MCS: SPIx4, address zero, 8 MiB N25Q064 capacity.
Not a full-program validation or physical-board certification.
No board access, programming, flashing, or reset was performed.
SCOPE
sha256sum church_wukong_B1_corrected.bit church_wukong_B1_corrected.mcs \
  checkpoint.sha256 generate.tcl launcher.sh verify_mcs.py final-timing.txt \
  final-drc.txt replay.log six-pin-evidence.tar.gz mcs-validation.txt SCOPE.txt \
  > SHA256SUMS
tar -czf B1-corrected-files.tar.gz church_wukong_B1_corrected.bit \
  church_wukong_B1_corrected.mcs SHA256SUMS checkpoint.sha256 generate.tcl \
  launcher.sh verify_mcs.py final-timing.txt final-drc.txt replay.log \
  six-pin-evidence.tar.gz mcs-validation.txt SCOPE.txt generate.log
cat SHA256SUMS
sha256sum B1-corrected-files.tar.gz
echo "FILES_READY_NO_BOARD_ACCESS"
RUN
bash -n "$OUT/run.sh"
nohup bash "$OUT/run.sh" > "$OUT/run.log" 2>&1 < /dev/null &
printf '\nStarted file generation. PID: %s\nDirectory: %s\n' "$!" "$OUT"
printf '\nWatch with:\ntail -n 70 -f %s/run.log\n' "$OUT"
