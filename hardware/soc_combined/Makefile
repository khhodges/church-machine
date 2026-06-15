.PHONY: check-util check-util-ci patch_sapphire firmware test-key-derive test-sha32 \
        bitstream bitstream-flash

SCRIPTS_DIR := $(shell git rev-parse --show-toplevel 2>/dev/null)/scripts
ifeq ($(SCRIPTS_DIR),/scripts)
SCRIPTS_DIR := ../../scripts
endif

SYM_PREFIX := EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol

check-util:
	python $(SCRIPTS_DIR)/check_ti60_utilisation.py --report-dir work_syn

check-util-ci:
	python $(SCRIPTS_DIR)/check_ti60_utilisation.py --report-dir work_syn --missing-ok

firmware:
	$(MAKE) -C firmware clean
	$(MAKE) -C firmware

patch_sapphire: $(SYM_PREFIX)0.bin
	python3 $(SCRIPTS_DIR)/patch_sapphire_init.py sapphire.v \
		$(SYM_PREFIX)0.bin \
		$(SYM_PREFIX)1.bin \
		$(SYM_PREFIX)2.bin \
		$(SYM_PREFIX)3.bin

$(SYM_PREFIX)0.bin: firmware

# ---------------------------------------------------------------------------
# bitstream — full safe build sequence for the Ti60 SoC+CM bitstream.
#
# Runs every step in order; aborts immediately on any error (set -euo pipefail
# is already in each shell script, and make exits on non-zero recipe status).
#
# Steps:
#   1. firmware      — cross-compile RISC-V firmware; generates symbol .bin files
#   2. prep_syn.sh   — copy symbol .bin files into work_syn/ for EFX_MAP
#   3. patch_sapphire — embed firmware bytes into sapphire.v initial-blocks
#   4. run_efx_map.sh  — strip banned XML params + synthesise (efx_map)
#   5. run_efx_pnr.sh  — Interface Designer IO placement + Place & Route (efx_pnr)
#   6. run_efx_pgm.sh  — bitstream hex generation (efx_pgm)
#
# Usage (from hardware/soc_combined/ or repo root):
#   make bitstream
#   make -C hardware/soc_combined bitstream
# ---------------------------------------------------------------------------
bitstream:
	@echo "========================================"
	@echo "make bitstream — full Ti60 build sequence"
	@echo "========================================"
	@echo ""
	@echo "==> Step 1/6: Firmware build ..."
	$(MAKE) firmware
	@echo ""
	@echo "==> Step 2/6: prep_syn.sh — copy BRAM symbol files to work_syn/ ..."
	bash scripts/prep_syn.sh
	@echo ""
	@echo "==> Step 3/6: patch_sapphire_init.py — embed firmware into sapphire.v ..."
	$(MAKE) patch_sapphire
	@echo ""
	@echo "==> Step 4/6: Synthesis (efx_map) ..."
	bash run_efx_map.sh
	@echo ""
	@echo "==> Step 5/6: Place & Route (efx_pnr) ..."
	bash run_efx_pnr.sh
	@echo ""
	@echo "==> Step 6/6: Bitstream generation (efx_pgm) ..."
	bash run_efx_pgm.sh
	@echo ""
	@echo "========================================"
	@echo "make bitstream COMPLETE"
	@echo "Flash with:  make bitstream-flash"
	@echo "========================================"

# ---------------------------------------------------------------------------
# bitstream-flash — flash the generated hex to the Ti60 via JTAG.
#
# Depends on bitstream so a plain 'make bitstream-flash' always rebuilds first.
# Override PROJECT to point at a different Efinity project XML if needed.
# ---------------------------------------------------------------------------
PROJECT ?= $(HOME)/church_project/SoC_minimal/church_soc.xml
CIRCUIT := $(basename $(notdir $(PROJECT)))
HEX     := $(dir $(PROJECT))outflow/$(CIRCUIT).hex

bitstream-flash: bitstream
	@echo "==> Flashing $(HEX) to Ti60F225 ..."
	sudo openFPGALoader -b titanium_ti60_f225_jtag -f "$(HEX)"
	@echo "==> Flash complete."

# ---------------------------------------------------------------------------
# test-key-derive — compile and run the host-side C key derivation test.
#
# Uses the local host GCC (not the RISC-V cross-compiler).
# No hardware required.  Verifies cm_derive_keys() byte-for-byte against
# the canonical vectors in hardware/key_derive_vectors.h.
#
# Source file is hardware/key_derive_test.c; sha256.h and key_derive_vectors.h
# are both in hardware/ so GCC's source-relative search finds them without -I.
#
# Usage:
#   make test-key-derive           (from hardware/soc_combined/)
#   make -C hardware/soc_combined test-key-derive   (from repo root)
# ---------------------------------------------------------------------------
test-key-derive:
	gcc -O2 -Wall -Wextra \
		-o /tmp/key_derive_test \
		../key_derive_test.c \
		&& /tmp/key_derive_test

# ---------------------------------------------------------------------------
# test-sha32 — run the cross-language sha32/HKDF vector suite.
#
# Two steps:
#   1. Host C: compiles hardware/sha32_test.c with GCC and runs it.  Verifies
#      the C sha32() and hkdf_sha256() implementations against all shared
#      vectors (9 Core OGTs + 5 edge cases including 255-char and Unicode).
#   2. Python: runs scripts/test_sha32_vectors.py with pytest.  Verifies the
#      Python reference implementation and callhome_bridge.sha32() against the
#      same table.
#
# Both must pass.  No hardware required.
#
# Usage:
#   make test-sha32                        (from hardware/soc_combined/)
#   make -C hardware/soc_combined test-sha32   (from repo root)
# ---------------------------------------------------------------------------
test-sha32:
	gcc -O2 -Wall \
		-o /tmp/sha32_test \
		../sha32_test.c \
		&& /tmp/sha32_test
	python3 -m pytest $(SCRIPTS_DIR)/test_sha32_vectors.py -v
