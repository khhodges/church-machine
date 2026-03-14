# Church Machine — Tang Nano 20K build (NextPNR-Himbaechel + Gowin Pack)
#
# Prerequisites:
#   Install oss-cad-suite: https://github.com/YosysHQ/oss-cad-suite-build/releases
#   source oss-cad-suite/environment
#
# Usage:
#   make pnr pack  — place-and-route + generate .fs bitstream
#   make prog      — flash to Tang Nano 20K via openFPGALoader (plug in USB-C first)
#   make clean     — remove generated files

DEVICE   := GW2AR-LV18QN88C8/I7
FAMILY   := GW2A-18C
FREQ_MHZ := 27

PROJ     := church_tang_nano_20k
JSON     := $(PROJ).json
PNR_JSON := $(PROJ)_pnr.json
PACK     := $(PROJ).fs
CST      := tang_nano_20k.cst

.PHONY: pnr pack prog clean

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

clean:
	rm -f $(PNR_JSON) $(PACK)
