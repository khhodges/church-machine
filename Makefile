.PHONY: bitstream bitstream-flash readiness update-lump

readiness:
	python3 scripts/check_hardware_namespace_thread_readiness.py

bitstream: readiness
	bash scripts/build_ti60_bitstream.sh

bitstream-flash: readiness
	bash scripts/build_ti60_bitstream.sh --flash

update-lump:
	node scripts/update-lump.js --token $(TOKEN)
