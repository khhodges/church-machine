.PHONY: bitstream bitstream-flash update-lump

bitstream:
	bash scripts/build_ti60_bitstream.sh

bitstream-flash:
	bash scripts/build_ti60_bitstream.sh --flash

update-lump:
	node scripts/update-lump.js --token $(TOKEN)
