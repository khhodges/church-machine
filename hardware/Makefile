# Church Machine — Tang Nano 20K build (NextPNR-Himbaechel + Gowin Pack)
#
# Prerequisites:
#   Install oss-cad-suite: https://github.com/YosysHQ/oss-cad-suite-build/releases
#   source oss-cad-suite/environment
#
# Usage:
#   make pnr pack       — full profile: place-and-route + generate .fs bitstream
#   make tang-iot        — IoT profile: generate Verilog + place-and-route + pack
#   make prog            — flash full profile to Tang Nano 20K
#   make prog-iot        — flash IoT profile to Tang Nano 20K
#   make ti60            — generate synthesis-ready Verilog + resource report for Ti60 F225
#   make clean           — remove generated files

DEVICE   := GW2AR-LV18QN88C8/I7
FAMILY   := GW2A-18C
FREQ_MHZ := 27

PROJ     := church_tang_nano_20k
JSON     := $(PROJ).json
PNR_JSON := $(PROJ)_pnr.json
PACK     := $(PROJ).fs
CST      := tang_nano_20k.cst

PROJ_IOT     := church_tang_nano_20k_iot
JSON_IOT     := $(PROJ_IOT).json
PNR_JSON_IOT := $(PROJ_IOT)_pnr.json
PACK_IOT     := $(PROJ_IOT).fs

.PHONY: pnr pack prog tang-iot pnr-iot pack-iot prog-iot clean ti60

pnr: $(PNR_JSON)
$(PNR_JSON): $(JSON) $(CST)
	nextpnr-himbaechel \
		--device $(DEVICE) \
		--json $(JSON) \
		--write $(PNR_JSON) \
		-o family=$(FAMILY) \
		-o cst=$(CST) \
		--freq $(FREQ_MHZ)

pack: $(PACK)
$(PACK): $(PNR_JSON)
	gowin_pack -d $(FAMILY) -o $(PACK) $(PNR_JSON)

prog: $(PACK)
	@echo "=== Uploading to Tang Nano 20K ==="
	openFPGALoader -b tangnano20k $(PACK)

tang-iot: pack-iot

pnr-iot: $(PNR_JSON_IOT)
$(PNR_JSON_IOT): $(JSON_IOT) $(CST)
	nextpnr-himbaechel \
		--device $(DEVICE) \
		--json $(JSON_IOT) \
		--write $(PNR_JSON_IOT) \
		-o family=$(FAMILY) \
		-o cst=$(CST) \
		--freq $(FREQ_MHZ)

pack-iot: $(PACK_IOT)
$(PACK_IOT): $(PNR_JSON_IOT)
	gowin_pack -d $(FAMILY) -o $(PACK_IOT) $(PNR_JSON_IOT)

prog-iot: $(PACK_IOT)
	@echo "=== Uploading IoT profile to Tang Nano 20K ==="
	openFPGALoader -b tangnano20k $(PACK_IOT)

ti60:
	@echo "=== Ti60 F225 Build Flow ==="
	cd .. && ./build_ti60.sh build

clean:
	rm -f $(PNR_JSON) $(PACK) $(PNR_JSON_IOT) $(PACK_IOT)
