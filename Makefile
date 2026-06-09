.PHONY: bitstream

bitstream:
	bash scripts/build_ti60_bitstream.sh

bitstream-flash:
	bash scripts/build_ti60_bitstream.sh --flash
