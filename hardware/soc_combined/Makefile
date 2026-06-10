.PHONY: check-util check-util-ci patch_sapphire firmware test-key-derive

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
