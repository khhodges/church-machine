# =============================================================================
# startup_config_layout.py — Startup.Config lump layout constants (Python)
# =============================================================================
#
# Single source of truth for the Startup.Config lump layout on the Python side.
# JavaScript mirror: simulator/startup_config_layout.js
#
# If the layout changes, update both files together.
#
# Lump layout (64 words total, cw=3, cc=1):
#   word  0         : lump header
#   words 1-3       : code region (3 CLOOMC instructions)
#   words 4-62      : data region (59 words = keys 0..58)
#     word 4  (key 0) : entry_slot
#     word 5  (key 1) : config_version
#     word 6  (key 2) : flags               ← SC_FLAGS_WORD
#     word 7  (key 3) : fault_count         ← SC_FAULT_COUNT_WORD
#     words 8-62      : user params (keys 4..58)
#   word 63         : c-list slot 0 (configured entry E-GT)

SC_DATA_OFFSET      = 4   # first data word index in lump (after header + 3-word code region)
SC_LAST_DATA_KEY    = 58  # last valid ReadParam / WriteParam key  (lump word 62)
SC_OOB_KEY          = 59  # first out-of-bounds key (would reach c-list at word 63)
SC_FLAGS_WORD       = 6   # absolute lump word index for flags      (data key 2)
SC_FAULT_COUNT_WORD = 7   # absolute lump word index for fault_count (data key 3)
