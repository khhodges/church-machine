#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for test in test_compiler_node_dependency test_mint_compiler_baseline test_lump_api_contract test_lump_api_codec test_canonical_api_browser_compile test_mint_slot_descriptor test_mint_word_address_demo test_mint_pkverify_call; do
    node "simulator/${test}.js"
done
node simulator/test_mint_stub_lump.js
