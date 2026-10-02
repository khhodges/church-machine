#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node simulator/test_compact_load_save.js
node simulator/test_compact_clist_mutation.js
node simulator/test_compiler_method_assembly.js
node tests/simulator/sim_load_through_l_perm_cr6.js
node tests/simulator/sim_call_cr6_l_perm.js
node tests/simulator/sim_return_cr6_l_perm.js
node tests/simulator/sim_return_fetch_lump.js
node simulator/test_compile_candidate_clist_validation.js
node simulator/test_lump_save_boundaries.js
node simulator/test_instruction_commentary_static.js