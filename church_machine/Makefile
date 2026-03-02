# Church Machine — pico-ice build (Yosys + NextPNR + IcePack)
#
# Prerequisites:
#   sudo apt install yosys nextpnr-ice40 fpga-icestorm
#   — or — install via oss-cad-suite
#
# Usage:
#   make verilog   — generate Verilog from Amaranth
#   make synth     — synthesize with Yosys
#   make pnr       — place and route with NextPNR (~3-5 min)
#   make pack      — create bitstream with IcePack
#   make uf2       — convert to UF2 for drag-and-drop flash
#   make prog      — upload to pico-ice
#   make all       — full build chain (UART-enabled)
#   make clean     — remove build artifacts
#
# Two build targets:
#   UART-enabled (default): UartTestTop — UART data loader + auto-boot fallback
#   Standalone:             ChurchPicoIce — Switch-based init, no UART RX

DEVICE   := up5k
PACKAGE  := sg48
PCF      := pico_ice.pcf

BUILD    := ../build
FREQ_MHZ := 12

PROJ     := uart_test
VERILOG  := $(BUILD)/uart_test.v
JSON     := $(BUILD)/$(PROJ).json
ASC      := $(BUILD)/$(PROJ).asc
BIT      := $(BUILD)/$(PROJ).bin
UF2      := $(BUILD)/$(PROJ).uf2
TIMING   := $(BUILD)/$(PROJ)_timing.txt

.PHONY: all verilog synth pnr pack prog clean report uf2

all: pack

verilog:
	cd .. && python -m church_machine.gen_verilog --uart-test

synth: $(JSON)
$(JSON): $(VERILOG) $(PCF)
	@mkdir -p $(BUILD)
	yosys -p "read_verilog $(VERILOG); synth_ice40 -top top; delete t:\$$scopeinfo; write_json $(JSON)" > $(BUILD)/synth.log 2>&1
	@echo "=== Resource usage ==="
	@grep -A 20 "Printing statistics" $(BUILD)/synth.log || true

pnr: $(ASC)
$(ASC): $(JSON)
	nextpnr-ice40 \
	        --$(DEVICE) \
	        --package $(PACKAGE) \
	        --pcf $(PCF) \
	        --pcf-allow-unconstrained \
	        --json $(JSON) \
	        --asc $(ASC) \
	        --freq $(FREQ_MHZ) \
	        --placer sa \
	        --report $(BUILD)/$(PROJ)_report.json \
	        2>&1 | tee $(BUILD)/pnr.log
	@echo "=== Timing ==="
	@grep -i "max frequency\|critical path\|slack" $(BUILD)/pnr.log || true

pack: $(BIT)
$(BIT): $(ASC)
	icepack $(ASC) $(BIT)
	@echo "Bitstream: $(BIT) ($$(wc -c < $(BIT)) bytes)"

timing: $(ASC)
	icetime -d $(DEVICE) -p $(PCF) -t $(ASC) > $(TIMING)
	@cat $(TIMING)

uf2: $(UF2)
$(UF2): $(BIT)
	python3 church_machine_uf2.py $(BIT) $(UF2)

prog: $(BIT)
	@echo "=== Upload to pico-ice ==="
	@echo "DFU flash (CRAM, immediate):"
	@echo "  sudo dfu-util -d 1209:b1c0 --alt 1 --download $(BIT)"
	@echo ""
	@echo "Then upload data (namespace + c-list):"
	@echo "  python -m church_machine.upload --port /dev/ttyACM1"
	@echo ""
	@echo "Or wait ~1s for auto-boot with built-in defaults."
	@echo ""
	@echo "Expected output:"
	@echo "  CHURCH v1.0"
	@echo "  <NIA hex>"
	@echo "  HALT"

report: $(JSON)
	@python3 -c "\
	import json; \
	r = json.load(open('$(BUILD)/$(PROJ)_report.json')); \
	u = r.get('utilization',{}); \
	print('=== iCE40UP5K Resource Utilization ==='); \
	print(f'  LUTs:     {u.get(\"ICESTORM_LC\",{}).get(\"used\",\"?\")} / 5280'); \
	print(f'  DFFs:     {u.get(\"ICESTORM_LC\",{}).get(\"used\",\"?\")}'); \
	print(f'  BRAM:     {u.get(\"ICESTORM_RAM\",{}).get(\"used\",\"?\")} / 30 (4Kbit each)'); \
	print(f'  SPRAM:    {u.get(\"ICESTORM_SPRAM\",{}).get(\"used\",\"?\")} / 4 (256Kbit each)'); \
	print(f'  DSP:      {u.get(\"ICESTORM_DSP\",{}).get(\"used\",\"?\")} / 8')"

clean:
	rm -f $(JSON) $(ASC) $(BIT) $(UF2) $(TIMING)
	rm -f $(BUILD)/synth.log $(BUILD)/pnr.log $(BUILD)/$(PROJ)_report.json
